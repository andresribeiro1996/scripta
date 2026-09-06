# Remote setup — recovery cheatsheet

Phone reaches opencode on the Mac over Tailscale. Chain: **phone browser → https://macbook-pro-de-andre.tail0d4db7.ts.net → Tailscale serve → 127.0.0.1:4096 (opencode serve)**.

- Web login: user `opencode`, password = `OPENCODE_SERVER_PASSWORD` in `~/.zshrc`
- Tailscale CLI (not on PATH): `/Applications/Tailscale.app/Contents/MacOS/Tailscale`

## Health check (on the Mac)

```bash
lsof -nP -iTCP:4096 -sTCP:LISTEN      # opencode listening?
curl -sS -u opencode:"$OPENCODE_SERVER_PASSWORD" http://127.0.0.1:4096/global/health
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
/Applications/Tailscale.app/Contents/MacOS/Tailscale status
```

Expected: LISTEN line, `{"healthy":true,...}`, serve proxying `/` → `http://127.0.0.1:4096`.

## Restart everything (after reboot / crash)

```bash
# 1. Tailscale (app usually auto-starts; if not):
open -a Tailscale
/Applications/Tailscale.app/Contents/MacOS/Tailscale up   # if logged out

# 2. opencode serve — run from a normal shell so ~/.zshrc exports the password
nohup opencode serve --hostname 127.0.0.1 --port 4096 > /tmp/opencode-serve.log 2>&1 &

# 3. Verify
curl -sS -o /dev/null -w '%{http_code}\n' -u opencode:"$OPENCODE_SERVER_PASSWORD" \
  https://macbook-pro-de-andre.tail0d4db7.ts.net/global/health   # want 200
```

`tailscale serve --bg 4096` config persists in Tailscale across reboots — no need to redo.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 502 on ts.net | opencode serve not running / bound to wrong iface | Restart command above; must bind `127.0.0.1` (tailscale serve proxies to localhost — binding to the Tailscale IP causes 502) |
| 401 | basic auth (expected) | Login `opencode` + `OPENCODE_SERVER_PASSWORD`. If auth is silently missing, serve was started without the zshrc env (e.g. LaunchAgent) |
| Log in fails | password changed in `~/.zshrc` | Restart serve so it picks up the new value |
| ts.net unreachable | Tailscale down on Mac or phone | `tailscale up` both; check admin console key expiry (disabled for this Mac) |
| Serve crashes | check `/tmp/opencode-serve.log` | |

## Notes

- `nohup` start does **not** survive reboot — LaunchAgent at `~/Library/LaunchAgents/com.opencode.serve.plist` is the permanent fix (plist must set `OPENCODE_SERVER_PASSWORD` itself; LaunchAgents don't read `~/.zshrc`). Not done yet.
- Power-loss reboot + FileVault: SSH and Tailscale only start after first login. `sudo fdesetup authrestart` before planned restarts.
- Verify power settings survive OS updates: `pmset -g` (want `sleep 0`).
