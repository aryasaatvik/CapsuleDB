---
packages:
  capsuledb:
    type: minor
---

### Effect 4.1.2 and Alchemy beta.85

**Breaking:** CapsuleDB now requires Effect `>=4.1.2 <5`; Effect 4.0 is no longer supported.

Checksums use `Digest` from `effect/crypto`, with WebCrypto when the caller does not provide a Digest service. Existing canonical bytes and SHA-256 checksums are unchanged. Development and provider tests now use Effect SQL 4.1.2 and Alchemy 2.0.0-beta.85. Optional SQL and Alchemy peer ranges remain unchanged.
