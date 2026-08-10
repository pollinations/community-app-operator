#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const OUTCOMES = new Set(["keep", "remove", "retry"]);

function getArgument(name) {
    const prefix = `--${name}=`;
    return process.argv
        .find((value) => value.startsWith(prefix))
        ?.slice(prefix.length);
}

function parseBoolean(value, fallback = false) {
    if (value === undefined) return fallback;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new Error("--apply must be true or false");
}

function recordDecision(review, input) {
    if (!Array.isArray(review.decisions)) {
        throw new Error("Review file does not contain a decisions array");
    }
    if (!OUTCOMES.has(input.outcome)) {
        throw new Error("--outcome must be keep, remove, or retry");
    }
    if (!input.reason?.trim()) {
        throw new Error("--reason is required");
    }
    if (input.apply && input.outcome === "retry") {
        throw new Error("A retry decision cannot be applied");
    }
    const decision = review.decisions.find((item) => item.id === input.id);
    if (!decision) throw new Error(`Unknown review target: ${input.id}`);
    Object.assign(decision, {
        apply: input.apply,
        evidence: input.evidence || null,
        outcome: input.outcome,
        reason: input.reason.trim(),
        reviewedAt: new Date().toISOString(),
    });
    return decision;
}

function main() {
    const reviewPath = path.resolve(process.argv[2] || "");
    if (!process.argv[2] || !fs.existsSync(reviewPath)) {
        throw new Error(
            "Usage: record-review.js RUN/review.json --id=ID --outcome=keep|remove|retry --reason=TEXT [--evidence=TEXT] [--apply=true]",
        );
    }
    const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
    const decision = recordDecision(review, {
        apply: parseBoolean(getArgument("apply")),
        evidence: getArgument("evidence"),
        id: getArgument("id"),
        outcome: getArgument("outcome"),
        reason: getArgument("reason"),
    });
    fs.writeFileSync(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
    console.log(`${decision.outcome}: ${decision.name} (${decision.id})`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}

module.exports = { parseBoolean, recordDecision };
