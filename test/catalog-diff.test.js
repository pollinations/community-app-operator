const assert = require("node:assert/strict");
const test = require("node:test");
const { applyChanges, diffCatalogs } = require("../src/catalog-diff.js");

test("separates metadata, removals, and screenshots without relying on row keys", () => {
    const base = [
        { name: "One", url: "https://one.test", screenshotUrl: null },
        { name: "Dead", url: "https://dead.test", screenshotUrl: null },
        { name: "Old Name", url: "https://three.test", screenshotUrl: null },
    ];
    const candidate = [
        {
            name: "One",
            url: "https://one.test",
            screenshotUrl: "https://media.pollinations.ai/one",
        },
        {
            name: "New Name",
            url: "https://three.test",
            screenshotUrl: "https://media.pollinations.ai/three",
        },
    ];
    const diff = diffCatalogs(base, candidate);
    assert.deepEqual(diff.removed.map((row) => row.baseIndex), [1]);
    assert.equal(diff.metadata.length, 1);
    assert.equal(diff.metadata[0].metadataChanges[0].field, "name");
    assert.equal(diff.screenshots.length, 2);
});

test("applies null values and field deletion distinctly", () => {
    const app = { name: "App", optional: "value" };
    applyChanges(app, [
        { field: "name", to: null, toPresent: true },
        { field: "optional", to: null, toPresent: false },
    ]);
    assert.deepEqual(app, { name: null });
});

test("rejects candidates containing added rows", () => {
    assert.throws(
        () => diffCatalogs([{ name: "One" }], [{ name: "One" }, { name: "Two" }]),
        /does not support added rows/,
    );
});
