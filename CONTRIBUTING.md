# Contributing

Issues and pull requests are welcome.

## Setup

```bash
git clone https://github.com/polyergon/polyergon.git
cd polyergon
npm ci
npm run dev     # http://localhost:3030, hot reload
```

## Before you open a PR

```bash
npx tsc --noEmit -p . && npx tsc --noEmit -p tsconfig.server.json
npm test
npm run build
```

CI runs the same checks on every pull request, and they must pass before merge.

- Keep PRs small and focused on one change.
- Add or update a test in `src/lib/__tests__` when you change server logic.
- UI text: short, plain sentences.

## Releases (maintainers)

1. Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. Push, tag `vX.Y.Z`, and publish a GitHub release for the tag.
3. The Release workflow tests, builds and publishes to npm.
