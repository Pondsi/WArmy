# WArmy 0.2.29

## Highlights

- **Voice organizer is truly read-only while organizing.** The input box can no longer be edited during organizing; the organizer result always replaces that round's original text. Clicking the mic again cancels immediately, restores the text, and discards late results by request generation. The next voice input still re-organizes the entire chat box.
- **Unified `.nm` v2 export/import with optional encryption.** The settings page now says “Export data” / “Import data”. Plain `.nm` imports directly. Encrypted `.nm` first checks the current account's stable Kroot fingerprint; if it matches, it imports with the current credential, otherwise it asks for the source account mnemonic. Legacy `.wvault` remains importable.
- **Scheduled export dialog fits the main window.** Content scrolls when needed; the data selector is a single six-category tree with collapsed subcategories; cycle count and interval share one row.
- **SQLCipher-compatible encrypted memory database (phase 1).** `memory.db` is encrypted with `better-sqlite3-multiple-ciphers`; the key is derived from a random DEK, old plaintext DBs are backed up and rebuilt from JSONL, and the key is passed to the memory child process only for the spawn.
- **Stable Kroot / key envelope.** `Kroot = HKDF(seed, "warmy-root-v2")`; a random data DEK is wrapped by both the legacy master key and Kroot. Same-mnemonic recovery works across devices; old vaults remain readable.
- **Explicit external-edit boundary.** App workspace files can be opened in Office/IDE through “External edit (decrypted copy)”, with a warning, audit record, automatic write-back and reseal, and restart recovery. External project directories remain user-controlled plaintext paths; we do not claim external tools are sandboxed.
- **IPC least privilege and tool-output redaction.** IPC now accepts only the app's own renderer prefix, validates sensitive channel arguments, and requires login for data/key channels. Known API keys and common high-entropy secret formats are replaced with reference placeholders in tool outputs.
- **API key migration after identity/credential rotation.** Legacy plaintext/base64 key entries are re-encrypted under the current OS protection; key values are unchanged.
- **TTS full-chain fallback.** Every model in the TTS chain is tried (`/audio/speech`, then chat-completions); all failures are reported with per-leg reasons. Image/video/vision generation retain the shared full-chain fallback.
- **Legacy fingerprintless groups are rebuilt, not faked.** Right-click a legacy group to rebuild it with the current identity fingerprint and re-invite members; the old group stays as read-only history.

## Verification

- `verify-r111-data` 35/35, `verify-r111-storage` 11/11, `verify-r111-data-ui` 9/9, `verify-r111-auth-storage-ui` 8/8.
- `verify-r104-vault` 51/51, `verify-r107-export-schedule` 29/29, `verify-security` 28/28, `verify-r110-voice-ui` 10/10.
- Fast suite: 3 consecutive rounds × 125 items, 0 failures.
- R111 Electron gates: 3 consecutive rounds, all green (`verify-r111-data-ui` 9/9, `verify-r111-auth-storage-ui` 8/8, `verify-r110-voice-ui` 10/10, `verify-r110-replies-ui` 6/6).
- Packaged `release/win-unpacked/WARMY.exe`: real registration, encrypted memory DB and key envelope verified (8/8).

## Known boundaries

- Single encrypted storage core is **phase 1**: `memory.db` is SQLCipher; JSONL, settings, groups, knowledge, attachments and audit remain runtime plaintext and are sealed by DataVault on exit/logout. Full object migration is future work.
- Real second-device recovery and real TTS/image/video provider chains were not exercised in this build's automated tests.
- External project directories are not encrypted; only app-managed workspace files have the explicit external-edit flow.
- Process isolation / command sandbox is not implemented; this release adds IPC sender/schema/login gates and tool-output redaction, which are complementary, not a replacement.

## Install

Download `WArmy-Setup-0.2.29.exe` from this release and run it. The installer is unsigned; Windows SmartScreen may ask for confirmation. SHA-256 is listed in `checksums.txt`.
