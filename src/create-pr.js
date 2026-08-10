#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readApps, writeApps } = require("./catalog.js");
const { applyChanges, diffCatalogs } = require("./catalog-diff.js");
const { KINDS } = require("./apply-review.js");
const { renderPrBody } = require("./render-pr-body.js");

const PRS = {
    metadata: {
        commit: "chore: correct community app metadata",
        title: "chore: correct community app metadata",
    },
    removals: {
        commit: "chore: remove unavailable community apps",
        title: "chore: remove unavailable community apps",
    },
    screenshots: {
        commit: "chore: backfill community app screenshots",
        title: "chore: backfill community app screenshots",
    },
};

function getArgument(name) {
    const prefix = `--${name}=`;
    return process.argv
        .find((value) => value.startsWith(prefix))
        ?.slice(prefix.length);
}

function run(command, args, cwd, options = {}) {
    return execFileSync(command, args, {
        cwd,
        encoding: "utf8",
        stdio: options.capture ? "pipe" : "inherit",
    });
}

function findExisting(checkout, candidates) {
    const found = candidates.find((candidate) =>
        fs.existsSync(path.join(checkout, candidate)),
    );
    if (!found) {
        throw new Error(`None of the expected scripts exist: ${candidates}`);
    }
    return found;
}

const IDENTITY_FIELDS = [
    "issueUrl",
    "githubUserId",
    "name",
    "url",
    "repositoryUrl",
    "submittedDate",
    "approvedDate",
];

function locateCurrentRow(apps, baseApp, used = new Set(), alternatives = []) {
    for (const identity of [baseApp, ...alternatives]) {
        const exact = apps
            .map((app, index) => ({ app, index }))
            .filter(({ app, index }) => {
                if (used.has(index)) return false;
                return IDENTITY_FIELDS.every(
                    (field) =>
                        JSON.stringify(app[field]) ===
                        JSON.stringify(identity[field]),
                );
            });
        if (exact.length > 0) {
            const index = exact[0].index;
            used.add(index);
            return index;
        }
    }
    throw new Error(`Could not locate current catalog row: ${baseApp.name}`);
}

function applyArtifactToCurrent(
    current,
    base,
    artifact,
    kind,
    identityCatalog = null,
) {
    const patch = diffCatalogs(base, artifact);
    const updated = JSON.parse(JSON.stringify(current));
    const used = new Set();

    if (kind === "metadata") {
        if (patch.removed.length || patch.screenshots.length) {
            throw new Error("Metadata artifact contains non-metadata changes");
        }
        for (const match of patch.metadata) {
            const currentIndex = locateCurrentRow(
                updated,
                base[match.baseIndex],
                used,
            );
            applyChanges(updated[currentIndex], match.metadataChanges);
        }
        return updated;
    }

    if (kind === "screenshots") {
        if (patch.removed.length || patch.metadata.length) {
            throw new Error("Screenshot artifact contains non-screenshot changes");
        }
        if (identityCatalog && identityCatalog.length !== base.length) {
            throw new Error("Screenshot identity catalog must align with the base");
        }
        for (const match of patch.screenshots) {
            const currentIndex = locateCurrentRow(
                updated,
                base[match.baseIndex],
                used,
                identityCatalog ? [identityCatalog[match.baseIndex]] : [],
            );
            applyChanges(updated[currentIndex], match.screenshotChanges);
        }
        return updated;
    }

    if (kind === "removals") {
        if (patch.metadata.length || patch.screenshots.length) {
            throw new Error("Removal artifact contains field changes");
        }
        const removalIndices = patch.removed.map(({ baseIndex }) =>
            locateCurrentRow(updated, base[baseIndex], used),
        );
        for (const index of removalIndices.sort((a, b) => b - a)) {
            updated.splice(index, 1);
        }
        return updated;
    }

    throw new Error(`Unsupported artifact kind: ${kind}`);
}

function main() {
    const manifestPath = path.resolve(process.argv[2] || "");
    const kind = getArgument("kind");
    if (!process.argv[2] || !fs.existsSync(manifestPath) || !KINDS.includes(kind)) {
        throw new Error(
            "Usage: create-pr.js RUN/split/manifest.json --kind=metadata|removals|screenshots",
        );
    }
    const catalogPath = path.join(
        path.dirname(manifestPath),
        `${kind}.catalog.json`,
    );
    const artifact = readApps(catalogPath);
    const runDirectory = path.dirname(path.dirname(manifestPath));
    const base = readApps(path.join(runDirectory, "base.catalog.json"));
    const metadataCatalogPath = path.join(
        path.dirname(manifestPath),
        "metadata.catalog.json",
    );
    const identityCatalog =
        kind === "screenshots" && fs.existsSync(metadataCatalogPath)
            ? readApps(metadataCatalogPath)
            : null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const checkout = fs.mkdtempSync(
        path.join(os.tmpdir(), `community-app-${kind}-`),
    );
    try {
        run(
            "gh",
            [
                "repo",
                "clone",
                "pollinations/pollinations",
                checkout,
                "--",
                "--depth=1",
            ],
            process.cwd(),
        );
        const branch = `auto/community-app-${kind}-${new Date()
            .toISOString()
            .replace(/[:.]/g, "-")}`;
        run("git", ["switch", "-c", branch], checkout);
        const checkoutCatalog = path.join(checkout, "apps/catalog.json");
        const current = readApps(checkoutCatalog);
        writeApps(
            applyArtifactToCurrent(
                current,
                base,
                artifact,
                kind,
                identityCatalog,
            ),
            checkoutCatalog,
        );

        const generator = findExisting(checkout, [
            "apps/app-management/generate-catalog-outputs.js",
            ".github/scripts/app-update-greenhouse.js",
        ]);
        run("node", [generator], checkout);
        const validator = findExisting(checkout, [
            "apps/app-management/catalog.js",
            ".github/scripts/app-validate-catalog.js",
        ]);
        run(
            "node",
            validator === "apps/app-management/catalog.js"
                ? [validator, "validate"]
                : [validator],
            checkout,
        );
        if (!run("git", ["status", "--porcelain"], checkout, { capture: true }).trim()) {
            throw new Error(`The ${kind} catalog produced no diff`);
        }

        const bodyPath = path.join(checkout, ".git", `${kind}-pr.md`);
        fs.writeFileSync(bodyPath, renderPrBody(manifest, kind));
        run("git", ["add", "apps/catalog.json", "apps/GREENHOUSE.md"], checkout);
        run("git", ["commit", "-m", PRS[kind].commit], checkout);
        run("git", ["push", "--set-upstream", "origin", branch], checkout);
        const url = run(
            "gh",
            [
                "pr",
                "create",
                "--repo",
                "pollinations/pollinations",
                "--base",
                "main",
                "--head",
                branch,
                "--draft",
                "--title",
                PRS[kind].title,
                "--body-file",
                bodyPath,
            ],
            checkout,
            { capture: true },
        ).trim();
        console.log(`Draft pull request: ${url}`);
    } finally {
        fs.rmSync(checkout, { force: true, recursive: true });
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}

module.exports = {
    PRS,
    applyArtifactToCurrent,
    findExisting,
    locateCurrentRow,
};
