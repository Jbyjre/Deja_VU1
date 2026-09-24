# Low-latency camera (optional, needs go2rtc)

The dashboard's camera normally uses **MJPEG**: a stream of still pictures,
relayed through this dashboard. It needs nothing installed and works
everywhere, but over Wi-Fi the delay can slowly build up.

**WebRTC** is what video calls use: the picture arrives with almost no
delay. Browsers can play WebRTC on their own, but the printer's camera
doesn't speak it, so something has to translate. This option uses
**[go2rtc](https://github.com/AlexxIT/go2rtc)**, a free, open-source
program that does exactly that.

> **This is one step beyond "nothing to install".** go2rtc is a separate
> program that you download, run and keep running yourself. Deja Vu1 never
> installs it, never downloads it, and works exactly as before without it.
> If go2rtc isn't running or can't connect, the dashboard goes back to
> MJPEG by itself and says so on the picture.

## What you'll see

A small label sits on the camera picture, saying which kind of feed is on:

| Label | Meaning |
|---|---|
| **Low latency · WebRTC** | The video comes from go2rtc, with almost no delay. |
| **MJPEG** | The normal feed. If WebRTC was tried and failed, a line under the picture says why, for example *"go2rtc has no stream called "u1""*. |
| **Connecting…** | WebRTC is being tried (it gives up after a few seconds). |

If the WebRTC connection drops later, it switches to MJPEG on its own.
**Reconnect** tries WebRTC again.

## Setting it up

1. **Install go2rtc** on a computer on the same network as the printer
   (a Raspberry Pi is fine). go2rtc's own instructions list a download for
   each system, a Docker image and a Home Assistant add-on:
   [go2rtc: Binary](https://github.com/AlexxIT/go2rtc#go2rtc-binary).
2. **Tell go2rtc about the printer camera.** Printer cameras send MJPEG,
   and WebRTC can't carry MJPEG, so go2rtc converts it to H.264 with
   FFmpeg. In go2rtc's `go2rtc.yaml` (or its web page at
   `http://<that computer>:1984`), add a stream. `u1` is just a name you
   choose:

   ```yaml
   streams:
     u1: ffmpeg:http://192.168.1.50/webcam/?action=stream#video=h264
   ```

   Use your camera's own MJPEG address, the same one you gave the
   dashboard. **FFmpeg is needed for this.** It comes preinstalled in
   go2rtc's Docker image and Home Assistant add-on. With the plain download,
   install FFmpeg as well.
3. **Check it in go2rtc first.** Open `http://<that computer>:1984`, find
   `u1` and play it. If it doesn't play there, it won't play in the
   dashboard either.
4. **Turn it on in Deja Vu1.** Go to **Modules & devices**, switch on
   **Low-latency camera (WebRTC)**, open **Low-latency camera** under the
   camera, and enter go2rtc's address (like `http://192.168.1.60:1984`) and
   the stream name (`u1`). Save.

## How it works (for the curious)

- The browser makes a WebRTC "offer" with its own built-in
  `RTCPeerConnection`. No extra code is loaded.
- It sends the offer to this dashboard, which passes it to go2rtc's
  WebRTC API and returns go2rtc's answer. The call, read from go2rtc's
  source code
  ([`internal/webrtc/server.go`](https://github.com/AlexxIT/go2rtc/blob/master/internal/webrtc/server.go),
  `outputWebRTC`), is:

  ```
  POST http://<go2rtc>:1984/api/webrtc?src=u1
  Content-Type: application/json
  {"type": "offer", "sdp": "v=0…"}   →   {"type": "answer", "sdp": "v=0…"}
  ```

  Because the dashboard makes this call, go2rtc needs no special
  cross-site ("CORS") setting.
- The video itself then flows **directly between go2rtc and the browser**,
  on go2rtc's WebRTC port **8555** (TCP and UDP; see
  [go2rtc's WebRTC notes](https://github.com/AlexxIT/go2rtc/blob/master/internal/webrtc/README.md)).
  So it works on your home network. Away from home (through the
  [Cloudflare Tunnel](remote-access.md)) the offer still gets through, but
  the video usually can't reach you, and the dashboard falls back to
  MJPEG. That's expected.

## Security

go2rtc's own README warns that its ports (1984, 8554, 8555) are open to
your whole local network without a password by default. Anyone on your
Wi-Fi can watch the camera through go2rtc. Only run it on a network you
trust, and see go2rtc's README for its password options.

## What has and hasn't been tested

- Tested: the dashboard's side of the signalling, against a small fake
  go2rtc that behaves like the call above (`tests/test_webrtc_camera.py`),
  including go2rtc refusing, being offline, having no such stream, and
  answering nonsense. Also tested: the browser side in headless Chromium,
  with a second browser page standing in for go2rtc. Real WebRTC video
  played, the label said "Low latency · WebRTC", and when that peer went
  away the picture switched to MJPEG by itself.
- **Not verified:** a real go2rtc install with a real printer camera.
