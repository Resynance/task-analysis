# Contributing

## Prerequisites

- **Node.js** 22.x (matches CI — see `.github/workflows/ci.yml`).
- **npm** (lockfile: `package-lock.json`).

## Local database

1. Copy **`.env.example`** → **`.env`** and adjust values (see also the “Minimum env” section in `.env.example`).
2. Apply the schema to your dev database:

   ```bash
   npx prisma db push
   ```

   For **Vitest** (integration tests and CI parity), use the dedicated SQLite file the test runner sets:

   ```bash
   DATABASE_URL=file:./vitest.sqlite npx prisma db push
   ```

## Scripts (CI parity)

From the repo root:

| Command | Purpose |
|--------|---------|
| `npm run check:push-data` | Fail if git-tracked paths match sensitive patterns (run before push; also runs in CI). |
| `npm run lint` | ESLint (`eslint.config.mjs`; `projects/**` is ignored). |
| `npm run test:coverage` | Vitest with coverage thresholds (requires `vitest.sqlite` schema — see above). |
| `npm run build` | Production Next.js build + TypeScript check. |
| `npm run test:e2e` | Playwright smoke tests (Chromium). First time: `npx playwright install chromium`. Requires DB schema on the URL used by the dev server (defaults to `vitest.sqlite` in `playwright.config.ts` if `DATABASE_URL` is unset). |

## Dev server bind address

- **`npm run dev`** / **`npm run start`** bind to **127.0.0.1** by default (safer on untrusted networks).
- Use **`npm run dev:lan`** / **`npm run start:lan`** to listen on **0.0.0.0** when you intentionally need LAN access.

## Branch expectations

- Open PRs against the default branch (`main` or `master`).
- Keep commits focused; update **docs** (`docs/`, root `README.md`) when behavior or env vars change in a user-visible way.
- Run **`npm run check:push-data`** before pushing so local datasets and secrets are not accidentally committed.

## Pull request checklist

- [ ] `npm run check:push-data`
- [ ] `npm run lint`
- [ ] `DATABASE_URL=file:./vitest.sqlite npx prisma db push && npm run test:coverage`
- [ ] `npm run build`
- [ ] (If UI flows changed) `npm run test:e2e` with browsers installed
