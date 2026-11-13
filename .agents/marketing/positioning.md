# Marketing positioning

Who CapsuleDB is for, the story it tells them, and the words it competes on.
[Truth](truth.md) decides what may be claimed and wins on conflict; [voice](voice.md) decides how
it sounds.

## Category

**Internal category:** package-owned persistence for Effect libraries.

**Public headline vocabulary:** "persistence that ships with your package", "your package's own
tables", "migrations inside the host's database". Searchers type "Effect database migrations",
"library migrations", "plugin database tables", "embedded migrations TypeScript".

**Definition (the sentence an AI overview can quote).** Open every key page with it or a faithful
variant:

> CapsuleDB is an open-source TypeScript library that lets an Effect package own its tables, typed
> queries and migrations inside the host application's existing database, over the SQL client the
> host already owns.

## Who it is for

**Primary: authors of Effect libraries that need durable state** (tokens, jobs, audit trails,
plugin storage) and do not want to ship a database, ask the host to copy SQL into its migrations,
or expose their tables as public API.

- Trigger: a library needs a table, and the README would otherwise say "run this SQL in your
  migration tool".
- Job: ship the table and its migrations with the package, and keep them private.

**Second: host applications composing several such packages** (a plugin system, a platform with
add-ons) that want one database, one client, and an explicit list of what runs migrations.

**Also served:** Cloudflare D1 and serverless hosts that prepare at deploy time with Alchemy.

### Anti-personas

- Teams looking for an ORM or query builder for their own tables.
- Hosts that want packages to discover themselves or open their own connections.
- Anyone needing isolation from untrusted package SQL.

## The story

- **Hero:** an engineer shipping an Effect library that needs its own tables.
- **Villain:** the "copy this SQL into your migrations" section of a README, and the drift that
  follows when hosts apply it by hand.
- **Guide:** CapsuleDB, which turns the package's tables, migrations, and service into one value
  the host composes.
- **Plan:** declare the capsule, compose it in the host, prepare at boot or at deploy.
- **Success:** the host adds a package and its tables arrive, migrated and recorded, with no SQL
  copied anywhere.

## Proof, strongest first

1. The quick start runs in CI (`tests/artifact/quick-start.test.ts`).
2. The conformance suite runs the reference capsule on PostgreSQL, Bun SQLite, libSQL, and D1.
3. `@domainkit/capsuledb` is a published capsule (see truth).

## Pages

| Surface                                                            | Job                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `/`                                                                | Definition, the boundary artifact, three steps, providers, limits |
| `/docs/quickstart`                                                 | One runnable program                                              |
| `/docs/capsule-authors`, `/docs/host-applications`                 | One guide per side of the boundary                                |
| `/docs/providers`, `/docs/migrations-and-recovery`, `/docs/design` | Reference and explanation                                         |
