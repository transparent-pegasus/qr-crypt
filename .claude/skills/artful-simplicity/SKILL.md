---
name: artful-simplicity
description: Audit code, tests, and prose for artful simplicity; use for design, over-engineering, and redundancy reviews.
---

# Artful simplicity

A unit is simple when a cold reader can name its one idea, predict its contents
from its name, and keep nothing unrelated in mind. Tests cover only logic; prose
says only what is needed.

Local reading judges clarity, not necessity. It may justify `rewrite`; `delete`,
`fold`, and boundary moves remain hypotheses. Evidence required: for deletion,
repository-wide reachability, freshness/invariant protection, and security
consequence; for folding, equivalence across every observable state and
transition—including pending, already-resolved, cancellation, close/reopen, and
error; for boundaries, convergence of at least two independent readings.

Seek contradictions, not volume. Before behavior changes, state the change,
reachable observer, safety direction, and what the opposite choice breaks.
Direction decides, not size.

Exclude append-only/frozen targets in `../freshness/targets.yaml`.
