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

---

## Keeping it current

The pictures here are copies. When the app changes, regenerate the
originals as `tools/readme-images/README.md` describes, then copy them here
again (or ask a Claude Code session to "refresh the marketing library").
