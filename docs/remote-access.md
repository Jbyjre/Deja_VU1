# On your phone away from home

Deja Vu1 has **no login**. Anyone who can reach the dashboard can use its
controls. Device pairing does not restrict access. Do not forward port 8000
from your router to the internet.

The computer running Deja Vu1 must stay awake and connected to the printer's
home network. Remote access only extends the phone-to-computer connection.

```text
Phone ── private encrypted connection ── computer running Deja Vu1
                                                    │
                                               home network
                                                    │
                                                U1 printer
```

## Recommended: a private Tailscale connection

Tailscale is a VPN: it gives approved devices a private network across the
internet. It's free for personal use; install it separately (Deja Vu1 does not
bundle it).

1. Install [Tailscale](https://tailscale.com/download) on the computer running
   Deja Vu1 and on your phone. Sign both into **the same** Tailscale account and
   connect.
2. On that computer, open Deja Vu1 at `http://localhost:8000` → **Settings →
   Away from home** and press **Turn on Away from home**.
3. The first time, Tailscale may ask you to switch on HTTPS for your account:
   the card shows a **Switch on HTTPS in Tailscale** button. Sign in, press
   Enable, and come back; the card notices by itself.
4. The card then shows a private `https://<computer>.<tailnet>.ts.net` address
   and a code. With Tailscale connected on the phone, point the phone's camera
   at the code. Deja Vu1 opens and pairs. On the phone, **More → Install app**
   puts it on the home screen; an https address installs without any Chrome
   setting.
5. Test it: turn the phone's Wi-Fi off, keep Tailscale connected, and open the
   app on mobile data.

What the button does: it runs Tailscale's own command,
`tailscale serve --bg --yes http://127.0.0.1:8000`, which shares the dashboard
privately with your Tailscale devices (**Serve**). It never uses **Funnel**,
Tailscale's public sharing, which would put this login-less dashboard on the
internet. Switching sharing on or off works only from the computer itself
(`localhost`), never from a phone or through the shared address. **Stop
sharing** runs `tailscale serve --https=443 off`.

Only approved devices allowed by your Tailscale access policy can reach the
address. Limit that policy to the people who may control your printers. A phone
coming through Tailscale is never treated as "this computer": Tailscale passes
on the address the phone asked for, so the optional device lock still applies.

**By hand, if you prefer:** run `tailscale serve --bg http://127.0.0.1:8000` in
Terminal (Mac/Linux) or PowerShell (Windows), follow any HTTPS link it prints,
and open the `https://…ts.net` address it shows. Check with
`tailscale serve status`; stop with `tailscale serve --https=443 off`.
[Official Serve command reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

**On Linux**, Tailscale may refuse a normal user. It then says, in its own
words, to run `sudo tailscale set --operator=$USER` once; the card shows that
message.

**Without https:** a phone with Tailscale connected can also open
`http://<the computer's 100.x.y.z address>:8000` (the card lists it under
"Without https"). It works, but Chrome can't install a plain http address as an
app.

`.ts.net` names are already allowed by Deja Vu1. HTTPS certificates can publish
the device's domain name in public certificate records; choose a neutral
machine name if that matters to you.
[Official HTTPS guidance](https://tailscale.com/docs/how-to/set-up-https-certificates).

## Your printer on another network

**How Snapmaker's own app does it.** Snapmaker's app and Snapmaker Orca bind a U1 in
one of two modes ([Snapmaker Orca quick start](https://wiki.snapmaker.com/en/snapmaker_orca/qsg),
checked 2 November 2026). In **Cloud mode** "the printer and computer are not required
to be on the same local area network": the printer keeps a connection open to
Snapmaker's servers (MQTTS, port 8883) and the app reaches it through them with your
Snapmaker account. Snapmaker's printer software shows the same design: its Moonraker
talks to a local MQTT broker, and a separate Snapmaker program handles the cloud link and
the link mode (u1-moonraker `components/client_manager.py`, "cloud" or "lan"). In **LAN
mode** the app and printer must share a network.

**How Deja Vu1 does it.** Deja Vu1 has no cloud and no account, and Snapmaker's cloud
protocol is not published, so Deja Vu1 does not use it. It reaches the printer through
networks you control, in one of these ways:

1. **Keep Deja Vu1 at home with the printer** (it starts with that computer) and open it
   from anywhere with Tailscale, as above. This is the same idea as Snapmaker's cloud:
   the side at home connects out, and nothing at home is opened to the internet.
2. **A second router, a mesh system or an extender at home:** Printers → Add a printer →
   **Look further** tries the address ranges home routers often use (as well as every
   network this computer is on). Typing the printer's address also works wherever your
   routers pass traffic between their networks.
3. **Deja Vu1 somewhere else:** install Tailscale on any computer that stays at home and
   share its home network with your tailnet (a subnet router):
   `tailscale set --advertise-routes=192.168.1.0/24` with your own range, then approve
   the route in Tailscale's admin console. **Look further** reads your tailnet
   (`tailscale status --json`) and tries the shared ranges and every online Tailscale
   device. Windows, phones and the Mac app use shared routes by themselves; on Linux run
   `tailscale set --accept-routes` on the computer with Deja Vu1. A printer on Tailscale
   itself (the Extended Firmware, below) is found the same way.

**A printer that moved.** Home routers can give a device a new address. Deja Vu1 keeps
the serial number a U1 reports (Moonraker's `machine.system_info`, also in its mDNS
announcement). When a saved printer hasn't answered for 90 seconds, Deja Vu1 looks for
that serial number (Look further's places), at most every 10 minutes, and when the same
printer answers elsewhere it switches to the new address and says so. A printer with no
serial number is never guessed at.

## The printer from anywhere (Extended Firmware)

Usually the printer stays on your home Wi-Fi and the Deja Vu1 computer stays
with it; only the phone travels. If you'd rather run Deja Vu1 on a computer
somewhere else, the community Extended Firmware can put the **printer itself**
on your Tailscale network: firmware-config → Remote Access → VPN Provider →
Tailscale (its own [VPN guide](https://github.com/paxx12/SnapmakerU1-Extended-Firmware/blob/main/docs/vpn.md)).
Its Moonraker trusts Tailscale addresses (`100.64.0.0/10`), so in Deja Vu1 add
the printer by its Tailscale address, for example `100.95.6.132` (the app adds
`:7125`). That firmware marks the VPN as experimental and warns it uses extra
processor time and memory, which may affect prints; follow its advice.

## Alternative: Cloudflare Tunnel with Access

A tunnel carries browser traffic to your computer without opening a router
port. **A tunnel alone is not a login.** Configure Cloudflare Access before
making the dashboard's hostname reachable. This option requires your own domain
and a separate Cloudflare setup; check current plans and domain costs with the
providers before choosing it.

1. In Cloudflare Zero Trust, create a **self-hosted Access application** for
   your chosen hostname, such as `printer.example.com`. Add an Allow policy for
   only your own email or approved users and choose a supported login method.
   Do not use a Bypass policy. Follow the
   [official Access setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).
2. Follow [Cloudflare's Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)
   to install its connector on the Deja Vu1 computer. Configure the protected
   hostname's service as `http://localhost:8000`. Leave the HTTP Host Header
   override unset. Use the **Protect with Access** option where available.
3. Restart Deja Vu1 with the hostname in its allowed-host list. On Mac/Linux,
   run this from the Deja Vu1 folder:

   ```sh
   DEJAVU_ALLOWED_HOSTS=printer.example.com python3 start.py
   ```

   On Windows, open **Command Prompt** in the folder:

   ```bat
   set "DEJAVU_ALLOWED_HOSTS=printer.example.com"
   py -3 start.py
   ```

   Replace the example hostname with yours. `DEJAVU_ALLOWED_HOSTS` is a startup
   setting, not an app password. It permits that address but does not verify a
   visitor's identity. Several names can be separated by commas.
4. Start the protected tunnel. From a private/incognito browser on another
   network, confirm Cloudflare asks for login **before any dashboard appears**.
   Test that an unapproved account cannot enter. Do not continue using the
   tunnel if either check fails.
5. Open your HTTPS hostname on the phone and sign in. Add that address to the
   home screen. Keep the computer, Deja Vu1 and the connector running.

The app also checks browser request origins and blocks embedding in other
websites. Those safeguards stay enabled behind a tunnel; they are not a
replacement for Access.

## Connection checks

- If local access fails, solve that first using [getting started](getting-started.md).
- “Refused” / 421 means the requested hostname is not allowed; check spelling
  and restart after changing the startup setting.
- If live updates cannot open a WebSocket (a persistent connection for new
  readings), the dashboard uses polling, which asks repeatedly for updates.
- Stock camera snapshots pass through the dashboard. The optional manually
  configured camera relay must also be reachable by the computer at home.
- No remote latency figures are promised. Connection quality, sleep settings,
  provider configuration and printer response all affect the result.

These instructions were checked against the app and official documentation.
Neither remote setup has been exercised with a real phone and U1 here.
