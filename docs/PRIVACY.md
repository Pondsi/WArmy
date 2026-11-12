# WArmy Privacy Policy

**Version**: 2.0
**Effective date**: 2026-10-24
**Previous version**: 1.0 (2026-10-18)
**Applicable product**: WArmy / Workhorse Army (Windows desktop app; in-repository preview page)
**Maintainer**: Pondsi (an individual open-source project maintainer, not a company)
**Also applies**: [Terms of Use](./TERMS.md) · [LICENSE](../LICENSE)

> This policy is written against **the actual behaviour of the current code** and makes no promises the software cannot keep. If the UI text, this document and the code disagree, **the code prevails**; please report it through the channels at the end of this document and we will correct it.
>
> On first launch, after choosing a language, you must read and agree to this Policy and the Terms of Use before you can continue. You can view the in-app full text or **revoke consent** under Settings → About (after revocation the app quits, and you must agree again on the next launch).

---

## 30-second summary

1. **There is no server-side account system**, and the maintainer **operates no backend of their own that could receive your data**.
2. Sessions, projects, memory, the knowledge base and the audit log are by default **stored only on your computer**; apart from what you yourself send to GitHub or by email, the maintainer holds none of your personal data.
3. The data files this app manages (sessions and messages, projects/groups/board, the knowledge base and archives, the audit log, settings and network configuration, checkpoints and the recycle bin) are **always stored as ciphertext on disk**: a runtime at-rest encryption layer seals and opens them with a data key derived from the account key (AES-256-GCM, with JSONL sealed per record). **Outside** this layer: the `workspace/` directory, external project directories outside `userData`, `auth/`, `identity/` and `secure/` (each has its own key or OS protection and must stay readable before sign-in), the Chromium cache, fonts, screenshots, boot and diagnostic logs, `node_modules`, `vault.bin` and `memory.db`. This is application-side encryption, not filesystem-level enforcement: an administrator process under the same OS account, and memory dumps, are outside the threat model.
4. The software goes online only when **you act or configure it yourself**; every network scenario is listed item by item in Section 3.
5. Models and API keys are your own (BYO). A cloud model receives whatever you choose to send and processes it under **that provider's** policies.
6. FWArmy is an **optional, standalone, self-hostable** relay program that the maintainer does not operate; it only forwards ciphertext and does not write messages to disk, but it can see metadata.
7. Messages over third-party IM platforms such as WeChat iLink, WeCom, Telegram and Feishu pass through those platforms.
8. **If the mnemonic is lost, nobody can recover it for you — including the maintainer**; there is no "account recovery" and no support backdoor.
9. Contact details are in Section 18 at the end (two email addresses + the GitHub repository URL).

---

## 1. Who processes your data

| Role | Who | What they process |
|------|------|----------|
| Controller of the local data | **You** | Sessions, files, memory, the knowledge base, credentials, etc. are all on your device; you decide what to keep, export and delete |
| Open-source project maintainer | **Pondsi (individual)** | Receives no local data; processes only what you voluntarily send via GitHub issues/PRs or email |
| Third-party services | The providers you choose and configure | Model providers, GitHub, npm, Hugging Face, Tencent WeChat/iLink, the operator of the relay you use, etc., each processing under its own policies |

Three points that must be clear:

- **There is no server-side account system.** The "account" in the app is only an encrypted configuration file on this machine (`auth/vault.json` and `identity/identity.json`), not an account on any online service; the maintainer does not have your account, password or mnemonic.
- **The maintainer is not your processor.** Local processing happens entirely on your device; the maintainer neither takes part in it nor can access it. If you deploy this software for an organisation, you are the controller of that deployment.
- **Each third-party service is responsible for itself.** When you send content to a cloud model, an IM platform or someone else's relay, it is **you** who provides data to them; whether they log it, train on it or transfer it abroad is governed by their own terms and privacy policies.

---

## 2. Local data inventory

Default user-data directory (can be overridden at launch with `--user-data-dir=`):

| System | Default path |
|------|----------|
| Windows | `%APPDATA%\@warmy\app-shell` |
| macOS | `~/Library/Application Support/@warmy/app-shell` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/@warmy/app-shell` |

| Data | Typical location | Contents | Does it leave the device automatically? | Encrypted by default? |
|------|----------|------|------------------|--------------|
| Sessions and messages | `memory/` (the JSONL is the single source of truth) | What you said, model replies, attachment references, timestamps and session IDs | No (unless that turn calls a cloud model) | **Yes**: runtime at-rest encryption layer (AES-256-GCM; JSONL sealed per record) |
| Memory index | `memory/`, `memory-runtime/` (SQLite / vectors) | Retrieval projections generated from the logs; rebuildable from the JSONL | No | **No, plaintext** (outside the runtime encryption layer) |
| Projects / groups / members / board | `groups.json`, `board/`, `plans.json` | Group and project ledgers, members, task cards, project MEMORY | No (when mesh networking is on, sent to peers according to your choices) | **Yes**: runtime at-rest encryption layer (AES-256-GCM; JSONL sealed per record) |
| Knowledge base and archives | `knowledge/`, `archive/archives.jsonl` | Entities, events, evidence anchors (three tiers: session / internal / private), archive summaries and anchors | No (may be sent to the archive model when archive summaries are generated; may be sent to a model as context after a retrieval hit) | **Yes**: runtime at-rest encryption layer (AES-256-GCM; JSONL sealed per record) |
| Audit log | `audit/audit.jsonl` | Operation names, timestamps, session IDs, model IDs, error summaries, file paths, etc. | **Never uploaded automatically** | **Yes**: runtime at-rest encryption layer (AES-256-GCM; JSONL sealed per record) |
| Settings and networking | `settings.json`, `profile.json`, `net.json`, `net-bindings.json`, `nodes.json`, `peers.json`, `bus/`, `assets.json` | UI preferences, model configuration, server lists, session and network bindings | No | **Yes**: runtime at-rest encryption layer (AES-256-GCM; JSONL sealed per record) |
| Checkpoints / work-in-progress / trash | `checkpoints/`, `board-carry.json`, `trash.json` | File checkpoints, drafts of unfinished tasks, the recently-deleted index | No | **Yes**: runtime at-rest encryption layer (AES-256-GCM; JSONL sealed per record) |
| Model API keys | Managed by `secure-keys` | Keys for each model provider | No (sent only to the provider you entered) | **Yes**, OS secure storage |
| Identity private key | `identity/identity.json` | Ed25519 private key (PKCS8) | No | **Yes**: AES-256-GCM; the DEK is wrapped by the system keychain or a passphrase (scrypt) |
| Mnemonic and local account | `auth/vault.json` | 24-word mnemonic, identity seed, PIN wrapper, auto-login wrapper | No | **Yes**: the master key is derived from the mnemonic via PBKDF2-HMAC-SHA512; a separate wrapper is stored for the PIN |
| Social-platform credentials | `enc:v1:` fields in `settings.json` | Email/website/wallet passwords, bot tokens, etc. | No (sent only to the corresponding platform) | **Usually**; when system protection is unavailable they are **explicitly marked `plain`**, never disguised as encrypted |
| Boot and diagnostic logs | `warmy-boot.log`, `updates/` | Boot steps, crash causes, temporary update-download files | No | **No, plaintext** (outside the runtime encryption layer) |

About encryption, this must be stated clearly:

- **The rows marked "Yes" in the table above are protected by the runtime at-rest encryption layer; the rows marked "No" are still plaintext.** During first-run bootstrap there is no data key yet, so writes stay plaintext; once you sign in and the vault is unsealed, the managed files are migrated to ciphertext in one pass. `workspace/` and external project directories stay plaintext by product design, and editing them outside the app goes through an explicit session.
- OS secure storage (Windows DPAPI / macOS Keychain / Linux libsecret) is bound to the **operating-system account**, not to the whole machine; a malicious program running under the same account can decrypt it. In a domain environment, AD may also hold the DPAPI keys, and an organisation administrator could in theory decrypt them.
- The identity private key cannot be used directly even if the file is copied away on its own; but if you set an identity passphrase, **a forgotten passphrase = an identity that cannot be unlocked**. There is no reset.
- We recommend enabling full-disk encryption (BitLocker / FileVault / LUKS), using a strong system-account password, and locking your screen.

---

## 3. When the app goes online

| # | Scenario | Trigger | Destination | What is sent | What the other side may retain |
|---|------|----------|--------|----------|------------------|
| 1 | Cloud-model conversation | You send a message, invoke a tool, or have a workhorse (the app's term for its AI agents) carry out a task | The `baseURL` of the model provider **you entered yourself** | The system prompt, the conversation, attachments/images you select, tool output, memory or knowledge-base excerpts | Decided by that provider (request logs, abuse monitoring, whether it trains on them, etc.) |
| 2 | Local Ollama | You select a local model | `http://127.0.0.1:11434` by default | Same as above | Stays on this machine (unless you change the address to a remote one) |
| 3 | Special models (embedding / ASR / TTS / summarisation) | You configure and enable them | The provider you configured, or this machine | The text or audio to be processed | Decided by that provider |
| 4 | Update checks | **Opening the About page checks automatically**; you can also click "Check for updates" manually | `api.github.com`, npm registry | A current-version query; **no** device ID, mnemonic or conversation content | GitHub / npm access logs (including IP) |
| 5 | Skill / plugin market | You search or install | `api.github.com`, `raw.githubusercontent.com`, npm registry | Repository names, queries, download requests | The respective platform's access logs (including IP) |
| 6 | Local speech-model downloads | You install local speech | Hugging Face (mirror first, official source as fallback) | Model-file requests | The respective platform's access logs (including IP) |
| 7 | LAN / public-network mesh | You enable mesh networking and add peers | Your peer devices; the STUN / port-mapping services you specify | Handshakes, rosters, end-to-end-encrypted messages | Peers and the services you specify may see IP, time and size |
| 8 | FWArmy relay | You add and select a relay | A relay server run by you or a third party | End-to-end-encrypted envelopes + metadata such as DID and time | In-memory queue for at most 30 seconds; credential hashes, statistics and operational logs are written to disk (see Section 5) |
| 9 | WeChat iLink / WeCom / Telegram / Feishu | You scan a QR code or enter credentials and connect | Tencent, Telegram, Feishu and other platform servers | Messages, contact/session identifiers, bot tokens | Decided by the platform; the platform may rate-limit, apply risk control and retain records |
| 10 | External links / built-in browsing | You click a link | The target website | An ordinary HTTP request (IP, User-Agent, etc.) | Decided by the target website |
| 11 | GitHub issues / email | You submit them yourself | GitHub, your email provider | What you write and attach | Public (issues) or retained in both parties' mailboxes |

**What does not happen:**

- No third-party analytics SDK, advertising SDK, user profiling, or A/B experiment reporting.
- No crash-reporting SDK that uploads automatically is integrated; crash causes are written only to the local `warmy-boot.log`. The operating system may keep its own local crash dumps; we do not upload or read them.
- Sessions, files, the knowledge base and the audit log are never silently uploaded in the background.
- API keys, the mnemonic and the identity private key are never sent to the maintainer or to any "analytics service".

> "Local-first" does not mean "offline forever": once you have a workhorse call a cloud model, the content sent to that model has already left this machine.

---

## 4. Models and API keys (BYO)

- **You choose the provider, the address and the model.** The app ships no shared keys and does not proxy your model requests.
- **A key is only sent to the address you entered.** When saving, OS secure storage is preferred; when system protection is unavailable the app **refuses to write plaintext** (in a development environment this is allowed only if `WARMY_ALLOW_PLAINTEXT_KEYS=1` is explicitly set, and the entry is marked `plain`).
- **Keys are never sent to the maintainer.** They are sent to the provider you configured as request authentication (usually the `Authorization` header; some protocols use other headers). That provider may log requests, run abuse detection and use them for training under its own terms. Read its privacy policy first.
- **The costs and quotas are yours.** Arrears, rate limits, account bans and regional restrictions are handled by the provider; deleting a key locally does not automatically revoke it on the provider side — revoke/rotate it in the provider's console.
- **What gets sent can be broad.** Besides the conversation it may include attachments, images, tool execution results, knowledge-base/memory excerpts and the system prompt. Do not put mnemonics, private keys, ID numbers or other people's personal information in there.
- **Local Ollama does not leave the machine by default.** If you change the address to a LAN or public-network machine, the data leaves this machine and is handled under that machine's rules.

---

## 5. The optional FWArmy relay

FWArmy is an **optional relay program, separate from the WArmy repository**. You can run it yourself or use a relay run by someone else. **The maintainer does not operate any public relay service.**

What it does **not** do:

- It does not store message bodies: the queue is in memory only, each message ≤64KB, at most 50 messages per recipient, TTL 30 seconds, deleted on pickup.
- It does not parse envelopes: messages are end-to-end encrypted, the server does not have the recipient's private key and cannot obtain the plaintext.
- It does not write messages to disk: the code contains no path that persists envelopes to disk.

What it **can see and do** (you must know this honestly):

- It can see metadata: who (DID public key), from which IP, when, how large the message is, which credential was used, and how many requests / how much traffic.
- It can refuse service, drop or delay messages, and replay old envelopes; if the client does not verify fingerprints, it can also substitute public keys to mount a man-in-the-middle attack.
- It records credential hashes, quotas, daily/monthly/yearly statistics and operational logs (5MB rotation by default), and these are written to disk. Per the code, the operational log records only method/path/status/latency/credential-hash prefix — not queries, bodies or credential plaintext — but the connection layer can still see IPs.

Therefore:

- **Configure TLS yourself for public-network use** (a reverse proxy or an equivalent solution); otherwise metadata may be visible along the transport path.
- **Verify identity fingerprints out of band** (security code / QR code); do not trust only the public key returned by the relay.
- **Do not expose the management interface to the public internet**: the FWArmy admin page only allows local loopback access; other processes on the same machine can still call the management API, so do not run the server on a machine shared by multiple people.
- If you run a relay, you are the operator of that service and must comply yourself with the rules of your jurisdiction covering servers, communications, content, filing/licensing and abuse; the maintainer does not assume these obligations for you.

---

## 6. WeChat / iLink and other third-party IM

- Connecting WeChat iLink (`ilinkai.weixin.qq.com`) requires you to authorise by scanning a QR code with WeChat; the platform returns a bot token and bot id. These credentials are preferentially stored encrypted on this machine (and are explicitly marked as plaintext when system protection is unavailable).
- Messages between you and your contacts **pass through Tencent's servers** and are subject to the WeChat/Tencent privacy policy and platform rules; the maintainer takes no part and cannot read them.
- iLink is currently a channel where "one WeChat account maps to one bot, 1:1 with its creator, replies must carry context, and the platform may silently rate-limit"; **delivery is not guaranteed, and freedom from restrictions is not guaranteed**. Platform API changes may break the feature.
- Group-chat/external-group content may be archived locally into the knowledge base. Archiving happens on this machine, but the content may include other people's personal information; before importing and using it, make sure you have the corresponding rights.
- To disconnect: remove the connection/credential inside the app, and revoke authorisation on the WeChat or other platform side. Deleting only the local credential does not mean the platform-side binding is removed.

The same applies to the WeCom smart-bot, Telegram and Feishu channels: messages pass through the corresponding platform and are handled under that platform's policies.

---

## 7. Logs, audit, memory, knowledge base

- **Audit log** (`audit/audit.jsonl`): records operation names, timestamps, session IDs, model IDs, error summaries, file paths, etc. **It stays on this machine and is never uploaded**; you can clear it in the UI or delete the file directly. It normally does not record message bodies, but error information may contain fragments you pasted; redact the log before sending it to anyone.
- **Memory**: the append-only JSONL is the single source of truth; SQLite/vector stores are only rebuildable projections. Memory contains everything you said and the full text of model replies; after a retrieval hit, the relevant fragments are sent to the model as context.
- **Knowledge base**: stores entities, events and evidence anchors (three tiers: session / internal / private) that you add manually or that are extracted from archives. It may contain personal information from your conversations with others; after a retrieval hit, relevant entries may be sent to the model as context. Archive summaries may be generated by the archive model you configured; if that model is in the cloud, the relevant conversation is sent to that provider.
- **Recently deleted**: deleted sessions go into `trash.json` and are **restorable within 48 hours**; after that they are permanently cleaned up automatically. You can also empty it immediately.
- **Boot log**: `warmy-boot.log` records boot steps, renderer/child-process exit reasons, etc., for local troubleshooting; it is not uploaded.
- **Shareable diagnostic log** (`diag/diag.jsonl`, added in R165): a second ledger **separate from the audit log**, sanitized **by construction** — it stores only enum event codes, module, error category/code, durations/counts/HTTP status, numeric metrics, sanitized stack frames (file:line only) and a per-boot random id. It contains **no** paths, usernames, hostnames, device IDs, conversation content, model prompts/replies, keys, URLs or IPs, and no free-text fields at all. Bounded ring (keeps only the newest half once over the limit); view / self-check / clear / disable under Settings → Functions → Logs / Diagnostics. **Never auto-uploaded**; export requires your explicit confirmation and re-sanitizes the whole bundle once more, attaching a privacy statement. It is meant for bug reports and local troubleshooting; full detail remains only in the local audit log.

---

## 8. Crashes, diagnostics and updates

- **Crashes**: there is no crash-reporting SDK that uploads automatically. Uncaught exceptions and renderer/child-process exit reasons are written to the local `warmy-boot.log`; the operating system or Electron may keep local crash dumps, which are managed by the system — we neither upload nor read them.
- **If you send logs yourself**: prefer Settings → Functions → Logs / Diagnostics → "Export (shareable)"; that bundle is sanitized by construction and re-sanitized on export, so it can be attached to a public issue directly. If you instead send the full audit log, first remove sensitive information such as usernames, home-directory paths, internal network addresses, API keys, mnemonics and raw chat content. GitHub issues are public.
- **Update checks**: opening the About page triggers one automatic check; you can also click "Check for updates" manually. The request contains only a version query — **no** device ID, mnemonic or conversation content. The request inevitably lets GitHub / npm see your IP.
- **Update downloads**: verified against the SHA-256 and size provided by the release feed; if verification fails, the partial download is deleted. The current version **does not auto-install**; installation steps follow the instructions on the release page.
- **The update feed is configurable**: `updateFeedUrl` in `settings.json` or the `WARMY_UPDATE_FEED_URL` environment variable; if you point it at a third-party feed, that feed will see your requests.

---

## 9. What we do not do

- We do not sell, rent out, or "share" (as defined by the CCPA) your personal information; nor have we collected any information that could be sold.
- We do no ad serving, user profiling, cross-site tracking or A/B experiment reporting.
- We operate no server-side accounts, provide no "cloud backup" and provide no "account recovery".
- The code contains no channel for the maintainer to read your data remotely; the code is open source, and you can audit it and verify it by compiling it yourself.
- We do not upload the audit log, sessions or the knowledge base to any endpoint controlled by the maintainer.

---

## 10. Purposes and legal bases of processing (GDPR / UK GDPR)

| Scenario | Purpose | Legal basis | Notes |
|------|------|----------|------|
| Local operation and storage | Providing the software's functions | No processing by the maintainer | The data is on your device, under your control |
| First-launch terms consent | Obtaining authorisation to use, meeting transparency requirements | Consent (Art. 6(1)(a)) | Can be withdrawn at any time; the app quits after revocation |
| GitHub issues / email | Answering questions, fixing defects, maintaining the project | Your voluntary provision (consent) / the maintainer's legitimate interests (Art. 6(1)(f)) | Public content is visible to everyone |
| Update checks | Security updates and version compatibility | Legitimate interests (Art. 6(1)(f)) or your own action | Version query only; data minimised |
| Your use of cloud models / IM / relays | Completing the transfer you requested | Your instruction and consent; the specific basis is determined by that third party | The maintainer does not take part in the transfer |

- **Special category data**: we do not ask you to provide special category data such as health, biometrics, political opinions, religion or sexual orientation. If you enter it yourself and send it to a model, you are responsible for establishing a lawful basis.
- **Automated decision-making**: the maintainer makes no automated decisions or profiles about you. Model output is assistive content, not a decision by the maintainer about you.
- **CCPA/CPRA**: in the past 12 months we have not "sold" or "shared" personal information, and have received no consideration for selling or sharing; we offer no financial incentives; we do not discriminate against you for exercising your rights. If you voluntarily provide information via email/issues, it remains subject to this policy.
- **China's Personal Information Protection Law (PIPL)**: the maintainer performs no cross-border transfers; when you choose a foreign model/IM/relay, you yourself are providing data to it, and you must complete the applicable compliance requirements such as notification, separate consent and the cross-border pathway.

---

## 11. Your rights

Within the scope of applicable law (GDPR, UK GDPR, CCPA/CPRA, PIPL, etc.), you have:

- **To be informed**: this Policy and the Terms of Use explain the data flows.
- **Access / portability**: export conversations as Markdown, export an identity backup (encrypted JSON), export a model-cost CSV; the local files themselves can also be copied directly.
- **Rectification**: edit the local data directly; data held on the third-party service side must be corrected with that provider.
- **Erasure**: delete local data as described in Section 16; edit or delete your GitHub content yourself; ask us to delete emails.
- **Restriction / objection**: stop using the app, disconnect the network, or remove model/relay/IM configurations to stop the corresponding processing.
- **Withdrawal of consent**: Settings → About → "Revoke privacy consent"; the app quits, and you must agree again on the next launch.
- **Not to be subject to automated decision-making**: the maintainer makes no such decisions.
- **Complaint**: complain to your local data-protection supervisory authority; California residents may complain to the California Attorney General.

**How to exercise these rights in a serverless architecture:**

- We **do not have your local data** and cannot query, export or delete it remotely; for access/deletion, work directly with the local files and the in-app exports.
- We can only act on **what we actually hold**: emails you send us and your GitHub issues/PRs. When requesting deletion, send the request from the original mailbox so that we can verify it; you can delete public issues yourself.
- We will respond within a reasonable time; where applicable law sets a deadline, we will meet it (usually 30 days under the GDPR, 45 days under the CCPA, extendable by law in complex cases, with notice). No fee, unless requests are manifestly repetitive or excessive.

---

## 12. Retention periods

| Data | Retained for | Deleted by |
|------|----------|----------|
| Sessions, projects, memory, knowledge base, archives | Until you delete them | You |
| Recently deleted (`trash.json`) | Permanently cleaned up automatically after 48 hours, or emptied immediately by you | The app / you |
| Audit log | Until you clear it or delete the file; **no automatic expiry** | **Yes**: runtime at-rest encryption layer (AES-256-GCM; JSONL sealed per record) |
| Boot log, checkpoints, work-in-progress files | Until you delete them | **No, plaintext** (outside the runtime encryption layer) |
| Identity, mnemonic, API keys, social-platform credentials | Until you delete the corresponding files/entries | You |
| FWArmy message queue | At most 30 seconds in memory; deleted on pickup | The server process |
| FWArmy credential hashes, statistics, operational logs | Until the operator deletes `data/`; logs rotate at 5MB | The relay operator |
| Update/skill/model download requests | Retained by GitHub / npm / Hugging Face under their policies | The respective platform |
| Emails you send us | Retained as needed after the matter is resolved; you can request deletion | The maintainer |
| GitHub issues/PRs | Kept publicly until you or the maintainer deletes them; GitHub has its own policies | You / the maintainer / GitHub |
| Data on the cloud-model side | Determined by the provider's policy | The provider (you can request deletion) |

---

## 13. Cross-border transfers

- The maintainer **operates no servers** and therefore **performs no** data transfers from your country/region to other countries.
- When you choose a foreign model provider, foreign IM or foreign relay, or send content to GitHub / Hugging Face, **you** are providing data to a foreign recipient; the recipient's location, the legal basis and the contract terms are matters between you and that recipient.
- Users in China: using foreign models/services may constitute a cross-border provision under the Personal Information Protection Law (PIPL); complete the applicable procedures yourself, such as notification, separate consent, and security assessment / standard contract / certification.
- Users in the EU/UK: the maintainer makes no transfers and does not need to rely on SCC/IDTA; but the providers you choose may transfer data — check their terms.
- The location of an FWArmy relay is decided by its operator; before using someone else's relay, confirm its location and policies.

---

## 14. Children and minors

- This software is **not directed at children** and does not target children as users; we perform **no age verification** and cannot technically prevent minors from installing it.
- Users under 18 should use it with a guardian's consent and guidance; children under 13 (or the higher age in your jurisdiction) should not use it.
- Because it involves self-custody of a mnemonic, API-key costs, third-party models and the risk of unlawful content, we do not recommend independent use by minors.
- We do not knowingly collect personal information from children. If you believe a child has sent us personal information (for example by email/issue), contact us and we will delete it.

---

## 15. Security measures and known limits

**What has been done:**

- Local-first: sessions/memory/knowledge base/audit are not uploaded by default.
- The identity private key is encrypted with AES-256-GCM; the DEK is wrapped by the system keychain or a passphrase; the passphrase path uses scrypt.
- The mnemonic is not stored in plaintext; the PIN uses a one-way verification value, with lockout after consecutive failures; auto-login uses the OS secure storage and is bound to the account/machine.
- Model API keys and social-platform passwords prefer the OS secure storage; without protection, silent plaintext is refused (social passwords are explicitly marked `plain`).
- FWArmy messages are end-to-end encrypted (X25519 + HKDF + AES-256-GCM + Ed25519 signatures); the server stores no messages.
- Update packages are verified with SHA-256 + size; tool/script invocation uses tiered authorisation, and writes outside the workspace require authorisation.
- The audit log is kept locally so that you can review it yourself.

**What it cannot do (please be sure to understand this):**

- It cannot stop malware, keyloggers, compromised input methods or remote administration tools that already run under your system account.
- It cannot stop other users of the same Windows account (DPAPI unwraps automatically); in a domain environment, administrators can in theory decrypt DPAPI.
- A 4–20 digit PIN is not a high-entropy secret; we apply rate limiting and lockout, but that cannot turn it into a strong password.
- It cannot stop the third-party plugins/scripts you install, the commands you run, or the files you open; they run with your privileges.
- It cannot stop model providers, IM platforms or relay operators from logging, training on, transferring abroad or leaking data under their own policies.
- It cannot stop AI output errors, hallucinations, prompt injection, or being induced to perform dangerous operations; critical decisions must be reviewed by a human.
- The dependency chain (Electron, Node, open-source libraries, model files) may itself contain undisclosed vulnerabilities; we have not obtained any third-party security certification or penetration-test endorsement.
- The security floor for local plaintext files is your operating-system account and disk encryption; enable full-disk encryption yourself and keep backups.

---

## 16. How to delete your data

1. **Quit the app** (tray "Sign off" / quit) so that no process holds the files.
2. **Delete the user-data directory**:
   - Windows: `%APPDATA%\@warmy\app-shell`
   - macOS: `~/Library/Application Support/@warmy/app-shell`
   - Linux: `${XDG_CONFIG_HOME:-~/.config}/@warmy/app-shell`
   - If you launched with `--user-data-dir=`, delete that directory.
3. **Uninstall the program**: the uninstaller does not necessarily delete the user-data directory; step 2 is what removes everything.
4. **Cloud-model side**: delete conversations/files and revoke API keys in the provider's console; local deletion does not affect data the provider has already stored.
5. **GitHub**: edit or delete the issues/comments/PRs you posted; contact us when you want emails deleted.
6. **FWArmy**: stop the server and delete its `data/` (`credentials.json`, `stats.json`, `server.log`, `config.json`, etc.); if credentials were ever leaked, revoke and recreate all of them.
7. **Third-party IM**: disconnect inside the app, and revoke authorisation on the WeChat/WeCom/Telegram/Feishu side.
8. **Exports and backups**: delete the `.NM` configuration packages, identity-backup JSON, Markdown/CSV exports, screenshots, etc. that you exported; they live outside the local data directory, and the app will not clean them up for you.
9. **Recently deleted**: cleaned up automatically after 48 hours; empty it in the UI to delete immediately.

Deletion is **irreversible**. We have no server copy to "delete again" and no backup to restore from.

---

## 17. Changes to this policy

- This policy carries a **version number and effective date**; historical versions can be traced through the Git history, and changes are written into the release notes.
- **Non-material changes** (wording, contact details, link fixes): the version number and date are updated; continued use counts as awareness.
- **Material changes** (new outbound transfers, new data categories, more recipients, changed legal bases): we will first state them in the repository and the release notes, and ask for consent again inside the app **before enabling them**; if at that time the app has not yet implemented per-version re-consent, we **will not enable** the transfer.
- If you do not accept a change, you can revoke consent and stop using the app; you delete the data already on this machine as described in Section 16.
- We will not silently expand the scope of data collection for the sake of "better usability".

---

## 18. Contact

`Public@numumu.com · Repository and issues: https://github.com/Pondsi/WArmy`

- For privacy questions, data-deletion requests and requests concerning minors, use the email addresses above and put `PRIVACY` in the subject line.
- **Do not send** mnemonics, private keys, API keys, ID numbers, raw chat content or other people's personal information **by email or in a public issue**; if you must provide them, redact them first or ask us for a safe way to provide them.
- For security vulnerabilities, contact us privately first; do not publish working exploit details directly.

---

## Appendix A: Third-party service list

| Service | Purpose | When it is contacted | Who controls it | Policy link |
|------|------|----------|--------|----------|
| The model providers you configure | Conversation, embeddings, speech, etc. | When you send a request | That provider | Its website's privacy policy |
| GitHub (API / Issues / raw) | Update checks, the skill market, issue feedback | Opening the About page, searching/installing skills, submitting an issue | GitHub | https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement |
| npm registry | Checking the DeepSeek Shell version, installing dependencies | Opening the About page, installing related components | npm / GitHub | https://www.npmjs.com/policies/privacy |
| Hugging Face | Downloading local speech models | When you install local speech | Hugging Face | https://huggingface.co/privacy |
| Tencent WeChat / iLink | The WeChat bot channel | After you connect by scanning the QR code | Tencent | https://www.tencent.com/zh-cn/privacy-policy.html |
| WeCom / Telegram / Feishu | Other IM channels | After you configure the connection | The respective platform | The respective platform's policies |
| FWArmy relay | Forwarding end-to-end-encrypted messages | When you add and select a relay | The relay operator (possibly you) | Provided by the operator |
| Your email provider | Contacting us | When you send email | The email provider | Its policies |

## Appendix B: Glossary

- **This machine / local**: the device on which you run WArmy and its user-data directory.
- **Maintainer**: Pondsi, an individual open-source project maintainer — not a company, and operates no online service.
- **Server-side account**: an account stored by an online service that the service provider can verify or recover. This software has **no** such account.
- **Mnemonic**: 24 BIP-39 English words generated on this machine (the UI can display Chinese phrase/pinyin aids); it is the only credential for recovering your identity.
- **BYO API key**: Bring Your Own Key — a key you obtain from a model provider yourself and enter.
- **Relay**: an optional server that forwards encrypted envelopes when two sides cannot connect directly; FWArmy is the reference implementation.

---

*This policy is not legal advice. It is written against the project's current implementation; if it disagrees with the code, the code prevails, and please report it so that we can correct it.*
