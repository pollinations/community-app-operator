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
    metadataChanges: [
        {
            catalogIndex: 2,
            changes: [
                {
                    field: "name",
                    from: "Old",
                    fromPresent: true,
                    to: "New",
                    toPresent: true,
                },
            ],
            id: "rename-id",
            name: "New",
        },
    ],
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
        metadataDecisions: [
            {
                apply: true,
                id: "rename-id",
                name: "New",
                outcome: "approve",
                reason: "The live site confirms the new name.",
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
                metadataDecisions: [
                    {
                        apply: false,
                        id: "rename-id",
                        name: "New",
                        outcome: "pending",
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
                metadataDecisions: [
                    {
                        apply: false,
                        id: "rename-id",
                        name: "New",
                        outcome: "pending",
                    },
                ],
            }),
        /no longer matches/,
    );
});

test("does not apply rejected metadata corrections", () => {
    const result = buildSplitCatalogs(base, candidate, report, {
        decisions: [
            {
                apply: false,
                id: "dead-id",
                name: "Dead",
                outcome: "keep",
                targetUrl: "https://dead.test",
            },
        ],
        metadataDecisions: [
            {
                apply: false,
                id: "rename-id",
                name: "New",
                outcome: "reject",
                reason: "The current brand is still Old.",
            },
        ],
    });
    assert.equal(result.catalogs.metadata[2].name, "Old");
    assert.equal(result.manifest.metadataUpdates.length, 0);
    assert.equal(result.manifest.metadataDecisions.reject, 1);
});
