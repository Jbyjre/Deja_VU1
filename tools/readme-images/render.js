// Renders the README explainer boards and the social card from the HTML in
// this folder. Needs Playwright with a Chromium (not a dependency of
// Deja Vu1 itself). Run from the repository root:
//   node tools/readme-images/render.js
// Writes PNGs into tools/readme-images/out/; resize and copy them as
// described in README.md in this folder.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const here = __dirname;
const out = path.join(here, 'out');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(here, 'boards.html'));
  await page.evaluate(() => document.fonts.ready);
  for (const id of ['b-problem', 'b-confirm', 'b-arch', 'b-features', 'b-numbers']) {
    await page.locator('#' + id).screenshot({ path: path.join(out, id + '.png') });
    console.log('wrote', id + '.png');
  }
  for (const [w, h] of [[1200, 630], [1280, 640]]) {
    const card = await browser.newPage({ viewport: { width: w, height: h } });
    await card.goto('file://' + path.join(here, 'card.html') + `?w=${w}&h=${h}`);
    await card.evaluate(() => document.fonts.ready);
    await card.screenshot({ path: path.join(out, `card-${w}x${h}.png`) });
    console.log(`wrote card-${w}x${h}.png`);
  }
  await browser.close();
})();
