# Marketing voice

How CapsuleDB sounds. [Truth](truth.md) decides what may be said and wins on conflict;
[positioning](positioning.md) decides which story to tell.

## Principles

1. **Pass the grunt test.** In five seconds a stranger knows what it is (tables that ship with a
   package), who owns what (package vs host), and what to do next (the quick start).
2. **Name both owners.** Every key page says what the package owns and what the host owns. The
   boundary is the product.
3. **Show the artifact.** Real code from `examples/`, real table names, real ledger rows. A diagram
   never stands in for code that exists.
4. **Plain words first.** "Your package's tables", "the host's database client", "migrations". The
   canon nouns (capsule, registry, ledger, manifest, readiness) appear after the plain sentence.
5. **State the limits.** Not an ORM, not a sandbox, D1 is not transactional. Saying so is part of
   the pitch.
6. **Builder to builder.** Short sentences, active voice, present tense, no hype.

## Style rules

- **Em dashes:** none in marketing prose or UI copy.
- **Titles and descriptions:** rendered titles 60 columns or fewer; meta descriptions 110 to 160
  characters. `bun run audit` in `site/` enforces both and inbound body links.
- **CTAs:** primary goes to the quick start; the install command is `npm i capsuledb effect`.
  Secondary: GitHub, then npm.
- **Names:** `CapsuleDB` in prose; `capsuledb` for the package and CLI. Module names exact:
  `Capsule`, `Registry`, `Schema`, `Migration`, `Pg`, `SqliteBun`, `Libsql`, `D1`.
- **Code samples:** regions of files under `examples/`, rendered with `<Snippet>`; never
  hand-written (see `site/AGENTS.md`).
- **Words to avoid:** seamless, effortless, powerful, robust, blazing, magic, "just works",
  zero-downtime, rollback, automatic recovery, enterprise-grade, next-gen.
