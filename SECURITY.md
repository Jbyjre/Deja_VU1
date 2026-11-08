# Security

## Reporting a problem

Please don't open a public issue for a security problem. Use **Report a
vulnerability** on the repository's **Security** tab on GitHub. If that
option isn't shown, open an issue asking for a private way to get in touch,
without the details.

## What this dashboard is designed for

- **Your home network.** It controls printers, so it's meant to be reached
  from your own network. It answers only to addresses a public web site
  couldn't hand out: an IP address, `localhost`, a name with no dots, or a
  home-network name such as `.local`, plus any you list in
  `DEJAVU_ALLOWED_HOSTS`. That stops a web page from reaching it by
  pointing its own domain at your dashboard (`host_is_local` in
  `backend/app.py`).
- **An optional device lock.** Settings → Paired devices → "Only paired
  devices can use this dashboard". With it on, every device except the
  computer the dashboard runs on (reached as `localhost`) must be paired with
  a six-digit code before it can read or change anything. Each paired device
  holds its own key in an HttpOnly cookie; only a hash of it is stored, and
  unpairing withdraws it at once. Requests through a tunnel's domain or a
  network address count as other devices, even from the same machine
  (`backend/pairing.py`, `_locked_out` in `backend/app.py`). It is off by
  default so nothing changes for existing set-ups.
- **Away from home through Tailscale or a protected tunnel.** Settings →
  Away from home shares the dashboard on your private Tailscale network
  (Tailscale Serve, never Funnel). A Cloudflare Tunnel needs Cloudflare Access
  in front of it ([docs/remote-access.md](docs/remote-access.md)). Don't
  forward a router port to it.
- **Watch-only mode.** Settings → Watch-only mode (or `DEJAVU_WATCH_ONLY=1`)
  makes the server refuse every command to a real printer; reads, the camera
  and the emergency stop still go through.
- **Secrets stay put.** API keys and notification tokens aren't sent back to
  the browser in full, are left out of config backups, and are masked in
  the printer's Details log.
- **Every printer command passes through the server's checks.** Start
  print is re-checked at the moment of starting, temperatures and G-code are
  bounded, and an emergency-stop line can't be slipped into a file edit.

Nothing is sent anywhere else unless you set it up: notifications, WLED,
Home Assistant, Spoolman and go2rtc are only contacted at addresses you
enter.
