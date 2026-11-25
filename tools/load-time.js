#!/usr/bin/env node
/* How long Deja Vu1 takes to start and to open, and how much the page downloads.
 *
 *   node tools/load-time.js            the server's start, then the dashboard on this computer and on a phone-like link
 *   node tools/load-time.js --json     the numbers as data
 *
 * It starts Deja Vu1 (backend/app.py) on a spare port in a temporary data folder and counts the time until it answers. Then it
 * opens the dashboard in Chromium three ways: straight (this computer), slowed to a home Wi-Fi link (30 Mbit/s, 30 ms each way,
 * the way a phone reaches it) with nothing cached, and the same link again with the browser's cache (a second visit). The phone runs
 * use this computer's network address rather than localhost, as a phone would, since the server compresses files only for another
 * device (with no network address they fall back to localhost and say so). For each it
 * gives the number of requests, the bytes sent over the wire, when the page could be used (DOMContentLoaded), when every file had
 * arrived (load) and when the live feed first answered. A software-rendered browser is slower than a real one, so compare runs
 * of this tool with each other, not with a person's own computer.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const asJson = process.argv.includes('--json');

function sparePort() {
  return new Promise(done => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => done(p)); });
  });
}
function alive(port) {
  return new Promise(done => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/app/alive', timeout: 500 }, res => { res.resume(); done(res.statusCode === 200); });
    req.on('error', () => done(false));
    req.on('timeout', () => { req.destroy(); done(false); });
  });
}

async function main() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (_) { console.log('Playwright is not installed here.'); process.exit(2); }
  const port = await sparePort();
  const lan = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal);
  const far = lan ? lan.address : '127.0.0.1';
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-load-'));
  const env = { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1', DEJAVU_TESTER: '0', DEJAVU_ALLOWED_HOSTS: far };
  const t0 = Date.now();
  const child = spawn('python3', [path.join(ROOT, 'backend', 'app.py')], { cwd: ROOT, env, stdio: 'ignore' });
  let started = null;
  for (let i = 0; i < 300 && started == null; i++) {
    if (await alive(port)) started = Date.now() - t0;
    else await new Promise(r => setTimeout(r, 50));
  }
  const out = { server_start_ms: started, runs: [] };
  const browser = await chromium.launch({ executablePath: process.env.DEJAVU_BROWSER || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    let bytes = 0, requests = 0;
    cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; requests += 1; });
    const near = `http://127.0.0.1:${port}/?dashboard&nointro`, away = `http://${far}:${port}/?dashboard&nointro`;
    const ways = [
      { name: 'this computer, first visit', link: null, cache: false },
      { name: 'phone on home Wi-Fi, first visit', link: { latency: 60, downloadThroughput: 30e6 / 8, uploadThroughput: 10e6 / 8 }, cache: false },
      { name: 'phone on home Wi-Fi, second visit', link: { latency: 60, downloadThroughput: 30e6 / 8, uploadThroughput: 10e6 / 8 }, cache: true }
    ];
    for (const way of ways) {
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: !way.cache });
      if (!way.cache) await cdp.send('Network.clearBrowserCache');
      await cdp.send('Network.emulateNetworkConditions', way.link ? { offline: false, ...way.link } : { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      bytes = 0;
      requests = 0;
      const start = Date.now();
      const live = page.waitForEvent('websocket', { timeout: 60000 }).then(ws => ws.waitForEvent('framereceived', { timeout: 60000 })).then(() => Date.now() - start).catch(() => null);
      await page.goto(way.link ? away : near, { waitUntil: 'load', timeout: 120000 });
      const timing = await page.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0];
        return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) };
      });
      const liveMs = await live;
      await page.waitForTimeout(1500);
      out.runs.push({ way: way.name, requests, kilobytes: Math.round(bytes / 1024), usable_ms: timing.dcl, all_files_ms: timing.load, live_ms: liveMs });
    }
  } finally {
    await browser.close();
    child.kill();
    fs.rmSync(data, { recursive: true, force: true });
  }
  if (asJson) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log(`Server answered ${out.server_start_ms} ms after it was started.`);
  if (!lan) console.log('No network address here: the phone runs used localhost, so their files came uncompressed.');
  for (const r of out.runs) {
    console.log(`${r.way}: ${r.requests} requests, ${r.kilobytes} KB over the wire, usable at ${r.usable_ms} ms, every file by ${r.all_files_ms} ms, live feed at ${r.live_ms == null ? 'no answer' : r.live_ms + ' ms'}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
