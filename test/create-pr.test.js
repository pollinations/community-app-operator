const assert = require("node:assert/strict");
const test = require("node:test");
const {
    applyArtifactToCurrent,
    locateCurrentRow,
} = require("../src/create-pr.js");

const oldApp = {
    approvedDate: "2026-01-01",
    githubUserId: "1",
    issueUrl: "https://github.com/example/issues/1",
    name: "Old",
    repositoryUrl: null,
    submittedDate: "2026-01-01",
    url: "https://old.test",
};
const neighbor = {
    approvedDate: "2026-01-02",
    githubUserId: "2",
    issueUrl: "https://github.com/example/issues/2",
    name: "Neighbor",
    repositoryUrl: null,
    submittedDate: "2026-01-02",
    url: "https://neighbor.test",
};

test("replays metadata onto the latest catalog without dropping newer rows", () => {
    const base = [oldApp, neighbor];
    const artifact = [{ ...oldApp, name: "New" }, neighbor];
    const current = [
        { name: "Newly submitted", url: "https://new.test" },
        { ...oldApp, requests24h: 99 },
        neighbor,
    ];
    const result = applyArtifactToCurrent(current, base, artifact, "metadata");
    assert.equal(result.length, 3);
    assert.equal(result[0].name, "Newly submitted");
    assert.equal(result[1].name, "New");
    assert.equal(result[1].requests24h, 99);
});

test("replays removals without deleting newer rows", () => {
    const base = [oldApp, neighbor];
    const current = [
        { name: "Newly submitted", url: "https://new.test" },
        oldApp,
        neighbor,
    ];
    const result = applyArtifactToCurrent(current, base, [neighbor], "removals");
    assert.deepEqual(
        result.map((app) => app.name),
        ["Newly submitted", "Neighbor"],
    );
});

test("fails closed when the reviewed row changed identity", () => {
    assert.throws(
        () => locateCurrentRow([{ ...oldApp, url: "https://changed.test" }], oldApp),
        /Could not locate current catalog row/,
    );
});
