# View on your desk (AR)

Open an STL or 3MF file in **Files** and, on a phone that supports it,
tap **View on your desk**. The phone's camera opens, you point it at a
table, and you tap to place the model there **at its real printed size**.
It helps you check how big a print will actually be before you spend hours
printing it.

**Works on Android/WebXR browsers; iOS Safari has no equivalent.**

## Where it works

It uses **WebXR**, the browser's built-in AR, with its "hit test" feature
for finding flat surfaces. That means:

- **Android:** Chrome and other WebXR browsers on phones that support
  Google's AR (ARCore). *Which phones qualify was not verified here: Google's
  developer pages couldn't be reached from this build environment.*
- **iPhone / iPad:** not available. Safari has no WebXR AR, and there
  is no drop-in replacement that works without extra apps.
- **Desktop computers:** not available (no camera AR).
- **A secure address is required.** The WebXR standard marks `navigator.xr`
  as `[SecureContext]`
  ([WebXR spec source](https://github.com/immersive-web/webxr/blob/main/index.bs)).
  In practice, browsers only allow WebXR on `https://`
  addresses or on the computer running the dashboard itself. On your home
  network the dashboard is plain `http://`, so AR won't start there. Through
  the [Cloudflare Tunnel](remote-access.md) it's `https://`, so AR is allowed to
  start (not verified on a device).

The button only appears when the browser says it can do AR. Everywhere
else, the file page says in one line why it isn't available.

It can be switched off in **Modules & devices → View on your desk (AR)**.

## How it works

- It uses the **same geometry** the 3D viewer already reads from the file
  (`DV3D.parseModel` in `frontend/viewer3d.js`). Nothing is uploaded or
  converted.
- Printer files are in millimetres with Z pointing up. AR works in metres
  with Y pointing up. `frontend/ar.js` converts one to the other and stands
  the model on its base, centred where you tap.
- It asks for an `immersive-ar` session
  ([WebXR AR module](https://github.com/immersive-web/webxr-ar-module/blob/main/index.bs))
  with the `hit-test` feature
  ([hit test module](https://github.com/immersive-web/hit-test/blob/main/index.bs)), and
  optionally `dom-overlay`
  ([DOM overlays module](https://github.com/immersive-web/dom-overlays/blob/main/index.bs)) for the glass bar at the bottom (the status line
  and **Done**). A white ring shows where the model will land; tap to place
  it, tap again to move it.
- It's drawn with plain WebGL. No 3D library is added.

## What has and hasn't been tested

- Tested in headless Chromium: without AR support, the button stays hidden
  and the explanation shows. The AR module can be switched off. There are
  no page errors.
- Tested with a **stand-in for a phone's WebXR** injected into the page.
  The session asks for `hit-test` and `dom-overlay`, the ring and then the
  model are really drawn (pixels checked), the placed size reads
  3.0 × 4.0 × 2.5 cm for the 30 × 40 × 25 mm sample bracket, and **Done**
  ends the session cleanly. This ran at desktop and phone sizes, with
  touch.
- **Not verified on a device.** No real Android phone was available, so it
  has never run on real AR hardware.
