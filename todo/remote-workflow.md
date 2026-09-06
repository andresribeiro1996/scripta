# Remote Workflow Plan (opencode + Tailscale)

Goal: Claude/Codex-style remote sessions — Mac at home runs opencode, reach it from phone via Tailscale (web UI + SSH/tmux).

Tailored to: Apple Silicon, macOS 26, no tailscale/tmux installed yet. Mac currently sleeps (`sleep 1`).

## 1. Keep the Mac awake and always-on

```bash
sudo pmset -a sleep 0 disksleep 0 standby 0 powernap 0
sudo pmset -a displaysleep 10          # display off is fine, saves the panel
sudo pmset -a womp 1                   # wake for network access (fallback)
sudo pmset -a autorestart 1            # reboot after power outage
```

- Keep it plugged in (`sleep 0` on battery = dead battery).
- **Lid**: closing the lid sleeps a Mac regardless of `sleep 0` unless external display + power. Either leave it open, or `sudo pmset -a disablesleep 1` (works on Apple Silicon; revert with `0`). Test after OS updates — they sometimes reset pmset.
- One-off keep-awake: `caffeinate -s` in a terminal.
- FileVault caveat: after a power-loss reboot, SSH only starts after first login. `sudo fdesetup authrestart` before planned restarts.

## 2. Tailscale (Mac + phone)

```bash
brew install --cask tailscale
tailscale up
tailscale ip -4                        # note the 100.x.y.z IP
```

- Install Tailscale from App Store/Play Store on the phone, sign in with the same account.
- In the admin console (https://login.tailscale.com): **disable key expiry** for the Mac node — it's an always-on server.
- Enable MagicDNS so you can use `http://<mac-name>:4096`.
- Optional but nice on mobile (proper HTTPS, no port typing):

  ```bash
  tailscale serve --bg 4096   # → https://<mac-name>.<tailnet>.ts.net
  ```

## 3. Serve opencode (web UI from phone)

```bash
opencode serve --hostname 0.0.0.0 --port 4096
```

Safer: bind only to the Tailscale interface so it's unreachable on LAN/Wi-Fi:

```bash
opencode serve --hostname "$(tailscale ip -4)" --port 4096
```

- `serve` has **no auth** — that's why Tailscale-only binding matters. Never port-forward or use Tailscale Funnel on it.
- Keep it alive with a LaunchAgent at login: `~/Library/LaunchAgents/com.opencode.serve.plist` with `RunAtLoad: true` and the command above.

## 4. SSH + tmux + mosh (the Claude/Codex-remote workflow)

Best experience on a phone is actually the TUI, not the web UI — sessions survive disconnects.

```bash
brew install tmux mosh
sudo systemsetup -setremotelogin on    # enable SSH
```

On the Mac:

```bash
tmux new -s scripta
cd ~/Documents/scripta && opencode     # TUI inside tmux
# detach: ctrl-b d — session keeps running
```

From the phone over Tailscale:

- **iOS**: Blink Shell (paid, worth it) — `mosh andreribeiro@<mac-name>` then `tmux attach -t scripta`. Mosh survives cell↔wifi handoffs, perfect for mobile.
- **Android**: Termux + `ssh` (Tailscale app provides the VPN).

SSH keys only, no passwords: add your key to `~/.ssh/authorized_keys`, then set `PasswordAuthentication no` in `/etc/ssh/sshd_config` and `sudo launchctl kickstart -k system/com.openssh.sshd`.

## 5. Verify from the phone

1. Tailscale on, Wi-Fi **off** (force cellular).
2. `https://<mac-name>.ts.net` (web UI) and Blink/mosh (TUI) both reachable.
3. Detach tmux on phone, reattach from the Mac — same session.

## Order of work

pmset → Tailscale → SSH/tmux → `opencode serve`
