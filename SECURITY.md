# Security

## Reporting a problem

Please don't open a public issue for a security problem. Use **Report a
vulnerability** on the repository's **Security** tab on GitHub. If that
option isn't shown, open an issue asking for a private way to get in touch,
without the details.

## What this dashboard is designed for

- **Your home network.** It controls printers, so it's meant to be reached
  from your own network. It answers only to addresses a public web site
  couldn't hand out - an IP address, `localhost`, a name with no dots, or a
  home-network name such as `.local`, plus any you list in
  `DEJAVU_ALLOWED_HOSTS` - which stops a web page from reaching it by
  pointing its own domain at your dashboard (`host_is_local` in
  `backend/app.py`).
- **Away from home only through a tunnel.** The supported way in from
  outside is a Cloudflare Tunnel with access control in front of it - see
  [docs/remote-access.md](docs/remote-access.md). Don't forward a router
  port to it.
- **Secrets stay put.** API keys and notification tokens aren't sent back to
  the browser in full, are left out of config backups, and are masked in
  the printer's Details log.
- **Every printer command passes through the server's checks** - start
  print is re-checked at the moment of starting, temperatures and G-code are
  bounded, and an emergency-stop line can't be slipped into a file edit.

Nothing is sent anywhere else unless you set it up: notifications, WLED,
Home Assistant, Spoolman and go2rtc are only contacted at addresses you
enter.
