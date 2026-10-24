# Credits

Deja Vu1 is its own code (MIT licence, see [LICENSE](LICENSE)). It works
alongside, talks to, or ships a few things made by others. They are listed
here with what Deja Vu1 does with each.

## Talked to, never copied

- **Moonraker** (Arksine/moonraker, GPL-3.0) and **Klipper**
  (Klipper3d/klipper, GPL-3.0), and Snapmaker's U1 builds of them
  (Snapmaker/u1-moonraker, Snapmaker/u1-klipper). Deja Vu1 talks to a
  printer through Moonraker's published web API. Its own client
  (`backend/moonraker_client.py`) and the stand-in printer used by the tests
  (`tests/fake_moonraker.py`) were written from reading that source and its
  documentation; no code was copied. The G-code pre-flight reads lines the
  way Klipper does, written from reading Klipper's tokeniser.
- **OrcaSlicer** (SoftFever/OrcaSlicer, AGPL-3.0) and **Snapmaker Orca**
  (Snapmaker/OrcaSlicer, AGPL-3.0). Used as an external slicing engine that
  you install yourself; nothing of either is bundled. Facts about the U1
  (plate size, nozzle layer limits, preset folder names and file formats)
  were read from their profiles and source; no files were copied.

## Shipped with Deja Vu1

- **3DBenchy** by Creative Tools (3dbenchy.com), public domain (CC0) since
  February 2025. The sample model and the two-colour sample prints are cut
  from it (`backend/sample_assets/3dbenchy.stl`, reduced to 60,000
  triangles).
- **Fonts**: Bricolage Grotesque, Instrument Sans and IBM Plex Mono, under
  the SIL Open Font License; their licences are beside them in
  `frontend/fonts/`.

## Names

Snapmaker and U1 are Snapmaker's names. Deja Vu1 is an independent project,
not made or endorsed by Snapmaker. The digital twin is drawn from
Snapmaker's published product picture and specifications; where a size is
estimated, the app says so.

## How it was made

Deja Vu1 is written with the help of an AI coding assistant (Claude), working
from the owner's direction; `CLAUDE.md` holds the working notes those
sessions follow. Every claim in the app and README is meant to be checkable:
Settings → About → "Check it yourself" runs a set of real checks in your own
copy, and the full test suite runs with `python3 -m unittest discover tests`.
