# Introducing CapsuleDB

A 60-second, 16:9 kinetic-typography film for package authors, showing the host integration they
ship into. On-screen type carries the story with the sound off. The film is silent: no narration,
captions track, music, or generated audio. The [transcript](TRANSCRIPT.md) is its text alternative.

## Identity

Ledger paper, ink, and one vermilion seal. The mark is a capsule split at its seam: the host's
half drawn in ink with two ledger rows, the package's half filled in seal. Throughout the film and
stills, seal marks what a package owns, ink what the host or CapsuleDB owns, green Ready, and ochre
Pending. Display type is Archivo (wide, heavy); code and labels are JetBrains Mono.

## Beats

| Time   | Beat    | On-screen copy and motion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0–7s   | Hook    | **For package authors.** **Your package needs tables.** **The app owns the database.** A seal bar draws, then **Bring the tables. Borrow the client.**                                                                                                                                                                                                                                                                                                                                                                                            |
| 7–12s  | Reveal  | The mark's two halves slide together and seal; the **CapsuleDB** wordmark rises. **Ship persistence with your package. Use the database the app already owns.** Footer: **Effect-native**, **Open source · MIT**, **PostgreSQL · SQLite · libSQL · D1**.                                                                                                                                                                                                                                                                                          |
| 12–24s | Capsule | **A capsule is one value.** The real `reference.tokens` definition from `examples/reference-token/Capsule.ts`. Tables, migrations, and layer highlight in turn while the matching compartment of a capsule diagram fills. Notes: tables declared once and rendered for PostgreSQL and SQLite; append-only migrations where editing applied history reads as drift; an Effect Layer providing a typed domain service; the ID deriving `capsule_reference_2e_tokens`.                                                                               |
| 24–36s | Host    | **The host composes what it trusts.** `Registry.layer` and `Effect.provideService(SqlClient.SqlClient, hostOwnedSqlClient)` from `docs/host-applications.md`. The `reference.tokens` capsule plugs into `Registry.layer` (**Explicit. No discovery.**); the host's `SqlClient` is **opened, shared, and closed by the host**. The host database fills with the app's tables, the capsule's two tables, and CapsuleDB's ledger and metadata tables. Footnote: capsules are trusted code; namespace collisions are prevented, SQL is not sandboxed. |
| 36–48s | Prepare | **Prepared before any service is provided.** A marker travels five stations: Read (metadata and ledger, in one statement), Pending (`1 create-tokens`, `2 add-token-audit`), Apply (each migration commits with its ledger row; PostgreSQL under an advisory lock), Ready (fingerprint · provider · capsules: 1), Provide (`OneTimeTokens`). Then **Already current? Ready from the first read, with no lock and no DDL.** and **Drift or a failed migration fails the layer with a typed error.**                                                |
| 48–55s | Service | **Call the domain. The tables stay private.** Illustrative calls against `OneTimeTokens`: `issue(expiresAt)` → `IssuedToken`, `get(token)` → `Pending`, `consume(token)` → `AuditReceipt`, a replayed `consume(token)` → `TokenAlreadyConsumed`. The four operations `issue(expiresAt) get(token) consume(token) revoke(token)` close the beat.                                                                                                                                                                                                   |
| 55–60s | CTA     | Mark and wordmark. **$ bun add capsuledb**, **github.com/aryasaatvik/CapsuleDB**, **MIT license · Effect 4 · Pre-1.0**. Holds to the last frame.                                                                                                                                                                                                                                                                                                                                                                                                  |

## Claims

Every claim follows the current source and guides, and `tests/source.test.ts` fails when an
excerpt drifts from the file it quotes.

- A capsule is tables, append-only migrations, and an Effect `Layer`; the host composes trusted
  capsules explicitly and supplies the `SqlClient` and its lifetime (`docs/design.md`,
  `docs/host-applications.md`).
- The preparation story is `Registry.layer` with its defaults, `mode: "prepare"` and
  `readiness: "boot"`. The `assert` mode and `first-use` readiness appear only in the readiness
  infographic, with their qualifications.
- "Each migration commits with its ledger row" holds for transactional providers (one transaction)
  and D1 (one bounded atomic batch). The film makes no general transaction claim for D1.
- The host-owned client claim is about runtime composition. The optional `capsuledb/alchemy`
  deploy resource opens and closes its own client from a URL; the shared-database infographic says
  so.
- CapsuleDB prevents capsule namespace collisions but does not sandbox package-authored SQL.
- The service calls are illustrative; result names are the types and tags `OneTimeTokens.ts`
  declares, not recorded output. No speed, security, adoption, download, or provider-endorsement
  claim appears.

## Stills and cards

All use the film's scene system and render compositor, exported losslessly from a PNG sequence.

| File                          | Size      | Story                                                                                                                          |
| ----------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `capsule-anatomy.png`         | 1920×1080 | The reference capsule's tables, migrations, and service; its derived identity; dialects; the service boundary.                 |
| `shared-database.png`         | 1920×1080 | Three example capsules and the host's own persistence share one host `SqlClient` and database, with CapsuleDB's ledger tables. |
| `preparation-readiness.png`   | 1920×1080 | `Registry.layer`'s preparation path and fast path, the readiness union, and the `mode` and `readiness` options.                |
| `og.png`                      | 1200×630  | Mark, wordmark, **Ship persistence with your package.**, install line, repository.                                             |
| `github-social-preview.png`   | 1280×640  | The same card at GitHub's social preview size.                                                                                 |
| `capsuledb-launch-poster.jpg` | 1920×1080 | The settled reveal at 10.6 seconds, extracted from the rendered film.                                                          |
