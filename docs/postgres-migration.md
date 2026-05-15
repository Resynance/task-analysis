# Moving from SQLite to Postgres (optional)

The app uses **Prisma** with **SQLite** (`file:…` in `DATABASE_URL`) for local analytics and small deployments. That is appropriate for single-machine, file-backed workflows.

If you outgrow SQLite (concurrent writers, larger datasets, managed backups, multi-instance hosting), Prisma already supports **Postgres**.

## High-level steps

1. Choose a managed Postgres (Neon, RDS, Supabase, etc.) or self-hosted Postgres.
2. Change the Prisma `datasource` in `prisma/schema.prisma` from `sqlite` to `postgresql` (or add a second schema / env-specific setup if you maintain both).
3. Run migrations (`prisma migrate dev` / `prisma migrate deploy`) instead of `db push` for production-grade history.
4. Set `DATABASE_URL` to the Postgres connection string (TLS URL params as required by your provider).
5. Regenerate the client (`npx prisma generate`) and redeploy.

## Operational considerations

- **Backups** — Use provider snapshots or `pg_dump`; do not rely on copying a single `.db` file.
- **Multi-instance** — Use a shared Postgres URL for all app instances; avoid multiple writers to one SQLite file.
- **File-backed special projects** — Trace exports and transcript trees remain on disk (or object storage); only the **relational** data moves to Postgres.

Consult [Prisma’s Postgres documentation](https://www.prisma.io/docs/orm/overview/databases/postgresql) for provider-specific connection strings and migration guidance.
