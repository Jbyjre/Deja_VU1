#!/usr/bin/env node
/* Where the page freezes, by screen: the stretches the main thread was busy for over 200 ms (the page cannot respond during them)
 * and the code that ran, from Chrome's CPU profile.
 *
 *   node tools/freeze-profile.js                        every main screen, 8 seconds each, with demo data
 *   node tools/freeze-profile.js --screens control,library --secs 12
 *   node tools/freeze-profile.js --no-demo              the screens as they are with no printer
 *   node tools/freeze-profile.js --json                 the numbers as data
 *   node tools/freeze-profile.js --probe                only says whether Playwright and a Chromium are available
 *
 * It starts Deja Vu1 (backend/app.py) on a spare port in a temporary data folder, opens each screen in a fresh page and lets it
 * run, counting long tasks (the browser's own measure of a freeze) and sampling the main thread. For each screen it prints the long
 * tasks (how many, how long in all, the longest) and the ten functions that spent the most time themselves. A software-rendered
 * browser (a computer with no graphics card, and this tool's usual home) is slower than a real one, so read the ranking and the
 * counts against each other, not as the figures a person with a graphics card would see.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const SCREENS = { overview: 'overview', printers: 'fleet', control: 'control', library: 'library', modules: 'modules', maintenance: 'care' };

function findChromium(playwright) {
  const candidates = [process.env.DEJAVU_BROWSER, '/usr/bin/chromium', '/opt/pw-browsers/chromium', '/usr/bin/chromium-browser'];
  try {
    candidates.push(playwright.chromium.executablePath());
  } catch (e) {
    /* no bundled browser */
  }
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const get = url =>
  new Promise((resolve, reject) => {
    http
      .get(url, res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startServer() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-freeze-'));
  const env = { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1', DEJAVU_TESTER: '0' };
  const child = spawn('python3', [path.join(ROOT, 'backend', 'app.py')], { cwd: ROOT, env, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await get(base + '/api/health')).status === 200) return { base, child };
    } catch (e) {
      /* not up yet */
    }
    await sleep(200);
  }
  child.kill();
  throw new Error('The server did not answer /api/health within 20 seconds');
}

/* Self time per function from a CPU profile: the time the main thread spent in a function's own code, not in what it called. */
function selfTimes(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map();
  const deltas = profile.timeDeltas || [];
  (profile.samples || []).forEach((id, i) => self.set(id, (self.get(id) || 0) + (deltas[i] || 0)));
  const byName = new Map();
  for (const [id, micros] of self) {
    const n = byId.get(id);
    const f = n.callFrame;
    if (f.functionName === '(idle)' || f.functionName === '(program)' || f.functionName === '(garbage collector)') {
      const key = f.functionName;
      byName.set(key, (byName.get(key) || 0) + micros);
      continue;
    }
    const file = (f.url || '').split('/').pop() || '(native)';
    const key = (f.functionName || '(anonymous)') + ' ' + file + ':' + (f.lineNumber + 1);
    byName.set(key, (byName.get(key) || 0) + micros);
  }
  return [...byName.entries()].map(([name, micros]) => ({ name, ms: Math.round(micros / 1000) })).sort((a, b) => b.ms - a.ms);
}

/* Inclusive time per function: the time spent in it and in everything it called, so the entry point of a long task shows up. */
function inclusiveTimes(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map();
  const deltas = profile.timeDeltas || [];
  (profile.samples || []).forEach((id, i) => self.set(id, (self.get(id) || 0) + (deltas[i] || 0)));
  const total = new Map();
  const walk = id => {
    if (total.has(id)) return total.get(id);
    const n = byId.get(id);
    let t = self.get(id) || 0;
    (n.children || []).forEach(c => { t += walk(c); });
    total.set(id, t);
    return t;
  };
  profile.nodes.forEach(n => walk(n.id));
  const byName = new Map();
  for (const n of profile.nodes) {
    const f = n.callFrame;
    if (!f.functionName || /^\((root|idle|program|garbage collector)\)$/.test(f.functionName) || !f.url) continue;
    const key = f.functionName + ' ' + (f.url.split('/').pop()) + ':' + (f.lineNumber + 1);
    byName.set(key, Math.max(byName.get(key) || 0, total.get(n.id)));
  }
  return [...byName.entries()].map(([name, micros]) => ({ name, ms: Math.round(micros / 1000) })).sort((a, b) => b.ms - a.ms);
}

async function profileScreen(browser, base, screen, tab, secs, demo) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 800 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    try { localStorage.setItem('dejavu1.setup-seen', '1'); } catch (e) { /* no storage */ }
    window.__long = [];
    try {
      new PerformanceObserver(list => list.getEntries().forEach(e => window.__long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) }))).observe({ type: 'longtask', buffered: true });
    } catch (e) { /* not supported */ }
  });
  const page = await context.newPage();
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Workshop && typeof showTab === 'function' && document.readyState === 'complete', null, { timeout: 30000 });
  if (demo) {
    await page.evaluate(() => showTab('modules'));
    await sleep(500);
    await page.evaluate(() => document.querySelector('label[for=demo-toggle]').click()).catch(() => {});
    await sleep(1500);
  }
  await page.evaluate(() => { window.__long.length = 0; });
  const client = await context.newCDPSession(page);
  await client.send('Profiler.enable');
  await client.send('Profiler.setSamplingInterval', { interval: 400 });
  await client.send('Profiler.start');
  await page.evaluate(t => showTab(t), tab);
  await sleep(secs * 1000);
  const { profile } = await client.send('Profiler.stop');
  const long = await page.evaluate(() => window.__long.slice());
  await context.close();
  return {
    screen,
    long: { count: long.length, total_ms: long.reduce((a, b) => a + b.ms, 0), longest_ms: Math.max(0, ...long.map(l => l.ms)), list: long.slice(0, 20) },
    top: selfTimes(profile).filter(x => !/^\((idle|program)\)/.test(x.name)).slice(0, 10),
    entry_points: inclusiveTimes(profile).slice(0, 14),
    native: selfTimes(profile).filter(x => /^\((program|garbage collector)\)/.test(x.name))
  };
}

async function main() {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (e) {
    console.error('Playwright for Node is not installed');
    process.exit(2);
  }
  const executablePath = findChromium(playwright);
  if (!executablePath) {
    console.error('No Chromium found (set DEJAVU_BROWSER)');
    process.exit(2);
  }
  if (flag('--probe')) process.exit(0);
  const wanted = option('--screens', Object.keys(SCREENS).join(',')).split(',');
  const secs = Number(option('--secs', '8'));
  const demo = !flag('--no-demo');
  const browser = await playwright.chromium.launch({ executablePath, args: ['--no-sandbox'] });
  const server = await startServer();
  const out = [];
  try {
    for (const screen of wanted) {
      if (!SCREENS[screen]) throw new Error('unknown screen ' + screen + ' (try ' + Object.keys(SCREENS).join(', ') + ')');
      out.push(await profileScreen(browser, server.base, screen, SCREENS[screen], secs, demo));
    }
  } finally {
    await browser.close();
    server.child.kill();
  }
  if (flag('--json')) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  for (const r of out) {
    console.log('\n== ' + r.screen + ': ' + r.long.count + ' freezes over 200 ms, ' + r.long.total_ms + ' ms in all, longest ' + r.long.longest_ms + ' ms');
    r.top.forEach(t => console.log('   ' + String(t.ms).padStart(6) + ' ms  ' + t.name));
    console.log('   the most time in a function and what it called:');
    r.entry_points.forEach(t => console.log('   ' + String(t.ms).padStart(6) + ' ms  ' + t.name));
    if (r.native.length) console.log('   not in the page\'s own code: ' + r.native.map(n => n.name + ' ' + n.ms + ' ms').join(', '));
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
