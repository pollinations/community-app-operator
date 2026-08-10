#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { readApps, writeApps } = require("./catalog.js");
const { applyChanges, diffCatalogs } = require("./catalog-diff.js");

const KINDS = ["metadata", "removals", "screenshots"];

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function validateReview(report, review) {
    if (!Array.isArray(report.results) || !Array.isArray(review.decisions)) {
        throw new Error("The report or review file is invalid");
    }
    const targets = new Map(report.results.map((target) => [target.id, target]));
    for (const decision of review.decisions) {
        const target = targets.get(decision.id);
        if (!target || target.targetUrl !== decision.targetUrl) {
            throw new Error(
                `Review decision no longer matches the report: ${decision.name}`,
            );
        }
        if (
            decision.apply &&
            !["keep", "remove"].includes(decision.outcome)
        ) {
            throw new Error(
                `Applied decision has an unsupported outcome: ${decision.name}`,
            );
        }
        if (decision.apply && !decision.reason?.trim()) {
            throw new Error(`Applied decision needs a reason: ${decision.name}`);
        }
    }
    return targets;
}

function buildSplitCatalogs(base, candidate, report, review) {
    const targets = validateReview(report, review);
    const diff = diffCatalogs(base, candidate);
    const metadata = clone(base);
    const removals = clone(base);
    const screenshots = clone(base);

    for (const match of diff.metadata) {
        applyChanges(metadata[match.baseIndex], match.metadataChanges);
    }
    for (const match of diff.screenshots) {
        applyChanges(screenshots[match.baseIndex], match.screenshotChanges);
    }

    const approvedRemovalIndices = new Set();
    const removedApps = [];
    for (const decision of review.decisions) {
        if (!decision.apply || decision.outcome !== "remove") continue;
        const target = targets.get(decision.id);
        for (const catalogIndex of target.catalogIndices) {
            approvedRemovalIndices.add(catalogIndex);
            removedApps.push({
                evidence: decision.evidence,
                issueUrl: base[catalogIndex].issueUrl,
                name: base[catalogIndex].name,
                reason: decision.reason,
                targetUrl: decision.targetUrl,
            });
        }
    }

    const removalCatalog = removals.filter(
        (_app, index) => !approvedRemovalIndices.has(index),
    );
    const decisionsByOutcome = Object.fromEntries(
        ["keep", "pending", "remove", "retry"].map((outcome) => [
            outcome,
            review.decisions.filter((decision) => decision.outcome === outcome)
                .length,
        ]),
    );
    const metadataUpdates = diff.metadata.map((match) => ({
        changes: match.metadataChanges,
        name: candidate[match.candidateIndex].name,
    }));
    const screenshotUpdates = diff.screenshots.map((match) => ({
        from: match.screenshotChanges[0].from,
        name: candidate[match.candidateIndex].name,
        to: match.screenshotChanges[0].to,
    }));

    return {
        catalogs: {
            metadata,
            removals: removalCatalog,
            screenshots,
        },
        manifest: {
            baseRows: base.length,
            candidateRows: candidate.length,
            decisions: decisionsByOutcome,
            generatedAt: new Date().toISOString(),
            metadataUpdates,
            removedApps,
            screenshotUpdates,
        },
    };
}

function writeSplitCatalogs(reportPath) {
    const directory = path.dirname(reportPath);
    const reviewPath = path.join(directory, "review.json");
    if (!fs.existsSync(reviewPath)) {
        throw new Error(`Review file not found: ${reviewPath}`);
    }
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    if (!report.candidateCatalog) {
        throw new Error("A candidate catalog is required to split changes");
    }
    const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
    const base = readApps(path.join(directory, report.baseCatalog));
    const candidate = readApps(path.join(directory, report.candidateCatalog));
    const result = buildSplitCatalogs(base, candidate, report, review);
    const outputDirectory = path.join(directory, "split");
    fs.mkdirSync(outputDirectory, { recursive: true });
    for (const kind of KINDS) {
        writeApps(
            result.catalogs[kind],
            path.join(outputDirectory, `${kind}.catalog.json`),
        );
    }
    fs.writeFileSync(
        path.join(outputDirectory, "manifest.json"),
        `${JSON.stringify(result.manifest, null, 2)}\n`,
    );
    return { ...result, outputDirectory };
}

function main() {
    const reportPath = path.resolve(process.argv[2] || "");
    if (!process.argv[2] || !fs.existsSync(reportPath)) {
        throw new Error("Usage: apply-review.js RUN/report.json");
    }
    const result = writeSplitCatalogs(reportPath);
    console.log(
        `Prepared ${result.manifest.metadataUpdates.length} metadata update(s), ${result.manifest.removedApps.length} removal(s), and ${result.manifest.screenshotUpdates.length} screenshot update(s)`,
    );
    console.log(`Split catalogs: ${result.outputDirectory}`);
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
    KINDS,
    buildSplitCatalogs,
    validateReview,
    writeSplitCatalogs,
};
