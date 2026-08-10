const SCREENSHOT_FIELD = "screenshotUrl";
const IMPORTANT_IDENTITY_FIELDS = new Set([
    "githubUserId",
    "issueUrl",
    "name",
    "repositoryUrl",
    "url",
]);

function fieldDifferenceCost(base, candidate, fields) {
    let cost = 0;
    for (const field of fields) {
        if (JSON.stringify(base[field]) === JSON.stringify(candidate[field])) {
            continue;
        }
        cost += IMPORTANT_IDENTITY_FIELDS.has(field) ? 3 : 1;
    }
    return cost;
}

function alignCatalogs(base, candidate) {
    if (!Array.isArray(base) || !Array.isArray(candidate)) {
        throw new Error("Both catalogs must be arrays");
    }
    if (candidate.length > base.length) {
        throw new Error(
            "Catalog splitting does not support added rows; review additions separately",
        );
    }

    const fields = [
        ...new Set([...base, ...candidate].flatMap((app) => Object.keys(app))),
    ].filter((field) => field !== SCREENSHOT_FIELD);
    const rows = base.length + 1;
    const columns = candidate.length + 1;
    const infinity = 1_000_000_000;
    const costs = Array.from({ length: rows }, () =>
        new Float64Array(columns).fill(infinity),
    );
    const previous = Array.from({ length: rows }, () =>
        new Uint8Array(columns),
    );
    costs[0][0] = 0;

    for (let baseIndex = 0; baseIndex <= base.length; baseIndex += 1) {
        for (
            let candidateIndex = 0;
            candidateIndex <= Math.min(baseIndex, candidate.length);
            candidateIndex += 1
        ) {
            const current = costs[baseIndex][candidateIndex];
            if (current >= infinity) continue;

            if (
                baseIndex < base.length &&
                current + 2 < costs[baseIndex + 1][candidateIndex]
            ) {
                costs[baseIndex + 1][candidateIndex] = current + 2;
                previous[baseIndex + 1][candidateIndex] = 1;
            }
            if (baseIndex < base.length && candidateIndex < candidate.length) {
                const next =
                    current +
                    fieldDifferenceCost(
                        base[baseIndex],
                        candidate[candidateIndex],
                        fields,
                    );
                if (next < costs[baseIndex + 1][candidateIndex + 1]) {
                    costs[baseIndex + 1][candidateIndex + 1] = next;
                    previous[baseIndex + 1][candidateIndex + 1] = 2;
                }
            }
        }
    }

    const matches = [];
    const removed = [];
    let baseIndex = base.length;
    let candidateIndex = candidate.length;
    while (baseIndex > 0 || candidateIndex > 0) {
        const operation = previous[baseIndex][candidateIndex];
        if (operation === 2) {
            matches.push({
                baseIndex: baseIndex - 1,
                candidateIndex: candidateIndex - 1,
            });
            baseIndex -= 1;
            candidateIndex -= 1;
            continue;
        }
        if (operation === 1) {
            removed.push({ baseIndex: baseIndex - 1 });
            baseIndex -= 1;
            continue;
        }
        throw new Error(
            `Could not align catalogs at ${baseIndex}:${candidateIndex}`,
        );
    }

    matches.reverse();
    removed.reverse();
    return { matches, removed };
}

function changesBetween(base, candidate) {
    const changes = [];
    const fields = new Set([...Object.keys(base), ...Object.keys(candidate)]);
    for (const field of fields) {
        if (JSON.stringify(base[field]) === JSON.stringify(candidate[field])) {
            continue;
        }
        changes.push({
            field,
            from: base[field] ?? null,
            fromPresent: field in base,
            to: candidate[field] ?? null,
            toPresent: field in candidate,
        });
    }
    return changes;
}

function diffCatalogs(base, candidate) {
    const alignment = alignCatalogs(base, candidate);
    const matched = alignment.matches.map((match) => {
        const changes = changesBetween(
            base[match.baseIndex],
            candidate[match.candidateIndex],
        );
        return {
            ...match,
            metadataChanges: changes.filter(
                (change) => change.field !== SCREENSHOT_FIELD,
            ),
            screenshotChanges: changes.filter(
                (change) => change.field === SCREENSHOT_FIELD,
            ),
        };
    });
    return {
        baseRows: base.length,
        candidateRows: candidate.length,
        matched,
        metadata: matched.filter((match) => match.metadataChanges.length > 0),
        removed: alignment.removed.map(({ baseIndex }) => ({
            app: base[baseIndex],
            baseIndex,
        })),
        screenshots: matched.filter(
            (match) => match.screenshotChanges.length > 0,
        ),
    };
}

function applyChanges(app, changes) {
    for (const change of changes) {
        if (change.toPresent === false) {
            delete app[change.field];
        } else {
            app[change.field] = change.to;
        }
    }
}

module.exports = {
    SCREENSHOT_FIELD,
    alignCatalogs,
    applyChanges,
    changesBetween,
    diffCatalogs,
};
