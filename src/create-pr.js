#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CATALOG_FILE, readApps } = require("./catalog.js");
const { renderPrBody } = require("./render-pr-body.js");

function run(command, args, cwd, options = {}) {
    return execFileSync(command, args, {
        cwd,
        encoding: "utf8",
        stdio: options.capture ? "pipe" : "inherit",
    });
}

function main() {
    const reportPath = path.resolve(process.argv[2] || "");
    if (!process.argv[2] || !fs.existsSync(reportPath)) {
        throw new Error("Usage: create-pr.js RUN/applied-report.json");
    }
    readApps(CATALOG_FILE);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    if (!report.appliedAt) {
        throw new Error("The supplied report has not passed manual apply");
    }

    const checkout = fs.mkdtempSync(
        path.join(os.tmpdir(), "community-app-operator-"),
    );
    try {
        run(
            "gh",
            ["repo", "clone", "pollinations/pollinations", checkout, "--", "--depth=1"],
            process.cwd(),
        );
        const branch = `auto/community-app-review-${new Date()
            .toISOString()
            .replace(/[:.]/g, "-")}`;
        run("git", ["switch", "-c", branch], checkout);
        fs.copyFileSync(CATALOG_FILE, path.join(checkout, "apps/catalog.json"));
        run("node", [".github/scripts/app-update-greenhouse.js"], checkout);
        run("node", [".github/scripts/app-validate-catalog.js"], checkout);
        const changed = run("git", ["status", "--porcelain"], checkout, {
            capture: true,
        }).trim();
        if (!changed) throw new Error("The approved review produced no diff");

        const bodyPath = path.join(checkout, ".git", "community-app-pr.md");
        fs.writeFileSync(bodyPath, renderPrBody(report, null));
        run("git", ["add", "apps/catalog.json", "apps/GREENHOUSE.md"], checkout);
        run("git", ["commit", "-m", "chore: update community app catalog"], checkout);
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
                "chore: update community app catalog",
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

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
