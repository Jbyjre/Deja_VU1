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

Farm readings come from **Demo data**. Current slicing captures also contain
estimates from actual local-engine output; these are not physical measurements.
No picture establishes a real U1 print. Keep that distinction when posting.

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
| ![What's in it](02-explainer-boards/explainer-whats-in-it.jpg)<br>**What's in it:** every feature, grouped by what it needs | ![Confirm Print](02-explainer-boards/explainer-confirm-print.jpg)<br>**Confirm Print:** the seven checks before a start |
| ![How it connects](02-explainer-boards/explainer-how-it-connects.jpg)<br>**How it connects:** one connection per printer, shared by every module | ![By the numbers](02-explainer-boards/explainer-by-the-numbers.jpg)<br>**By the numbers:** 759 tests, 250 ms updates, up to 12 printers |
| ![Silent docks](02-explainer-boards/explainer-silent-docks.jpg)<br>**Dock status:** the old lead picture. Now used only in the README's dock rings section; don't lead with it | |

## 03 · Screenshots

Older farm captures use demo data. Current `slicer-after-*` images show
preparation, profiles and preview at 1366/390 px; `slicer-recovery-1366.png`
shows isolated app-data recovery. See [validation](../docs/slicer-workspace-validation.md)
for the source of each figure and the remaining physical/platform limits.

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

The launch video, version 13 (October 2026): two new 60-second cuts, re-filmed from the current
app on the simulated farm. Version 12's two 75-second cuts are kept beside them. All are H.264
MP4 at 60 frames a second, with sound set to -16 LUFS (2 dB under the usual -14 for YouTube and
social, so the music stays light).

| File | Size | Length | Where it goes |
|---|---|---|---|
| `deja-vu1-launch-60s-16x9.mp4` | 1920 × 1080 | 60 s | YouTube, the forum, X, LinkedIn, the README or product page (version 13) |
| `deja-vu1-launch-60s-9x16.mp4` | 1080 × 1920 | 60 s | Shorts, Reels, TikTok (version 13) |
| `deja-vu1-launch-16x9.mp4` | 1920 × 1080 | 75 s | the longer version 12 cut |
| `deja-vu1-launch-9x16.mp4` | 1080 × 1920 | 75 s | the longer version 12 cut |

Version 13 is told like a product-launch film: the problem first ("Every printer has its own
screen. So you check them one by one. And miss the one that needs you."), the answer (the
windows fold into one: Deja Vu1, "One screen for every U1 you run."), how it works in one breath
(runs on your computer, talks to your U1s on your network, opens in any browser), then six
features shown working, each headline landing on its own before it steps aside for the app:
every printer live, Needs you, Confirm Print and the phone, prepare & slice, the digital twin,
automations. Then "and plenty more" (six more as screenshots), why to trust it (free and open
source, no account needed, runs on your own network, 759 automated tests) and the install lines.

Every app view is labelled "Simulated farm". The end card says every figure comes from the
simulated farm and that Deja Vu1 is not affiliated with Snapmaker. The clicks and keystrokes are
synthesised in code (the same sounds as version 11). The music is a new bright lounge-jazz tune
at 144 beats a minute with a vibraphone melody, played on recorded acoustic instruments: the
VCSL vibraphone, the VSCO 2 Community Edition upright bass and Virtuosity Drums (all CC0), and
Salamander Grand Piano by Alexander Holm (CC BY 3.0, so credit it in the post's description too:
"Piano: Salamander Grand Piano by Alexander Holm, CC BY 3.0"). It plays along with the picture: a
cymbal and the band's chord on every scene change, the tune's head under each headline, a vibes
note on every callout and card, a band hit on each value. Listen to it before posting: it was
checked by measurement, not by ear.
How to change or re-film it: `promo-video/README.md`.

## 08 · Feature cards

Cards from version 13's 60-second cut. One card per beat of the story, taken from the finished
video at the moment its words are on screen. Each comes in two shapes: `-16x9.jpg` (1920 × 1080:
README, forum posts, X, LinkedIn) and `-9x16.jpg` (1080 × 1920: Instagram and TikTok stories).
13 cards, 26 files.

| Card | Shows |
|---|---|
| `00-the-problem` | "And miss the one that needs you." Six separate printer windows, one flagging a problem (an illustration) |
| `00-the-answer` | The app icon, "Deja Vu1" and "One screen for every U1 you run." |
| `01-how-it-works` | The laptop with the app, three printers and a phone joined by the network, three chips |
| `02-every-printer-live` | The 27-printer sandbox farm on the laptop, one card's progress and finish time called out |
| `03-needs-you` | A filament jam arriving at the top of Needs you |
| `04-confirm-print` | A print started after every check, confirmed by the printer |
| `04b-on-your-phone` | The phone layout in front of the laptop |
| `05-prepare-and-slice` | A part duplicated, the copy on head T1, arranged on the U1 plate |
| `06-digital-twin` | The live engineering drawing, front and top views |
| `07-automations` | A ready-made rule saved, on the laptop |
| `08-and-plenty-more` | Maintenance, filament, skip one object, Home Assistant, games, 29 modules |
| `09-why-trust-it` | Free and open source, no account needed, runs on your own network, 759 automated tests |
| `10-get-it` | The end card: the three install lines |

Remade with `promo-video/build/stills.sh` after any change to the video.

---

## Keeping it current

The pictures here are copies. When the app changes, regenerate the
originals as `tools/readme-images/README.md` describes, then copy them here
again (or ask a Claude Code session to "refresh the marketing library").


Boards, social cards, current slicing captures, both launch videos and the feature cards
were refreshed. Older editorial feature crops still need a final pass. Follow
[the capture guide](../tools/readme-images/README.md) and
[video guide](../promo-video/README.md) before replacing them.

`05-animation/slicer-preview.gif` shows current browser layer controls using simulated demo files. It does not replace the launch videos.
