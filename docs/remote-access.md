# Reaching the dashboard away from home — Cloudflare Tunnel

Deja Vu1 runs on one always-on machine on your home network (a Raspberry
Pi, a NAS, an old laptop). At home you open it by that machine's address.
To open it from anywhere else, this project uses **Cloudflare Tunnel**.

## How it fits together

```
 your phone, anywhere ──https──▶ Cloudflare ◀──outgoing link── cloudflared ──▶ Deja Vu1 (localhost:8000)
                                                                              │
                                                              home network only
                                                                              ▼
                                                                    Moonraker ──▶ Snapmaker U1
```

- The dashboard is **never exposed directly** to the internet. No port is
  opened on your router.
- `cloudflared` is a small program from Cloudflare that you install and run
  on the same machine. It makes an *outgoing* connection to Cloudflare, and
  Cloudflare passes visitors for your address down that connection. It is
  not part of this project's code and is not something Deja Vu1 imports.
- The tunnel only covers **your browser ↔ the dashboard**. The dashboard ↔
  printer link stays on your home network. The printer itself is never
  reachable from the internet, tunnel or no tunnel.

## Before you start — this part is a real, one-time cost

A *named* tunnel (the kind with a fixed address that survives restarts)
needs **a domain whose nameservers point at Cloudflare**. If you don't have
one, that means buying a cheap domain and, in the Cloudflare dashboard,
adding it as a site and switching its nameservers to the two Cloudflare
gives you. Allow roughly fifteen minutes plus however long your registrar
takes to apply the nameserver change.

(Cloudflare also has "quick tunnels" with a random address. That address
changes every time the tunnel restarts, so it isn't suitable for a link you
keep on your phone.)

## Put a login in front of it — do not skip this

**Deja Vu1 has no login of its own.** On your home network that is a
deliberate choice (see pairing in the README). On the internet it is not
safe: anyone who found the address could pause or cancel a print.

Protect the address with **Cloudflare Access** (part of Cloudflare Zero
Trust, which has a "Zero Trust Free" plan): create an application for the
hostname and an Access policy that only lets your own email address in,
with Cloudflare's "one-time PIN" login. Cloudflare then emails you a code
before the dashboard is ever reached.

The dashboard also refuses control commands and live connections that come
from a *different website* (it checks the `Origin` header browsers send),
so a web page you happen to visit can't press buttons on your printer. That
is a second layer, not a replacement for Access.

## Setting it up

These are the steps from Cloudflare's own guide to a locally-managed
tunnel. Replace `deja-vu1` with any name you like and
`printer.example.com` with an address on your own domain.

1. **Install `cloudflared`** on the machine that runs Deja Vu1 — Cloudflare
   publishes packages for Linux, macOS and Windows on its downloads page.

2. **Log in** (opens a browser; pick your domain):

   ```sh
   cloudflared tunnel login
   ```

3. **Create the named tunnel** — note the tunnel ID (a UUID) it prints:

   ```sh
   cloudflared tunnel create deja-vu1
   ```

4. **Write `config.yml`** in the `.cloudflared` folder in your home
   directory. Deja Vu1 listens on port 8000 by default:

   ```yaml
   url: http://localhost:8000
   tunnel: <Tunnel-UUID>
   credentials-file: /home/<you>/.cloudflared/<Tunnel-UUID>.json
   ```

5. **Point your address at the tunnel** (creates the DNS record):

   ```sh
   cloudflared tunnel route dns deja-vu1 printer.example.com
   ```

6. **Run it:**

   ```sh
   cloudflared tunnel run deja-vu1
   ```

   To have it start with the machine, install it as a system service —
   Cloudflare's "run as a service" pages cover Linux, macOS and Windows.

7. **Add Cloudflare Access** for `printer.example.com` (above).

Leave the tunnel's "HTTP Host Header" option unset. Deja Vu1 checks it
either way, but unset is the default and the simplest.

### Which addresses the dashboard answers to

Deja Vu1 only answers requests addressed to a name that belongs to your own
network: an IP address, `localhost`, a plain machine name like
`raspberrypi`, or a home-network name ending in `.local`, `.lan`, `.home`,
`.home.arpa` or `.internal`. Anything else gets a "Refused" message. This
blocks a trick called *DNS rebinding*, where a web page you happen to visit
points its own domain at your dashboard's address to control it from your
browser.

Requests that `cloudflared` forwards from the same computer are recognised
and allowed, so the tunnel above works without extra set-up. If you run
`cloudflared` on a *different* computer, or reach the dashboard through some
other domain name of your own, list the name when starting the server:

```
DEJAVU_ALLOWED_HOSTS=printer.example.com python3 backend/app.py
```

(Several names can be separated with commas.)

## Live updates through the tunnel

The dashboard's live updates travel over a WebSocket. Cloudflare's
documentation says it proxies WebSocket connections; there is also a
**WebSockets** switch under **Network** in the Cloudflare dashboard for
your domain, which should be on. If the WebSocket can't get through for
any reason, the dashboard notices and switches to asking once a second
instead — the badge in the status strip then reads "Polling 1 s" rather
than "Live".

## How fast will it feel?

These are the rough figures from this project's planning, not measurements
of a real installation — how far you are from a Cloudflare location is what
matters:

| Where you are | Extra delay |
|---|---|
| Near a Cloudflare location | about 2–8 ms |
| Typical | about 15–45 ms |
| Far from any location | up to about 200 ms |

None of that is noticeable on a status dashboard. For a sense of scale: the
printer itself only reports new readings every 250 ms (a fixed Klipper
setting), and on the home network a Pause is confirmed back from the
printer in well under 100 ms (about 57 ms in this project's own browser
tests against the simulated printer).

## The camera through the tunnel

The printer's camera address is only reachable at home, so the dashboard
relays the camera's MJPEG stream itself (`/api/camera/stream`). It only
ever relays something that is actually a camera stream (an MJPEG stream or
an image), never an arbitrary web page on your network.
