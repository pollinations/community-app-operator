const assert = require("node:assert/strict");
const test = require("node:test");
const {
    parseBoolean,
    recordDecision,
} = require("../src/record-review.js");

test("records a browser verdict without approving it by default", () => {
    const review = {
        decisions: [
            {
                apply: false,
                id: "target-id",
                name: "App",
                outcome: "pending",
                targetUrl: "https://app.test",
            },
        ],
    };
    const result = recordDecision(review, {
        apply: false,
        evidence: "Visible matching interface",
        id: "target-id",
        outcome: "keep",
        reason: "The public app matches the catalog entry.",
    });
    assert.equal(result.outcome, "keep");
    assert.equal(result.apply, false);
    assert.ok(result.reviewedAt);
});

test("rejects applied retry decisions and invalid booleans", () => {
    assert.throws(() => parseBoolean("yes"), /true or false/);
    assert.throws(
        () =>
            recordDecision(
                {
                    decisions: [
                        {
                            id: "target-id",
                            name: "App",
                            targetUrl: "https://app.test",
                        },
                    ],
                },
                {
                    apply: true,
                    id: "target-id",
                    outcome: "retry",
                    reason: "Temporary provider error.",
                },
            ),
        /cannot be applied/,
    );
});
