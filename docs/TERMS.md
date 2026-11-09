# WArmy Terms of Use

**Version**: 2.0
**Effective date**: 2026-10-24
**Previous version**: None — there was no standalone terms file before (older releases merged the privacy and usage terms into the privacy policy)
**Applicable product**: WArmy / Workhorse Army / `无限牛马` (the app's Chinese product name) — Windows desktop app; preview pages in this repository
**Maintainer**: Pondsi (an individual open-source project maintainer, not a company)
**Also applies**: [Privacy Policy](./PRIVACY.md) · [LICENSE](../LICENSE)

> Please read this document in full before use. On first launch, you must scroll to the bottom of the terms page and wait 3 seconds before you can click `同意并继续` ("Agree and continue"). If you do not agree, click `不同意并退出` ("Disagree (quit)") and delete the software.
>
> These terms are written against the software's **current real capabilities** and do not promise things it cannot do. If these terms and the code are inconsistent, the code prevails; please report the discrepancy using the contact details at the end of this document and we will correct the documentation.

---

## 1. Accepting these terms

1.1 By clicking `同意并继续` ("Agree and continue"), installing, copying, running or otherwise using the software, you confirm that you have read and agree to:
- These Terms of Use;
- The [Privacy Policy](./PRIVACY.md);
- The [LICENSE](../LICENSE) in the repository root (MIT + mandatory attribution).

1.2 If you do not agree, do not use the software, and delete the software and the user data directory.

1.3 If you use the software on behalf of an organization, you confirm that you are authorized to accept these terms on that organization's behalf; the organization is responsible for the data on this machine, model costs, networking and compliance.

1.4 **No** employment, agency, partnership, fiduciary, medical, legal or financial-adviser relationship exists between you and the maintainer.

---

## 2. What the software is, and what it is not

**It is:**

- A **local-first** Windows desktop app: AI workhorses ("workhorse" is the app's term for its AI agents), project groups, task boards, a memory system, a knowledge base, tool execution, and optional LAN/public-network meshing and relay.
- An **open-source** project: the source code is public, and you may audit, compile and modify it yourself (subject to the attribution requirements in the LICENSE).
- A **bring-your-own-model** (BYO) client: you fill in your own model provider, endpoint, model name and API key, or connect to a local Ollama instance.

**It is not:**

- **Not SaaS, and there is no server-side account system.** An "account" in the app is just one encrypted configuration on this machine; the maintainer does not have your account, password or mnemonic, and there is no online account you can log into.
- **Not a cloud backup / cloud sync service.** The maintainer does not store your conversations, files, memories or knowledge base, and does not provide "automatic restore on a new device".
- **Not an account recovery service.** If you lose your mnemonic, the maintainer **cannot** recover your identity or data (see Section 5).
- **Not a model provider.** Model capabilities, content moderation, logging, billing and availability are the responsibility of the provider you choose.
- **Not a relay operator.** FWArmy is an optional separate program; the maintainer does not operate a public relay.
- **Not a source of professional advice.** AI output does not constitute medical, legal, financial, tax, security or other professional advice.

---

## 3. Licence and attribution

3.1 The software is licensed under the **LICENSE (MIT + mandatory attribution)** in the repository root. You may use, copy, modify, merge, publish, distribute, sublicense and/or sell copies of the software, but you must:

- Keep the copyright notice and the licence notice;
- **Always credit Pondsi as the original author**, in a place reasonably visible to the recipient (README, documentation, About page, package metadata or source file headers, etc.), and never remove or obscure that attribution when modifying, renaming or redistributing.

3.2 These terms **do not modify the LICENSE**. For use, copying, modification and distribution of the source code, if these terms conflict with the LICENSE, **the LICENSE prevails**.

3.3 Third-party dependencies, models, fonts, icons, skills and plugins each have their own licences; you must comply with them yourself. Third-party licence files in the repository (such as `jsqr-1.4.0.LICENSE.txt`) also apply.

3.4 When the names and marks "WArmy", `无限牛马` (the app's Chinese product name) and "Workhorse Army" are used to refer to this project, they must not imply that you have the maintainer's endorsement; you may reasonably state that your product is "based on WArmy".

---

## 4. Eligibility

4.1 You should have full civil capacity appropriate to your jurisdiction. Minors should use the software with a guardian's consent and guidance; because it involves self-custody of a mnemonic, API-key costs and third-party models, **independent use by minors is not recommended**.

4.2 You must not use the software from a sanctioned, embargoed or legally prohibited region or under a prohibited entity identity, nor use it for purposes that violate export-control or sanctions rules.

4.3 You confirm that you are entitled to install and run the software on the device you use, and that you will comply with the rules of your employer, school, organization or device administrator.

---

## 5. Self-custodied credentials: mnemonic, PIN and identity backup

5.1 **Your identity is generated on this machine.** First-time registration generates 24 BIP-39 English words locally (the interface can also show Chinese word phrases/pinyin as an aid) and an Ed25519 key pair; no server is involved and no "registration request" is sent out.

5.2 **The mnemonic is the only recovery credential.** It is never written to disk in plaintext (it is shown once in the interface during registration for you to copy down; locally it is stored encrypted with a master key, with a separate PIN / system secure-storage wrapper). Write it down offline and keep it safe.

5.3 **Loss = no recovery.** If you lose your mnemonic, forget your identity passphrase, reinstall the operating system without a backup, or your device is damaged and no usable backup exists:
- The maintainer does **not** have your mnemonic, private key or a copy of your data;
- **No one can** recover your identity, decrypt your old files or "reset your account" for you;
- There is no "support-desk recovery", no "security-question recovery" and no backdoor.

5.4 **A PIN is not a strong password.** The 4–20-digit PIN is only for convenient local unlocking; failed attempts are rate-limited/locked out; it cannot replace the mnemonic. The system secure store (DPAPI/Keychain) is bound to the operating-system account: malicious programs under the same account can decrypt it, and changing devices, reinstalling or changing the account can break automatic sign-in.

5.5 **Identity backup is your responsibility.** Exported backups are always encrypted; if you forget the backup passphrase, recovery is likewise impossible. Do not send your mnemonic or backups via chat, email, issues or public cloud-drive links.

5.6 **Credential leakage = identity takeover.** Anyone who obtains your mnemonic or the 51-character credential can immediately impersonate you and decrypt your encrypted files. The maintainer cannot "ban" or "freeze" that identity; you can only re-register, rotate your keys and notify your contacts.

---

## 6. Your responsibilities

You agree to:

6.1 **Use the software lawfully.** Do not use the software for illegal activities, and do not infringe others' intellectual property, privacy, reputation, personal information or other rights; do not generate or spread malicious code, scam content, harassing content, non-consensual intimate images or tools that evade platform risk controls, and do not use it for illegal surveillance or weaponization.

6.2 **Be responsible for the content you input and output.** You confirm that you are entitled to process the files, chat records, knowledge-base content and personal information you provide; you must review AI output before using it, especially content involving others' rights, contracts, or medical, financial, legal or safety matters.

6.3 **Safeguard your keys and costs.** You apply for and keep your own API keys, model accounts, cloud resources and IM bot credentials; you bear all costs, arrears, overages and account bans. Deleting a key from this machine does not mean it has been revoked on the provider's side.

6.4 **Comply with third-party terms.** When you use model providers, GitHub, Hugging Face, WeChat/iLink, WeCom, Telegram, Feishu (Lark), or a relay you run or use, you must comply with their terms and with local law. You must assess for yourself the risks of platform rate limiting, risk controls, interface changes and account bans.

6.5 **Compliance for self-hosted relays.** If you run FWArmy or open your relay to others:
- You are the operator of that service and are responsible for security, logs, abuse handling, TLS, access control, and any local filing/licensing requirements;
- Do not expose the management interface to the public internet, and do not host the server on a machine shared by multiple people;
- Do not use it to send illegal content, spam or attack traffic; you bear the resulting liability.

6.6 **Protect your device and backups.** Enable full-disk encryption, a strong account password and screen lock; back up important files regularly; do not paste mnemonics, private keys or API keys into chats, issues or screenshots.

6.7 **Do not abuse the feedback channels.** Do not post keys, raw chat content, other people's personal information, or exploitable details of unpatched vulnerabilities in public issues; contact us privately first for security problems.

---

## 7. AI output, tool execution and high-risk uses

7.1 **AI can be wrong.** Models can hallucinate, omit things, be outdated, be biased or generate inappropriate content; the software does not guarantee that output is true, accurate, complete, lawful or suitable for your purpose.

7.2 **Tools really execute.** Workhorses can run commands, read and write files, invoke scripts and access the network; these operations run with your system privileges and may modify or delete files. Back up first, review authorizations, use checkpoints, and keep operations inside the workspace.

7.3 **Prompt injection.** Web pages, documents, emails and chat records you process may contain malicious instructions that induce the model to call tools or leak information. Limit tool permissions, review external content, and do not keep sensitive credentials in directories the model can read.

7.4 **High-risk uses.** You must not use the software as the **sole** basis for high-risk decisions such as medical diagnosis, legal opinions, financial trading, autonomous driving, aviation, nuclear power, weapons or emergency rescue; a qualified person must review such decisions and bear final responsibility.

7.5 **No content-moderation promise.** Local conversations are by default not reviewed by the maintainer; whether you see inappropriate content depends on the model and platform you choose. You must take your own filtering, isolation and compliance measures.

---

## 8. Third-party services, networking and relays

8.1 **Third-party services are not under our control.** The availability, pricing, terms, data handling and geography of model providers, GitHub, npm, Hugging Face, Tencent/WeChat, Telegram, Feishu (Lark) and the relays you use are decided by them; they may change, rate-limit, ban or discontinue their services at any time.

8.2 **Networking features are not guaranteed to work.** LAN discovery, NAT hole punching, STUN, port mapping, direct public-network connections and relay forwarding can all fail; on failure the app should honestly show `未送达` ("not delivered"), but it **does not guarantee delivery, does not guarantee real-time transmission, and does not guarantee that no messages are lost**.

8.3 **Relay boundaries.** FWArmy only forwards end-to-end-encrypted envelopes, does not persist messages to disk, and the queue TTL is 30 seconds; but the operator can see metadata (DID, IP, time, size, usage) and may also refuse service or substitute public keys. Verify fingerprints out of band, and configure TLS for public-network use.

8.4 **Experimental features.** WeChat iLink, the FWArmy relay, cross-network meshing and special models may be marked as experimental; they may change, break or be removed at any time and carry no availability promise.

8.5 **External links.** The software may open external websites or download third-party content; that content is not provided by us and we are not responsible for it.

---

## 9. Privacy

9.1 Data-processing rules are governed by the [Privacy Policy](./PRIVACY.md). Core facts:

- There is no server-side account; the maintainer does not operate its own backend that receives your data;
- Most local data is unencrypted by default; only the identity private key, mnemonic, API keys and social passwords use the system secure store;
- Cloud models, IM platforms and relays process the content you send according to their own policies;
- A lost mnemonic cannot be recovered; local data cannot be recovered after deletion.

9.2 You must not use the software to process other people's personal information without a lawful basis; you must not build unlawful face/voice/behaviour surveillance databases, or collect or trade personal information without consent.

---

## 10. Updates, changes and discontinuation

10.1 **Update checks**: Opening the `关于` ("About") page triggers one automatic check; you can also check manually. Only version information is queried; conversation content is not uploaded. Update packages are verified by SHA-256 and size; the current version does not auto-install — installation follows the instructions on the release page.

10.2 **Updates may change behaviour.** New versions may add, modify or remove features, and may change data flows. Material changes will be stated in the release notes and in these terms / the privacy policy; where a new outbound data transfer is added, consent will be requested again before it is enabled.

10.3 **Terms changes.** These terms carry a version number and an effective date. For non-material changes (wording, contact details, links), continued use after the update counts as acceptance; material changes will be announced through the repository release notes and an in-app notice. If you do not agree, stop using the software and delete your data.

10.4 **Discontinuation.** The maintainer may stop maintaining, releasing or distributing the software at any time; already-released code remains licensed under the LICENSE, but no further updates, fixes or support are guaranteed.

---

## 11. Disclaimer

To the maximum extent permitted by applicable law:

11.1 The software is provided **"as is"** and **"as available"**, **without any express or implied warranty**, including but not limited to warranties of merchantability, fitness for a particular purpose, non-infringement, accuracy, freedom from viruses, uninterrupted operation, freedom from errors, and compatibility with particular models or platforms.

11.2 The maintainer **does not guarantee** that:
- the software is free of defects or vulnerabilities, or will not be compromised;
- data will not be lost, corrupted or accessed without authorization;
- model output will be correct, lawful or meet your expectations;
- third-party services will remain available, keep their prices or not ban you;
- meshing/relay messages will definitely be delivered, or that metadata will not be observed;
- any defect will be fixed, or fixed within a particular time.

11.3 You bear all risk of using the software, including data loss, device damage, model costs, business interruption, third-party claims and compliance liability.

11.4 These terms do not exclude or limit liability that **cannot be excluded or limited by law**, including personal injury caused by the maintainer's intent or gross negligence, fraud, and the mandatory rights consumers enjoy by law.

---

## 12. Limitation of liability

12.1 To the maximum extent permitted by applicable law, the maintainer is **not liable for any indirect, incidental, special, punitive, exemplary or consequential damages**, including but not limited to lost profits, lost revenue, lost goodwill, data loss, business interruption, the cost of substitute services, and third-party claims.

12.2 To the maximum extent permitted by applicable law, the maintainer's **total aggregate liability** relating to the software does not exceed the amount you **actually paid** to use the software. The software is currently provided free of charge, so that amount is **0**; you should not rely on any compensation not expressly agreed.

12.3 The above limitations apply under contract, tort (including negligence), strict liability or any other theory, even if the maintainer has been advised of the possibility of such damages.

12.4 If your jurisdiction does not allow the above limitations, they do not apply in that jurisdiction; instead, the minimum extent permitted by applicable law applies. This does not affect the validity of the remaining terms.

---

## 13. Indemnification

13.1 To the extent permitted by applicable law, you agree to indemnify and hold the maintainer harmless from third-party claims, losses, liabilities and expenses (including reasonable attorneys' fees) arising from:

- your unlawful use of the software, or infringement of others' rights;
- content you input, generate, publish or spread;
- your breach of these terms, third-party platform terms or local law;
- abuse, content or compliance problems caused by relays, meshing or IM bots you run or open to others;
- your disclosure of a mnemonic, private key, API key or other people's personal information.

13.2 The maintainer should promptly notify you of the relevant claim and allow you to participate in the defence; however, the maintainer may choose its own counsel and settlement. These terms do not require you to pay for the maintainer's own intent or gross negligence.

---

## 14. Termination

14.1 You may stop using the software at any time: quit the app, delete the user data directory and uninstall the software. **There is no server-side account to close**, and no "account deletion request".

14.2 If you breach these terms, the maintainer may stop providing you with support, issue interactions or subsequent versions; but the code rights already granted to you under the LICENSE are not retroactively revoked by the termination of these terms.

14.3 After termination, Sections 3 (Licence and attribution), 5 (Self-custodied credentials), 6 (Your responsibilities), 7 (AI and high-risk uses), 9 (Privacy), 11 (Disclaimer), 12 (Limitation of liability), 13 (Indemnification), 15 (Governing law and disputes) and 16 (General terms) survive.

---

## 15. Governing law and disputes

15.1 To the extent not prohibited by the mandatory law of your place of residence, these terms are governed by the **laws of the People's Republic of China** (excluding its conflict-of-laws rules).

15.2 For disputes arising from these terms or the software, the parties should first negotiate amicably; if negotiation fails, the dispute is submitted to the **competent People's Court at the maintainer's domicile**.

15.3 If you are a consumer, the mandatory consumer-protection rights granted by the law of your place of residence (including choice of forum) take precedence over this Section; these terms do not limit your right to complain to a local consumer-protection body or regulator.

15.4 If you have a dispute with a third-party service provider (models, IM, relays, etc.), that is a matter between you and that third party; the maintainer is not a party to it.

---

## 16. General terms

16.1 **Entire agreement**: These terms + the privacy policy + the LICENSE constitute the entire agreement between you and the maintainer regarding the software. Where these terms conflict with the LICENSE on code licensing, the LICENSE prevails; where they conflict with the privacy policy on data processing, the privacy policy prevails; otherwise these terms prevail.

16.2 **Severability**: If any provision is held invalid or unenforceable, the remaining provisions are unaffected; that provision will be enforced to the maximum extent permitted by law.

16.3 **No waiver**: The maintainer's failure or delay in exercising any right does not constitute a waiver of that right.

16.4 **Assignment**: You may not assign your rights or obligations under these terms; the maintainer may transfer the project to a successor, provided these terms remain in effect for already-released versions.

16.5 **Language**: These terms are authoritative in **Chinese**; translations into other languages are for convenience only, and if they conflict with the Chinese version, the Chinese version prevails. The LICENSE is authoritative in its original English.

16.6 **Headings**: Section headings are for convenience of reading only and do not affect interpretation.

16.7 **Force majeure**: The maintainer is not liable for non-performance caused by force majeure such as natural disasters, war, epidemics, cyberattacks, platform bans or changes in law.

---

## 17. Contact

`Public@numumu.com · Repository and issue feedback: https://github.com/Pondsi/WArmy`

- For terms/licence questions, put `TERMS` in the subject line; for privacy/deletion requests, put `PRIVACY`; for security problems, contact us privately first.
- **Do not send** mnemonics, private keys, API keys, national ID numbers, raw chat content or other people's personal information.
- We usually reply within a reasonable time; the software is an individual open-source project and comes with no commercial SLA or 24-hour support.

---

*These terms are not legal advice. They are written against the project's current implementation; if they are inconsistent with the code, the code prevails — please report the discrepancy so we can correct it.*
