# Public copy and image review

Review build, 23 October 2026. The product page, README, metadata, share card,
editorial screenshots, explainer boards and campaign copy now use consistent
claims. The landing page matches the dashboard’s blue accent and gives the
preparation workspace and twin dedicated images.

| Material | Location |
|---|---|
| Product page | `frontend/welcome.html` |
| Share card | `frontend/img/social-card.png` |
| Campaign | [18 cards, captions and alternatives](../marketing-library/09-current-campaign/) |
| Descriptions and posts | [Copy ready for review](../marketing-library/COPY.md) |
| Claim limits | [Project messaging](../marketing-library/MESSAGING.md) |
| Capture evidence | [Capture record](../marketing-library/capture-record.json) |
| Copy consistency | [Asset paths and hashes](../marketing-library/current-assets.json) |
| Reproduction | [Capture/render guide](../tools/readme-images/README.md) |

## Browser review

Current product page at 1366 px:

![Product page at 1366 px: blue accent, concrete introduction, demo and setup links, and the current dashboard image](img/marketing-page-1366.png)

Current product page at 390 px:

<img src="img/marketing-page-390.png" width="390" alt="Product page at 390 px: wrapped headline, readable introduction and separate demo, setup and code links">

The browser check passed at both widths: local images decode, section links
resolve, the demo button opens the recorded farm, no horizontal overflow and
no uncaught JavaScript errors. The separate static-demo check passed G-code
layer navigation, three-plate choices and the refusal of writes that require
the local app. These are Chromium viewport checks, not real-phone tests.

The campaign renderer checked all 18 output sizes for missing images and
out-of-bounds copy. Visual review checked their composition and evidence labels;
these automated bounds checks are not an accessibility certification.

## Software validation

- `python3 -m unittest discover tests`: **771 passed in 134.189 seconds**,
  Python 3.12.14/Linux, app/demo servers stopped.
- Two focused API asset checks passed: shipped page assets and bundled share-card
  URL/type/dimensions.
- `check-marketing.js` and `tools/check-static-demo.js`: desktop and phone checks
  passed with no page errors or horizontal overflow.
- `git diff --check`: passed.

No new engine run or physical printer test was performed. Historical Linux
engine captures retain that provenance. Current farm imagery uses an isolated
simulator; Add a printer uses a source-based stand-in Moonraker on loopback.
The twin remains a software model with partly estimated geometry.

## Review boundaries

The repository description, GitHub social-preview candidate, Phase 2 description
and social/video posts are supplied as reviewable files. No repository settings,
application form or social account was changed. Existing version 12–15 films and
icons are retained. The library separates these historical films/cards from the
current standalone campaign. No detector, conversion uplift or award-score
measurement is claimed. No merge is authorized by this review.
