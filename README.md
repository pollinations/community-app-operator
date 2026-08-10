# Community App Operator

Human-supervised review and screenshot maintenance for the Pollinations community app catalog.

The operator is intentionally local. It never changes the catalog during a review run, never merges pull requests, and never stores credentials in the repository.

## Workflow

```bash
npm install
npm run install-browser
npm run fetch

COMMUNITY_APP_MANAGEMENT_KEY=... npm run review -- --mode=all --limit=50
```

The review creates `runs/<timestamp>/report.json` and `review.json`. Inspect the screenshots and set `apply` to `true` only for decisions you approve.

```bash
COMMUNITY_APP_MANAGEMENT_KEY=... npm run apply -- runs/<timestamp>/report.json
npm run propose -- runs/<timestamp>/applied-report.json
```

`apply` uploads approved covers and updates the local catalog. `propose` opens a draft data-only pull request against `pollinations/pollinations` using the authenticated GitHub CLI.

Official Google, GitHub, and Pollinations login can be enabled with a local Playwright storage-state file:

```bash
COMMUNITY_APP_MANAGEMENT_KEY=... npm run review -- \
  --mode=all --limit=50 \
  --auth-state=/secure/path/reviewer-state.json \
  --authorize-pollinations
```

Authentication state, run evidence, and the working catalog are ignored by Git.
