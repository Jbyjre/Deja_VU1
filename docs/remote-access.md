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
internet. Install it separately; Deja Vu1 does not bundle or configure it.

1. Install [Tailscale](https://tailscale.com/download) on the computer running
   Deja Vu1 and on your phone. Sign both into your own Tailscale account and
   complete any device approval your account requires.
2. Start Deja Vu1 with its launcher. Confirm `http://localhost:8000` opens on
   that computer.
3. In Terminal (Mac/Linux) or PowerShell (Windows) on that computer, run:

   ```sh
   tailscale serve --bg http://127.0.0.1:8000
   ```

4. Follow Tailscale's displayed setup link if it asks you to enable HTTPS.
   Copy the resulting `https://…ts.net` address. **Use Serve**, which is private
   to your Tailscale network. Funnel is a separate public-sharing feature and
   is unsuitable for this app without added authentication.
5. On the phone, connect Tailscale, turn Wi-Fi off briefly to test mobile data,
   and open that HTTPS address. Only approved devices allowed by your Tailscale
   access policy should be able to reach it. Limit that policy to the people
   who may control your printers.
6. Add this HTTPS address to the home screen using Safari or Chrome. Keep
   Tailscale connected when you use it away from home. Turn Wi-Fi back on after
   testing if you normally use it at home.

`.ts.net` names are already allowed by Deja Vu1. Check the setup with
`tailscale serve status`; to stop sharing, use `tailscale serve --https=443 off`.
This stops the HTTPS sharing configured above, not Deja Vu1 itself.
[Official Serve command reference](https://tailscale.com/docs/reference/tailscale-cli/serve).

HTTPS certificates can publish the device's domain name in public certificate
records; choose a neutral machine name if that matters to you.
[Official HTTPS guidance](https://tailscale.com/docs/how-to/set-up-https-certificates).

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
