# Mesh dual-machine verification checklist

Public Internet / NAT traversal cannot be fully proven on a single machine.
Use this checklist on **two devices** (or one device + a public VPS).

## Environment

| Item | Machine A | Machine B |
| --- | --- | --- |
| OS | | |
| WArmy version | 0.1.0 | 0.1.0 |
| LAN IP | | |
| Public IP / NAT | | |
| Listen port (default 59599) | | |

## Steps

1. Install WArmy on both machines (same major version).
2. Settings → mesh: start mesh; note listen port (**fail-loud if bind fails**).
3. Generate invite / pair identity (QR or code). Confirm fingerprints match.
4. Same LAN: verify discovery + handshake logs (`WARMY-HELLO/1` family).
5. Cross LAN/WAN: add peer `public:port` if discovery blocked; record dialability ladder result.
6. Project group: creator on A, member on B — verify member sees project state.
7. Container-dev project on A: stop container → member B should see creator-offline face; history readable.
8. Optional relay: configure relay only if both sides are NAT-hard; record whether content remains E2E (relay sees handshake metadata only).

## Report template (copy)

```markdown
## Mesh dual-machine report — YYYY-MM-DD

- Versions: A=  B=
- LAN success: yes/no — evidence:
- WAN/holes: n/a | success | failed — reason:
- Identity fingerprint match: yes/no
- Project state visible to member: yes/no
- Container stop face on member: yes/no (creator-offline)
- Ports used: A=  B=  (bind fail ever silently switched? must be no)
- Notes / screenshots:

Reported by: Pondsi
```

## Known limits (do not over-claim)

- UPnP / NAT-PMP not implemented in 0.1.0
- True hole-punching needs both NATs + a STUN endpoint
- Relay metadata visibility is expected for a byte pipe

---
Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
