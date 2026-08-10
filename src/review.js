#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { CATALOG_FILE, readApps } = require("./catalog.js");
const { diffCatalogs } = require("./catalog-diff.js");

const MODES = new Set(["all", "missing", "refresh"]);
const REPOSITORY_COVER_PLATFORMS = new Set(["cli"]);

function getArgument(name) {
    const prefix = `--${name}=`;
    return process.argv
        .find((value) => value.startsWith(prefix))
        ?.slice(prefix.length);
}

function readInteger(name, fallback, minimum = 1) {
    const argument = getArgument(name);
    if (argument === undefined) return fallback;
    const value = Number(argument);
    if (!Number.isInteger(value) || value < minimum) {
        throw new Error(`--${name} must be an integer >= ${minimum}`);
    }
    return value;
}

function normalizeHttpUrl(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const candidate = /^https?:\/\//.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
    let url;
    try {
        url = new URL(candidate);
    } catch {
        return null;
    }
    if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        !url.hostname.includes(".") ||
        net.isIP(url.hostname) ||
        /\s/.test(trimmed)
    ) {
        return null;
    }
    return /^https?:\/\//.test(trimmed) ? trimmed : url.href;
}

function isGitHubUrl(value) {
    try {
        return new URL(value).hostname.toLowerCase() === "github.com";
    } catch {
        return false;
    }
}

function resolveTarget(app, catalogIndex) {
    const platforms = String(app.platform || "")
        .split(",")
        .map((value) => value.trim());
    if (
        platforms.some((platform) =>
            REPOSITORY_COVER_PLATFORMS.has(platform),
        ) &&
        normalizeHttpUrl(app.repositoryUrl)
    ) {
        return {
            catalogIndex,
            source: "repository",
            targetUrl: normalizeHttpUrl(app.repositoryUrl),
        };
    }

    const url = normalizeHttpUrl(app.url);
    if (url) {
        return {
            catalogIndex,
            source: isGitHubUrl(url) ? "repository" : "website",
            targetUrl: url,
        };
    }

    const repositoryUrl = normalizeHttpUrl(app.repositoryUrl);
    if (repositoryUrl) {
        return {
            catalogIndex,
            source: "repository",
            targetUrl: repositoryUrl,
        };
    }
    return null;
}

function targetId(key) {
    return crypto.createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function metadataReviewItems(diff, candidate) {
    return diff.metadata.map((match) => {
        const key = JSON.stringify([
            match.baseIndex,
            match.candidateIndex,
            match.metadataChanges,
        ]);
        return {
            catalogIndex: match.baseIndex,
            changes: match.metadataChanges,
            id: targetId(`metadata:${key}`),
            name: candidate[match.candidateIndex].name,
        };
    });
}

function selectTargets(entries, mode = "all") {
    if (!MODES.has(mode)) {
        throw new Error(`--mode must be one of: ${[...MODES].join(", ")}`);
    }

    const targets = new Map();
    const skipped = [];
    for (const { app, catalogIndex } of entries) {
        const included =
            mode === "all" ||
            (mode === "missing" && !app.screenshotUrl) ||
            (mode === "refresh" && !!app.screenshotUrl);
        if (!included) continue;

        const resolved = resolveTarget(app, catalogIndex);
        if (!resolved) {
            skipped.push({
                catalogIndex,
                name: app.name,
                reason: "No reviewable website or repository URL",
            });
            continue;
        }

        const key = `${resolved.source}:${resolved.targetUrl}`;
        const existing = targets.get(key);
        if (existing) {
            existing.catalogIndices.push(catalogIndex);
            existing.names.push(app.name);
            existing.context.descriptions.push(app.description);
            existing.context.issueUrls.push(app.issueUrl);
            existing.context.repositoryUrls.push(app.repositoryUrl);
            continue;
        }

        targets.set(key, {
            catalogIndices: [catalogIndex],
            context: {
                descriptions: [app.description],
                issueUrls: [app.issueUrl],
                repositoryUrls: [app.repositoryUrl],
            },
            id: targetId(key),
            name: app.name,
            names: [app.name],
            source: resolved.source,
            targetUrl: resolved.targetUrl,
        });
    }
    return { skipped, targets: [...targets.values()] };
}

function calculateDailyBatch(totalTargets, batchSize, now = new Date()) {
    if (!Number.isInteger(totalTargets) || totalTargets < 0) {
        throw new Error("totalTargets must be a non-negative integer");
    }
    if (!Number.isInteger(batchSize) || batchSize < 1) {
        throw new Error("batchSize must be a positive integer");
    }
    const batchCount = Math.ceil(totalTargets / batchSize);
    if (batchCount === 0) return { batchCount: 0, batchIndex: 0, offset: 0 };
    const batchIndex = Math.floor(now.getTime() / 86_400_000) % batchCount;
    return {
        batchCount,
        batchIndex,
        offset: batchIndex * batchSize,
    };
}

function prepareReview(base, candidate, options = {}) {
    const mode = options.mode || "all";
    const limit = options.limit || Number.MAX_SAFE_INTEGER;
    const diff = candidate ? diffCatalogs(base, candidate) : null;
    const entries = diff
        ? diff.removed.map(({ app, baseIndex }) => ({
              app,
              catalogIndex: baseIndex,
          }))
        : base.map((app, catalogIndex) => ({ app, catalogIndex }));
    const selected = selectTargets(entries, mode);
    const batch = calculateDailyBatch(selected.targets.length, limit);
    return {
        batch,
        metadataChanges: diff ? metadataReviewItems(diff, candidate) : [],
        skipped: selected.skipped,
        targets: selected.targets.slice(batch.offset, batch.offset + limit),
        totalTargets: selected.targets.length,
    };
}

function runDirectory(now = new Date()) {
    return path.resolve(
        "runs",
        now.toISOString().replace(/[:.]/g, "-").replace("Z", ""),
    );
}

function writeReviewRun(basePath, candidatePath, options = {}) {
    const base = readApps(basePath);
    const candidate = candidatePath ? readApps(candidatePath) : null;
    const prepared = prepareReview(base, candidate, options);
    const directory = runDirectory();
    fs.mkdirSync(directory, { recursive: true });
    const baseSnapshot = path.join(directory, "base.catalog.json");
    const candidateSnapshot = candidate
        ? path.join(directory, "candidate.catalog.json")
        : null;
    fs.copyFileSync(basePath, baseSnapshot);
    if (candidateSnapshot) fs.copyFileSync(candidatePath, candidateSnapshot);

    const createdAt = new Date().toISOString();
    const report = {
        baseCatalog: path.basename(baseSnapshot),
        batch: prepared.batch,
        candidateCatalog: candidateSnapshot
            ? path.basename(candidateSnapshot)
            : null,
        createdAt,
        metadataChanges: prepared.metadataChanges,
        mode: options.mode || "all",
        results: prepared.targets,
        schemaVersion: 1,
        skipped: prepared.skipped,
        totalTargets: prepared.totalTargets,
    };
    const review = {
        createdAt,
        decisions: prepared.targets.map((target) => ({
            apply: false,
            evidence: null,
            id: target.id,
            name: target.name,
            outcome: "pending",
            reason: null,
            targetUrl: target.targetUrl,
        })),
        metadataDecisions: prepared.metadataChanges.map((change) => ({
            apply: false,
            id: change.id,
            name: change.name,
            outcome: "pending",
            reason: null,
        })),
        instructions:
            "Use Codex's in-app Browser to inspect every removal target and metadata correction. Set apply=true only after human approval.",
        schemaVersion: 1,
    };
    fs.writeFileSync(
        path.join(directory, "report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
    );
    fs.writeFileSync(
        path.join(directory, "review.json"),
        `${JSON.stringify(review, null, 2)}\n`,
    );
    return { directory, report, review };
}

function main() {
    const basePath = path.resolve(getArgument("base") || CATALOG_FILE);
    const candidateArgument = getArgument("candidate");
    const candidatePath = candidateArgument
        ? path.resolve(candidateArgument)
        : null;
    if (!fs.existsSync(basePath)) {
        throw new Error(`Base catalog not found: ${basePath}`);
    }
    if (candidatePath && !fs.existsSync(candidatePath)) {
        throw new Error(`Candidate catalog not found: ${candidatePath}`);
    }
    const result = writeReviewRun(basePath, candidatePath, {
        limit: readInteger("limit", 50),
        mode: getArgument("mode") || "all",
    });
    console.log(`Prepared ${result.report.results.length} browser reviews`);
    console.log(`Run: ${result.directory}`);
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
    calculateDailyBatch,
    normalizeHttpUrl,
    metadataReviewItems,
    prepareReview,
    resolveTarget,
    selectTargets,
    targetId,
    writeReviewRun,
};
