// Shared recorder: films the real app through Chromium's screencast (JPEG frames with
// timestamps), draws a visible cursor inside the page, and turns the frames into a
// constant-60fps H.264 clip with ffmpeg. Capture-time only; the app's code is untouched.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const CURSOR = `
(() => {
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = '<svg width="26" height="32" viewBox="0 0 26 32"><path d="M3 2 L3 25 L9 19.5 L13 29 L17.2 27.2 L13.2 18 L21 18 Z" fill="#14161c" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {position:'fixed', left:'0', top:'0', zIndex: 2147483647, pointerEvents:'none',
      transform:'translate(-200px,-200px)', filter:'drop-shadow(0 2px 3px rgba(0,0,0,.28))', willChange:'transform'});
    const r = document.createElement('div'); r.id = '__ring';
    Object.assign(r.style, {position:'fixed', left:'0', top:'0', width:'44px', height:'44px', margin:'-22px 0 0 -22px',
      borderRadius:'50%', border:'2px solid rgba(74,141,248,.9)', background:'rgba(74,141,248,.16)', zIndex: 2147483646,
      pointerEvents:'none', opacity:'0', transform:'translate(-200px,-200px) scale(.4)'});
    if (matchMedia('(pointer: coarse)').matches) {   // phone: a fingertip instead of an arrow
      c.innerHTML = '<div style="width:40px;height:40px;margin:-18px 0 0 -18px;border-radius:50%;background:rgba(20,22,28,.16);border:2px solid rgba(255,255,255,.95);box-shadow:0 2px 8px rgba(0,0,0,.18)"></div>';
    }
    for (const el of [r, c]) { el.popover = 'manual'; Object.assign(el.style, {inset: 'auto', left: '0', top: '0', padding: '0', overflow: 'visible'}); }
    Object.assign(c.style, {margin: '0', border: '0', background: 'transparent'});
    document.documentElement.append(r, c);
    r.showPopover(); c.showPopover();
    // A modal dialog opened later sits above the cursor in the top layer: lift the cursor back over it.
    let open = 0;
    window.__raiseCursor = () => {
      const n = document.querySelectorAll('dialog[open]').length;
      if (n !== open) { open = n; for (const el of [r, c]) { el.hidePopover(); el.showPopover(); } }
    };
    let x = -200, y = -200;
    addEventListener('mousemove', e => { x = e.clientX; y = e.clientY; c.style.transform = 'translate(' + (x-3) + 'px,' + (y-2) + 'px)'; }, true);
    addEventListener('mousedown', () => {
      r.animate([{opacity: 1, transform: 'translate(' + x + 'px,' + y + 'px) scale(.4)'},
                 {opacity: 0, transform: 'translate(' + x + 'px,' + y + 'px) scale(1.25)'}], {duration: 520, easing: 'cubic-bezier(.2,.7,.2,1)'});
      c.animate([{scale: 1}, {scale: .86}, {scale: 1}], {duration: 220});
    }, true);
  };
  const hide = () => { const s = document.createElement('style'); s.textContent = '#handoff{display:none!important}'; document.head.append(s); };
  const boot = () => { mk(); hide(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();`;


// Frame-stepped filming. The page runs on Playwright's fake clock, and every CSS / Web
// animation is paused and set to the same virtual time each frame, so a slow software
// renderer still produces perfectly even motion. Server pushes (WebSocket) arrive in real
// time; at roughly 10x slow-down that only makes slow-moving print progress tick sooner.
const SYNC = `(() => {
  if (window.__raiseCursor) window.__raiseCursor();
  const now = performance.now();
  for (const a of document.getAnimations()) {
    if (a.__v === undefined) { a.__v = now - (a.currentTime || 0); a.pause(); }
    const t = now - a.__v, end = a.effect && a.effect.getComputedTiming().endTime;
    if (isFinite(end) && t >= end) { if (!a.__done) { a.__done = 1; try { a.finish(); } catch (e) {} } }
    else a.currentTime = t;
  }
})()`;

async function open({ width = 1440, height = 900, dpr = 2, fps = 60, url = 'http://localhost:' + (process.env.APP_PORT || 8791) + '/?dashboard', mobile = false } = {}) {
  const browser = await chromium.launch({ args: ['--hide-scrollbars'] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.clock.install({ time: t0 });
  const cdp = await ctx.newCDPSession(page);
  const st = { browser, ctx, page, cdp, width, height, dpr, fps, mx: -200, my: -200, dir: null, n: 0 };
  await page.goto(url);
  await page.clock.pauseAt(t0 + 1500);   // from here on, time only moves when a frame is filmed
  return st;
}
async function frame(st) {
  const p = st.page;
  await p.clock.runFor(1000 / st.fps);
  await p.evaluate(SYNC);
  if (!st.dir) return;
  const { data } = await st.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, optimizeForSpeed: false });
  fs.writeFileSync(path.join(st.dir, String(st.n++).padStart(5, '0') + '.jpg'), Buffer.from(data, 'base64'));
}
async function wait(st, ms) { for (let i = 0, n = Math.round(ms * st.fps / 1000); i < n; i++) await frame(st); }

const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
async function move(st, x, y, ms = 700) {
  const n = Math.max(2, Math.round(ms * st.fps / 1000)), x0 = st.mx < 0 ? x + 260 : st.mx, y0 = st.my < 0 ? y + 180 : st.my;
  const bend = Math.min(50, Math.hypot(x - x0, y - y0) * .07);   // a slight arc, like a real hand
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n), arc = Math.sin(Math.PI * k) * bend;
    await st.page.mouse.move(x0 + (x - x0) * k, y0 + (y - y0) * k - arc);
    await frame(st);
  }
  st.mx = x; st.my = y;
}
async function box(st, sel) {
  const el = st.page.locator(sel).first();
  const b = await el.boundingBox();
  if (!b) throw new Error('no box for ' + sel);
  return b;
}
async function center(st, sel) { const b = await box(st, sel); return [b.x + b.width / 2, b.y + b.height / 2]; }
async function press(st) {
  (st.clicks = st.clicks || []).push(+(st.n / st.fps).toFixed(3));
  await st.page.mouse.down(); await frame(st); await frame(st); await st.page.mouse.up(); await frame(st);
}
// A key press, logged so the sound track can put a keystroke exactly on it.
async function key(st, k) {
  (st.keys = st.keys || []).push(+(st.n / st.fps).toFixed(3));
  await st.page.keyboard.press(k); await frame(st);
}
async function type(st, text, perChar = 70) {
  for (const ch of text) { await key(st, ch === ' ' ? 'Space' : ch); await wait(st, Math.max(0, perChar - 1000 / st.fps)); }
}
async function click(st, sel, ms = 700, pause = 150) {
  const [x, y] = await center(st, sel);
  await move(st, x, y, ms);
  await wait(st, pause);
  await press(st);
}
// Smooth scroll to bring y (document px) to the top, or by dy, over ms.
async function scrollBy(st, dy, ms = 900) {
  const y0 = await st.page.evaluate(() => scrollY), n = Math.max(2, Math.round(ms * st.fps / 1000));
  for (let i = 1; i <= n; i++) {
    await st.page.evaluate(y => scrollTo(0, y), y0 + dy * ease(i / n));
    await frame(st);
  }
}
async function scrollTo(st, sel, offset = 120, ms = 900) {
  const top = await st.page.locator(sel).first().evaluate(el => el.getBoundingClientRect().top);
  await scrollBy(st, top - offset, ms);
}
function start(st, name) {
  st.name = name; st.dir = path.join(__dirname, 'frames', name); st.n = 0; st.clicks = []; st.keys = [];
  fs.rmSync(st.dir, { recursive: true, force: true }); fs.mkdirSync(st.dir, { recursive: true });
}
function stop(st, outDir = path.join(__dirname, '..', 'footage')) {
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, st.name + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(st.fps), '-i', path.join(st.dir, '%05d.jpg'),
    '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-r', String(st.fps), '-movflags', '+faststart', out]);
  fs.writeFileSync(path.join(outDir, st.name + '.json'), JSON.stringify({ fps: st.fps, frames: st.n, seconds: st.n / st.fps, clicks: st.clicks, keys: st.keys || [], marks: st.marks || {} }));
  fs.rmSync(st.dir, { recursive: true, force: true });
  console.log(st.name + '.mp4', st.n, 'frames =', (st.n / st.fps).toFixed(2), 's');
  st.dir = null;
}
// Setup helpers run on the fake clock too, without filming.
async function settle(st, ms = 1500) { const d = st.dir; st.dir = null; await wait(st, ms); st.dir = d; }
async function demoOn(st) {
  await st.page.locator('label[for=demo-toggle]').click();
  await settle(st, 3000);
  const x = st.page.locator('.handoff button, [aria-label*="ismiss"]').first();
  if (await x.isVisible().catch(() => false)) { await x.click().catch(() => {}); await settle(st, 600); }
}
async function api(st, route, body) {
  return st.page.evaluate(async ([route, body]) => {
    const r = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return r.json();
  }, [route, body]);
}
async function still(st, file, clip) {
  const { data } = await st.cdp.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}
function mark(st, name) { (st.marks = st.marks || {})[name] = +(st.n / st.fps).toFixed(3); }
module.exports = { mark, open, frame, wait, move, click, press, key, type, box, center, scrollBy, scrollTo, start, stop, settle, demoOn, api, still };
