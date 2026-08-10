#!/usr/bin/env node

const fs = require("node:fs");

function tableCell(value) {
    if (value == null || value === "") return "—";
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("|", "&#124;")
        .replace(/[\r\n]+/g, " ");
}

function renderMetadata(manifest) {
    const rows = manifest.metadataUpdates.flatMap((app) =>
        app.changes.map(
            (change) =>
                `| ${tableCell(app.name)} | ${tableCell(change.field)} | ${tableCell(change.from)} | ${tableCell(change.to)} |`,
        ),
    );
    return `## Summary

- Corrects metadata for ${manifest.metadataUpdates.length} community catalog rows.
- Does not remove apps or add screenshots.

| App | Field | Before | After |
| --- | --- | --- | --- |
${rows.join("\n") || "| — | — | — | — |"}
`;
}

function renderRemovals(manifest) {
    const decisions = manifest.decisions ?? {};
    const approvedTargets = decisions.remove ?? manifest.removedApps.length;
    const keptTargets = decisions.keep ?? 0;
    const retryTargets = decisions.retry ?? 0;
    const rows = manifest.removedApps.map(
        (app) =>
            `| ${tableCell(app.name)} | ${tableCell(app.targetUrl)} | ${tableCell(app.reason)} | ${tableCell(app.evidence)} |`,
    );
    return `## Summary

- Removes ${manifest.removedApps.length} catalog rows representing ${approvedTargets} approved review targets.
- Preserves ${keptTargets} verified apps and excludes ${retryTargets} inconclusive apps from this PR.
- Does not change retained-app metadata or screenshots.

| App | Reviewed target | Reason | Evidence |
| --- | --- | --- | --- |
${rows.join("\n") || "| — | — | — | — |"}
`;
}

function renderScreenshots(manifest) {
    const added = manifest.screenshotUpdates.filter(
        (app) => app.from == null || app.from === "",
    );
    const refreshed = manifest.screenshotUpdates.filter(
        (app) => app.from != null && app.from !== "",
    );
    const rows = refreshed.map(
        (app) => `| ${tableCell(app.name)} | ${tableCell(app.to)} |`,
    );
    return `## Summary

- Adds screenshots to ${added.length} retained community catalog rows.
- Refreshes screenshots for ${refreshed.length} retained community catalog rows.
- Does not remove apps or change other metadata.

## Refreshed screenshots

New screenshot additions are reviewable directly in the catalog diff. Previously
populated screenshot URLs that changed are listed below.

| App | New screenshot URL |
| --- | --- |
${rows.join("\n") || "| — | — |"}
`;
}

function renderPrBody(manifest, kind) {
    if (kind === "metadata") return renderMetadata(manifest);
    if (kind === "removals") return renderRemovals(manifest);
    if (kind === "screenshots") return renderScreenshots(manifest);
    throw new Error("kind must be metadata, removals, or screenshots");
}

if (require.main === module) {
    const [manifestPath, kind] = process.argv.slice(2);
    if (!manifestPath || !kind) {
        throw new Error(
            "Usage: render-pr-body.js RUN/split/manifest.json metadata|removals|screenshots",
        );
    }
    process.stdout.write(
        renderPrBody(JSON.parse(fs.readFileSync(manifestPath, "utf8")), kind),
    );
}

module.exports = { renderPrBody, tableCell };
