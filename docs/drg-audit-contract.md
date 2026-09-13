# DRG audit contract

## Version fence

Every audit ledger records:

- Thai DRG knowledge package `6.3.3`
- ICD-10/ICD-10-TM `2016`
- procedure set `ICD-9-CM 2015 + Thai extension rules`
- grouper engine and executable/API build separately

The public repo does not ship the full catalog, code set, proprietary grouper or source PDFs.

## Evidence ledger

The ledger keeps `rawInput` and `normalizedInput` separately, then records evidence, candidate codes, validation, grouping trace and discrepancy. The minimum trace covers PDx, SDx, procedure, demographics, LOS, A1–A4, MDC, PDC/AX/DC, DCL/F2/PCL, DRG, RW and AdjRW when the source provides them.

An AI candidate must include evidence location, clinical action, provider status, rule path, version and human review state. `inferred` evidence remains inferred; a planned procedure is not a performed procedure. When documentation conflicts or is incomplete, the system creates a neutral query and does not silently resolve the conflict.

## Grouper and AdjRW semantics

`valid` means a response contains the required grouping result. A transport error, invalid input, not-run and HTTP 200 with missing DRG/RW are distinct states; the last is `empty`, never success. No mock result is created.

`what_if` and RW/AdjRW sensitivity are QA-only views. They cannot be used to select a code for financial optimization. AdjRW follows the controlled formula implementation with RW0d/short-stay, normal OT and long-stay branches; coefficients, TGrp boundary and engine build must be visible in the audit trace.

## Human decision

Only a human reviewer can accept, reject or query a candidate. Events are append-only and carry actor, timestamp, action and correlation ID. The public contract deliberately does not imply that a candidate is a final claim code.
