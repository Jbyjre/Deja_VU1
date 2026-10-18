// Loads a built composition and prints the music cues scene.js recorded (window.__cues) as JSON.
// Usage: node cues.js path/to/index.html main|vertical
const { chromium } = require('playwright');
(async () => {
  const [file, fmt] = process.argv.slice(2);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: fmt === 'main' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 } });
  await p.addInitScript(() => { window.__timelines = {}; });
  await p.route('**/*.{mp4,wav}', r => r.abort());          // the media aren't needed for the timing
  await p.goto('file://' + require('path').resolve(file), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__cues && window.__cues.length, null, { timeout: 30000 });
  process.stdout.write(JSON.stringify(await p.evaluate(() => window.__cues)));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
