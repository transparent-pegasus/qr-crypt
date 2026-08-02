---
name: nation-state-security
description: >
  Assess QR Crypt against a recorded advanced-adversary profile and produce
  actionable, evidence-bounded findings. Do not certify the system as
  nation-state-proof.
---

# Scope

Review the current repository state across:

1. source, build, and release;
2. installation and verification;
3. online relay;
4. offline execution; and
5. offline physical and operational environment.

The result is a scoped risk assessment, not a certification.

# Adversary model

For every review, record assumed, excluded, and uncertain capabilities for:

- physical access: phase, duration, and supervision;
- time horizon: pre-deployment through post-operation;
- supply-chain reach;
- platform compromise;
- proximity and surveillance; and
- targeting scale and persistence.

“Nation-state” does not imply unlimited capability.

# Control classes

Classify every finding as exactly one of:

- `REPOSITORY_IMPLEMENTABLE`
- `DEPLOYMENT_ENFORCED`
- `EXTERNAL_ASSURANCE`
- `ARCHITECTURAL_RESIDUAL`

Repository controls require objective acceptance criteria and tests. Deployment
and external controls must not be described as application features.

# Invariants

- Signatures establish origin only under a defined trust policy; they do not
  establish benign source, uncompromised tooling, or source-to-binary
  correspondence.
- A compromised offline endpoint may exfiltrate secrets through valid outbound
  data; relay validation does not close T21.
- Application code cannot secure a compromised platform, peripheral, operator,
  or physical environment.
- Route B requires an independent authenticity mechanism for any
  high-assurance installation claim.
- Do not make absolute security or side-channel claims.

# Environment threats

The authoritative catalog is:

`docs/security/environment-threat-catalog.md`

For every relevant review, assess its currency and applicability. Add only
techniques with a credible relationship to the system, distinguish evidence
from speculation, and propagate material changes to models, findings,
implementation, tests, and claims.

Do not duplicate the evolving attack list in this skill.

# Review procedure

Record the reviewed revision, date, adversary profile, assumptions, and
evidence. Inspect implementation, tests, release workflows, installation
documentation, threat models, reviews, and the environment catalog. Separate
control existence from evidence of effectiveness and identify contradictions
or unsupported claims.

For each material catalog change:

- record affected boundaries, assumptions, threats, controls, tests,
  documentation, residual risk, and assurance claims—or a no-impact rationale;
- verify identifiers, classifications, evidence, tests, cross-document
  consistency, and user-visible claims after the change.

For each finding, provide:

- boundary, threat, prerequisites, assets, evidence, and status;
- control class and proposed response;
- objective verification criteria and applicable tests;
- documentation changes and residual risk;
- consequence if the threat succeeds or a relied-upon control fails;
- impact severity: `CRITICAL`, `HIGH`, `MODERATE`, or `LOW`;
- affected scope and severity rationale;
- feasibility under the recorded adversary profile; and
- dated sources where external evidence is used.

Severity describes consequence assuming success. Do not reduce severity because
feasibility is low; record feasibility separately.

# Required conclusion

Prioritize repository changes, deployment controls, external assurance,
architectural residuals, and documentation updates. State only the precise
assurance supported by the reviewed evidence.
