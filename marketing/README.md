# Marketing library

Finished, ready-to-post marketing assets for Deja Vu1. Each entry says what it
is, where it came from, and what it may and may not be used to claim.

Nothing in this folder is part of the app or the public site: Cloudflare
publishes only `frontend/` (see `wrangler.jsonc`). The repository itself is
public, so anything committed here can be downloaded by anyone.

## Videos

| File | Format | Length | Use it for |
|---|---|---|---|
| [`videos/deja-vu1-launch-16x9.mp4`](videos/deja-vu1-launch-16x9.mp4) | 16:9, 1920 × 1080, 60 fps, H.264 + AAC, -14 LUFS | 60 s | YouTube, the forum, the README or product page, X, LinkedIn |
| [`videos/deja-vu1-launch-9x16.mp4`](videos/deja-vu1-launch-9x16.mp4) | 9:16, 1080 × 1920, 60 fps, H.264 + AAC, -14 LUFS | 40 s | Shorts, Reels, TikTok |

Made October 2026 (version 2, after the owner asked for faster pacing, smoother
motion, a laptop presentation and clearer words). How they were made, and how to
rebuild or change them: [`promo-video/README.md`](../promo-video/README.md).

**Story, main cut:** "Four toolheads. Which one is ready? Deja Vu1 tells you." →
logo → Needs you, then a jam arriving live → Confirm Print refusing the unsafe
sample file → 27-printer fleet, Pause all, each printer's result → 3D toolpath and
digital twin → phone layout → Photo-to-Print Studio, MakerWorld → U1, Automations,
Maintenance, Games → "And there's more" feature chips → Free / Open source / Runs
on your own network / No account / Just Python → end card with the three install
lines, licence, and two honesty lines. The vertical cut tells the same story in
40 s, with the phone scene given more room and a shorter montage.

**Honesty, built in:**
- Every app view is the built-in simulated farm, and is labelled "Simulated farm".
  The end card says every figure comes from the simulated farm, and that Deja Vu1
  is independent and not affiliated with Snapmaker. No Snapmaker logo appears.
- Deja Vu1 has never connected to a real U1. Don't caption or post these videos in
  a way that implies it has (for example "running on my U1").
- The filament jam in the Needs you scene was fired from the farm sandbox; the
  caption says so.

**Music and sound:** original, synthesised from scratch in code
(`promo-video/music/compose2.py` and `sfx.py`): no samples, loops, stock tracks
or third-party audio, so there is no outside licence. The music was checked with
loudness measurements and spectrograms, not by ear.

**Fonts and code:** the app's own fonts (Bricolage Grotesque, Instrument Sans, IBM
Plex Mono, SIL Open Font License). Rendered with HyperFrames 0.8.166 (Apache 2.0)
and GSAP 3.14.2 (GreenSock standard licence).

## Other assets elsewhere in the repo

- `frontend/img/social-card.png`: the 1200 × 630 link-preview card.
- `docs/img/`: README screenshots, five explainer boards and a GIF, all from the
  simulated farm. `tools/readme-images/README.md` says how each was made.
