# Task Analysis

Local-first **Next.js** app for reviewing imported training **prompts** and **feedback**, scoring them with an LLM against **guidelines**, and running reporting workflows (metrics, coaching insights, special-project exports).

## Documentation

Functional documentation (features, architecture, configuration) lives in **[`docs/`](./docs/README.md)**. Start with the docs index, then jump to the area you care about.

## Quick start

```bash
npm install
cp .env.example .env
# Edit .env: set DATABASE_URL and, for OpenRouter, OPENROUTER_API_KEY
npx prisma db push
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Purpose |
|---------|--------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run test:run` | Vitest (non-watch) |
| `npm run test:coverage` | Vitest with coverage |
| `npm run check:push-data` | Block accidental commit of sensitive paths (see `scripts/check-push-data.mjs`) |

## Learn more (framework)

This project is built with [Next.js](https://nextjs.org). For App Router patterns, see the [Next.js documentation](https://nextjs.org/docs).
