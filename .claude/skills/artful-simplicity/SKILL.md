---
name: artful-simplicity
description: Ask whether this repository's simplicity — implementation design, logic, tests, docs and comments — is at the level of art. Use for design review, simplicity audit, excessive tests, redundant comments, over-engineering audit, /artful-simplicity.
---

# Artful simplicity

Is the simplicity of this repository's implementation design, logic, tests, and
docs/comments at the level of art? In particular, do the tests cover only logic,
and do the docs and comments say what is needed in the shortest words?

Never a finding: whatever `../freshness/targets.yaml` marks append-only or frozen.
Deleting one of those wipes stored preferences or breaks a golden; it does not
simplify.
