---
name: nation-state-security
description: Review whether this application is structured so that plaintext cannot be leaked even under nation-state-level attack.
---

Review whether this application is structured so that plaintext cannot be leaked
even under nation-state-level attack. Prioritize T21 as a structural residual risk arising from compromise of the offline execution environment, rather than merely a Relay implementation flaw.

- The offline device will not be seized.
- wipe is insurance; once the application has been installed on a device, that
  device is never connected to a network.
- Method A is the intended path; the possibility of tampering with Method B is
  accepted.
