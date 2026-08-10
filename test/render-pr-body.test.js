const assert = require("node:assert/strict");
const test = require("node:test");
const { renderPrBody } = require("../src/render-pr-body.js");

const manifest = {
    metadataUpdates: [
        {
            changes: [{ field: "name", from: "Old", to: "New" }],
            name: "New",
        },
    ],
    removedApps: [
        {
            evidence: "DNS failure | twice",
            name: "Dead",
            reason: "Host does not exist",
            targetUrl: "https://dead.test",
        },
    ],
    screenshotUpdates: [
        {
            name: "Image App",
            to: "https://media.pollinations.ai/image",
        },
    ],
};

test("renders kind-specific PR bodies", () => {
    const metadata = renderPrBody(manifest, "metadata");
    assert.match(metadata, /Corrects metadata for 1/);
    assert.match(metadata, /\| New \| name \| Old \| New \|/);
    assert.doesNotMatch(metadata, /Host does not exist/);

    const removals = renderPrBody(manifest, "removals");
    assert.match(removals, /Removes 1 catalog rows/);
    assert.match(removals, /DNS failure &#124; twice/);
    assert.doesNotMatch(removals, /media\.pollinations/);

    const screenshots = renderPrBody(manifest, "screenshots");
    assert.match(screenshots, /screenshots for 1 retained/);
    assert.match(screenshots, /https:\/\/media\.pollinations\.ai\/image/);
    assert.doesNotMatch(screenshots, /Host does not exist/);
});

test("rejects unknown PR kinds", () => {
    assert.throws(() => renderPrBody(manifest, "combined"), /kind must be/);
});
