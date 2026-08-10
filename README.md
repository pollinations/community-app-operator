# Community App Operator

Small, local utilities for Codex-assisted review of the Pollinations community
app catalog.

Codex performs visual inspection with the in-app Browser. This repository does
not install or control Chromium, manage browser profiles, authenticate to apps,
or call a visual model. It keeps only the deterministic parts of the workflow:
catalog validation, target queues, an auditable decision ledger, isolated data
outputs, and draft PR creation.

## Review a catalog change

Fetch or otherwise save the base and candidate catalogs locally, then prepare a
review run:

```bash
npm run review -- \
  --base=workspace/base.catalog.json \
  --candidate=workspace/candidate.catalog.json \
  --limit=100
```

When `--candidate` is supplied, the queue contains only rows removed by the
candidate. Duplicate rows that resolve to the same target are grouped into one
review. Without `--candidate`, the command reviews the base catalog itself.

The command creates:

```text
runs/<timestamp>/
  base.catalog.json
  candidate.catalog.json
  report.json
  review.json
```

Ask Codex to inspect each `report.json` target with the in-app Browser. Record a
decision without approving it. Use [the browser review policy](prompts/browser-review.md)
for the verdict criteria:

```bash
npm run record -- runs/<timestamp>/review.json \
  --id=<target-id> \
  --outcome=keep \
  --reason="The live product matches the catalog entry." \
  --evidence="HTTP 200 and visible matching product UI"
```

Valid outcomes are `keep`, `remove`, and `retry`. Add `--apply=true` only after
a human approves that exact decision. Review evidence is ordinary text or a
safe URL; never store browser credentials or session state in a run.

Metadata corrections have their own approval ledger:

```bash
npm run record -- runs/<timestamp>/review.json \
  --kind=metadata \
  --id=<metadata-id> \
  --outcome=approve \
  --reason="The canonical product name is visible on the live site." \
  --apply=true
```

Use `--outcome=reject` without `--apply=true` when the proposed correction is
not supported. Unapproved metadata never appears in the split catalog.

## Split the benchmark into three changes

After review, generate independent catalog artifacts:

```bash
npm run apply -- runs/<timestamp>/report.json
```

This writes:

```text
runs/<timestamp>/split/
  metadata.catalog.json
  removals.catalog.json
  screenshots.catalog.json
  manifest.json
```

- `metadata.catalog.json` applies only non-screenshot field corrections.
- `removals.catalog.json` deletes only approved `remove` decisions.
- `screenshots.catalog.json` applies only `screenshotUrl` changes.

The original benchmark PR and its candidate catalog remain unchanged.

## Create draft PRs

Each output can be proposed separately:

```bash
npm run propose -- runs/<timestamp>/split/manifest.json --kind=metadata
npm run propose -- runs/<timestamp>/split/manifest.json --kind=removals
npm run propose -- runs/<timestamp>/split/manifest.json --kind=screenshots
```

`propose` clones `pollinations/pollinations` into a temporary directory,
regenerates and validates catalog outputs, pushes one data-only branch, and
opens one draft PR. It never changes or closes the benchmark PR.
