# Native relay distribution records

Checked 2026-11-04. This is preparation for the dedicated relay, starting with
Windows. No native release, signed Store package or authorized fixed-counterpart
interoperability result is recorded here. The Windows developer EXE evidence is in
the [verification matrix](browser-matrix.md#windows-native-relay-development-evidence).
The [host contract](../spec/native-relay.md) owns the technical requirements.

## Privacy and listing preparation

The user-facing notices are [English](../privacy/native-relay.md) and
[Japanese](../locales/ja/privacy/native-relay.md). Before submission, the maintainer
must publish and verify the production privacy URL, confirm the operator/contact
details and private privacy contact, and reconcile the Store declarations with the
exact submitted package. All of these publication/account facts remain pending.
The repository notice alone is not a live Store policy or a legal-compliance finding.

Microsoft's [Store policies](https://learn.microsoft.com/en-us/windows/apps/publish/store-policies)
§§10.5.1 and 10.7, checked 2026-11-04, require applicable privacy information and
localized descriptions for declared languages. Recheck them at submission. The
project's approved listing policy additionally excludes `beta`, `experimental`,
`test` and `demo` from names, subtitles, descriptions and screenshots, including
equivalent Japanese positioning. This is a project rule, not a claim that Microsoft
prohibits each word. It does not remove the independent-audit warning.

The following fields are **draft copy only**; name availability and Store identity
are unconfirmed. This development annotation is outside the fields to copy. Keep
all three warnings in each language's submitted description and before in-app
camera, copy and paste actions.

### English listing fields

**Name:** QR Crypt Relay

**Short description:** Carry encrypted QR messages between an offline device and
your messenger.

**Description:**

QR Crypt Relay converts encrypted message QR frames to text and text back to QR
frames. A message that fits one frame can also be copied as a QR image. You choose
the messenger into which you copy the output; this app does not send the message.

The relay checks message format. It does not generate or store keys, encrypt,
decrypt or authenticate messages. Keys must be exchanged face to face, outside
this app. Message type, stable key identifiers, size and frame count remain visible;
shared-key messages also expose the sender-reported creation time. The app keeps
message content in session memory and saves only the language setting. OS,
clipboard and messenger copies can remain after the session ends.

Never install or use this app on a device that holds, or has ever held, QR Crypt
keys, identities or plaintext, including a device with a browser where the offline
QR Crypt app is installed. Use a separate online device.

The camera sees everything in its view, not only the QR code. Keep sensitive
surroundings out of view and do not paste personal information or secrets.

This app has not been independently audited.

### 日本語の掲載フィールド

**名前:** QR Crypt Relay

**短い説明:** 暗号化済みメッセージを QR で、オフライン端末とメッセンジャーの間で受け渡します。

**説明:**

QR Crypt Relay は、暗号化済みメッセージの QR フレームをテキストに、テキストを QR
フレームに変換します。1 フレームに収まるメッセージは QR 画像としてもコピーできます。
出力をコピーするメッセンジャーは利用者が選びます。このアプリ自身はメッセージを送信しません。

中継版が検査するのはメッセージの形式です。鍵の生成・保存、暗号化、復号、メッセージの認証は
行いません。鍵はこのアプリを使わず対面で交換してください。メッセージの種類、固定の鍵識別子、
サイズ、フレーム数は見え、共有鍵メッセージでは送信者が申告した作成時刻も見えます。
メッセージ内容はセッションのメモリーで扱い、保存する設定は言語だけです。セッション終了後も、
OS、クリップボード、メッセンジャーにコピーが残る場合があります。

QR Crypt の鍵、識別子、平文を持つ端末や、過去に持っていた端末には、このアプリを入れたり
使ったりしないでください。オフライン QR Crypt アプリを入れたブラウザーがある端末も含みます。
別のオンライン端末を使ってください。

カメラは QR コードだけでなく、写る範囲のすべてを映します。周囲の機密を映さず、個人情報や
秘密を貼り付けないでください。

このアプリは、独立した第三者による監査を受けていません。

## Release and interoperability ledger

There are **no completed native release records** as of 2026-11-04. The current
Windows work is an unsigned developer EXE; its download observation and intermittent
PowerShell fixture failure are unresolved. Android, iOS and direct PC distribution
have no product release record. Historical [G0r](native-spikes/g0r-20261025.md)
measurements do not fill these gaps.

Create a record for every candidate and update it through each submission and
release stage. Keep every concurrently published Store version and its exact fixed
counterparts recorded; stores may progress independently. Required fields are:

| Record | Required fields and evidence |
| --- | --- |
| Candidate identity | Store/distribution route, relay edition, displayed version, Store build number, full source SHA, active wire format and suite identifiers, package/archive name and SHA-256, embedded EXE identity, lock/build provenance, exact OS and WebView runtime |
| Fixed counterpart, one entry per authorized release | Offline edition, exact release tag and full source SHA, artifact name and SHA-256, Route A signature/policy and independent rebuild verification record, installation-approval state and approving owner, exact installed build/device identity |
| Interoperability, for each candidate/counterpart pair | Both directions completed with `sym-message` and `pq-message`, including multi-frame PQ; exact bytes/outcome, environment, date and retained evidence. Synthetic protocol fixtures are separate engineering evidence |
| Package and assurance | Package identity/capabilities, signature and verification record, actual sandbox/token results, production listener inspection and contaminated negative fixture, native suite/control evidence, independent review and disposition of remaining blockers |
| Submission and rollout | Store submission/build identifiers, submitted artifact identity, submission/certification dates and results, explicit publication hold, staged rollout plan and actual stage, stop decision/responsible maintainer, evidence references |
| Public release | Same candidate's required physical-device/camera/clipboard results and dates, publication authorization, published version/build/date, Store URL and any rollout halt or withdrawal |

A field without evidence is **pending**, not passed. A public PWA release tag or
successful synthetic fixture is not an authorized Route A installation. No fixed
counterpart has yet been designated in this ledger. Bind every measurement to the
actual source and artifact; preserve failed results and previous published records.
Use committed records or exact CI run/job/artifact identifiers and retained hashes;
temporary local paths are not accessible publication evidence.

Every upload, including an update, requires successful interoperability with **each**
authorized fixed offline release. Incompatible wire changes cannot be normal Store
updates. Decide the distribution and sanitized fresh offline-install route first;
do not introduce old parsers, migration or rollback paths. Store updates are allowed
only for the relay. Account, build, runtime or Store compromise can introduce a
persistent replacement that observes camera/input data and copies ciphertext;
authentication does not detect such observation or copying.

## Submission and public-release conditions

Implementation order is Windows Store, Android, iOS, then direct PC. A platform's
submission can proceed independently once its own submission conditions pass.
Physical measurements occur on its actual public-release candidate immediately
before publication; they are deferred to that point, not waived. No platform is
published without the required evidence and release authorization.

For Windows, verify explicit manual publication hold before submitting. Microsoft's
[MSIX submission options](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options),
checked 2026-11-04, describe automatic publication after certification as the default
and offer “Don't publish this submission until I select Publish now”. Record the
chosen setting and submission identifier. Certification alone does not satisfy this
project's physical-device or security gates. Signed MSIX, actual AppContainer
behavior, client compatibility, live policy URL, Store declarations and submission
are all pending; the developer EXE establishes none of them.

## Account responsibility and incident recovery

The maintainer owns Store identity, credentials, recovery access and publication
decisions. Record account type, responsible person and verification dates without
recording passwords, tokens, certificates' private keys or recovery codes here.
Individual accounts and no additional initial spending are the approved defaults;
neither proves that registration or access is complete.

Before the first submission, the owner must verify MFA, independent recovery
methods and secure recovery-material storage using guidance for the actual account
type. Microsoft's [personal-account two-step verification guidance](https://support.microsoft.com/en-us/accounts-billing/security/how-to-use-two-step-verification-with-your-microsoft-account),
checked 2026-11-04, explains additional sign-in verification and the consequences
of losing access to verification methods. Do not substitute work/school-account
instructions or promise that support can restore access. Account type, MFA setup,
recovery access and recovery verification date remain pending.

If account, signing or build compromise is suspected, stop further submissions and
publication, halt any available rollout, preserve non-secret evidence and use the
provider's current recovery/revocation process. Revoke affected credentials and
re-establish trusted build/signing access before considering a new candidate. Repeat
package, fixed-counterpart and release checks. Withdrawal does not remove copies
already installed, and a halted update does not repair a compromised device. Record
the incident and affected published versions; never reconnect an offline key device
as a recovery step.
