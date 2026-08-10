const assert = require("node:assert/strict");
const test = require("node:test");
const {
    calculateDailyBatch,
    normalizeHttpUrl,
    prepareReview,
    resolveTarget,
    selectTargets,
    targetId,
} = require("../src/review.js");

function app(overrides = {}) {
    return {
        category: "image",
        description: "A test app",
        issueUrl: "https://github.com/pollinations/pollinations/issues/1",
        name: "Test App",
        platform: "web",
        repositoryUrl: null,
        screenshotUrl: null,
        url: "https://app.test",
        ...overrides,
    };
}

test("normalizes safe public URLs and rejects unsafe targets", () => {
    assert.equal(normalizeHttpUrl("app.test"), "https://app.test/");
    assert.equal(normalizeHttpUrl("https://app.test/path"), "https://app.test/path");
    assert.equal(normalizeHttpUrl("https://user:pass@app.test"), null);
    assert.equal(normalizeHttpUrl("http://127.0.0.1"), null);
});

test("uses repositories for CLI entries", () => {
    assert.deepEqual(
        resolveTarget(
            app({
                platform: "cli",
                repositoryUrl: "https://github.com/example/bot",
            }),
            4,
        ),
        {
            catalogIndex: 4,
            source: "repository",
            targetUrl: "https://github.com/example/bot",
        },
    );
});

test("uses public Discord installation URLs instead of stale repositories", () => {
    assert.deepEqual(
        resolveTarget(
            app({
                platform: "discord",
                repositoryUrl: "https://github.com/example/missing-bot",
                url: "https://discord.com/oauth2/authorize?client_id=123",
            }),
            5,
        ),
        {
            catalogIndex: 5,
            source: "website",
            targetUrl:
                "https://discord.com/oauth2/authorize?client_id=123",
        },
    );
});

test("groups duplicate catalog rows into one stable browser target", () => {
    const selected = selectTargets([
        { app: app(), catalogIndex: 3 },
        { app: app({ name: "Duplicate" }), catalogIndex: 9 },
    ]);
    assert.equal(selected.targets.length, 1);
    assert.deepEqual(selected.targets[0].catalogIndices, [3, 9]);
    assert.equal(
        selected.targets[0].id,
        targetId("website:https://app.test"),
    );
});

test("prepares only removals when a candidate catalog is supplied", () => {
    const base = [app({ name: "Keep" }), app({ name: "Remove", url: "https://remove.test" })];
    const candidate = [app({ name: "Keep", screenshotUrl: "https://media.pollinations.ai/keep" })];
    const prepared = prepareReview(base, candidate, { limit: 50 });
    assert.equal(prepared.totalTargets, 1);
    assert.equal(prepared.targets[0].name, "Remove");
    assert.deepEqual(prepared.targets[0].catalogIndices, [1]);
});

test("rotates deterministic daily batches", () => {
    const first = calculateDailyBatch(120, 50, new Date("2026-08-10T00:00:00Z"));
    const second = calculateDailyBatch(120, 50, new Date("2026-08-11T00:00:00Z"));
    assert.equal(first.batchCount, 3);
    assert.equal(second.batchIndex, (first.batchIndex + 1) % 3);
});
