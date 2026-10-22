# Media provenance

Everything in `exports/` is rendered from source in this directory. No stock imagery, generated
imagery, music, voice, or paid generation service was used, and nothing is fetched at render time.

| Asset                                         | Source                                                                                     | License                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Copy, script, layouts, motion                 | Written for this repository                                                                | MIT, as the repository                                        |
| Capsule mark (`src/brand/capsuledb-mark.svg`) | Drawn for this repository                                                                  | MIT, as the repository                                        |
| On-screen code                                | Verbatim excerpts of `examples/reference-token/Capsule.ts` and `docs/host-applications.md` | MIT, as the repository                                        |
| Archivo (display type)                        | `@fontsource-variable/archivo` 5.3.0, copied into each build's assets                      | SIL Open Font License 1.1, The Archivo Project Authors        |
| JetBrains Mono (code and labels)              | `@fontsource-variable/jetbrains-mono` 5.3.0, copied into each build's assets               | SIL Open Font License 1.1, The JetBrains Mono Project Authors |
| GSAP (timeline runtime)                       | `gsap` 3.15.0, bundled into each build                                                     | GSAP Standard "no charge" license (gsap.com/standard-license) |
| HyperFrames (compositor and renderer)         | `hyperframes` 0.8.150, a development dependency; renders with its managed headless Chrome  | Apache-2.0; not distributed with the outputs                  |

## Audio

The film is silent. No original or licensed audio was available for this cut, and paid music
generation was out of scope. The [transcript](launches/introducing-capsuledb/TRANSCRIPT.md) is the
film's text alternative; a later cut that adds audio records its source and license here.

## Telemetry

The scripts run HyperFrames with `HYPERFRAMES_NO_TELEMETRY=1` and `DO_NOT_TRACK=1`. Never run
`hyperframes publish`: renders are reviewed and shipped through this repository.
