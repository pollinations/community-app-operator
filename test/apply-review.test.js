const assert = require("node:assert/strict");
const test = require("node:test");
const { selectApprovedResults } = require("../src/apply-review.js");

const keep = {
    name: "Keep me",
    outcome: "keep",
    targetUrl: "https://keep.test",
};
const remove = {
    name: "Remove me",
    outcome: "remove",
    targetUrl: "https://remove.test",
};

test("applies only decisions explicitly approved by a human", () => {
    assert.deepEqual(
        selectApprovedResults(
            { results: [keep, remove] },
            {
                decisions: [
                    { ...keep, apply: true },
                    { ...remove, apply: false },
                ],
            },
        ),
        [keep],
    );
});

test("rejects stale or unsupported manual decisions", () => {
    assert.throws(
        () =>
            selectApprovedResults(
                { results: [keep] },
                {
                    decisions: [
                        {
                            ...keep,
                            apply: true,
                            outcome: "remove",
                        },
                    ],
                },
            ),
        /no longer matches/,
    );
    assert.throws(
        () =>
            selectApprovedResults(
                { results: [keep] },
                { decisions: [{ ...keep, apply: false }] },
            ),
        /No decisions have apply=true/,
    );
});
