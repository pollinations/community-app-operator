const assert = require("node:assert/strict");
const test = require("node:test");
const {
    buildSplitCatalogs,
    validateReview,
} = require("../src/apply-review.js");

const base = [
    { name: "Keep", screenshotUrl: null, url: "https://keep.test" },
    { name: "Dead", screenshotUrl: null, url: "https://dead.test" },
    { name: "Old", screenshotUrl: null, url: "https://rename.test" },
];
const candidate = [
    {
        name: "Keep",
        screenshotUrl: "https://media.pollinations.ai/keep",
        url: "https://keep.test",
    },
    {
        name: "New",
        screenshotUrl: "https://media.pollinations.ai/new",
        url: "https://rename.test",
    },
];
const report = {
    results: [
        {
            catalogIndices: [1],
            id: "dead-id",
            name: "Dead",
            targetUrl: "https://dead.test",
        },
    ],
};

test("builds three isolated catalogs", () => {
    const review = {
        decisions: [
            {
                apply: true,
                evidence: "DNS does not resolve",
                id: "dead-id",
                name: "Dead",
                outcome: "remove",
                reason: "The public host does not exist.",
                targetUrl: "https://dead.test",
            },
        ],
    };
    const result = buildSplitCatalogs(base, candidate, report, review);

    assert.deepEqual(result.catalogs.metadata.map((app) => app.name), [
        "Keep",
        "Dead",
        "New",
    ]);
    assert.equal(result.catalogs.metadata[0].screenshotUrl, null);
    assert.deepEqual(result.catalogs.removals.map((app) => app.name), [
        "Keep",
        "Old",
    ]);
    assert.equal(result.catalogs.removals[0].screenshotUrl, null);
    assert.deepEqual(
        result.catalogs.screenshots.map((app) => app.screenshotUrl),
        [
            "https://media.pollinations.ai/keep",
            null,
            "https://media.pollinations.ai/new",
        ],
    );
    assert.equal(result.catalogs.screenshots[2].name, "Old");
});

test("rejects stale and unreasoned applied decisions", () => {
    assert.throws(
        () =>
            validateReview(report, {
                decisions: [
                    {
                        apply: true,
                        id: "dead-id",
                        name: "Dead",
                        outcome: "remove",
                        reason: null,
                        targetUrl: "https://dead.test",
                    },
                ],
            }),
        /needs a reason/,
    );
    assert.throws(
        () =>
            validateReview(report, {
                decisions: [
                    {
                        apply: false,
                        id: "dead-id",
                        name: "Dead",
                        outcome: "keep",
                        targetUrl: "https://changed.test",
                    },
                ],
            }),
        /no longer matches/,
    );
});
