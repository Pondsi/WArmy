# Update feed (WArmy)

Product default update source can be pointed at this GitHub repository.

## Recommended feed URLs

| Kind | URL |
| --- | --- |
| GitHub Releases API (recommended) | `https://api.github.com/repos/Pondsi/WArmy/releases/latest` |
| All releases | `https://api.github.com/repos/Pondsi/WArmy/releases` |
| Repo-managed manifest | `https://raw.githubusercontent.com/Pondsi/WArmy/main/feed/latest.json` |

## How to set in the app

Settings feed is stored in `settings.json` as `updateFeedUrl` (UI entry for editing was removed on purpose; values can be set via IPC `updateSourceSet`, env `WARMY_UPDATE_FEED_URL`, or editing settings.json).

```json
{
  "updateFeedUrl": "https://api.github.com/repos/Pondsi/WArmy/releases/latest"
}
```

Environment variable:

```text
WARMY_UPDATE_FEED_URL=https://api.github.com/repos/Pondsi/WArmy/releases/latest
```

## Expected check results

| Situation | `status` |
| --- | --- |
| Feed version == app version | `up-to-date` |
| Feed version > app version | `update-available` |
| Not configured | `not-configured` (never pretends up-to-date) |
| Network / parse failure | `network-error` / `http-error` / `invalid-response` |

## Local verify

```bash
node packages/app-shell/scripts/verify-updater.mjs
node packages/app-shell/scripts/verify-updater-github.mjs
```

Current published version: **0.1.0** · Release: https://github.com/Pondsi/WArmy/releases/tag/v0.1.0

Installer asset: `WArmy-Setup-0.1.0.exe` (SHA-256 in `checksums.txt`).
