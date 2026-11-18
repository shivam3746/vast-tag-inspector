# VAST evaluation

**Built-in rule guidance** using prompt version `vast-findings-v2`.

## Rules

Rules matched the expected set on **17/17 fixtures (100.0%)**.

| Rule | True positives | False positives | False negatives | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| CHAIN-DEPTH | 1 | 0 | 0 | 100.0% | 100.0% |
| CHAIN-EMPTY | 1 | 0 | 0 | 100.0% | 100.0% |
| CHAIN-LATENCY | 1 | 0 | 0 | 100.0% | 100.0% |
| DUR-MISMATCH | 3 | 0 | 0 | 100.0% | 100.0% |
| IMP-MISSING | 3 | 0 | 0 | 100.0% | 100.0% |
| MEDIA-MIME | 3 | 0 | 0 | 100.0% | 100.0% |
| TRK-MISSING | 2 | 0 | 0 | 100.0% | 100.0% |
| VAST-VERSION | 2 | 0 | 0 | 100.0% | 100.0% |

| Fixture | Expected | Actual |
| --- | --- | --- |
| clean-inline | None | None |
| clean-pod | None | None |
| clean-vast-3 | None | None |
| combined-findings | DUR-MISMATCH, IMP-MISSING, MEDIA-MIME, TRK-MISSING | DUR-MISMATCH, IMP-MISSING, MEDIA-MIME, TRK-MISSING |
| creative-injection | IMP-MISSING | IMP-MISSING |
| duration-invalid | DUR-MISMATCH | DUR-MISMATCH |
| duration-missing | DUR-MISMATCH | DUR-MISMATCH |
| empty-response | CHAIN-EMPTY | CHAIN-EMPTY |
| no-impression | IMP-MISSING | IMP-MISSING |
| no-trackers | TRK-MISSING | TRK-MISSING |
| slow-response | CHAIN-LATENCY | CHAIN-LATENCY |
| unsupported-codec | MEDIA-MIME | MEDIA-MIME |
| version-missing | VAST-VERSION | VAST-VERSION |
| version-unsupported | VAST-VERSION | VAST-VERSION |
| webm-only | MEDIA-MIME | MEDIA-MIME |
| wrapper-depth | CHAIN-DEPTH | CHAIN-DEPTH |
| wrapper-to-inline | None | None |

## Explanations

The evaluation used `built-in-rules`.
These results measure the built-in guidance and its response contract. The run uses no model API.

- 100.0% of attempts passed schema validation.
- 100.0% of cases matched the expected finding references exactly.
- 0.0% of schema-valid attempts contained an unknown rule ID.
- The injection fixture passed.
- Median latency was 0.05 ms per case.
- Mean estimated cost was $0.000000 per case (13/13 with known cost).
