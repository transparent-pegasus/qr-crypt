export const en = {
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
  "common.copy": "Copy",
  "common.download": "Download",
  "common.delete": "Delete",
  "common.deleteAriaLabel": "Delete {name}",
  "common.created": "Created: {datetime}",
  "common.identityFingerprint": "Identity fingerprint",
  "common.supplementalFingerprints": "Supplemental KEM and signing fingerprints",
  "common.fingerprintCompare": "Comparison display: {value}",
  "common.loading": "Loading",
  "common.openKeysPage": "Open the keys page",
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

  "nav.encrypt": "Encrypt",
  "nav.decrypt": "Decrypt",
  "nav.keys": "Keys",
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
  "errors.QR_DECODE_PROGRESS_TIMEOUT":
    "The QR decoding pipeline stopped making progress on this device.",
  "errors.QR_READER_BLOCKED":
    "This browser blocks the QR reader. On iPhone, use Safari 16 or newer.",
  "errors.DUPLICATE_KEY": "A key with the same contents is already stored.",
  "errors.DUPLICATE_QR": "A QR code with the same contents is already stored.",
  "errors.KEY_ID_CONFLICT":
    "One of these key IDs is already reserved by a stored bundle, which may be disabled and hidden from the list. The import was refused.",
  "errors.MESSAGE_ID_REUSED":
    "This message reuses an identifier already seen with different ciphertext in this app window since it was loaded. The plaintext was not shown. The check is not shared with other tabs or windows of this app; it also resets on a transient clear or full local wipe, and its bounded cache drops the oldest entries.",
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
  "boot.networkSuspected.title": "Network connection detected",
  "boot.networkSuspected.body":
    "This device appears to be connected to a network, and the application could not confirm otherwise. Secret operations stay closed. Disconnect the network — including virtual interfaces such as VPN or container bridges — and reload. Your stored keys have not been changed or deleted.",
  "boot.deploymentFailed.title": "Server security headers are wrong",
  "boot.deploymentFailed.body":
    "The server answered, but its response did not carry the required security headers. This installation cannot be trusted for secret operations. Serve the application with a configuration that applies _headers, then reload. Your stored keys have not been changed or deleted.",
  "boot.deploymentUnverified.title": "Installation not verified yet",
  "boot.deploymentUnverified.body":
    "No server check has been recorded for this address, so the application cannot confirm it was installed correctly. This is normal before the first installation, and after a data reset. Load the application once from its server, then disconnect and reload. Nothing is wrong with your server, and your stored keys have not been changed or deleted.",
  "boot.blocked.reload": "Reload",
  "boot.wiping.title": "Resetting local data",
  "boot.wiping.body": "Do not close this screen until the operation finishes.",
  "boot.wiped.title": "Local data was reset after an online connection was detected",
  "boot.wiped.body":
    "Best-effort logical deletion was attempted. Physical erasure is not guaranteed.",
  "boot.wiped.backOnline": "Return to the online page",
  "boot.partialFailure.retryHint":
    "Close this tab. App reset and ordinary formatting do not guarantee physical erasure. Before using the app again, follow media-appropriate sanitization guidance or use a replacement device, then install afresh.",

  "gate.install.error":
    "Installation could not be started. Use the browser menu instead.",
  "gate.appIcon.alt": "{appName} app icon",
  "gate.mode.label": "Online installation and message relay",
  "gate.heading": "Install the PWA",
  "gate.description":
    "Install this app while online, then use it offline. Encryption, decryption, keys, and settings work only offline.",
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
    "To use encryption features, take this device offline — for example with airplane mode — then accept the risk acknowledgement that appears. Going offline does not make a compromised device safe.",
  "gate.about.link": "What this app does",

  "relay.card.title": "Message relay",
  "relay.card.description":
    "Pass encrypted messages between a messenger and an offline device using QR codes and text. This works only while a scan finds no keys, PQ identities, or Vault on this device; nothing is decrypted and no keys are used.",
  "relay.boundary.title": "Untrusted relay boundary",
  "relay.boundary.body":
    "This relay accepts only encrypted message frames (OCF2 pq-message or sym-message). It checks their format but does not decrypt or verify them. Frames remain in this page's memory for this session only, with no app-managed persistence, and the relay makes no payload-bearing network request. The copy action places text on the system clipboard, which is outside the app's control. Everything the sender chose — the ciphertext, transferId, IV, and createdAt values — stays untrusted and can carry covert data until the receiving offline device authenticates it. Exchange keys face to face, never through this relay.",
  "relay.capture.open": "QR → Text",
  "relay.capture.unavailable":
    "Camera capture is unavailable on this device. Text-to-QR playback remains available.",
  "relay.capture.title": "QR to text",
  "relay.capture.description":
    "Start the camera, then scan every QR frame shown on the offline device.",
  "relay.capture.video.ariaLabel": "Message relay camera preview",
  "relay.capture.startCamera": "Start camera",
  "relay.capture.cameraActive": "Camera active",
  "relay.capture.progress": "{collected} / {total} frames collected",
  "relay.capture.missing": "Missing frames: {indexes}",
  "relay.capture.output.label": "Relay text",
  "relay.capture.copy": "Copy relay text",
  "relay.copy.warning":
    "Copying exports the relay text to the system clipboard. Clipboard contents may persist or sync outside this app and are not cleared by an app reset.",
  "relay.playback.open": "Text → QR",
  "relay.playback.title": "Turn relay text into QR",
  "relay.playback.description":
    "Paste the relay text exactly as you received it, then show the QR codes to the offline device.",
  "relay.playback.input.label": "Relay text",
  "relay.playback.show": "Show QR",
  "relay.playback.missing": "Missing frames: {indexes}",
  "relay.playback.screenCaptureWarning":
    "Displayed QR images can still be saved by long-press, printing, screenshots, or screen recording.",
  "relay.playback.qrTitle": "Relayed message frames",
  "relay.playback.noDownloadControls":
    "This relay provides no app file-download controls.",
  "relay.image.open": "QR → QR",
  "relay.image.hint":
    "Use QR → QR only if your messaging app supports pasting images and the message fits in a single QR code.",
  "relay.image.title": "QR to QR",
  "relay.image.description":
    "Start the camera, then scan the QR code shown on the offline device. Only single-frame messages can be relayed as an image.",
  "relay.image.alt": "Relayed message QR code",
  "relay.image.copy": "Copy QR image",
  "relay.image.copyWarning":
    "Copying exports the QR image to the system clipboard. Clipboard contents may persist or sync outside this app and are not cleared by an app reset.",
  "relay.error.title": "Relay input rejected",
  "relay.error.empty": "Enter or scan at least one OCF2 frame.",
  "relay.error.prefix":
    "Only canonical OCF2 frame strings are accepted.",
  "relay.error.kindMismatch":
    "One relay transfer carries either pq-message or sym-message frames, never both.",
  "relay.error.outerType":
    "The frame's outer header does not declare pq-message or sym-message.",
  "relay.error.invalidFrame": "The frame is not a canonical OCF2 frame.",
  "relay.error.mismatch":
    "The payload does not belong to what this relay session already accepted.",
  "relay.error.length": "The frame set has inconsistent declared and collected lengths.",
  "relay.error.incomplete":
    "The frame set is incomplete. Add every missing frame before playback.",
  "relay.error.inputSize": "The relay text exceeds the protocol limit.",
  "relay.error.timeout":
    "The relay session timed out and its app-held payload references were cleared.",
  "relay.error.busy":
    "Another operation is using this device's local storage. Close it, then try again.",
  "relay.error.copy": "The relay text could not be copied.",
  "relay.error.multiFrame": "This message spans multiple QR frames. Use QR → Text instead.",
  "relay.error.copyImage": "The QR image could not be copied.",

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

  "algorithm.A256GCM": "Shared-key AES-256-GCM",
  "algorithm.MLKEM1024_MLDSA87_A256GCM":
    "Public-key ML-KEM-1024 + ML-DSA-87 + AES-256-GCM",

  "qrDisplay.defaultTitle": "QR code",
  "qrDisplay.notQrCryptPayload":
    "A QR code cannot be generated because this is not an app payload.",
  "qrDisplay.error.title": "The QR code could not be generated",
  "qrDisplay.image.alt": "{title} image",
  "qrDisplay.generating": "Generating the QR code…",
  "qrDisplay.fullscreen.button": "View full screen",
  "qrDisplay.fullscreen.title": "View {title} full screen",
  "qrDisplay.fullscreen.desc": "Displays the QR code full screen on a white background.",
  "qrDisplay.fullscreen.imageAlt": "Full-screen {title} image",

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
  "animatedQr.export.error.title": "The frames could not be exported",

  "keyDetail.rename.label": "Key name",
  "keyDetail.rename.submit": "Rename",
  "keyDetail.rename.saved": "Key renamed",
  "keyDetail.qr.outputName": "{title}-{date}",
  "keyDetail.toast.rotated": "The public key was rotated",
  "keyDetail.toast.symmetricRotated": "The shared key was rotated",
  "keyDetail.toast.revoked": "The public key was revoked on this device",
  "keyDetail.toast.symmetricDeleted": "The shared key was deleted",
  "keyDetail.toast.identityDeleted": "The public key was deleted",
  "keyDetail.toast.supersededDestroyed": "Older key material was discarded",
  "keyDetail.toast.copied":
    "Copied. Be aware that the clipboard may be synchronized.",
  "keyDetail.symmetricQr.title": "Shared-key QR",
  "keyDetail.identityQr.title": "{name} public key",
  "keyDetail.identityQr.desc":
    "This QR code contains the public keys used for encryption and signature verification.",
  "keyDetail.symmetricQr.desc":
    "This QR code contains a secret key that can be used for encryption and decryption.",
  "keyDetail.backToDetail": "Back to details",
  "keyDetail.delete.titleNamed": 'Delete "{name}"?',
  "keyDetail.delete.titleGeneric": "Delete the key?",
  "keyDetail.delete.body.identity":
    "Ciphertext addressed to this public key will no longer be decryptable. Unlike revocation, this cannot be undone.",
  "keyDetail.delete.body.symmetric":
    "Ciphertext encrypted with this key will no longer be decryptable. This cannot be undone.",
  "keyDetail.delete.confirm": "Delete",
  "keyDetail.destroy.title": "Discard {count} older generation(s)?",
  "keyDetail.destroy.body":
    "Created {dates}. This closes the decryption route this app keeps open for those generations: messages sent to them that have not been decrypted yet can no longer be opened here. It is a logical delete, so it does not assure the bytes leave the storage medium, and a copy already loaded in another open tab is outside this action.",
  "keyDetail.destroy.confirm": "Discard",
  "keyDetail.identity.oldNote": "Previous generation: decryption/verification only",
  "keyDetail.identity.activeNote": "Available for encryption and signing",
  "keyDetail.identity.kemFingerprintLabel": "KEM {algorithm}",
  "keyDetail.identity.signingFingerprintLabel": "Signing {algorithm}",
  "keyDetail.button.showPublicKeyQr": "Show public-key QR",
  "keyDetail.button.rotate": "Rotate",
  "keyDetail.button.revoke": "Revoke on this device",
  "keyDetail.revokeNote":
    "Revocation stops this public key from signing and from being published as a current recipient on this device, and is not propagated to other parties. It does not stop decryption with this public key: use Delete to discard its key material.",
  "keyDetail.previous.toggle":
    "{count} previous generations, decryption only",
  "keyDetail.previous.destroyAll":
    "Discard the key material of {count} older generation(s)",
  "keyDetail.symmetric.fingerprintLabel": "Key fingerprint",
  "keyDetail.button.showSecretQr": "Show secret-key QR",

  "keyStatus.active": "Active",
  "keyStatus.rotated": "Rotated",
  "keyStatus.revoked": "Revoked",

  "keyList.action.create": "Create a key",
  "keyList.action.import": "Scan a key QR",
  "keyList.error.identity": "Public keys could not be loaded",
  "keyList.error.symmetric": "Shared keys could not be loaded",
  "keyList.error.peer": "The other party's keys could not be updated",
  "keyList.tab.own": "My keys",
  "keyList.tab.peer": "Other parties' keys",
  "keyList.filter.label": "Type",
  "keyList.filter.all": "All",
  "keyList.filter.pqIdentity": "Public key",
  "keyList.filter.symmetric": "Shared key",
  "keyList.item.identityMeta": "Public key · {datetime}",
  "keyList.item.supersededWarning":
    "{count} older generation(s) can still decrypt",
  "keyList.item.symmetricMeta": "Shared key · {datetime}",
  "keyList.empty.ownAll": "You have no keys.",
  "keyList.empty.ownFiltered": "There are no keys of the selected type.",
  "keyList.bundle.empty": "There are no imported public-key bundles.",
  "keyList.bundle.itemMeta": "Imported {datetime}",
  "keyList.bundle.nameConfirmed": "Verified public key",
  "keyList.bundle.nameUnverified": "Unverified public key",
  "keyList.bundle.badge.confirmed": "Identity verified",
  "keyList.bundle.badge.unverified": "Unverified",
  "keyList.bundle.fingerprintKem": "Recipient public key {algorithm}",
  "keyList.bundle.fingerprintSigning": "Signing public key {algorithm}",
  "keyList.bundle.revoke": "Disable on this device",
  "keyList.bundle.revokeTitle": "Disable this public-key bundle?",
  "keyList.bundle.revokeBody":
    "Disabling hides this row and permanently reserves both its signing and KEM key IDs in this installation. It cannot be undone, and the bundle cannot be deleted from this screen afterwards. Only a full local wipe clears the reservation. Delete the bundle instead if you need to free both IDs.",
  "keyList.bundle.revokeConfirm": "Disable",
  "keyList.bundle.confirmOpen": "Compare and confirm the fingerprint",
  "keyList.bundle.confirmTitle": "Confirm this identity's fingerprint",
  "keyList.bundle.confirmBody":
    "Compare all 64 hexadecimal digits of the identity fingerprint with the intended person's own device through an independent channel, such as a call or in person. KEM and signing fingerprints are supplemental details. Confirming records that you did so and makes this identity selectable as an encryption recipient; the app cannot check the comparison for you.",
  "keyList.bundle.confirmCheck":
    "I compared all 64 hexadecimal digits of the identity fingerprint with the intended person through an independent channel and they all matched",
  "keyList.bundle.confirmSubmit": "Confirm",
  "keyList.toast.bundleConfirmed": "The fingerprint was confirmed",

  "keys.validation.keyNameFallback": "Check the key name.",
  "keys.validation.idNameFallback": "Check the public-key name.",
  "keys.toast.symmetricCreated": "The shared key was created",
  "keys.toast.identityCreated": "The public key was created",
  "keys.toast.symmetricImported": "The shared key was imported",
  "keys.toast.bundleConfirmed": "Saved with the fingerprint verified",
  "keys.toast.bundleUnverified": "Saved without verification",
  "keys.import.symmetricDefaultName": "Imported-shared-key-{date}",
  "keys.tab.create": "Create",
  "keys.tab.import": "Import",
  "keys.import.cameraTitle": "Scan with the camera",
  "keys.import.scanTrigger": "Scan a key QR code",
  "keys.import.payloadLabel": "Key payload",
  "keys.import.payloadPlaceholder": "Paste OCK2: / OCI2:",
  "keys.import.readButton": "Read the key",
  "keys.bundle.dialogTitle": "Compare the fingerprint through another channel",
  "keys.bundle.dialogDesc":
    "Before completing the import, compare all 64 hexadecimal digits of the identity fingerprint with the intended person through an independent channel, such as a call or in person. KEM and signing fingerprints are supplemental details. A self-signature alone does not prove a person's identity. If you save without verification, this identity cannot be selected for encryption until you confirm it later under Saved keys.",
  "keys.bundle.fingerprintKem": "ML-KEM fingerprint",
  "keys.bundle.fingerprintSigning": "ML-DSA fingerprint",
  "keys.bundle.confirmLabel":
    "I compared all 64 hexadecimal digits of the identity fingerprint with the intended person through an independent channel and they all matched",
  "keys.bundle.saveUnverified": "Save without verification",
  "keys.bundle.saveConfirmed": "Verify and save",
  "keys.symmetricImport.dialogTitle": "Import a shared key",
  "keys.symmetricImport.dialogDesc":
    "This payload contains a secret key that can be used for encryption and decryption.",
  "keys.symmetricImport.warnTitle": "Verify the sharing channel",
  "keys.symmetricImport.warnBody":
    "If a third party has the same key, they may be able to decrypt the ciphertext.",
  "keys.symmetricImport.nameLabel": "Key name",
  "keys.symmetricImport.fingerprintHint":
    "Compare all 64 hexadecimal digits of this shared-key fingerprint with the intended sender through an independent channel",
  "keys.symmetricImport.ackLabel":
    "I compared all 64 hexadecimal digits of this shared-key fingerprint with the intended sender through an independent channel and they all matched",
  "keys.symmetricImport.saveButton": "Save the shared key",
  "keys.demo.hint":
    "Ask the other party to increase their screen brightness, hold the camera about 15–20 cm away, and keep it still until the image is in focus.",
  "keys.create.nameLabel.pq": "Public-key name",
  "keys.create.nameLabel.symmetric": "Shared-key name",
  "keys.create.button.pq": "Create a public key",
  "keys.create.button.symmetric": "Create a shared key",
  "keys.create.kindLabel": "Key type",
  "keys.create.kind.pqIdentity": "Public key ML-KEM-1024 + ML-DSA-87",
  "keys.create.experimentalNote": "experimental · not independently audited",

  "encrypt.toast.autoCleared": "Plaintext and transient results were cleared",
  "encrypt.output.suggestedName": "Encrypted-result-{date}",
  "encrypt.toast.plaintextClearedByPref":
    "Plaintext was cleared according to the setting",
  "encrypt.toast.payloadCopied": "The payload was copied",
  "encrypt.validation.outputNameFallback": "Check the output name.",
  "encrypt.srHeading": "Encryption",
  "decrypt.srHeading": "Decryption",
  "decrypt.cameraTitle": "Scan with the camera",
  "decrypt.scanTrigger": "Scan a ciphertext QR code",
  "decrypt.payloadLabel": "Ciphertext payload",
  "decrypt.payloadPlaceholder": "Paste an OCA2: or OCM2: payload",
  "decrypt.invalidTitle": "The ciphertext could not be identified",
  "decrypt.invalidBody": "Enter a supported OCA2 or OCM2 ciphertext.",
  "decrypt.button.busy": "Decrypting…",
  "decrypt.button.idle": "Decrypt",
  "decrypt.signingKeyId": " Key ID: {id}",
  "decrypt.importSigningKey": "Import a signing key",
  "decrypt.result.modalTitle": "Decryption complete",
  "decrypt.result.symmetric": "Shared-key message",
  "decrypt.result.signatureValid": "The signature is valid for this key",
  "decrypt.result.senderSigningKeyId": "Sender signing key ID: {id}",
  "decrypt.result.identityCheck.label": "Identity verification:",
  "decrypt.result.identityCheck.confirmed": "Identity verified",
  "decrypt.result.identityCheck.unverified":
    "Unverified. Key validity and identity verification are separate.",
  "decrypt.result.identityUnconfirmed.title":
    "The sender's identity is not confirmed",
  "decrypt.result.identityUnconfirmed.body":
    "A valid signature only proves this message was signed with this key. It does not prove who holds that key. Confirm the fingerprint in person before you act on this message.",
  "decrypt.result.senderCreatedAt":
    "Sender-reported time: {time} (asserted by the sending device, not verified)",
  "decrypt.result.replay.title": "Already received in this session",
  "decrypt.result.replay.body":
    "This exact ciphertext was already decrypted in this app window at {time}. A repeat can be an ordinary re-read, or someone replaying an old message to you. Treat any instruction inside it as unconfirmed. The check covers only this app window since it was loaded, is not shared with other tabs or windows of this app, resets on a transient clear or full local wipe, and uses a bounded cache that drops the oldest entries.",
  "decrypt.result.replay.reveal": "Show the message anyway",
  "decrypt.result.invisibleCharacters.title": "Invisible characters detected",
  "decrypt.result.invisibleCharacters.body":
    "This message contains invisible or direction-altering Unicode characters. Detected count: {count}. Verify the visible text carefully before acting on it.",
  "decrypt.result.memoryOnly":
    "The decrypted result is held only in memory and is not stored.",
  "encrypt.algorithmLabel": "Cryptographic algorithm",
  "encrypt.keyLabel": "Key",
  "encrypt.recipientLabel": "Recipient ML-KEM public key",
  "encrypt.recipient.confirmed": "Verified",
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
  "encrypt.detail.method": "Method",
  "encrypt.detail.recipientKeyId": "Recipient key ID",
  "encrypt.result.modalTitle": "Encryption complete",
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

  "scanner.payloadLabel.foreign": "Not from this app",
  "scanner.acceptedLabel.multipart": "multi-frame QR",
  "scanner.mismatch":
    "This QR code is not accepted ({actual}). This screen can scan {accepted}.",
  "scanner.defaultTitle": "Scan a QR code",
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
  "scanner.status.readerLoading": "Still loading the QR reader…",
  "scanner.reader.reloadHint":
    "The QR reader could not be prepared. Reload the page and try again.",
  "scanner.status.multipartReading": "Reading a multi-frame QR code",
  "scanner.status.multipartError":
    "The multi-frame QR scan state has an error",
  "scanner.error.expiredDiscarded":
    "The temporary scan state expired and was discarded.",
  "scanner.status.stateDiscarded": "The scan state was discarded",
  "scanner.status.multipartReadingUnordered":
    "Reading multi-frame QR codes in any order",
  "scanner.status.unacceptedRejected": "An unaccepted QR code was rejected",
  "scanner.status.cameraError": "A camera error occurred",
  "scanner.status.startFailed": "The camera could not be started",
  "scanner.status.readUnordered": "QR codes can be read in any order",
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
  "scanner.button.reload": "Reload",
  "scanner.progress.ariaLabel": "Multi-frame QR scan progress",
  "scanner.progress.received": "Received {received} / {total}",
  "scanner.progress.missingIndex": "Missing frames: {indexes}",
  "scanner.progress.expiresAt": "Scan expires: {time}",
  "scanner.frameSetComplete":
    "All required frames were received. Frame metadata, frame indexes, total length, and format are consistent.",
  "scanner.frameSetNotice":
    "These checks detect frames that are missing, duplicated, or mixed in from another transfer. They do not verify the artifact's contents and do not prove the sender's authenticity.",
  "scanner.error.title": "The scan could not be completed",
  "scanner.button.discard": "Discard scan state",
  "scanner.closed.multipartProgress":
    "Multi-frame QR scan in progress: received {received} / {total}",
  "scanner.closed.frameSetImported":
    "All frames of the multi-frame QR code were received and imported.",

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
  "settings.card.pqMessage": "Post-quantum messages",
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
  "settings.wipeOff.title": "Disable reset after online connectivity?",
  "settings.wipeOff.body":
    'When this setting is off, confirmed online connectivity will not automatically reset keys or local data. Enter "DISABLE WIPE" and acknowledge this consequence to continue.',
  "settings.wipeOff.acknowledge":
    "I understand that confirmed online connectivity will no longer automatically reset keys or local data",
  "settings.wipeOff.confirm": "Disable automatic reset",
  "settings.wipeOff.cancel": "Cancel",
  "settings.maintenance.button": "Keep keys across the next online transition only",
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
    "In-place upgrades are not supported. To install a new version, follow media-appropriate sanitization guidance or use a replacement device. App reset and ordinary formatting do not guarantee physical erasure.",
  "settings.info.version": "Version",
  "settings.info.build": "Build",
  "settings.pwa.offlineReadyNote":
    "Offline-use readiness means this page is controlled by the installed service worker. It does not indicate security.",
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
    "Wipe-on-online reduces remaining data only if the current code can run after connectivity is established. It does not prevent malicious same-origin code, physical recovery, or compromised code that ran before the current code.",
  "settings.maintenance.dialogDesc":
    'Suppresses wipe once, at the next confirmed online transition. Enter "KEEP KEYS" and review the warning to continue.',
  "settings.confirmationLabel": "Confirmation text",
  "settings.maintenance.ackLabel":
    "I understand this applies once and does not guarantee the safety of whatever code or device state follows that transition",
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
  "hooks.pqRecords.loadFailed": "Public keys could not be loaded.",
} as const
