# Marketing truth

This file decides whether CapsuleDB may say something in public. [Positioning](positioning.md)
decides which true things to lead with, and [voice](voice.md) decides how they sound. Truth wins
every conflict among the three.

Public means every surface a stranger can read: capsuledb.arya.sh pages, titles, meta
descriptions, OG cards, JSON-LD, `llms.txt` and the `.md` mirrors, the README, the npm
description and keywords, GitHub metadata, launch media and social posts. Metadata counts.

## What ships now

Public copy claims only what the latest published npm artifact does. Read the version from npm at
ship time (`npm view capsuledb version`); never hard-code a version in copy that outlives the
release. Behaviour that exists only in a working tree or a branch is not claimable.

Claimable, tied to `src/index.ts` and the `exports` map in `package.json`:

- **A capsule is a value.** `Capsule.make` bundles a stable ID, tables declared once with
  `Schema.table`, an append-only migration history, and an Effect `Layer` for the capsule's service.
  The constructors are pure and throw `CapsuleDefinitionError` on an invalid definition.
- **Derived identity.** The physical namespace is derived from the ID by an injective encoding. A
  host cannot rename it. Table names are the author's; the reference capsule prefixes its tables
  with the namespace by convention, which is not enforced.
- **Host composition.** `Registry.layer`, `Registry.prepare`, `Registry.status`, and
  `Registry.assert` over the host's `SqlClient`. Composition is explicit: nothing is discovered.
- **Providers.** `Pg.profile` (PostgreSQL), `SqliteBun.profile` (Bun SQLite), `Libsql.profile`
  (libSQL), and `D1.profile` (Cloudflare D1, bounded atomic batches). Read limits from
  `docs/providers.md`.
- **Tooling.** The `capsuledb` CLI (`emit`, `check`, `manifest write`, `d1 artifact`, `d1 check`),
  the `capsuledb/Testing` conformance kit, and the optional `capsuledb/alchemy` resource for
  deploy-time PostgreSQL preparation.
- **Requirements.** Effect `>=4.1.2 <5`; Node.js 24.10 or newer per `engines`. Read both from
  `package.json` at ship time.

## Ownership

The host owns the database client and its lifetime, which capsules to trust, when preparation runs,
destructive authorization, and backups. The capsule author owns the ID, tables, migrations, service,
and its errors.

- Never imply CapsuleDB opens, pools, closes, or replaces a connection.
- Never describe CapsuleDB as an ORM, a query builder, a migration service for the host's own
  tables, a deployment service, a hosted product, or a sandbox for capsule SQL.
- It rejects namespace collisions; it does not isolate trusted package-authored SQL. Say both when
  safety comes up.

## Migrations and safety

- Say append-only, checksummed per dialect, recorded in a ledger, fail-closed readiness.
- PostgreSQL, Bun SQLite, and libSQL preparation is transactional. D1 is not: it runs bounded atomic
  batches with no interactive transactions, savepoints, or Effect steps. Never say "transactional
  on every provider".
- Destructive migrations need the host's explicit authorization for that run.
- Never say zero-downtime, rollback, automatic recovery, or "safe on every database".

## Adoption

- Claimable: DomainKit publishes its PostgreSQL storage as a CapsuleDB capsule,
  [`@domainkit/capsuledb`](https://www.npmjs.com/package/@domainkit/capsuledb) (peer
  `capsuledb >=0.6.0 <0.7.0`, read 2026-11-13). Re-check the npm manifest before repeating it.
- Claimable: **Samva uses CapsuleDB in production.** Samva prepares DomainKit's PostgreSQL
  capsule (`@domainkit/capsuledb`) at deploy time with `capsuledb/alchemy` and runs DomainKit's
  storage on it. Evidence: Samva `main` (1a723778e7, read 2026-11-13) pins `capsuledb` 0.6.0 and
  `@domainkit/capsuledb` 0.23.0 in the root `package.json`;
  `apps/api/src/platform/infrastructure/data.ts` declares `CapsuleDB.Registry` from
  `capsuledb/alchemy` with the `PgStorage.manifest()`; `apps/api/src/email/provisioning/domainkit.ts`
  uses `PgStorage`. Samva's maintainer approved naming it on 2026-11-13. Say no more than this:
  Samva uses CapsuleDB through DomainKit's capsule, not capsules of its own.
- Executor appears only in `examples/` as an integration sketch. Never claim it has adopted
  CapsuleDB. `examples/samva-shared-client.ts` is a sketch too, not Samva's code.
- The guides state facts, not adoption: `tools/check-docs.ts` rejects adoption phrases there.
  Adoption lines belong on the site, the README and social posts.
- No invented users, quotes, download counts, benchmarks, or logos.

## Offer

CapsuleDB is MIT-licensed open source distributed on npm. There is no paid plan, hosted service,
SLA, or warranty. The public contract is pre-1.0 and may change between minor versions; say so
when stability comes up.
