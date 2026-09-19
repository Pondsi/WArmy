# Container real-machine timings (WArmy)

Measured on the development host after user-authorized Docker Desktop start.

## Engine lifecycle

| Step | Measured |
| --- | --- |
| Cold start Docker Desktop (app exe) | **297 ms** (poll until `docker info` ready) |
| Engine stop (accepted → daemon not running) | **3419 ms** |
| Probe transition | `installed-not-running` → `ready` (linux) |

> `docker desktop start` CLI may print success even when registry launcher key is missing on some machines; product path still **polls the daemon** and never treats “accepted” as ready.

## Container smoke (digest-pinned)

| Action | Image | Measured |
| --- | --- | --- |
| pull | alpine:3.20@sha256:d9e853e8… | 1034 ms |
| run --rm echo ok | alpine pinned | 459 ms |
| pull | node:24-slim@sha256:2fe369e9… | 830 ms |
| run node -e version | node pinned | **505 ms** → `v24.21.0` linux/x64 |

Registry digest re-check: node / debian / alpine **all OK** (content-addressed).

## Product implications

- UI “大概需要的时间” for **engine start** can cite ~0.3s on this host when the VM is warm; cold machines may take much longer (first boot OOBE).
- **Container run** after image present is sub-second; first pull is network-bound.
- Secrets env are scrubbed (`SECRET=none` in container shell smoke).
- Host Windows `node.exe` cannot run inside Linux containers — images must ship Linux Node when needed.

Source result file: `%TEMP%/perf/container/container-real-result.json`

---
Pondsi (+mimo-X-pro-Preview +mimo-v2.5-pro +DeepSeek-V4.1-Flash +Qwen3.7-max +Qwen3.8-27b +Gemini3.1pro +Gemini3.8-flash) — automatically committed by Xiaomi MiMo Desktop
