#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { readApps, writeApps } = require("./catalog.js");
const {
    applyCatalogChanges,
    runWorkers,
    uploadScreenshot,
} = require("./review.js");

function selectApprovedResults(report, review) {
    if (!Array.isArray(report.results) || !Array.isArray(review.decisions)) {
        throw new Error("The report or manual review file is invalid");
    }
    const approved = review.decisions.filter((decision) => decision.apply);
    if (approved.length === 0) {
        throw new Error("No decisions have apply=true");
    }

    const results = new Map(
        report.results.map((result) => [
            `${result.targetUrl}\n${result.outcome}`,
            result,
        ]),
    );
    return approved.map((decision) => {
        const result = results.get(
            `${decision.targetUrl}\n${decision.outcome}`,
        );
        if (!result || !["keep", "remove"].includes(decision.outcome)) {
            throw new Error(
                `Manual decision no longer matches the report: ${decision.name}`,
            );
        }
        return result;
    });
}

async function main() {
    const reportPath = path.resolve(process.argv[2] || "");
    if (!process.argv[2] || !fs.existsSync(reportPath)) {
        throw new Error("Usage: apply-review.js RUN/report.json");
    }
    const reviewPath = path.join(path.dirname(reportPath), "review.json");
    if (!fs.existsSync(reviewPath)) {
        throw new Error(`Manual review file not found: ${reviewPath}`);
    }

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
    const selected = selectApprovedResults(report, review);
    const covers = selected.filter((result) => result.outcome === "keep");
    const token = process.env.COMMUNITY_APP_MANAGEMENT_KEY;
    if (covers.length > 0 && !token) {
        throw new Error("COMMUNITY_APP_MANAGEMENT_KEY missing");
    }

    const uploads = await runWorkers(covers, 2, "Uploading", (result) =>
        uploadScreenshot(result, token, 30000),
    );
    const failedUploads = uploads.filter((upload) => !upload.success);
    if (failedUploads.length > 0) {
        throw new Error(
            `${failedUploads.length} cover upload(s) failed; catalog unchanged`,
        );
    }

    const update = applyCatalogChanges(readApps(), uploads, selected);
    writeApps(update.apps);
    const appliedReport = {
        ...report,
        appliedAt: new Date().toISOString(),
        catalogRowsUpdated: update.updatedApps.length,
        metadataRowsUpdated: update.metadataRowsUpdated,
        removedApps: update.removedApps,
        updatedApps: update.updatedApps,
        uploads,
    };
    const appliedReportPath = path.join(
        path.dirname(reportPath),
        "applied-report.json",
    );
    fs.writeFileSync(
        appliedReportPath,
        `${JSON.stringify(appliedReport, null, 2)}\n`,
    );
    console.log(
        `Applied ${update.updatedApps.length} update(s) and ${update.removedApps.length} removal(s)`,
    );
    console.log(`Catalog: ${path.resolve("workspace/catalog.json")}`);
    console.log(`Applied report: ${appliedReportPath}`);
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}

module.exports = { selectApprovedResults };
