# Environment Threat Catalog

日本語版: [docs/locales/ja/security/environment-threat-catalog.md](../locales/ja/security/environment-threat-catalog.md)

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
- **Evidence** — one of three labels, never silently upgraded toward the first:
  - `Evidence` — a dated public source, an in-repo measurement, or a behaviour
    already recorded elsewhere in this repository supports feasibility.
  - `Observed` — the mechanism is a directly observable property of the
    platform or the design, definitional rather than researched, so no source
    exists to cite. Use this instead of stretching `Evidence`; an entry that
    needs a citation and lacks one is not `Observed`.
  - `Speculation` — plausible for this stack but unmeasured here.
- **Position** — the control class from the review skill:
  `REPOSITORY_IMPLEMENTABLE`, `DEPLOYMENT_ENFORCED`, `EXTERNAL_ASSURANCE`, or
  `ARCHITECTURAL_RESIDUAL`.
- **Touches** — the threat-model rows or documents the entry constrains.

Severity is not restated per entry: it belongs to the finding a review writes,
where consequence and feasibility are recorded separately.

## Currency

- E1–E12 sources and applicability were assessed on 2026-09-07. This updates
  the 2026-08-14 review; it does not certify a deployment or device.
- The final USENIX 2026 paper replaces the E5 prepublication account: its
  ML-KEM-768 result is simulated, while its native experiment uses ML-KEM-512.
  Neither is an attack measurement on QR Crypt's JS ML-KEM-1024 stack.
- E1 uses author-hosted papers instead of the old generic repository redirect.
  E3's original van Eck paper could not be freshly retrieved; Kuhn's paper
  supports the mechanism. E4's 2004 primary abstract was read, not its full
  paper. E7's unidentified “2013 disclosures” claim was removed.
- E8 now names primary demonstrations; E9 distinguishes HTTP interference
  from authenticated HTTPS; E10 adds the 2026-07-16 sanitization FAQ. E11
  records the full identity comparison and actual trust decision; E12 retains
  the sentinel-only limit and points to Route A §7, step 4.
- No new technique or promotion to a `T` row is justified by this assessment.
  E8/T21's 277-bit sender-controlled floor in a legitimate symmetric transfer
  remains unchanged. Source retrieval and exact-device measurement gaps are
  retained below; this is not an exhaustive search for every possible attack.
- Registered in `.claude/skills/freshness/targets.yaml` as
  `environment-threats`. Integrated application/release verification remains
  pending; the prior `last_checked` date is retained until the complete unit
  passes. Physical-device and procedure-effectiveness evidence is unmeasured.

---

## E1 — Optical capture of a displayed QR

**Relationship.** Every key QR (`OCK2`), public bundle (`OCI2`), and ciphertext
frame is displayed for optical transfer. A camera with sufficient sightline
and resolution may capture it, including from an angle outside the operator's
view, without software compromise or an application-visible trace.

**Evidence.** `Observed` for direct photography of a readable display.
`Evidence` for indirect optical paths: Backes, Dürmuth, Unruh,
[*Compromising Reflections* (2008)](https://kodu.ut.ee/~unruh/publications/reflections.pdf),
and Backes et al.,
[*Tempest in a Teapot* (2009)](https://www.mia.uni-saarland.de/Publications/backes-sp09.pdf).
They study reconstruction through reflections; no distance or resolution
bound for this phone/display has been measured here.

**Position.** `ARCHITECTURAL_RESIDUAL` for the display;
`DEPLOYMENT_ENFORCED` for sightlines, window coverings, and camera exclusion.
The app contributes sensitive-display warnings and export confirmation only.

**Touches.** threat-model T3, T19, non-goal 6.

## E2 — Ambient capture by the application's own camera

**Relationship.** While a user-initiated scan runs, the camera may capture
documents, other screens, or people around the QR. QR Crypt provides no
privacy boundary guaranteeing QR-only acquisition.

**Evidence.** `Observed` for ambient pixels in a camera frame. The
[W3C Media Capture and Streams draft (2025-10-09)](https://www.w3.org/TR/2025/CRD-mediacapture-streams-20251009/)
provides cropping/scaling constraints, but these do not prove that the
sensor/platform never captured surroundings. Camera teardown is an
application control; its device timing and the room's protection are separate,
unmeasured questions.

**Position.** `DEPLOYMENT_ENFORCED` for scan location;
`REPOSITORY_IMPLEMENTABLE` for teardown bounding when capture is active.

**Touches.** threat-model T12, T19, non-goals 2/3.

## E3 — Screen electromagnetic emanation (TEMPEST / van Eck)

**Relationship.** Reconstruction of a displayed symmetric-key QR would expose
the key. Contrast and error correction may assist decoding but do not
establish receiver feasibility, range, or a phone's emissions.

**Evidence.** `Evidence` for the general mechanism: van Eck,
*Electromagnetic Radiation from Video Display Units* (1985), and Kuhn,
[*Electromagnetic Eavesdropping Risks of Flat-Panel Displays* (2004)](https://www.cl.cam.ac.uk/~mgk25/pet2004-fpd.pdf).
The original van Eck paper could not be freshly retrieved on 2026-09-07;
Kuhn's studied display/cable mechanisms support this entry. `Speculation` for
modern phone OLED QR reconstruction at a stated distance: no such measurement
exists here, and those panels differ from the studied displays.

**Position.** `EXTERNAL_ASSURANCE` for shielding, distance, and facility choice.
No application resistance follows from the cited demonstrations.

**Touches.** threat-model non-goals 1/5; no `T` row claims resistance.

## E4 — Acoustic and mechanical emanation while typing plaintext

**Relationship.** Plaintext entry precedes encryption, so observations of
typing can bypass the message's cryptography.

**Evidence.** `Evidence` for hardware keyboards: Asonov & Agrawal,
[*Keyboard Acoustic Emanations* (primary abstract, 2004-08-16)](https://research.ibm.com/publications/keyboard-acoustic-emanations);
Zhuang, Zhou, Tygar,
[*Keyboard Acoustic Emanations Revisited* (2005)](https://www.cs.cornell.edu/~shmat/courses/cs6431/zhuang.pdf);
and Harrison, Toreini, Mehrnezhad,
[*A Practical Deep Learning-Based Acoustic Side Channel Attack on Keyboards* (submitted 2023-08-02)](https://arxiv.org/abs/2308.01074).
The 2023 study classifies laptop keys from phone/Zoom recordings, not phone
touchscreen entry. `Speculation` for the expected touchscreen input here;
neither its relative weakness nor motion-sensor variants were measured. The
2004 full paper was not freshly retrieved in this assessment.

**Position.** `DEPLOYMENT_ENFORCED` for excluding recording devices, including
the operator's online phone, from plaintext-entry areas.

**Touches.** threat-model non-goal 2; asset row “plaintext”.

## E5 — Physical side channels against the cryptographic implementation

**Relationship.** ML-KEM-1024 decapsulation and ML-DSA-87 signing run in
JavaScript. The selected
[Noble 0.7.1 security statement](https://github.com/paulmillr/noble-post-quantum/blob/0.7.1/README.md#security)
does not guarantee constant-time JS/JIT execution, including implicit rejection.
The cleanup changes assessed in [security-review.md](security-review.md) §1
do not bound timing, power, EM leakage, or GC/native copies.

**Evidence.** `Evidence` for generic lattice-KEM implementation attacks:
Ravi et al.,
[*Generic Side-channel attacks on CCA-secure lattice-based PKE and KEMs* (2020-06-19)](https://tches.iacr.org/index.php/TCHES/article/view/8592).
Guo, Nabokov, Johansson's
[USENIX Security 2026 paper](https://www.usenix.org/conference/usenixsecurity26/presentation/guo-qian)
([final PDF](https://www.usenix.org/system/files/usenixsecurity26-guo-qian.pdf))
reports **simulated ML-KEM-768** recovery at 2,950 queries with 95% oracle
accuracy. Its **native GoFetch experiment uses ML-KEM-512**, Apple M1/macOS
13.5, and unprivileged code in a separate address space with native
high-resolution timing. In 73 of 100 runs, recovered-key Hamming distance is
at most four, the paper's success definition. Browser-sandbox restrictions
are explicitly outside scope. `Speculation` for QR Crypt: no measured attack
on its ML-KEM-1024 JavaScript/browser/device configuration is supplied or
attempted here.

**Position.** `EXTERNAL_ASSURANCE`. A scoped review and timing/power/EM campaign
must identify hardware, firmware, OS/browser, build, workload, attacker access,
and statistical limits. A generic audit or throughput benchmark alone provides
no exact-stack leakage bound; the independent-review blocker remains.

**Touches.** security-review §1; threat-model T14; prohibited side-channel claims.

## E6 — Custody of the offline device between sessions

**Relationship.** A permanently offline device may hold keys during periods
without supervision. Brief physical access can target its boot or firmware
layers; QR Crypt cannot attest those layers or repair their compromise.

**Evidence.** `Evidence` on the studied systems: Rutkowska,
[*Evil Maid goes after TrueCrypt!* (2009-10-15)](https://blog.invisiblethings.org/2009/10/15/evil-maid-goes-after-truecrypt.html),
and ESET,
[*LoJax* (2018-09-27, Secure Boot correction 2018-10-09)](https://www.welivesecurity.com/2018/09/27/lojax-first-uefi-rootkit-found-wild-courtesy-sednit-group/).
These support boot-path tampering and firmware persistence, not a universal
phone exploit or absence of platform monitoring. `Speculation` for access
probability at a particular installation; no measurement here bounds it.

**Position.** `DEPLOYMENT_ENFORCED` for custody, tamper evidence, and storage.
Application boot/wipe gates do not restore trust in a compromised lower layer.

**Touches.** threat-model non-goals 1/5 and T17.

## E7 — Removable media as the sanctioned crossing

**Relationship.** Route A carries an archive to the offline device; explicit
T11 exports can leave on media too. The bridge includes controller/firmware
behavior, not just the files the operator sees.

**Evidence.** `Evidence`: SRLabs,
[*BadUSB / USB peripherals that turn evil* (2014-07-31)](https://srlabs.de/blog/usb-peripherals-turn)
describes reprogrammable controller firmware outside filesystem scans. The
unidentified “2013 disclosures” reference is not retained as verified evidence.

**Position.** `DEPLOYMENT_ENFORCED`. An authenticated ZIP or clean filesystem
does not authenticate the medium's controller. Route A §7 requires trusted
transport and custody; **reject any medium or transfer that cannot meet this
threat model**. No specific medium is approved by this catalog.

**Touches.** install-route-a/README.md §7; threat-model T11, non-goal 4.

## E8 — Air-gap covert channels from an already-compromised offline device

**Relationship.** T21's valid QR egress is not the only possible channel after
platform compromise. Other emitters depend on the host's hardware and the
attacker's privileges. Narrowing QR syntax does not bound total egress.

**Evidence.** `Evidence` for distinct native-host demonstrations:
[AirHopper (2014-11-02)](https://arxiv.org/abs/1411.0237),
[BitWhisper (2015-03-26)](https://arxiv.org/abs/1503.07919),
[LED-it-GO (2017-02-22)](https://arxiv.org/abs/1702.06715),
[MAGNETO (2018-02-07)](https://arxiv.org/abs/1802.02317), and
[MOSQUITO (2018-03-09)](https://arxiv.org/abs/1803.03422).
Their radios, thermal paths, LEDs, magnetic emissions, and audio channels
require different capabilities and receivers. `Speculation` for this PWA's
access to each emitter; no device measurement establishes it. Not every phone
has controllable fans, radios, or an HDD LED.

**Position.** `ARCHITECTURAL_RESIDUAL`. Preserve valid-egress risk through QR,
clipboard, PNG, ZIP, and removable media, including T21's 277-bit floor. An
export carried on media bypasses the relay parser entirely.

**Touches.** threat-model T21, T17; install-route-a/README.md §1.

## E9 — Hostile network at the online relay location

**Relationship.** The relay is deliberately online; destructive reachability
depends on a same-origin sentinel body match. A hostile network may interfere
with delivery, but ordinary access-point control alone does not let an
attacker rewrite authenticated HTTPS without an additional trust/platform
compromise.

**Evidence.** `Evidence`: in-repo T18 accepts sentinel pass-through as reachable;
[RFC 8952 (2020-11)](https://www.rfc-editor.org/rfc/rfc8952)
describes captive-portal architecture and authenticated TLS treatment. HTTP
interception and authenticated HTTPS are distinct cases. A body match is not
proof of a physical air gap or of response-header conformity.

**Position.** `DEPLOYMENT_ENFORCED` for network choice;
`REPOSITORY_IMPLEMENTABLE` for separating display and destructive probes.

**Touches.** threat-model T18, T19.

## E10 — Media sanitization and disposal

**Relationship.** Wipe attempts logical deletion and Vault-key destruction.
Flash translation, wear levelling, and spare blocks can retain prior data;
retirement and online-wipe events therefore require separate media assurance.

**Evidence.** `Evidence`:
[NIST SP 800-88 Rev. 2 (2025-09-26)](https://csrc.nist.gov/pubs/sp/800/88/r2/final)
supersedes Rev. 1; its
[FAQ (2026-07-16)](https://csrc.nist.gov/files/pubs/sp/800/88/r2/final/docs/sp800-88r2-faq.pdf)
distinguishes sanitization-program guidance from technique-specific standards.
Browser deletion and attempted Vault-key destruction are not demonstrated
NIST cryptographic erase: prior plaintext, every key copy, implementation,
media characteristics, and verification matter.

**Position.** `EXTERNAL_ASSURANCE` for media-specific sanitization and verified
disposal. The citation alone approves no physical destruction method.

**Touches.** threat-model §5 “No update path”, T17.

## E11 — Operator conditions

**Relationship.** Person-binding requires a manual comparison with the intended
person through an independent channel. Route A rebuilding and acceptance of
warnings also depend on operators. Fatigue, coercion, time pressure, or an
attacker-controlled comparison channel can defeat these procedures.

**Evidence.** `Evidence` in the 2026-09-07 application implementation record
([security-review.md](security-review.md) §1.4): `formatFingerprint` shows
all 64 lowercase hex digits, grouped in fours, in one display. The complete
composite identity digest is authoritative at import and saved-key
confirmation; complete KEM/signing hashes are supplementary. Confirmed save
requires acknowledging comparison of every digit with the intended person
over an independent channel. **Save without verification** is a separate choice;
unverified bundles cannot be encryption recipients, while signatures under
their stored keys can still be checked without asserting person-binding.
Symmetric import requires the full key comparison but persists no trust state.
Independent regression verification remains pending on the integrated tree.

**Position.** `REPOSITORY_IMPLEMENTABLE` for the display and trust-state gate;
`EXTERNAL_ASSURANCE` for the comparison procedure. A checkbox or
non-dismissible dialog does not prove comparison occurred or bound fatigue,
coercion, or channel trust.

**Touches.** threat-model T6, T15, T21, T22, T23;
install-route-a/README.md §§2–5/7.

## E12 — Serving configuration of the Route A local server

**Relationship.** Headers, MIME types, SPA fallback, and sentinel caching are
properties of the actual local server. A signed archive cannot ensure that
server interprets `_headers` or sends the intended policy.

**Evidence.** `Evidence` from the 2026-09-07 source review: the
[Cloudflare header format](https://developers.cloudflare.com/pages/configuration/headers/)
is host-specific, and [CSP meta delivery](https://w3c.github.io/webappsec-csp/#meta-element)
cannot deliver every response-header control. The reference server and shared
parser implement this repository's rules, not the entire Cloudflare language.

**Position.** `DEPLOYMENT_ENFORCED`. The app evaluates seven `/*` header
values, sentinel `Cache-Control: no-store`, MIME, status, redirects, and URL
on the sentinel response, persists the verdict, and refuses to mount the
Router when that verdict is failing or absent. This control already exists;
it is not a new navigation validator.

**Residual.** The expected policy is derived from the same checkout's
`public/_headers`, not an independently provisioned security floor. A passing
sentinel says nothing about actual navigation or arbitrary script/style/WASM/
service-worker responses or browser enforcement. Route A requires a separate
checker against those real responses, cache/MIME rules, SPA handling, method
restrictions, and path containment on the chosen server. Release tests on the
reference server provide separate evidence and do not discharge that duty.

**Touches.** threat-model §2, T18; boot-and-reset-v2.md §2.2;
[install-route-a/README.md](../develop/install-route-a/README.md) §7, step 4.

---

## Not included, and why

- Cryptanalysis of ML-KEM/ML-DSA or AES-GCM: not an environment technique;
  belongs to the suite choice and the audit blocker.
- Generic malware, OS compromise, screen recording: already explicit non-goals
  1–3 in the threat model; this catalog does not restate them.
- Techniques with no credible relationship to a browser-hosted, air-gapped PWA
  (for example attacks that require a hypervisor the deployment does not use):
  deliberately absent. Add one only with the relationship stated.
