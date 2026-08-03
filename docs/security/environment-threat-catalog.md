# Environment Threat Catalog

日本語版: [docs/languages/ja/security/environment-threat-catalog.md](../languages/ja/security/environment-threat-catalog.md)

The authoritative list of **physical and operational environment** techniques
with a credible relationship to QR Crypt. The
`.claude/skills/nation-state-security` review procedure reads this file, assesses
its currency, and propagates material changes into the threat model, findings,
implementation, tests, and claims.

Scope boundary against [threat-model.md](threat-model.md): that document owns the
`T` identifiers, the countermeasures, and the residual-risk statements for
threats the **application** meets. This catalog owns techniques that act on the
**environment around** the application — the room, the operator, the hardware,
the media, and the network the device sits next to — including techniques the
application cannot address at all. Nothing here creates a new `T` identifier; an
entry that turns out to be application-addressable is promoted into the threat
model and cross-referenced from here.

## How to read an entry

- **Relationship** — why this technique touches *this* system specifically. An
  entry without one does not belong here.
- **Evidence** — `Evidence` when a dated public source or an in-repo measurement
  supports feasibility, `Speculation` when the mechanism is plausible for this
  stack but unmeasured here. Never silently upgrade the second into the first.
- **Position** — the control class from the review skill:
  `REPOSITORY_IMPLEMENTABLE`, `DEPLOYMENT_ENFORCED`, `EXTERNAL_ASSURANCE`, or
  `ARCHITECTURAL_RESIDUAL`.
- **Touches** — the threat-model rows or documents the entry constrains.

Severity is not restated per entry: it belongs to the finding a review writes,
where consequence and feasibility are recorded separately.

## Currency

- Catalog created 2026-08-03; entries reviewed on that date.
- Registered in `.claude/skills/freshness/targets.yaml` (unit
  `environment-threats`). A sweep re-checks the dated sources, adds techniques
  that gained a credible relationship, and records what changed.
- Cited external sources are dated. A source that has been superseded is
  replaced, not accumulated.

---

## E1 — Optical capture of a displayed QR

**Relationship.** The QR display *is* the transfer mechanism. Every key QR
(`OCK2`), public bundle (`OCI2`), and ciphertext frame is rendered on a screen
that anything with a lens can read, including from an angle the operator cannot
see. This is the most direct environment technique against the system: it needs
no software compromise and leaves no trace on the device.

**Evidence.** Direct photography needs no citation. Indirect optical paths are
demonstrated: Backes, Dürmuth, Unruh, *Compromising Reflections — or How to Read
LCD Monitors Around the Corner*, IEEE S&P 2008; Backes et al., *Tempest in a
Teapot: Compromising Reflections Revisited*, IEEE S&P 2009 (reconstruction from
reflections in eyeglasses, teapots, and eyes at a distance).

**Position.** `ARCHITECTURAL_RESIDUAL` for the display itself;
`DEPLOYMENT_ENFORCED` for the room (sightlines, window coverings, no cameras).
The application contributes only the sensitive-display warning and the
strong-confirmation gate before export.

**Touches.** threat-model T3, T19, non-goal 6.

## E2 — Ambient capture by the application's own camera

**Relationship.** Scanning is user-initiated, but while it runs the camera sees
whatever is behind the QR: documents on the desk, other screens, people in the
room. The device cannot narrow its own field of view, and the operator is
looking at the code, not the frame edges.

**Evidence.** Evidence — inherent to `getUserMedia` video capture; no citation
needed for the mechanism.

**Position.** `DEPLOYMENT_ENFORCED` (where scanning happens) plus the in-app
teardown that bounds *when* the camera is live.

**Touches.** threat-model T12, T19, non-goals 2/3.

## E3 — Screen electromagnetic emanation (TEMPEST / van Eck)

**Relationship.** A QR is a high-contrast, error-corrected, self-delimiting
image — the best possible target for a partial screen reconstruction, because
error correction repairs exactly the degradation such a channel produces. A
symmetric key QR reconstructed this way is a full key compromise with no
proximity to the device.

**Evidence.** Evidence for the mechanism: van Eck, *Electromagnetic Radiation
from Video Display Units*, Computers & Security, 1985; Kuhn, *Electromagnetic
Eavesdropping Risks of Flat-Panel Displays*, PETS 2004 (digital flat panels,
including laptop LCDs, remain readable at distance). Speculation for this stack:
no measurement exists of QR reconstruction from a modern phone OLED at a stated
distance, and phone panels are not the displays those papers characterized.

**Position.** `EXTERNAL_ASSURANCE` (shielding, distance, facility choice). The
application cannot reduce it; rendering a QR is the feature.

**Touches.** threat-model non-goal 1/5 boundary; no `T` row claims resistance,
and none may be added without measurement.

## E4 — Acoustic and mechanical emanation while typing plaintext

**Relationship.** Plaintext is typed on the offline device before encryption.
The acoustic channel bypasses every cryptographic control because it captures
the message before it becomes a message.

**Evidence.** Evidence: Asonov & Agrawal, *Keyboard Acoustic Emanations*, IEEE
S&P 2004; Zhuang, Zhou, Tygar, *Keyboard Acoustic Emanations Revisited*, CCS
2005; Harrison, Toreini, Mehrnezhad, *A Practical Deep Learning-Based Acoustic
Side Channel Attack on Keyboards*, EuroS&PW 2023 (phone-microphone and
video-call recordings of a laptop keyboard). Speculation for this stack:
touchscreen soft-keyboard entry is the expected input method here and is a
weaker acoustic target than a mechanical keyboard; motion-sensor variants of the
same idea exist but are unmeasured for this system.

**Position.** `DEPLOYMENT_ENFORCED` (no recording devices, including the
operator's own phone, near the offline device).

**Touches.** threat-model non-goal 2; asset row "plaintext".

## E5 — Physical side channels against the cryptographic implementation

**Relationship.** ML-KEM decapsulation and ML-DSA signing run in JavaScript on a
consumer device. `@noble/post-quantum` documents that constant-time execution is
not guaranteed under JS/JIT, and the ML-KEM implicit-rejection path is named
explicitly. Timing, power, and EM channels are the classical way to turn that
into key recovery.

**Evidence.** Evidence for the general class against lattice KEM/signature
implementations (an active published literature) and Evidence for the
implementation caveat itself (`@noble/post-quantum` documentation, recorded in
[security-review.md](security-review.md) §1). Speculation for this system: no
key-recovery attack has been demonstrated against this JS stack on this
hardware, and none has been attempted here.

**Position.** `EXTERNAL_ASSURANCE` — an independent audit is the mechanism that
would bound this; see the `release-approved` blocker.

**Touches.** security-review.md §1 side-channel statement; threat-model T14
residual. The prohibited-claims rule already forbids any absolute
side-channel claim.

## E6 — Custody of the offline device between sessions

**Relationship.** The operating model is a dedicated device that never
reconnects, which means it spends most of its life unattended and holding keys.
That is precisely the condition an evil-maid or implant technique needs; unlike
a networked target, nothing on the device is watching for a change.

**Evidence.** Evidence for the class (bootkit/firmware implants and unattended
tampering are long-established). Speculation for prevalence against a specific
private installation.

**Position.** `DEPLOYMENT_ENFORCED` (custody, tamper-evidence, storage) — the
application's wipe and boot gates do not survive a platform below them.

**Touches.** threat-model non-goals 1 and 5; T17 residual ("cannot defend
against code that ran before").

## E7 — Removable media as the sanctioned crossing

**Relationship.** Route A requires carrying a ZIP on physical media to a device
that must never be networked, and [threat-model.md](threat-model.md) T11's
download control lets files leave the same way. The medium is therefore a
bidirectional bridge, and its controller (firmware, not filesystem) is trusted
by both ends.

**Evidence.** Evidence: Nohl & Lell, *BadUSB — On Accessories that Turn Evil*,
Black Hat USA 2014 (reprogrammable USB controller firmware; a filesystem scan
cannot see it). Evidence for interdiction of shipped hardware as a state
practice (2013 disclosures).

**Position.** `DEPLOYMENT_ENFORCED`. Route A §7 already states that whatever
carries the archive must be trusted; this catalog records *why* a clean-looking
filesystem is not that assurance.

**Touches.** install-route-a/README.md §7; threat-model T11, non-goal 4.

## E8 — Air-gap covert channels from an already-compromised offline device

**Relationship.** T21 establishes that a compromised offline endpoint can
exfiltrate through the QR path the user carries. This entry records that the QR
path is not the only exit: the same compromised endpoint controls screen
brightness, LEDs, speakers, fans, and radios. Closing or narrowing the QR
channel therefore does not bound total egress — an argument the threat model
must never make.

**Evidence.** Evidence for a large body of demonstrated techniques (Guri et al.
have published optical, acoustic, thermal, magnetic, and RF variants against
air-gapped hosts, 2014 onward). Speculation for this stack: those demonstrations
assume native code on the host; a browser-sandboxed PWA reaches far fewer of
those emitters, and no measurement exists here.

**Position.** `ARCHITECTURAL_RESIDUAL` — outside application control once the
platform or install is compromised (non-goals 1 and 4).

**Touches.** threat-model T21, T17; install-route-a/README.md §1 (why Route A
determines the guarantee).

## E9 — Hostile network at the online relay location

**Relationship.** The relay device is deliberately online, and the wipe decision
depends on a same-origin sentinel body match. A network that rewrites or replays
responses — a captive portal, a hostile access point — is an environment
property of *where the relay device is used*, not a property of the code.

**Evidence.** Evidence: T18 already records the captive-portal pass-through case
as accepted-equivalent-to-reachable; captive portals modifying HTTP responses
are ordinary observed behavior.

**Position.** `DEPLOYMENT_ENFORCED` (choose the network) with the in-app
separation of display probe from destructive probe as the bounding control.

**Touches.** threat-model T18, T19.

## E10 — Media sanitization and disposal

**Relationship.** The wipe path is explicitly best-effort logical deletion plus
Vault-key shredding. Flash translation layers, wear levelling, and over-
provisioned blocks mean the physical medium can retain what the application
believes it deleted, which matters at device retirement and after any
`wipe-on-online` event.

**Evidence.** Evidence: NIST SP 800-88 Rev. 1, *Guidelines for Media
Sanitization* (clear/purge/destroy distinction for flash media). Already cited
by [threat-model.md](threat-model.md) §5.

**Position.** `EXTERNAL_ASSURANCE` (media-appropriate sanitization or physical
destruction).

**Touches.** threat-model §5 "No update path", T17 residual.

## E11 — Operator conditions

**Relationship.** The security-relevant steps are manual and unverifiable by the
device: the out-of-band fingerprint comparison (the only person-binding in the
system), the Route A rebuild-and-compare, and the decision to accept a
displayed warning. Fatigue, time pressure, coercion, and an attacker-supplied
"comparison channel" all defeat them without touching a byte of code.

**Evidence.** Evidence within this repository: the threat model already states
that the application cannot establish that the user compared against the
intended person (T6), and the invisible-character scan is explicitly a detection
aid whose value depends on alerts staying rare enough to be read (T21).

**Position.** `EXTERNAL_ASSURANCE` for the procedure; `REPOSITORY_IMPLEMENTABLE`
only where an interface change would reduce the load — e.g. the deliberate
non-dismissible fingerprint confirmation, which exists for this reason.

**Touches.** threat-model T6, T15, T21, T22; install-route-a/README.md §5–§6.

---

## Not included, and why

- Cryptanalysis of ML-KEM/ML-DSA or AES-GCM: not an environment technique;
  belongs to the suite choice and the audit blocker.
- Generic malware, OS compromise, screen recording: already explicit non-goals
  1–3 in the threat model; this catalog does not restate them.
- Techniques with no credible relationship to a browser-hosted, air-gapped PWA
  (for example attacks that require a hypervisor the deployment does not use):
  deliberately absent. Add one only with the relationship stated.
