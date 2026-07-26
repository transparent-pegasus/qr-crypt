export const LANGUAGES = ["en", "ja"] as const
export type Language = (typeof LANGUAGES)[number]

export type InterpolationValue = string | number
export type InterpolationValues = Readonly<Record<string, InterpolationValue>>

const en = {
  "language.field": "Language",
  "language.en": "English",
  "language.ja": "日本語",

  "common.operationFailed": "The operation could not be completed",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.supported.yes": "Available",
  "common.supported.no": "Unavailable",
  "common.featureUnavailable": "This feature is unavailable: {feature}",
  "common.unused": "Not used",
  "common.none": "None",
  "common.copyFailed":
    "The content could not be copied. Check the browser permission.",
  "common.riskUnderstood": "I understand the risk",
  "common.copy": "Copy",
  "common.download": "Download",
  "common.delete": "Delete",
  "common.deleteAriaLabel": "Delete {name}",
  "common.created": "Created: {datetime}",
  "common.identityFingerprint": "Identity fingerprint",
  "common.fingerprintCompare": "Comparison display: {value}",
  "common.loading": "Loading",
  "common.openKeysPage": "Open the keys page",
  "common.processing": "Processing",
  "common.pastePayload": "Paste a payload",
  "common.na": "N/A",
  "common.yes": "Present",

  "validation.name.required": "Enter a name",
  "validation.name.maxLength": "Keep the name to 80 characters or fewer",
  "validation.name.invalidChars": "The name contains characters that cannot be used",

  "presentation.framePosition": "frame {position}",
  "presentation.frameSeparator": ", ",

  "feature.camera": "Camera",
  "network.online": "Online",
  "network.offline": "Offline",
  "network.srLabel": "Network status",

  "nav.encrypt": "Encrypt / decrypt",
  "nav.keys": "Add keys",
  "nav.keyList": "Key list",
  "nav.settings": "Settings",
  "nav.ariaLabel": "Main navigation",
  "nav.top": "Top",
  "nav.relay": "Relay",
  "nav.onlineAriaLabel": "Online navigation",

  "errors.UNSUPPORTED_BROWSER":
    "This browser does not provide the required features. Open the app in a supported browser.",
  "errors.INVALID_QR_PREFIX": "This QR code is not in this app's format.",
  "errors.INVALID_QR_PAYLOAD":
    "The QR code contents could not be read. The format is invalid or the data is damaged.",
  "errors.UNSUPPORTED_PROTOCOL_VERSION":
    "This QR code was created by a newer version of the app. Update the app.",
  "errors.UNSUPPORTED_ALGORITHM": "This cryptographic algorithm is not supported.",
  "errors.KEY_NOT_FOUND": "The matching key could not be found.",
  "errors.KEY_TYPE_MISMATCH": "The selected key cannot be used for this operation.",
  "errors.ENCRYPTION_FAILED": "Encryption failed. Check the input.",
  "errors.DECRYPTION_FAILED":
    "Decryption failed. The key, cryptographic algorithm, or ciphertext does not match.",
  "errors.QR_TOO_LARGE":
    "There is too much data to generate a QR code at this error-correction level.",
  "errors.STORAGE_FAILED": "The storage operation failed.",
  "errors.CAMERA_PERMISSION_DENIED":
    "Camera access is not permitted. Allow it in the browser settings.",
  "errors.CAMERA_NOT_AVAILABLE": "The camera is unavailable.",
  "errors.QR_READER_PREPARATION_TIMEOUT":
    "The QR reader did not finish preparing on this device.",
  "errors.QR_DECODE_PROGRESS_TIMEOUT":
    "The QR decoding pipeline stopped making progress on this device.",
  "errors.QR_READER_BLOCKED":
    "This browser blocks the QR reader. On iPhone, use Safari 16 or newer.",
  "errors.DUPLICATE_KEY": "A key with the same contents is already stored.",
  "errors.DUPLICATE_QR": "A QR code with the same contents is already stored.",
  "errors.SIGNATURE_INVALID":
    "The signature could not be verified. The sender's signing key or the contents do not match.",
  "errors.SIGNING_KEY_NOT_FOUND":
    "The sender's signing key for this signature could not be found. Import the signature-verification public key first.",
  "errors.FRAME_MISMATCH":
    "QR codes from different transfers are mixed together. Discard the scan state and start again.",
  "errors.WORKER_UNAVAILABLE":
    "Cryptographic processing could not be performed safely on this device. Reopen the app in a supported browser.",
  "errors.RESET_FAILED": "Some operations did not finish while resetting local data.",

  "browser.unsupported.title": "This browser is not supported",
  "browser.unsupported.body":
    "This browser is missing features required for encryption and on-device storage. Open the app in a current browser that supports Web Crypto and IndexedDB.",
  "browser.featureList.ariaLabel": "Browser feature list",

  "boot.probing.status": "Checking network reachability and local data…",
  "boot.wiping.title": "Resetting local data",
  "boot.wiping.body": "Do not close this screen until the operation finishes.",
  "boot.wiped.title": "Local data was reset after an online connection was detected",
  "boot.wiped.body":
    "Best-effort logical deletion was attempted. Physical erasure is not guaranteed.",
  "boot.partialFailure.retryHint":
    "Close this tab. To use the app again, fully format the device, then reinstall the app.",

  "gate.install.error":
    "Installation could not be started. Use the browser menu instead.",
  "gate.appIcon.alt": "{appName} app icon",
  "gate.mode.label": "Online installation and OCF2 message-header relay",
  "gate.heading": "Install the PWA or relay OCF2 message-header QR frames",
  "gate.description":
    "Encryption, decryption, key creation, key lists, and settings remain offline-only. When a sensitive-store scan completes without error and finds no key rows, PQ identities, or Vault, a clean origin may also relay canonical OCF2 frames whose untrusted outer header declares pq-message, without using local keys.",
  "pwa.installState.label": "PWA installation status",
  "pwa.installState.installed": "Installed",
  "pwa.installState.notInstalled": "Not installed",
  "pwa.offlineReady.label": "Offline-use readiness",
  "pwa.offlineReady.ready": "Ready",
  "pwa.offlineReady.preparing": "Preparing",
  "pwa.registerError": "The Service Worker could not be registered.",
  "pwa.offlineReady.toast": "Offline use is ready",
  "gate.install.progress": "Installing…",
  "gate.install.button": "Install the PWA",
  "gate.install.iosHint": 'In Safari, choose "Add to Home Screen" from the Share menu.',
  "gate.install.otherHint":
    'Choose "Install app" or "Add to Home Screen" from the browser menu.',
  "gate.switchOffline.title": "Switch to offline mode",
  "gate.switchOffline.body":
    "Switch to offline mode, for example with airplane mode, to use offline features. A risk acknowledgement will appear when the state changes. On a compromised device, neither airplane mode nor an offline indicator can be trusted, so going offline does not guarantee that the device is safe.",
  "gate.about.link": "What this app does",

  "relay.card.title": "OCF2 message-header QR relay",
  "relay.card.description":
    "Move canonical OCF2 frame text between a messenger and an offline device. The relay does not intentionally place frame-derived values in app-managed storage or frame-bearing network requests.",
  "relay.boundary.title": "Untrusted relay boundary",
  "relay.boundary.body":
    "The relay accepts frames whose untrusted outer header declares pq-message. It does not assemble the artifact or verify its total hash, inner type, AEAD, signature, sender, or safety; the receiving offline device is authoritative. Face-to-face key exchange is the supported workflow.",
  "relay.capture.open": "QR → text",
  "relay.capture.unavailable":
    "Camera capture is unavailable on this device. Text-to-QR playback remains available.",
  "relay.capture.title": "QR frames to text",
  "relay.capture.description":
    "Start the camera explicitly, then scan every frame from the offline device. Malformed or mismatched frames are rejected without replacing accepted frames.",
  "relay.capture.video.ariaLabel": "OCF2 message-header relay camera preview",
  "relay.capture.startCamera": "Start camera",
  "relay.capture.cameraActive": "Camera active",
  "relay.capture.progress": "{collected} / {total} frames collected",
  "relay.capture.missing": "Missing frames: {indexes}",
  "relay.capture.output.label": "Relay text",
  "relay.capture.copy": "Copy relay text",
  "relay.copy.warning":
    "Copying exports the relay text to the system clipboard. Clipboard contents may persist or sync outside this app and are not cleared by an app reset.",
  "relay.playback.open": "Text → QR",
  "relay.playback.title": "Turn relay text into QR frames",
  "relay.playback.description":
    "Paste a complete canonical frame set. Lines may use LF or CRLF; order does not matter.",
  "relay.playback.input.label": "Relay text",
  "relay.playback.show": "Show QR frames",
  "relay.playback.missing": "Missing frames: {indexes}",
  "relay.playback.screenCaptureWarning":
    "Displayed QR images can still be saved by long-press, printing, screenshots, or screen recording.",
  "relay.playback.qrTitle": "Relayed OCF2 frames",
  "relay.playback.noDownloadControls":
    "This relay provides no app file-download controls.",
  "relay.error.title": "Relay input rejected",
  "relay.error.empty": "Enter or scan at least one frame.",
  "relay.error.prefix": "Only canonical OCF2 frame strings are accepted.",
  "relay.error.outerType": "The frame's outer header does not declare pq-message.",
  "relay.error.invalidFrame": "The frame is not a canonical OCF2 frame.",
  "relay.error.mismatch": "The frame does not belong to the accepted frame set.",
  "relay.error.length": "The frame set has inconsistent declared and collected lengths.",
  "relay.error.incomplete":
    "The frame set is incomplete. Add every missing frame before playback.",
  "relay.error.inputSize": "The relay text exceeds the protocol limit.",
  "relay.error.timeout":
    "The relay session timed out and its app-held frame references were cleared.",
  "relay.error.copy": "The relay text could not be copied.",

  "offlineAck.status": "The device is now offline",
  "offlineAck.title": "Confirm before continuing",
  "offlineAck.body.assumption":
    "This app is designed around the assumption that any device connected to a network may be compromised. Selecting airplane mode or disconnecting a network after being online does not return the device to a trusted state. Compromised code, keys, and data may remain after the device goes offline.",
  "offlineAck.body.riskPrefix":
    "To reduce risk, physically isolate the device from networks and operate it as a dedicated device that will ",
  "offlineAck.body.neverReconnect": "never connect again",
  "offlineAck.body.riskSuffix":
    ". Otherwise, there is no way to encrypt messages with complete safety. ",
  "offlineAck.body.noGuarantee":
    "Even then, this app does not guarantee complete safety, including that of the device or installed code.",
  "offlineAck.ackLabel":
    "I understand the statements above, accept the risk, and want to continue on this device",
  "offlineAck.ackHint":
    "This check does not verify or restore the security of the device",
  "offlineAck.continue": "Accept the risk and show offline features",
  "offlineAck.reload": "Reload and continue",

  "algorithm.A256GCM": "Symmetric-key AES-256-GCM",
  "algorithm.MLKEM1024_A256GCM": "Post-quantum ML-KEM-1024 + AES-256-GCM",
  "algorithm.MLKEM1024_MLDSA87_A256GCM":
    "Signed post-quantum ML-KEM-1024 + ML-DSA-87 + AES-256-GCM",

  "qrDisplay.defaultTitle": "QR code",
  "qrDisplay.notQrCryptPayload":
    "A QR code cannot be generated because this is not an app payload.",
  "qrDisplay.error.title": "The QR code could not be generated",
  "qrDisplay.image.alt": "{title} image",
  "qrDisplay.generating": "Generating the QR code…",
  "qrDisplay.dataSize": "Data size: {bytes} bytes / EC={ecLevel}",
  "qrDisplay.fullscreen.button": "View full screen",
  "qrDisplay.fullscreen.title": "View {title} full screen",
  "qrDisplay.fullscreen.desc": "Displays the QR code full screen on a white background.",
  "qrDisplay.fullscreen.imageAlt": "Full-screen {title} image",
  "qrDisplay.fullscreen.brightnessHint":
    "Increasing the screen brightness can make scanning easier",

  "animatedQr.defaultTitle": "Multi-frame QR",
  "animatedQr.empty.title": "There are no frames to display",
  "animatedQr.empty.body": "Create the multi-frame QR again.",
  "animatedQr.section.ariaLabel": "{title} frame display",
  "animatedQr.missing.title": "Frames are missing",
  "animatedQr.missing.body":
    "Missing frames: {indexes}. Recovery is not possible while frames are missing.",
  "animatedQr.frameTitle": "{title} {current} / {total}",
  "animatedQr.prev": "Previous",
  "animatedQr.play": "Play",
  "animatedQr.pause": "Pause",
  "animatedQr.next": "Next",
  "animatedQr.compatibility.label": "Compatibility mode",
  "animatedQr.densityRaised":
    "Frame density could not be lowered further because this transfer must stay within the frame limit.",
  "animatedQr.brightnessHint":
    "Increase the screen brightness and keep the device still for more reliable scanning.",
  "animatedQr.export.error.title": "The frames could not be exported",

  "keyDetail.rename.label": "Key name",
  "keyDetail.rename.submit": "Rename",
  "keyDetail.rename.saved": "Key renamed",
  "keyDetail.qr.bundleTitle": "{name} public-key bundle",
  "keyDetail.qr.kemTitle": "{name} encryption public key",
  "keyDetail.qr.signingTitle": "{name} signature-verification public key",
  "keyDetail.qr.outputName": "{title}-{date}",
  "keyDetail.toast.rotated": "The identity was rotated",
  "keyDetail.toast.revoked": "The identity was revoked on this device",
  "keyDetail.toast.symmetricDeleted": "The symmetric key was deleted",
  "keyDetail.toast.identityDeleted": "The post-quantum identity was deleted",
  "keyDetail.toast.supersededDestroyed": "Older key material was discarded",
  "keyDetail.toast.copied":
    "Copied. Be aware that the clipboard may be synchronized.",
  "keyDetail.symmetricQr.title": "Symmetric-key QR",
  "keyDetail.identityQr.desc":
    "All content is displayed as OCF2 frames with Q error correction.",
  "keyDetail.symmetricQr.desc":
    "This QR code contains a secret key that can be used for encryption and decryption.",
  "keyDetail.backToDetail": "Back to details",
  "keyDetail.symmetricQr.secretTitle": "Sensitive information",
  "keyDetail.symmetricQr.secretBody":
    "If shown to a third party, past and future ciphertext may be decrypted.",
  "keyDetail.delete.titleNamed": 'Delete "{name}"?',
  "keyDetail.delete.titleGeneric": "Delete the key?",
  "keyDetail.delete.body.identity":
    "Ciphertext addressed to this identity will no longer be decryptable. Unlike revocation, this cannot be undone.",
  "keyDetail.delete.body.symmetric":
    "Ciphertext encrypted with this key will no longer be decryptable. This cannot be undone.",
  "keyDetail.delete.confirm": "Delete",
  "keyDetail.destroy.title": "Discard {count} older generation(s)?",
  "keyDetail.destroy.body":
    "Created {dates}. This closes the decryption route this app keeps open for those generations: messages sent to them that have not been decrypted yet can no longer be opened here. It is a logical delete, so it does not assure the bytes leave the storage medium, and a copy already loaded in another open tab is outside this action.",
  "keyDetail.destroy.confirm": "Discard",
  "keyDetail.badge.legacyProfile": "Unsupported (legacy profile)",
  "keyDetail.identity.legacyNote":
    "Unsupported (legacy profile): cryptographic operations and QR re-export are unavailable.",
  "keyDetail.identity.oldNote": "Previous generation: decryption/verification only",
  "keyDetail.identity.activeNote": "Available for encryption and signing",
  "keyDetail.identity.kemFingerprintLabel": "KEM {algorithm}",
  "keyDetail.identity.signingFingerprintLabel": "Signing {algorithm}",
  "keyDetail.button.bundleQr": "Public-key bundle QR",
  "keyDetail.button.kemQr": "Encryption public-key QR",
  "keyDetail.button.signingQr": "Signature-verification public-key QR",
  "keyDetail.button.rotate": "Rotate",
  "keyDetail.button.revoke": "Revoke on this device",
  "keyDetail.revokeNote":
    "Revocation stops this identity from signing and from being published as a current recipient on this device, and is not propagated to other parties. It does not stop decryption with this identity: use Delete to discard its key material.",
  "keyDetail.previous.toggle":
    "{count} previous generations, decryption only",
  "keyDetail.previous.destroyAll":
    "Discard the key material of {count} older generation(s)",
  "keyDetail.symmetric.fingerprintLabel": "Key fingerprint",
  "keyDetail.button.showSecretQr": "Show secret-key QR",

  "keyStatus.active": "Active",
  "keyStatus.rotated": "Rotated",
  "keyStatus.revoked": "Revoked",

  "keyList.title": "Key list",
  "keyList.subtitle": "Message ciphertext is not stored in the app.",
  "keyList.error.identity": "Post-quantum identities could not be loaded",
  "keyList.error.symmetric": "Symmetric keys could not be loaded",
  "keyList.error.peer": "The other party's keys could not be updated",
  "keyList.tab.own": "My keys",
  "keyList.tab.peer": "Other parties' keys",
  "keyList.filter.label": "Type",
  "keyList.filter.all": "All",
  "keyList.filter.pqIdentity": "Post-quantum identity",
  "keyList.filter.symmetric": "Symmetric key",
  "keyList.item.identityMeta": "Post-quantum identity · {datetime}",
  "keyList.item.supersededWarning":
    "{count} older generation(s) can still decrypt",
  "keyList.item.symmetricMeta": "Symmetric key · {datetime}",
  "keyList.empty.ownAll": "You have no keys.",
  "keyList.empty.ownFiltered": "There are no keys of the selected type.",
  "keyList.empty.noKeys": "There are no keys. Create one on the keys page.",
  "keyList.bundle.empty": "There are no imported public-key bundles.",
  "keyList.bundle.nameConfirmed": "Verified public key",
  "keyList.bundle.nameUnverified": "Unverified public key",
  "keyList.bundle.badge.confirmed": "Identity verified",
  "keyList.bundle.badge.unverified": "Unverified",
  "keyList.bundle.fingerprintKem": "Recipient public key {algorithm}",
  "keyList.bundle.fingerprintSigning": "Signing public key {algorithm}",
  "keyList.bundle.legacyNote":
    "This legacy profile is unsupported, so only deletion is available.",
  "keyList.bundle.revoke": "Disable on this device",
  "keyList.bundle.confirmOpen": "Compare and confirm the fingerprint",
  "keyList.bundle.confirmTitle": "Confirm this identity's fingerprint",
  "keyList.bundle.confirmBody":
    "Compare every group below with the value shown on the other party's own device, through another channel such as a call or in person. Confirming records that you did so and makes this identity selectable as an encryption recipient; the app cannot check the comparison for you.",
  "keyList.bundle.confirmCheck":
    "I compared the fingerprint through another channel and it matched",
  "keyList.bundle.confirmSubmit": "Confirm",
  "keyList.toast.bundleConfirmed": "The fingerprint was confirmed",

  "keys.validation.keyNameFallback": "Check the key name.",
  "keys.validation.idNameFallback": "Check the identity name.",
  "keys.toast.symmetricCreated": "The symmetric key was created",
  "keys.toast.identityCreated": "The post-quantum identity was created",
  "keys.toast.legacyRemoved": "The legacy RSA keys were deleted",
  "keys.toast.symmetricImported": "The symmetric key was imported",
  "keys.toast.bundleConfirmed": "Saved with the fingerprint verified",
  "keys.toast.bundleUnverified": "Saved without verification",
  "keys.import.symmetricDefaultName": "Imported-symmetric-key-{date}",
  "keys.title": "Add keys",
  "keys.legacy.title":
    "{count} legacy RSA keys cannot be used with v2 and cannot be recovered",
  "keys.legacy.body":
    "Legacy ciphertext cannot be decrypted. These keys are not shown in normal lists or options.",
  "keys.legacy.deleteButton": "Delete legacy keys",
  "keys.tab.create": "Create",
  "keys.tab.import": "Import",
  "keys.import.cameraTitle": "Scan with the camera",
  "keys.import.scanTrigger": "Scan a key QR code",
  "keys.import.payloadLabel": "Key payload",
  "keys.import.payloadPlaceholder": "Paste OCK1: / OCP2: / OCS2: / OCI2:",
  "keys.import.readButton": "Read the key",
  "keys.singleKey.title": "A single key was read",
  "keys.singleKey.kemLabel": "Encryption public key",
  "keys.singleKey.signingLabel": "Signature-verification public key",
  "keys.singleKey.fingerprintLabel": "Single-key fingerprint",
  "keys.singleKey.persistHint":
    "To verify the association with a person and use this key persistently, import the OCI2 public-key bundle.",
  "keys.bundle.dialogTitle": "Compare the fingerprint through another channel",
  "keys.bundle.dialogDesc":
    "Before completing the import, compare the full hex with the other party through another channel, such as a call or in person. A self-signature alone does not prove a person's identity. If you save without verification, this identity cannot be selected for encryption until you confirm it later under Saved keys.",
  "keys.bundle.fingerprintKem": "ML-KEM fingerprint",
  "keys.bundle.fingerprintSigning": "ML-DSA fingerprint",
  "keys.bundle.confirmLabel": "I confirmed a match through another channel",
  "keys.bundle.saveUnverified": "Save without verification",
  "keys.bundle.saveConfirmed": "Verify and save",
  "keys.symmetricImport.dialogTitle": "Import a symmetric key",
  "keys.symmetricImport.dialogDesc":
    "This payload contains a secret key that can be used for encryption and decryption.",
  "keys.symmetricImport.warnTitle": "Verify the sharing channel",
  "keys.symmetricImport.warnBody":
    "If a third party has the same key, they may be able to decrypt the ciphertext.",
  "keys.symmetricImport.nameLabel": "Key name",
  "keys.symmetricImport.ackLabel": "I trust the channel used to share this key",
  "keys.symmetricImport.saveButton": "Save the symmetric key",
  "keys.demo.hint":
    "Ask the other party to increase their screen brightness, hold the camera about 15–20 cm away, and keep it still until the image is in focus.",
  "keys.create.nameLabel.pq": "Post-quantum identity name",
  "keys.create.nameLabel.symmetric": "Symmetric-key name",
  "keys.create.button.pq": "Create a post-quantum identity",
  "keys.create.button.symmetric": "Create a symmetric key",
  "keys.create.kindLabel": "Type",
  "keys.create.kind.pqIdentity":
    "Post-quantum identity ML-KEM-1024 + ML-DSA-87",
  "keys.create.experimentalNote": "experimental · not independently audited",

  "encrypt.toast.autoCleared": "Plaintext and transient results were cleared",
  "encrypt.output.suggestedName": "Encrypted-result-{date}",
  "encrypt.toast.plaintextClearedByPref":
    "Plaintext was cleared according to the setting",
  "encrypt.toast.payloadCopied": "The payload was copied",
  "encrypt.validation.outputNameFallback": "Check the output name.",
  "encrypt.srHeading": "Encryption and decryption",
  "encrypt.tab.encrypt": "Encrypt",
  "encrypt.tab.decrypt": "Decrypt",
  "encrypt.algorithmLabel": "Cryptographic algorithm",
  "encrypt.keyLabel": "Key",
  "encrypt.recipientLabel": "Recipient ML-KEM public key",
  "encrypt.recipient.confirmed": "Verified",
  "encrypt.recipient.unverified": "Unverified",
  "encrypt.recipient.needsConfirmation":
    "No confirmed recipient. A public identity becomes selectable here once its fingerprint has been compared with the other party through another channel and confirmed under Saved keys.",
  "encrypt.senderLabel": "My ML-DSA signing identity",
  "encrypt.plaintextLabel": "Plaintext",
  "encrypt.clearPlaintext": "Clear plaintext",
  "encrypt.plaintextPlaceholder": "Enter the text to encrypt",
  "encrypt.charCount": "{count} characters",
  "encrypt.overLimit.title": "The plaintext limit has been exceeded",
  "encrypt.overLimit.body": "Shorten the UTF-8 text to no more than {max} bytes.",
  "encrypt.encryptButton.busy": "Encrypting…",
  "encrypt.encryptButton.idle": "Encrypt",
  "encrypt.decrypt.cameraTitle": "Scan with the camera",
  "encrypt.decrypt.scanTrigger": "Scan a ciphertext QR code",
  "encrypt.decrypt.payloadLabel": "Ciphertext payload",
  "encrypt.decrypt.payloadPlaceholder": "Paste an OCM1: or OCM2: payload",
  "encrypt.decrypt.invalidTitle": "The ciphertext could not be identified",
  "encrypt.decrypt.invalidBody": "Enter a supported OCM1 or OCM2 ciphertext.",
  "encrypt.detail.method": "Method",
  "encrypt.detail.recipientKeyId": "Recipient key ID",
  "encrypt.pqUnsupported.body":
    "This ciphertext uses a legacy post-quantum profile that is no longer available.",
  "encrypt.decryptButton.busy": "Decrypting…",
  "encrypt.decryptButton.idle": "Decrypt",
  "encrypt.signingKeyId": " Key ID: {id}",
  "encrypt.importSigningKey": "Import a signing key",
  "encrypt.result.decryptedTitle": "Decryption result",
  "encrypt.result.unsigned": "Unsigned",
  "encrypt.result.aesUnsigned": "Symmetric-key message, unsigned",
  "encrypt.result.signatureValid": "The signature is valid for this key",
  "encrypt.result.senderSigningKeyId": "Sender signing key ID: {id}",
  "encrypt.result.identityCheck.label": "Identity verification:",
  "encrypt.result.identityCheck.confirmed": "Identity verified",
  "encrypt.result.identityCheck.unverified":
    "Unverified. Key validity and identity verification are separate.",
  "encrypt.result.memoryOnly":
    "The decrypted result is held only in memory and is not stored.",
  "encrypt.result.sectionAria": "Encryption result",
  "encrypt.result.encryptDone": "Encryption is complete",
  "encrypt.result.copyPayload": "Copy payload",
  "encrypt.result.qrTitle": "Ciphertext QR",
  "encrypt.result.pqTitle": "Ciphertext",
  "encrypt.result.outputNameLabel": "Output name",
  "encrypt.result.detailAria": "Encryption result details",
  "encrypt.result.detailTitle": "Result details",
  "encrypt.detail.suite": "Cryptographic suite",
  "encrypt.detail.senderSigningKeyId": "Sender signing key ID",
  "encrypt.detail.totalBytes": "Total data size",
  "encrypt.detail.frameCount": "QR frame count",
  "encrypt.detail.frameCountValue": "{count} frames",
  "encrypt.detail.encryptedAt": "Encrypted at",
  "encrypt.detail.signature": "Signature",
  "encrypt.detail.pqProfile": "Post-quantum profile",
  "encrypt.detail.notApplicable": "Not applicable",
  "encrypt.detail.wholeSha256": "Whole-message SHA-256",
  "encrypt.recordSelect.loading": "Loading…",
  "encrypt.recordSelect.placeholder": "Select an option",
  "encrypt.recordSelect.noKeys": "There are no available keys.",

  "scanner.targetLabel.message": "Ciphertext",
  "scanner.targetLabel.symmetricKey": "Symmetric key",
  "scanner.targetLabel.publicKey": "Public key",
  "scanner.payloadLabel.foreign": "Not from this app",
  "scanner.acceptedLabel.multipart": "multi-frame QR",
  "scanner.acceptedLabel.separator": ", ",
  "scanner.acceptedLabel.fallback": "a configured QR code",
  "scanner.mismatch":
    "This QR code is not accepted ({actual}). This screen can scan {accepted}.",
  "scanner.defaultTitle": "Scan a QR code",
  "scanner.stopHint.default":
    "Camera images are not stored. Scanning stops when you press Stop or leave the screen.",
  "scanner.stopHint.modal":
    "Camera images are not stored. Scanning stops when you close the dialog, press Stop, or leave the screen.",
  "scanner.stopHint.multipart":
    "Camera images are not stored. Scanning stops when you close the dialog, discard the scan state, or leave the screen.",
  "scanner.status.idlePrompt": "Press Start to start the camera",
  "scanner.status.deliverFailed": "The import could not be completed",
  "scanner.status.delivering": "Importing…",
  "scanner.status.allFramesRead": "All frames were read",
  "scanner.error.videoNotReady":
    "The camera view could not be prepared. Reopen the page.",
  "scanner.status.videoNotReady": "The camera view could not be prepared",
  "scanner.status.preparing": "Preparing the camera…",
  "scanner.status.qrRead": "The QR code was read",
  "scanner.error.multipartNotAccepted":
    "This screen does not accept multi-frame QR codes.",
  "scanner.status.multipartRejected": "The multi-frame QR code was rejected",
  "scanner.status.multipartReading": "Reading a multi-frame QR code",
  "scanner.status.multipartError":
    "The multi-frame QR scan state has an error",
  "scanner.error.expiredDiscarded":
    "The temporary scan state expired and was discarded.",
  "scanner.status.stateDiscarded": "The scan state was discarded",
  "scanner.status.multipartReadingUnordered":
    "Reading multi-frame QR codes in any order",
  "scanner.error.singleWhileMultipart":
    "A multi-frame QR scan is in progress. Scan a single QR code after completion or after discarding the scan state.",
  "scanner.status.singleRejectedDuringMultipart":
    "A single QR code was rejected during a multi-frame scan",
  "scanner.status.unacceptedRejected": "An unaccepted QR code was rejected",
  "scanner.status.cameraError": "A camera error occurred",
  "scanner.status.startFailed": "The camera could not be started",
  "scanner.status.alignInFrame": "Align the QR code inside the frame",
  "scanner.status.readUnordered": "QR codes can be read in any order",
  "scanner.error.stopped":
    "The camera was stopped. Press Restart to resume.",
  "scanner.status.stopped": "The camera was stopped",
  "scanner.status.discardedCanStart":
    "The scan state was discarded. Press Start to start the camera",
  "scanner.error.hiddenStopped":
    "The camera was stopped because the screen was hidden. Press Restart to resume.",
  "scanner.status.leftScreenStopped":
    "The camera was stopped after leaving the screen",
  "scanner.error.cameraUnavailable":
    "The camera is unavailable on this device. Paste the payload instead.",
  "scanner.status.cameraUnavailable": "The camera is unavailable",
  "scanner.error.stateDiscardedGeneric": "The scan state was discarded.",
  "scanner.video.ariaLabel": "Camera video for QR scanning",
  "scanner.button.restart": "Restart camera",
  "scanner.button.start": "Start camera",
  "scanner.progress.ariaLabel": "Multi-frame QR scan progress",
  "scanner.progress.received": "Received {received} / {total}",
  "scanner.progress.missingIndex": "Missing frames: {indexes}",
  "scanner.progress.expiresAt": "Scan expires: {time}",
  "scanner.integrityConfirmed":
    "SHA-256 integrity was confirmed for all frames.",
  "scanner.sha256Notice":
    "SHA-256 detects missing or mixed frames during transfer; it does not prove the sender's authenticity.",
  "scanner.error.title": "The scan could not be completed",
  "scanner.diagnostic.ariaLabel": "Camera diagnostic",
  "scanner.diagnostic": "Diagnostic: {name} @{phase} [{detail}]",
  "scanner.pipelineDiagnostic.ariaLabel": "QR decode pipeline diagnostic",
  "scanner.pipelineDiagnostic":
    "Pipeline: module={moduleState} frames={frames} attempts={attempts} results={results} last={lastError}",
  "scanner.pipelineDiagnostic.noError": "none",
  "scanner.button.discard": "Discard scan state",
  "scanner.button.stopCamera": "Stop camera",
  "scanner.closed.multipartProgress":
    "Multi-frame QR scan in progress: received {received} / {total}",
  "scanner.closed.integrityImported":
    "All multi-frame QR frames passed SHA-256 integrity checking and were imported.",

  "settings.error.saveFailed":
    "Settings could not be saved. Check the device storage.",
  "settings.toast.plaintextCleared": "All plaintext was cleared",
  "settings.toast.keysCleared": "All keys were deleted",
  "settings.error.deleteFailed":
    "Data could not be deleted. Check the device storage.",
  "settings.toast.maintenanceArmed":
    "Key retention has been armed for the next transition only",
  "settings.error.maintenanceFailed":
    "The maintenance token could not be set. Confirm that the device is offline.",
  "settings.title": "Settings",
  "settings.card.display": "Display",
  "settings.field.theme": "Theme",
  "settings.theme.system": "System",
  "settings.theme.light": "Light",
  "settings.theme.dark": "Dark",
  "settings.card.defaults": "Defaults",
  "settings.field.defaultAlgorithm": "Default cryptographic algorithm",
  "settings.field.defaultEc": "Default QR error-correction level",
  "settings.ec.hint":
    "Higher levels are easier to scan but hold less data. This setting applies only to the single-image AES message QR; the symmetric-key QR is fixed at H, and all frame-based QRs (ciphertext, public key, and identity) are fixed at Q.",
  "settings.card.pqMessage": "Post-quantum messages",
  "settings.requireSignature.label": "Require a signature",
  "settings.requireSignature.forced":
    "This cannot be disabled because it is required by the environment configuration.",
  "settings.requireSignature.hint":
    "When enabled, unsigned post-quantum options are hidden.",
  "settings.field.transferTimeout": "Scan-state lifetime: {min}–{max} minutes",
  "settings.frameEc.hint": "OCF2 frames always use Q error correction.",
  "settings.card.plaintext": "Plaintext handling",
  "settings.autoClearAfterEncrypt.label": "Clear plaintext after encryption",
  "settings.backgroundClear.label": "Clear after moving to the background",
  "settings.backgroundClear.desc":
    "When enabled, plaintext is cleared {normalSeconds} seconds after the app moves to the background. If the WebAssembly runtime required by the QR reader is unavailable, it is cleared after {fallbackSeconds} seconds instead.",
  "settings.clearAllPlaintext": "Clear all plaintext",
  "settings.card.onlineProtection": "Protection when online connectivity is detected",
  "settings.wipeOnOnline.label": "Reset local data after confirmed online connectivity",
  "settings.wipeOnOnline.hint":
    "On by default. Runs only after the dedicated sentinel body matches.",
  "settings.wipeOnOnline.offTitle": "Local data will remain",
  "settings.wipeOnOnline.offBody":
    "While permanently off, detecting connectivity will not automatically reset keys and local data.",
  "settings.maintenance.button": "Keep keys for the next update only",
  "settings.maintenance.hint":
    "This can be armed only while offline. It is not a recovery path for stored ciphertext and always expires after the next verified transition.",
  "settings.maintenance.onlineDisabled": "This cannot be set while online.",
  "settings.advanced.title": "Advanced: reset churn",
  "settings.advanced.field": "reset churn ({min}–{max} MB)",
  "settings.resetChurn.warning":
    "The default is 0. Churn does not guarantee erasure and does not guarantee that physical data cannot be recovered.",
  "settings.dataDeletion.title": "Delete data",
  "settings.deleteAllKeys": "Delete all keys",
  "settings.resetAllData": "Reset all local data",
  "settings.dataDeletion.note":
    "A full reset deletes every IndexedDB store, oc-* localStorage settings, and temporary in-memory data. Service Worker caches are retained to preserve offline startup.",
  "settings.card.pwaInfo": "PWA information",
  "settings.pwa.browserView": "Open in a browser",
  "settings.sw.unavailable":
    "This feature is unavailable: Service Worker. Offline startup is unavailable.",
  "settings.pwa.noUpdatePolicy":
    "The app does not update in place. To use a new version, fully format the device and reinstall the app.",
  "settings.info.version": "Version",
  "settings.info.build": "Build",
  "settings.pwa.offlineReadyNote":
    "Offline-use readiness describes whether assets are stored. It does not indicate security.",
  "settings.card.featureDetect": "Feature detection",
  "settings.featureDetect.note":
    "If Web Crypto or IndexedDB is unavailable, the UNSUPPORTED_BROWSER screen stops all features.",
  "settings.security.title": "About security",
  "settings.security.scope":
    "This app guarantees only that the application does not intentionally transmit plaintext or secret keys.",
  "settings.security.outOfScope.heading": "Out of scope:",
  "settings.security.outOfScope.1": "Compromise of the OS, browser, or firmware",
  "settings.security.outOfScope.2": "Keyloggers, screen recording, and screenshots",
  "settings.security.outOfScope.3": "Malware that captures camera frames",
  "settings.security.outOfScope.4":
    "Supply-chain compromise during the initial PWA download or reinstallation",
  "settings.security.outOfScope.5": "Physical theft of the device",
  "settings.security.outOfScope.6": "Accidental sharing of a secret QR code",
  "settings.security.outOfScope.7": "Key loss caused by clearing browser data",
  "settings.security.offlineDisplayNote":
    "The offline indicator is supporting information about the current network state, not proof of security.",
  "settings.security.caveat.1":
    "The integration of noble used by this app has not completed an independent audit.",
  "settings.security.caveat.2":
    "The JavaScript implementation does not guarantee resistance to side channels.",
  "settings.security.caveat.3":
    "JavaScript and garbage collection mean secret values in memory cannot be guaranteed to be completely erased.",
  "settings.security.caveat.4":
    "Reset attempts logical deletion of local data. Physical erasure is not guaranteed, including for LevelDB and SSD wear leveling.",
  "settings.security.wipeOnOnlineNote":
    "Wipe-on-online reduces remaining data only if the current code can run after connectivity is established. It does not prevent malicious same-origin code, physical recovery, or compromised code that runs before the update.",
  "settings.maintenance.dialogDesc":
    'Suppresses wipe once, at the next confirmed online transition. Enter "KEEP KEYS" and review the warning to continue.',
  "settings.confirmationLabel": "Confirmation text",
  "settings.maintenance.ackLabel":
    "I understand this applies once and does not guarantee the safety of the updated code or device",
  "settings.maintenance.armButton": "Arm maintenance token",
  "settings.delete.desc.keys":
    'All ciphertext will become undecryptable. Enter "DELETE ALL" to continue.',
  "settings.delete.desc.reset":
    'Deletes IndexedDB, oc-* settings, and temporary data. Service Worker caches are retained. Enter "DELETE ALL" to continue.',
  "settings.delete.working": "Deleting…",
  "settings.delete.execute": "Run logical deletion",
  "hooks.preferences.loadFailed":
    "Settings could not be loaded. Default values will be used.",
  "hooks.keys.loadFailed":
    "Keys could not be loaded. Check local storage.",
  "hooks.pqRecords.loadFailed":
    "Post-quantum identities and public keys could not be loaded.",
} as const

export type MessageKey = keyof typeof en
export type MessageCatalog = Readonly<Record<MessageKey, string>>
const MESSAGE_KEY_SET: ReadonlySet<string> = new Set(Object.keys(en))

const ja = {
  "language.field": "言語",
  "language.en": "English",
  "language.ja": "日本語",

  "common.operationFailed": "操作を完了できません",
  "common.cancel": "キャンセル",
  "common.close": "閉じる",
  "common.supported.yes": "利用できます",
  "common.supported.no": "利用できません",
  "common.featureUnavailable": "この機能は利用できません: {feature}",
  "common.unused": "未使用",
  "common.none": "なし",
  "common.copyFailed":
    "コピーできませんでした。ブラウザーの権限を確認してください。",
  "common.riskUnderstood": "リスクを理解しました",
  "common.copy": "コピー",
  "common.download": "ダウンロード",
  "common.delete": "削除",
  "common.deleteAriaLabel": "{name}を削除",
  "common.created": "作成: {datetime}",
  "common.identityFingerprint": "公開鍵セット指紋",
  "common.fingerprintCompare": "比較表示: {value}",
  "common.loading": "読込中",
  "common.openKeysPage": "鍵ページを開く",
  "common.processing": "処理中",
  "common.pastePayload": "ペイロードを貼り付ける",
  "common.na": "なし",
  "common.yes": "あり",

  "validation.name.required": "名前を入力してください",
  "validation.name.maxLength": "名前は80文字以内にしてください",
  "validation.name.invalidChars": "使用できない文字が含まれています",

  "presentation.framePosition": "{position}枚目",
  "presentation.frameSeparator": "、",

  "feature.camera": "カメラ",
  "network.online": "オンライン",
  "network.offline": "オフライン",
  "network.srLabel": "通信状態",

  "nav.encrypt": "暗号・復号",
  "nav.keys": "鍵追加",
  "nav.keyList": "鍵一覧",
  "nav.settings": "設定",
  "nav.ariaLabel": "メインナビゲーション",
  "nav.top": "トップ",
  "nav.relay": "リレー",
  "nav.onlineAriaLabel": "オンラインナビゲーション",

  "errors.UNSUPPORTED_BROWSER":
    "このブラウザーでは必要な機能を利用できません。対応ブラウザーで開いてください。",
  "errors.INVALID_QR_PREFIX": "このQRコードは本アプリの形式ではありません。",
  "errors.INVALID_QR_PAYLOAD":
    "QRコードの内容を読み取れませんでした。形式が不正か、破損しています。",
  "errors.UNSUPPORTED_PROTOCOL_VERSION":
    "新しいバージョンのアプリで作成されたQRコードです。アプリを更新してください。",
  "errors.UNSUPPORTED_ALGORITHM": "対応していない暗号方式です。",
  "errors.KEY_NOT_FOUND": "対応する鍵が見つかりません。",
  "errors.KEY_TYPE_MISMATCH": "選択した鍵はこの操作に使用できません。",
  "errors.ENCRYPTION_FAILED": "暗号化に失敗しました。入力内容を確認してください。",
  "errors.DECRYPTION_FAILED":
    "復号できませんでした。鍵、暗号方式、または暗号文が一致していません。",
  "errors.QR_TOO_LARGE":
    "データ量が多いため、この誤り訂正レベルではQRコードを生成できません。",
  "errors.STORAGE_FAILED": "保存領域の操作に失敗しました。",
  "errors.CAMERA_PERMISSION_DENIED":
    "カメラの使用が許可されていません。ブラウザーの設定で許可してください。",
  "errors.CAMERA_NOT_AVAILABLE": "カメラを利用できません。",
  "errors.QR_READER_PREPARATION_TIMEOUT":
    "この端末でQRリーダーの準備が完了しませんでした。",
  "errors.QR_DECODE_PROGRESS_TIMEOUT":
    "この端末でQR復号パイプラインの進行が停止しました。",
  "errors.QR_READER_BLOCKED":
    "このブラウザーではQRコードリーダーがブロックされています。iPhoneではSafari 16以降を使用してください。",
  "errors.DUPLICATE_KEY": "同じ内容の鍵がすでに保存されています。",
  "errors.DUPLICATE_QR": "同じ内容のQRコードがすでに保存されています。",
  "errors.SIGNATURE_INVALID":
    "署名を検証できませんでした。送信者の署名鍵、または内容が一致していません。",
  "errors.SIGNING_KEY_NOT_FOUND":
    "この署名に対応する送信者の署名鍵が見つかりません。先に署名検証用の公開鍵を取り込んでください。",
  "errors.FRAME_MISMATCH":
    "異なる転送のQRコードが混在しています。読み取り状態を破棄してやり直してください。",
  "errors.WORKER_UNAVAILABLE":
    "この端末では暗号処理を安全に実行できませんでした。対応ブラウザーで開き直してください。",
  "errors.RESET_FAILED":
    "ローカルデータの初期化中に一部の操作が完了しませんでした。",

  "browser.unsupported.title": "このブラウザーでは利用できません",
  "browser.unsupported.body":
    "暗号化と端末内保存に必要な機能が不足しています。Web CryptoとIndexedDBに対応した最新のブラウザーで開いてください。",
  "browser.featureList.ariaLabel": "ブラウザー機能一覧",

  "boot.probing.status": "ネットワーク到達性とローカルデータを確認しています…",
  "boot.wiping.title": "ローカルデータを初期化しています",
  "boot.wiping.body": "完了するまでこの画面を閉じないでください。",
  "boot.wiped.title": "オンラインを検出したため、ローカルデータを初期化しました",
  "boot.wiped.body": "論理削除を試行しました。物理消去は保証されません。",
  "boot.partialFailure.retryHint":
    "このタブを閉じてください。再び利用するには、端末を完全フォーマットしてからアプリを導入し直してください。",

  "gate.install.error":
    "インストールを開始できませんでした。ブラウザーのメニューから操作してください。",
  "gate.appIcon.alt": "{appName}のアプリアイコン",
  "gate.mode.label": "オンライン導入・OCF2メッセージヘッダーリレーモード",
  "gate.heading": "PWAの導入またはOCF2メッセージヘッダーQRフレームの中継",
  "gate.description":
    "暗号・復号、鍵作成、鍵一覧、設定は引き続きオフライン専用です。機微ストア走査がエラーなく完了し、鍵行・PQ identity・Vaultが無い場合に限り、クリーンオリジンは外側の信頼できないヘッダーがpq-messageと表明する正規OCF2フレームを、鍵を使わず中継できます。",
  "pwa.installState.label": "PWAインストール状態",
  "pwa.installState.installed": "インストール済み",
  "pwa.installState.notInstalled": "未インストール",
  "pwa.offlineReady.label": "オフライン利用準備状態",
  "pwa.offlineReady.ready": "準備完了",
  "pwa.offlineReady.preparing": "準備中",
  "pwa.registerError": "Service Workerを登録できませんでした。",
  "pwa.offlineReady.toast": "オフライン利用の準備ができました",
  "gate.install.progress": "インストール中…",
  "gate.install.button": "PWAをインストール",
  "gate.install.iosHint":
    "Safariの共有メニューから「ホーム画面に追加」を選んでください。",
  "gate.install.otherHint":
    "ブラウザーのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。",
  "gate.switchOffline.title": "オフラインに切り替えてください",
  "gate.switchOffline.body":
    "機内モードなどでオフラインに切り替えるとオフライン機能を利用できます。切替時にリスク確認が表示されます。侵害された端末では機内モードやオフライン表示そのものを信頼できないため、オフライン化は端末の安全性を保証しません。",
  "gate.about.link": "このアプリが何をするか",

  "relay.card.title": "OCF2メッセージヘッダーQRリレー",
  "relay.card.description":
    "メッセンジャーとオフライン端末の間で、正規OCF2フレーム文字列を中継します。フレーム由来の値をアプリ管理の保存領域やフレームを含むネットワーク要求へ意図的に書き込みません。",
  "relay.boundary.title": "信頼しない中継境界",
  "relay.boundary.body":
    "外側の信頼できないヘッダーがpq-messageと表明するフレームを受け入れます。成果物の組立、全体ハッシュ、内側の種類、AEAD、署名、送信者、安全性は検証しません。受信側のオフライン端末が最終判断者です。鍵交換は対面で行う運用を前提とします。",
  "relay.capture.open": "QR → テキスト",
  "relay.capture.unavailable":
    "この端末ではカメラを利用できません。テキストからQRへの再生は利用できます。",
  "relay.capture.title": "QRフレームをテキスト化",
  "relay.capture.description":
    "明示的にカメラを開始し、オフライン端末の全フレームを読み取ってください。不正または不一致のフレームは、受理済みフレームを置き換えず拒否します。",
  "relay.capture.video.ariaLabel": "OCF2メッセージヘッダーリレーのカメラプレビュー",
  "relay.capture.startCamera": "カメラを開始",
  "relay.capture.cameraActive": "カメラ動作中",
  "relay.capture.progress": "{collected} / {total} フレーム収集済み",
  "relay.capture.missing": "不足フレーム: {indexes}",
  "relay.capture.output.label": "中継テキスト",
  "relay.capture.copy": "中継テキストをコピー",
  "relay.copy.warning":
    "コピーすると中継テキストをシステムのクリップボードへ書き出します。内容はアプリ外に残存・同期する可能性があり、アプリのresetでは消去されません。",
  "relay.playback.open": "テキスト → QR",
  "relay.playback.title": "中継テキストをQRフレーム化",
  "relay.playback.description":
    "正規フレーム一式をすべて貼り付けてください。改行はLF・CRLFのどちらでもよく、順序は問いません。",
  "relay.playback.input.label": "中継テキスト",
  "relay.playback.show": "QRフレームを表示",
  "relay.playback.missing": "不足フレーム: {indexes}",
  "relay.playback.screenCaptureWarning":
    "表示したQR画像は長押し保存、印刷、スクリーンショット、画面録画で保存される可能性があります。",
  "relay.playback.qrTitle": "中継されたOCF2フレーム",
  "relay.playback.noDownloadControls":
    "このリレーはアプリによるファイルダウンロード操作を提供しません。",
  "relay.error.title": "中継入力を拒否しました",
  "relay.error.empty": "1つ以上のフレームを入力またはスキャンしてください。",
  "relay.error.prefix": "正規OCF2フレーム文字列だけを受け入れます。",
  "relay.error.outerType": "フレームの外側ヘッダーがpq-messageを表明していません。",
  "relay.error.invalidFrame": "正規OCF2フレームではありません。",
  "relay.error.mismatch": "受理済みのフレーム一式に属さないフレームです。",
  "relay.error.length": "表明された長さと収集した長さが一致しません。",
  "relay.error.incomplete":
    "フレーム一式が不完全です。再生前に不足フレームをすべて追加してください。",
  "relay.error.inputSize": "中継テキストがプロトコル上限を超えています。",
  "relay.error.timeout":
    "中継セッションが時間切れになり、アプリが保持していたフレーム参照を解放しました。",
  "relay.error.copy": "中継テキストをコピーできませんでした。",

  "offlineAck.status": "オフラインへ切り替わりました",
  "offlineAck.title": "続行前の確認",
  "offlineAck.body.assumption":
    "このアプリは「ネットワークに接続した端末は常に侵害されうる」という前提で設計されています。オンライン状態から機内モードやネットワーク切断を選んでも、それによって端末が信頼できる状態に戻るわけではありません。オンライン中に侵害されたコード・鍵・データは、オフライン化後もそのまま残り得ます。",
  "offlineAck.body.riskPrefix":
    "リスクを抑えるには、ネットワークから物理的に遮断し、",
  "offlineAck.body.neverReconnect": "二度と接続しない",
  "offlineAck.body.riskSuffix":
    "専用端末として運用する必要があります。それ以外に、完全に安全にメッセージの暗号化を行う方法はありません。",
  "offlineAck.body.noGuarantee":
    "それでも、端末や導入済みコードを含めた完全な安全を本アプリが保証するものではありません。",
  "offlineAck.ackLabel":
    "上記を理解した上で、リスクを受け入れてこの端末で続行します",
  "offlineAck.ackHint":
    "このチェックは端末の安全性を検証・回復するものではありません",
  "offlineAck.continue": "リスクを理解してオフライン機能を表示",
  "offlineAck.reload": "再読み込みして続行",

  "algorithm.A256GCM": "共通鍵 AES-256-GCM",
  "algorithm.MLKEM1024_A256GCM":
    "ポスト量子 ML-KEM-1024 + AES-256-GCM",
  "algorithm.MLKEM1024_MLDSA87_A256GCM":
    "署名付きポスト量子 ML-KEM-1024 + ML-DSA-87 + AES-256-GCM",

  "qrDisplay.defaultTitle": "QRコード",
  "qrDisplay.notQrCryptPayload":
    "本アプリのペイロードではないためQRコードを生成できません。",
  "qrDisplay.error.title": "QRコードを生成できません",
  "qrDisplay.image.alt": "{title}の画像",
  "qrDisplay.generating": "QRコードを生成しています…",
  "qrDisplay.dataSize": "データサイズ: {bytes} bytes / EC={ecLevel}",
  "qrDisplay.fullscreen.button": "全画面表示",
  "qrDisplay.fullscreen.title": "{title}を全画面表示",
  "qrDisplay.fullscreen.desc": "白い背景にQRコードを全画面で表示します。",
  "qrDisplay.fullscreen.imageAlt": "{title}の全画面画像",
  "qrDisplay.fullscreen.brightnessHint":
    "画面の輝度を上げると読み取りやすくなります",

  "animatedQr.defaultTitle": "複数QR",
  "animatedQr.empty.title": "表示できるフレームがありません",
  "animatedQr.empty.body": "複数QRを作り直してください。",
  "animatedQr.section.ariaLabel": "{title}フレーム表示",
  "animatedQr.missing.title": "フレームが欠損しています",
  "animatedQr.missing.body":
    "欠損フレーム: {indexes}。欠損したままでは復元できません。",
  "animatedQr.frameTitle": "{title} {current} / {total}",
  "animatedQr.prev": "前へ",
  "animatedQr.play": "再生",
  "animatedQr.pause": "一時停止",
  "animatedQr.next": "次へ",
  "animatedQr.compatibility.label": "互換モード",
  "animatedQr.densityRaised":
    "フレーム数の上限内に収めるため、フレーム密度をこれ以上下げられませんでした。",
  "animatedQr.brightnessHint":
    "画面の輝度を上げ、端末を動かさずに読み取ると安定します。",
  "animatedQr.export.error.title": "フレームを出力できません",

  "keyDetail.rename.label": "鍵の名前",
  "keyDetail.rename.submit": "改名",
  "keyDetail.rename.saved": "鍵を改名しました",
  "keyDetail.qr.bundleTitle": "{name} 公開鍵セット",
  "keyDetail.qr.kemTitle": "{name} 暗号化用公開鍵",
  "keyDetail.qr.signingTitle": "{name} 署名検証用公開鍵",
  "keyDetail.qr.outputName": "{title}-{date}",
  "keyDetail.toast.rotated": "IDをローテーションしました",
  "keyDetail.toast.revoked": "この端末でIDを失効しました",
  "keyDetail.toast.symmetricDeleted": "共通鍵を削除しました",
  "keyDetail.toast.identityDeleted": "ポスト量子IDを削除しました",
  "keyDetail.toast.supersededDestroyed": "旧世代の鍵素材を破棄しました",
  "keyDetail.toast.copied":
    "コピーしました。クリップボード同期に注意してください。",
  "keyDetail.symmetricQr.title": "共通鍵QR",
  "keyDetail.identityQr.desc":
    "すべてOCF2フレーム・誤り訂正Qで表示します。",
  "keyDetail.symmetricQr.desc":
    "このQRには暗号化と復号に使える秘密鍵が含まれます。",
  "keyDetail.backToDetail": "詳細に戻る",
  "keyDetail.symmetricQr.secretTitle": "機密情報",
  "keyDetail.symmetricQr.secretBody":
    "第三者に見せると、過去と将来の暗号文を復号されるおそれがあります。",
  "keyDetail.delete.titleNamed": "「{name}」を削除しますか?",
  "keyDetail.delete.titleGeneric": "鍵を削除しますか?",
  "keyDetail.delete.body.identity":
    "このID宛の暗号文は復号できなくなります。失効と異なり元に戻せません。",
  "keyDetail.delete.body.symmetric":
    "この鍵で暗号化した暗号文は復号できなくなります。元に戻せません。",
  "keyDetail.delete.confirm": "削除する",
  "keyDetail.destroy.title": "旧世代 {count} 件を破棄しますか?",
  "keyDetail.destroy.body":
    "作成日時: {dates}。このアプリがこれらの世代のために開いたままにしている復号経路を閉じます。これらの鍵宛に送られ、まだ復号していないメッセージは、ここでは開けなくなります。論理削除のため記録媒体からバイト列が消える保証はなく、既に別タブへ読み込まれた複製はこの操作の対象外です。",
  "keyDetail.destroy.confirm": "破棄する",
  "keyDetail.badge.legacyProfile": "非対応（旧プロファイル）",
  "keyDetail.identity.legacyNote":
    "非対応（旧プロファイル）: 暗号処理とQR再出力はできません。",
  "keyDetail.identity.oldNote": "旧世代: 復号/検証専用",
  "keyDetail.identity.activeNote": "暗号化・署名に使用可能",
  "keyDetail.identity.kemFingerprintLabel": "暗号化用公開鍵 {algorithm}",
  "keyDetail.identity.signingFingerprintLabel": "署名検証用公開鍵 {algorithm}",
  "keyDetail.button.bundleQr": "公開鍵セットQR",
  "keyDetail.button.kemQr": "暗号化用単鍵QR",
  "keyDetail.button.signingQr": "署名検証用単鍵QR",
  "keyDetail.button.rotate": "ローテーション",
  "keyDetail.button.revoke": "この端末で失効",
  "keyDetail.revokeNote":
    "失効はこの識別子での署名と、現在の宛先としての公開をこの端末で止めるもので、外部の相手には伝播しません。この識別子での復号は止まりません。鍵素材を手放すには削除を使ってください。",
  "keyDetail.previous.toggle": "旧世代 {count} 件、復号専用",
  "keyDetail.previous.destroyAll": "旧世代 {count} 件の鍵素材を破棄",
  "keyDetail.symmetric.fingerprintLabel": "鍵指紋",
  "keyDetail.button.showSecretQr": "秘密鍵QRを表示",

  "keyStatus.active": "有効",
  "keyStatus.rotated": "更新済み",
  "keyStatus.revoked": "失効",

  "keyList.title": "鍵一覧",
  "keyList.subtitle": "メッセージ暗号文はアプリ内へ保存しません。",
  "keyList.error.identity": "ポスト量子IDを読み込めません",
  "keyList.error.symmetric": "共通鍵を読み込めません",
  "keyList.error.peer": "相手の鍵を更新できません",
  "keyList.tab.own": "自分の鍵",
  "keyList.tab.peer": "相手の鍵",
  "keyList.filter.label": "種別",
  "keyList.filter.all": "すべて",
  "keyList.filter.pqIdentity": "ポスト量子ID",
  "keyList.filter.symmetric": "共通鍵",
  "keyList.item.identityMeta": "ポスト量子ID · {datetime}",
  "keyList.item.supersededWarning": "旧世代 {count} 件が復号可能",
  "keyList.item.symmetricMeta": "共通鍵 · {datetime}",
  "keyList.empty.ownAll": "自分の鍵がありません。",
  "keyList.empty.ownFiltered": "選択した種別の鍵がありません。",
  "keyList.empty.noKeys": "鍵がありません。鍵ページから作成できます。",
  "keyList.bundle.empty": "取り込んだ公開鍵セットがありません。",
  "keyList.bundle.nameConfirmed": "確認済み公開鍵",
  "keyList.bundle.nameUnverified": "未確認の公開鍵",
  "keyList.bundle.badge.confirmed": "人物確認済み",
  "keyList.bundle.badge.unverified": "未確認",
  "keyList.bundle.fingerprintKem": "受信公開鍵 {algorithm}",
  "keyList.bundle.fingerprintSigning": "署名公開鍵 {algorithm}",
  "keyList.bundle.legacyNote":
    "非対応（旧プロファイル）のため、削除以外の操作はできません。",
  "keyList.bundle.revoke": "利用停止",
  "keyList.bundle.confirmOpen": "指紋を比較して確認する",
  "keyList.bundle.confirmTitle": "この識別子の指紋を確認しますか?",
  "keyList.bundle.confirmBody":
    "以下の各グループを、相手本人の端末に表示された値と、通話や対面など別の経路で突き合わせてください。確認するとその事実が記録され、この識別子が暗号化の宛先として選べるようになります。比較そのものをアプリが検証することはできません。",
  "keyList.bundle.confirmCheck":
    "別の経路で指紋を比較し、一致することを確認しました",
  "keyList.bundle.confirmSubmit": "確認する",
  "keyList.toast.bundleConfirmed": "指紋を確認しました",

  "keys.validation.keyNameFallback": "鍵名を確認してください。",
  "keys.validation.idNameFallback": "ID名を確認してください。",
  "keys.toast.symmetricCreated": "共通鍵を作成しました",
  "keys.toast.identityCreated": "ポスト量子IDを作成しました",
  "keys.toast.legacyRemoved": "旧形式のRSA鍵を削除しました",
  "keys.toast.symmetricImported": "共通鍵を取り込みました",
  "keys.toast.bundleConfirmed": "指紋確認済みで保存しました",
  "keys.toast.bundleUnverified": "未確認のまま保存しました",
  "keys.import.symmetricDefaultName": "取込共通鍵-{date}",
  "keys.title": "鍵追加",
  "keys.legacy.title":
    "旧形式のRSA鍵 {count} 件は v2 で使用不可、復元できません",
  "keys.legacy.body":
    "旧暗号文は復号できません。鍵は通常の一覧や選択肢には表示しません。",
  "keys.legacy.deleteButton": "旧形式の鍵を削除",
  "keys.tab.create": "作成",
  "keys.tab.import": "読込",
  "keys.import.cameraTitle": "カメラで読み取る",
  "keys.import.scanTrigger": "鍵QRを読み取る",
  "keys.import.payloadLabel": "鍵ペイロード",
  "keys.import.payloadPlaceholder": "OCK1: / OCP2: / OCS2: / OCI2: を貼り付け",
  "keys.import.readButton": "鍵を読み取る",
  "keys.singleKey.title": "単鍵を読み取りました",
  "keys.singleKey.kemLabel": "暗号化用公開鍵",
  "keys.singleKey.signingLabel": "署名検証用公開鍵",
  "keys.singleKey.fingerprintLabel": "単鍵指紋",
  "keys.singleKey.persistHint":
    "人物との対応を確認して永続利用するには、OCI2公開鍵セットを取り込んでください。",
  "keys.bundle.dialogTitle": "別経路で指紋を比較してください",
  "keys.bundle.dialogDesc":
    "取込を完了する前に、相手と通話・対面など別経路で full hex を照合します。自己署名だけでは人物を証明しません。未確認のまま保存した識別子は暗号化の宛先に選べませんが、保存済み鍵の画面から後で指紋を確認できます。",
  "keys.bundle.fingerprintKem": "ML-KEM鍵指紋",
  "keys.bundle.fingerprintSigning": "ML-DSA鍵指紋",
  "keys.bundle.confirmLabel": "別経路で一致を確認した",
  "keys.bundle.saveUnverified": "未確認のまま保存",
  "keys.bundle.saveConfirmed": "確認して保存",
  "keys.symmetricImport.dialogTitle": "共通鍵を取り込みます",
  "keys.symmetricImport.dialogDesc":
    "このペイロードには暗号化と復号に使える秘密鍵が含まれます。",
  "keys.symmetricImport.warnTitle": "共有経路を確認してください",
  "keys.symmetricImport.warnBody":
    "第三者が同じ鍵を持つと、暗号文を復号されるおそれがあります。",
  "keys.symmetricImport.nameLabel": "鍵名",
  "keys.symmetricImport.ackLabel": "この鍵の共有経路を信頼しています",
  "keys.symmetricImport.saveButton": "共通鍵を保存",
  "keys.demo.hint":
    "相手の画面の輝度を上げてもらい、カメラを15〜20cmほど離してピントが合うまで静止すると読み取りやすくなります。",
  "keys.create.nameLabel.pq": "ポスト量子ID名",
  "keys.create.nameLabel.symmetric": "共通鍵名",
  "keys.create.button.pq": "ポスト量子IDを作成",
  "keys.create.button.symmetric": "共通鍵を作成",
  "keys.create.kindLabel": "種類",
  "keys.create.kind.pqIdentity":
    "ポスト量子ID ML-KEM-1024 + ML-DSA-87",
  "keys.create.experimentalNote": "experimental・未独立監査",

  "encrypt.toast.autoCleared": "平文と一時結果を自動消去しました",
  "encrypt.output.suggestedName": "暗号結果-{date}",
  "encrypt.toast.plaintextClearedByPref":
    "設定に従って平文を消去しました",
  "encrypt.toast.payloadCopied": "ペイロードをコピーしました",
  "encrypt.validation.outputNameFallback": "出力名を確認してください。",
  "encrypt.srHeading": "暗号化と復号",
  "encrypt.tab.encrypt": "暗号化",
  "encrypt.tab.decrypt": "復号",
  "encrypt.algorithmLabel": "暗号化方式",
  "encrypt.keyLabel": "使用鍵",
  "encrypt.recipientLabel": "受信者のML-KEM公開鍵",
  "encrypt.recipient.confirmed": "確認済み",
  "encrypt.recipient.unverified": "未確認",
  "encrypt.recipient.needsConfirmation":
    "確認済みの宛先がありません。公開識別子は、相手と別の経路で指紋を比較し、保存済み鍵の画面で確認したものだけがここで選べるようになります。",
  "encrypt.senderLabel": "自分のML-DSA署名ID",
  "encrypt.plaintextLabel": "平文",
  "encrypt.clearPlaintext": "平文を消去",
  "encrypt.plaintextPlaceholder": "暗号化する文章を入力してください",
  "encrypt.charCount": "{count} 文字",
  "encrypt.overLimit.title": "平文の上限を超えています",
  "encrypt.overLimit.body":
    "UTF-8で{max}バイト以内に短くしてください。",
  "encrypt.encryptButton.busy": "暗号化中…",
  "encrypt.encryptButton.idle": "暗号化する",
  "encrypt.decrypt.cameraTitle": "カメラで読み取る",
  "encrypt.decrypt.scanTrigger": "暗号文QRを読み取る",
  "encrypt.decrypt.payloadLabel": "暗号文ペイロード",
  "encrypt.decrypt.payloadPlaceholder":
    "OCM1: または OCM2: ペイロードを貼り付けてください",
  "encrypt.decrypt.invalidTitle": "暗号文を確認できません",
  "encrypt.decrypt.invalidBody":
    "対応するOCM1/OCM2暗号文を入力してください。",
  "encrypt.detail.method": "方式",
  "encrypt.detail.recipientKeyId": "受信者鍵ID",
  "encrypt.pqUnsupported.body":
    "この暗号文は現在利用できない旧ポスト量子プロファイルです。",
  "encrypt.decryptButton.busy": "復号中…",
  "encrypt.decryptButton.idle": "復号する",
  "encrypt.signingKeyId": " 鍵ID: {id}",
  "encrypt.importSigningKey": "署名鍵を取り込む",
  "encrypt.result.decryptedTitle": "復号結果",
  "encrypt.result.unsigned": "署名なし",
  "encrypt.result.aesUnsigned": "共通鍵メッセージ、署名なし",
  "encrypt.result.signatureValid": "署名はこの鍵に対して有効です",
  "encrypt.result.senderSigningKeyId": "送信者署名鍵ID: {id}",
  "encrypt.result.identityCheck.label": "人物確認:",
  "encrypt.result.identityCheck.confirmed": "人物確認済み",
  "encrypt.result.identityCheck.unverified":
    "未確認。鍵の有効性と人物確認は別です。",
  "encrypt.result.memoryOnly":
    "復号結果はメモリー内だけに保持し、保存しません。",
  "encrypt.result.sectionAria": "暗号結果",
  "encrypt.result.encryptDone": "暗号化が完了しました",
  "encrypt.result.copyPayload": "ペイロードをコピー",
  "encrypt.result.qrTitle": "暗号文QR",
  "encrypt.result.pqTitle": "暗号文",
  "encrypt.result.outputNameLabel": "出力名",
  "encrypt.result.detailAria": "暗号結果詳細",
  "encrypt.result.detailTitle": "結果詳細",
  "encrypt.detail.suite": "使用暗号スイート",
  "encrypt.detail.senderSigningKeyId": "送信者署名鍵ID",
  "encrypt.detail.totalBytes": "総データ量",
  "encrypt.detail.frameCount": "QRフレーム数",
  "encrypt.detail.frameCountValue": "{count} 枚",
  "encrypt.detail.encryptedAt": "暗号化日時",
  "encrypt.detail.signature": "署名",
  "encrypt.detail.pqProfile": "ポスト量子プロファイル",
  "encrypt.detail.notApplicable": "対象外",
  "encrypt.detail.wholeSha256": "全体SHA-256",
  "encrypt.recordSelect.loading": "読み込み中…",
  "encrypt.recordSelect.placeholder": "選択してください",
  "encrypt.recordSelect.noKeys": "使用できる鍵がありません。",

  "scanner.targetLabel.message": "暗号文",
  "scanner.targetLabel.symmetricKey": "共通鍵",
  "scanner.targetLabel.publicKey": "公開鍵",
  "scanner.payloadLabel.foreign": "本アプリ以外",
  "scanner.acceptedLabel.multipart": "複数QR",
  "scanner.acceptedLabel.separator": "・",
  "scanner.acceptedLabel.fallback": "設定されたQR",
  "scanner.mismatch":
    "受理対象外のQRです({actual})。この画面では{accepted}を読み取れます。",
  "scanner.defaultTitle": "QRコードを読み取る",
  "scanner.stopHint.default":
    "カメラ画像は保存されません。停止ボタンまたは画面離脱で停止します。",
  "scanner.stopHint.modal":
    "カメラ画像は保存されません。閉じる・停止ボタン・画面離脱で停止します。",
  "scanner.stopHint.multipart":
    "カメラ画像は保存されません。閉じる・破棄ボタン・画面離脱で停止します。",
  "scanner.status.idlePrompt": "起動ボタンを押すとカメラを開始します",
  "scanner.status.deliverFailed": "取り込みを完了できませんでした",
  "scanner.status.delivering": "取り込み中です…",
  "scanner.status.allFramesRead": "全フレームを読み取りました",
  "scanner.error.videoNotReady":
    "カメラ画面を準備できませんでした。ページを開き直してください。",
  "scanner.status.videoNotReady": "カメラ画面を準備できませんでした",
  "scanner.status.preparing": "カメラを準備しています…",
  "scanner.status.qrRead": "QRコードを読み取りました",
  "scanner.error.multipartNotAccepted":
    "この画面では複数QRを受理しません。",
  "scanner.status.multipartRejected": "複数QRを拒否しました",
  "scanner.status.multipartReading": "複数QRを読み取り中です",
  "scanner.status.multipartError":
    "複数QRの読取状態にエラーがあります",
  "scanner.error.expiredDiscarded":
    "読取期限を過ぎたため、一時読取状態を破棄しました。",
  "scanner.status.stateDiscarded": "読取状態を破棄しました",
  "scanner.status.multipartReadingUnordered":
    "複数QRを順不同で読み取り中です",
  "scanner.error.singleWhileMultipart":
    "複数QR読取中です。単発QRは読取完了または破棄後に読み取ってください。",
  "scanner.status.singleRejectedDuringMultipart":
    "複数QR読取中の単発QRを拒否しました",
  "scanner.status.unacceptedRejected": "受理対象外のQRを拒否しました",
  "scanner.status.cameraError": "カメラでエラーが発生しました",
  "scanner.status.startFailed": "カメラを起動できませんでした",
  "scanner.status.alignInFrame": "QRコードを枠内に合わせてください",
  "scanner.status.readUnordered": "QRコードを順不同で読み取れます",
  "scanner.error.stopped":
    "カメラを停止しました。再起動ボタンで再開できます。",
  "scanner.status.stopped": "カメラを停止しました",
  "scanner.status.discardedCanStart":
    "読取状態を破棄しました。起動ボタンでカメラを開始できます",
  "scanner.error.hiddenStopped":
    "画面が非表示になったためカメラを停止しました。再起動ボタンで再開できます。",
  "scanner.status.leftScreenStopped":
    "画面離脱によりカメラを停止しました",
  "scanner.error.cameraUnavailable":
    "この端末ではカメラを利用できません。ペイロードを貼り付けてください。",
  "scanner.status.cameraUnavailable": "カメラを利用できません",
  "scanner.error.stateDiscardedGeneric": "読取状態が破棄されました。",
  "scanner.video.ariaLabel": "QRコード読取用カメラ映像",
  "scanner.button.restart": "カメラを再起動",
  "scanner.button.start": "カメラを起動",
  "scanner.progress.ariaLabel": "複数QR読取進捗",
  "scanner.progress.received": "受信 {received} / {total}",
  "scanner.progress.missingIndex": "欠損フレーム: {indexes}",
  "scanner.progress.expiresAt": "読取期限: {time}",
  "scanner.integrityConfirmed":
    "全フレームのSHA-256整合性を確認しました。",
  "scanner.sha256Notice":
    "SHA-256は転送中の欠損・混在検出用であり、送信者の真正性を証明しません。",
  "scanner.error.title": "読み取りを完了できません",
  "scanner.diagnostic.ariaLabel": "カメラ診断",
  "scanner.diagnostic": "診断: {name} @{phase} [{detail}]",
  "scanner.pipelineDiagnostic.ariaLabel": "QR復号パイプライン診断",
  "scanner.pipelineDiagnostic":
    "パイプライン: module={moduleState} frames={frames} attempts={attempts} results={results} last={lastError}",
  "scanner.pipelineDiagnostic.noError": "なし",
  "scanner.button.discard": "読取状態を破棄",
  "scanner.button.stopCamera": "カメラを停止",
  "scanner.closed.multipartProgress":
    "複数QR読取中: 受信 {received} / {total}",
  "scanner.closed.integrityImported":
    "複数QRの全フレームSHA-256整合性を確認し、取り込みました。",

  "settings.error.saveFailed":
    "設定を保存できませんでした。保存領域を確認してください。",
  "settings.toast.plaintextCleared": "すべての平文を消去しました",
  "settings.toast.keysCleared": "すべての鍵を消去しました",
  "settings.error.deleteFailed":
    "データを消去できませんでした。保存領域を確認してください。",
  "settings.toast.maintenanceArmed":
    "次の一回だけ鍵を保持する設定を arm しました",
  "settings.error.maintenanceFailed":
    "maintenance tokenを設定できませんでした。オフライン状態を確認してください。",
  "settings.title": "設定",
  "settings.card.display": "表示",
  "settings.field.theme": "テーマ",
  "settings.theme.system": "システム",
  "settings.theme.light": "ライト",
  "settings.theme.dark": "ダーク",
  "settings.card.defaults": "既定値",
  "settings.field.defaultAlgorithm": "デフォルト暗号方式",
  "settings.field.defaultEc": "デフォルトQR誤り訂正レベル",
  "settings.ec.hint":
    "高いほど読み取りに強く、入る量は減ります。この設定が効くのは単一画像のAESメッセージQRだけです。共通鍵QRは常にH、フレーム分割QR（暗号文・公開鍵・公開鍵セット）は常にQです。",
  "settings.card.pqMessage": "ポスト量子メッセージ",
  "settings.requireSignature.label": "署名を必須にする",
  "settings.requireSignature.forced":
    "環境設定で必須化されているため解除できません。",
  "settings.requireSignature.hint":
    "有効時は非署名のポスト量子方式を選択肢から隠します。",
  "settings.field.transferTimeout":
    "読取状態の期限 {min}〜{max} 分",
  "settings.frameEc.hint": "OCF2フレームの誤り訂正は常にQです。",
  "settings.card.plaintext": "平文の扱い",
  "settings.autoClearAfterEncrypt.label": "暗号化後に平文を自動消去",
  "settings.backgroundClear.label": "バックグラウンド移行後に自動消去",
  "settings.backgroundClear.desc":
    "有効時はバックグラウンド移行から{normalSeconds}秒後に平文を消去します。QRリーダーが必要とするWebAssemblyランタイムが使えない場合は、代わりに{fallbackSeconds}秒後に消去します。",
  "settings.clearAllPlaintext": "すべての平文を消去",
  "settings.card.onlineProtection": "オンライン検出時の保護",
  "settings.wipeOnOnline.label":
    "オンライン確定時にローカルデータを初期化",
  "settings.wipeOnOnline.hint":
    "既定ON。専用sentinelの本文一致後だけ実行します。",
  "settings.wipeOnOnline.offTitle": "ローカルデータが残り続けます",
  "settings.wipeOnOnline.offBody":
    "永続OFFでは、接続を検出しても鍵とローカルデータを自動初期化しません。",
  "settings.maintenance.button": "次の一回だけ鍵を保持して更新",
  "settings.maintenance.hint":
    "オフライン中だけ arm できます。暗号文保存の救済経路ではなく、次の verified transition 後に必ず失効します。",
  "settings.maintenance.onlineDisabled": "オンライン中は設定できません。",
  "settings.advanced.title": "Advanced: reset churn",
  "settings.advanced.field": "reset churn ({min}–{max} MB)",
  "settings.resetChurn.warning":
    "既定は0です。churnは消去保証にならず、物理データの回収不能を保証しません。",
  "settings.dataDeletion.title": "データの消去",
  "settings.deleteAllKeys": "すべての鍵を消去",
  "settings.resetAllData": "全ローカルデータ初期化",
  "settings.dataDeletion.note":
    "全初期化はIndexedDBの全ストア、oc-*のlocalStorage、メモリー内の一時データを消去します。オフライン起動を維持するためService Workerのキャッシュは保持します。",
  "settings.card.pwaInfo": "PWAアプリ情報",
  "settings.pwa.browserView": "ブラウザー表示中",
  "settings.sw.unavailable":
    "この機能は利用できません: Service Worker。オフライン起動を利用できません。",
  "settings.pwa.noUpdatePolicy":
    "アプリの更新は行わない方針です。新しいバージョンの利用には端末の完全フォーマット後の再インストールが必要です。",
  "settings.info.version": "バージョン",
  "settings.info.build": "ビルド",
  "settings.pwa.offlineReadyNote":
    "オフライン利用準備状態は資産の保存状態を示します。安全性を示すものではありません。",
  "settings.card.featureDetect": "機能検出",
  "settings.featureDetect.note":
    "Web CryptoまたはIndexedDBが利用できない場合はUNSUPPORTED_BROWSER画面で全機能を停止します。",
  "settings.security.title": "セキュリティについて",
  "settings.security.scope":
    "このアプリが保証するのは、アプリケーションが意図的に平文や秘密鍵を外部送信しないことまでです。",
  "settings.security.outOfScope.heading": "防御対象外:",
  "settings.security.outOfScope.1": "OS・ブラウザー・ファームウェアの侵害",
  "settings.security.outOfScope.2":
    "キーロガー・画面録画・スクリーンショット",
  "settings.security.outOfScope.3":
    "カメラフレームを取得するマルウェア",
  "settings.security.outOfScope.4":
    "PWA初回取得時・再インストール時の供給網侵害",
  "settings.security.outOfScope.5": "端末の物理的な窃取",
  "settings.security.outOfScope.6":
    "ユーザー自身による秘密QRの誤共有",
  "settings.security.outOfScope.7":
    "ブラウザーデータ削除による鍵の消失",
  "settings.security.offlineDisplayNote":
    "オフライン表示は現在のネットワーク状態を示す補助情報であり、安全性の証明ではありません。",
  "settings.security.caveat.1":
    "採用している noble の本アプリ統合は独立監査を完了していません。",
  "settings.security.caveat.2":
    "JavaScript実装はサイドチャネル耐性を保証しません。",
  "settings.security.caveat.3":
    "JavaScriptとGCのため、メモリー上の秘密値を完全消去できる保証はありません。",
  "settings.security.caveat.4":
    "resetはローカルデータの論理削除を試行します。LevelDB・SSDウェアレベリングを含め、物理消去は保証しません。",
  "settings.security.wipeOnOnlineNote":
    "wipe-on-onlineは、接続後に現在のコードが実行できた場合の残存データ低減です。同一オリジンの悪意あるコード、物理回収、更新前に実行される侵害コードを防ぎません。",
  "settings.maintenance.dialogDesc":
    "次のオンライン確定時にwipeを一度だけ抑止します。実行するには「KEEP KEYS」と入力し、注意事項を確認してください。",
  "settings.confirmationLabel": "確認文字列",
  "settings.maintenance.ackLabel":
    "一回限りであり、更新後のコードや端末の安全性を保証しないことを理解しました",
  "settings.maintenance.armButton": "maintenance tokenをarm",
  "settings.delete.desc.keys":
    "すべての暗号文が復号できなくなります。削除を実行するには「DELETE ALL」と入力してください。",
  "settings.delete.desc.reset":
    "IndexedDBとoc-*設定、一時データを消去します。Service Workerキャッシュは保持します。実行するには「DELETE ALL」と入力してください。",
  "settings.delete.working": "消去中…",
  "settings.delete.execute": "論理削除を実行",
  "hooks.preferences.loadFailed":
    "設定を読み込めませんでした。既定値を使用します。",
  "hooks.keys.loadFailed":
    "鍵を読み込めませんでした。保存領域を確認してください。",
  "hooks.pqRecords.loadFailed":
    "ポスト量子IDと公開鍵を読み込めませんでした。",
} as const satisfies MessageCatalog

export const messages: Readonly<Record<Language, MessageCatalog>> = { en, ja }

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === "string" && MESSAGE_KEY_SET.has(value)
}

export function interpolateMessage(
  template: string,
  values: InterpolationValues = {},
): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (placeholder, name: string) => {
    const value = values[name]
    return value === undefined ? placeholder : String(value)
  })
}

export function translate(
  language: Language,
  key: MessageKey,
  values: InterpolationValues = {},
): string {
  return interpolateMessage(messages[language][key], values)
}
