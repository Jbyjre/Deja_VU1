# Marketing library

> **Temporary. Delete this whole folder before the launch post.** It is a
> working copy of every picture Deja Vu1 uses or could use, gathered in one
> place so they are easy to find, look at and download. The originals the
> README and product page actually use live in `docs/img/` and
> `frontend/img/`; nothing in the app reads from this folder, so deleting it
> breaks nothing.

Open any folder on GitHub to see its pictures; tap one, then **Download**
(or the ⋯ menu → Download) to save it. To download everything at once, use
**Code → Download ZIP** on the repository's main page and open the
`marketing-library` folder inside the ZIP.

Every figure in every picture comes from the built-in simulated farm (the
**Demo data** switch). None of it is from a real U1 yet; say so wherever you
post them.

What to say about the project, in what order, and which claims are safe:
**[MESSAGING.md](MESSAGING.md)**.

---

## 01 · Main image

The picture that appears when someone shares a link to the project.

| File | Size | Where it goes |
|---|---|---|
| `link-preview-card-1200x630.png` | 1200 × 630 | Already in use: `frontend/img/social-card.png` (the product page and dashboard link previews) and the top of the README |
| `github-social-preview-1280x640.png` | 1280 × 640 | **Not in use yet.** Upload it on GitHub: on the repository's page, **Settings**, then under **Social preview** click **Edit → Upload an image** (GitHub's limit: under 1 MB). GitHub's own link previews then show it |

![The link-preview card: "One screen for every U1 you run."](01-main-image/link-preview-card-1200x630.png)

## 02 · Explainer boards

Illustrations that explain one idea each. Rendered from
`tools/readme-images/boards.html`.

| | |
|---|---|
| ![What's in it](02-explainer-boards/explainer-whats-in-it.jpg)<br>**What's in it:** every module, grouped by what it needs | ![Confirm Print](02-explainer-boards/explainer-confirm-print.jpg)<br>**Confirm Print:** the six checks before a start |
| ![How it connects](02-explainer-boards/explainer-how-it-connects.jpg)<br>**How it connects:** one connection per printer, shared by every module | ![By the numbers](02-explainer-boards/explainer-by-the-numbers.jpg)<br>**By the numbers:** 608 tests, 250 ms updates, 12 printers… |
| ![Silent docks](02-explainer-boards/explainer-silent-docks.jpg)<br>**Dock status:** the old lead picture. Now used only in the README's dock rings section; don't lead with it | |

## 03 · Screenshots

Captured from the app with demo data on.

| | |
|---|---|
| ![Overview](03-screenshots/overview.jpg)<br>**Overview:** status ribbon, Needs you, totals | ![Fleet](03-screenshots/fleet.jpg)<br>**Fleet:** every printer at a glance |
| ![Confirm print refused](03-screenshots/confirm-print-refused.jpg)<br>**Confirm Print refusing an unsafe file** | ![File detail](03-screenshots/file-detail.jpg)<br>**A G-code file in 3D** with its pre-flight verdict |
| ![Skip object](03-screenshots/skip-object.jpg)<br>**Skip one object** | ![Converter](03-screenshots/converter.jpg)<br>**MakerWorld project converted for the U1** |
| ![Files](03-screenshots/files.jpg)<br>**File library and queue** | ![Automations](03-screenshots/automations.jpg)<br>**Automations:** when this happens, do that |
| ![Twin, health, chamber](03-screenshots/twin-health-chamber.jpg)<br>**Digital twin, print health, chamber climate** | ![Control](03-screenshots/control.jpg)<br>**Control:** pause, temperatures, home, console |
| ![Photo studio](03-screenshots/photo-studio.jpg)<br>**Photo-to-Print Studio** | ![Care](03-screenshots/care.jpg)<br>**Care:** maintenance tasks |
| ![Sandbox](03-screenshots/sandbox.jpg)<br>**Farm sandbox:** scripted problems | ![Sandbox farm](03-screenshots/sandbox-farm.jpg)<br>**The three built-in printers and sandbox ones, side by side** |
| ![Modules](03-screenshots/modules.jpg)<br>**Modules:** switch features on and off | ![Dock rings](03-screenshots/dock-rings.jpg)<br>**Dock status rings** (hardware pending) |
| ![Games](03-screenshots/games.jpg)<br>**Games** | ![Phone](03-screenshots/phone.jpg)<br>**On a phone** |

The product page uses its own crops: `product-page-overview.jpg`,
`product-page-fleet.jpg`, `product-page-phone.jpg`.

## 04 · Digital twin

The live engineering drawing, the most distinctive picture the app has.
Captured fresh for this library.

| | |
|---|---|
| ![3D](04-digital-twin/twin-3d-printing.jpg)<br>**3D view, printing:** T2 on the carriage, three parts on the plate | ![Front](04-digital-twin/twin-front-printing.jpg)<br>**Front view:** reads like a drawing sheet |
| ![Top](04-digital-twin/twin-top-printing.jpg)<br>**Top view:** the nozzle's trail around the parts | ![Dock fault](04-digital-twin/twin-3d-dock-fault.jpg)<br>**Idle, with a fault on T3's dock** |
| ![Phone](04-digital-twin/twin-phone.jpg)<br>**On a phone** | |

## 05 · Animation

![Live jam](05-animation/live-jam.gif)

`live-jam.gif`: a filament jam fired from the farm sandbox. The status
ribbon turns to an error and the jam goes to the top of **Needs you**.

## 06 · App icon

`icon.svg` (any size), `icon-512.png`, and `icon-maskable-512.png` (the
version phones crop into a circle or rounded square).

<img src="06-app-icon/icon-512.png" width="96" alt="The Deja Vu1 icon">

## 07 · Videos

The launch video (version 9), filmed from the current app with demo data on, in two
cuts of 75 seconds each. Both are H.264 MP4 at 60 frames a second, with sound set to
-16 LUFS (2 dB under the usual -14 for YouTube and social, so the music stays light).

| File | Size | Length | Where it goes |
|---|---|---|---|
| `deja-vu1-launch-16x9.mp4` | 1920 × 1080 | 75 s | YouTube, the forum, X, LinkedIn, the README or product page |
| `deja-vu1-launch-9x16.mp4` | 1080 × 1920 | 75 s | Shorts, Reels, TikTok |

It's a SaaS-style promo that moves fast but stays easy to follow. It opens on what the app is
for ("Run your 3D printers from one screen." and three promises: watch every print live, check
every file before it prints, know the moment one needs you), then the name, then twelve
features in turn. Each has a short glass caption (the feature's icon, a headline, a
few words) and one or two callouts pointing at the thing that matters. About half are shown
on a 3D laptop (or the phone), the rest full screen. One quick camera move links each to the
next, and every move lands on a bar line of the music. The features: every printer live,
Needs you, Confirm Print (and the phone), projects converted for the U1, Skip one object,
the digital twin, automations, maintenance, filament and Spoolman, print cost, Home
Assistant and ten games. Then the values, one per beat, and the install lines typed out.
Time-lapse, AR preview and the Photo-to-Print Studio are not in this version.

Every app view is labelled "Simulated farm". The end card says every figure comes from
the simulated farm and that Deja Vu1 is not affiliated with Snapmaker. The music and every
click and keystroke are original, synthesised in code, with no third-party audio. The music
is a bright, up-tempo jazz trio (piano, upright bass, drums) at 160 beats a minute that plays
along with the picture: a drum fill and a cymbal on every scene change, a piano note on every
label that pops up, a band hit on each closing value. Listen to it before posting: it was checked by measurement, not by ear.
How to change or re-film it: `promo-video/README.md`.

## 08 · Feature cards

One card per feature of the launch video, taken from the finished video at the moment its
caption and callouts are on screen, plus the icon opening, a title card and an end card.
Each comes in two shapes: `-16x9.jpg` (1920 × 1080: README, forum posts, X, LinkedIn) and
`-9x16.jpg` (1080 × 1920: Instagram and TikTok stories). 16 cards, 32 files.

| Card | Shows |
|---|---|
| `00-what-it-is-for` | The opening: "Run your 3D printers from one screen." and three promises |
| `00-title` | The app icon, "Deja Vu1" and "One screen for every U1 you run." |
| `01-every-printer-live` | The 27-printer sandbox farm on the laptop, one card's progress and finish time called out |
| `02-needs-you` | A filament jam arriving at the top of Needs you |
| `03-confirm-print` | A print started after every check, confirmed by the printer |
| `03b-on-your-phone` | The phone layout in front of the laptop |
| `04-files-for-the-u1` | A MakerWorld (Bambu Studio) project converted for the U1 |
| `05-skip-one-object` | One part skipped, the rest still printing |
| `06-digital-twin` | The live engineering drawing, front and top views |
| `07-automations` | A ready-made rule saved, on the laptop |
| `08-maintenance` | An overdue task marked done |
| `09-filament-and-spoolman` | Spools, and prints left on each |
| `10-print-cost` | The running print's cost so far |
| `11-home-assistant` | The bridge's address typed in, the sensors it sends |
| `12-ten-games` | Sky Dash being played |
| `13-get-it` | The end card: the three install lines |

Remade with `promo-video/build/stills.sh` after any change to the video.

---

## Keeping it current

The pictures here are copies. When the app changes, regenerate the
originals as `tools/readme-images/README.md` describes, then copy them here
again (or ask a Claude Code session to "refresh the marketing library").
