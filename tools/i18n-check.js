#!/usr/bin/env node
/*
 * The translation check: opens every screen of the dashboard twice in Chromium, once in English and once in the pseudo language
 * (every catalogued text accented and about a third longer, frontend/i18n.js), and compares them.
 *
 *   node tools/i18n-check.js                 starts its own server (demo data on), checks and prints a summary
 *   node tools/i18n-check.js --base URL      checks a server that is already running
 *   node tools/i18n-check.js --json FILE     also writes everything it found
 *   node tools/i18n-check.js --widths 1366,390
 *   node tools/i18n-check.js --max-missing 40   exit 1 when more than 40 different visible texts are not in the catalogue
 *   node tools/i18n-check.js --runtime       only the small scenarios that prove the loader itself (a few seconds)
 *   node tools/i18n-check.js --probe         only says whether Playwright and a Chromium are available
 *
 * It reports, per screen:
 *   script    a script error on a page (always makes the exit code 1)
 *   shape     a screen that is built differently in the pseudo language than in English: some part of the page looked at its own English
 *             words to decide what to do (a heading it searched for, a card it sorted by title) and no longer finds them
 *   missing   a visible text that stayed English because it is not in frontend/strings/en.json: text built in a way the scanner
 *             cannot see (a sentence glued together from pieces, text sent by the server, drawn on a canvas) or a name or figure
 *             that was never a translatable text. The list is where to look when a language shows English words.
 *
 * Run `node tools/text-audit.js --lang pseudo` for the other half: text that no longer fits once it is longer.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const option = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const PLACES = ['overview', 'printer', 'readings', 'camera', 'history', 'printers', 'desk', 'slice', 'preview', 'files', 'queue', 'models', 'ai',
  'maintenance', 'filament', 'settings', 'automations', 'studio', 'games'];

function findChromium(playwright) {
  const candidates = [process.env.DEJAVU_BROWSER, '/usr/bin/chromium', '/opt/pw-browsers/chromium', '/usr/bin/chromium-browser'];
  try { candidates.push(playwright.chromium.executablePath()); } catch (e) { /* no bundled browser */ }
  return candidates.find(p => p && fs.existsSync(p)) || null;
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  s.on('error', reject);
});
const ping = url => new Promise(resolve => { http.get(url, r => { r.resume(); resolve(r.statusCode); }).on('error', () => resolve(0)); });

async function startServer() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dejavu-i18n-'));
  const child = spawn('python3', [path.join(ROOT, 'backend', 'app.py')], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), DEJAVU_DATA_DIR: data, DEJAVU_NO_BROWSER: '1' },
  });
  for (let i = 0; i < 60; i++) {
    if ((await ping(`http://127.0.0.1:${port}/api/health`)) === 200) return { base: `http://localhost:${port}`, child };
    await new Promise(r => setTimeout(r, 250));
  }
  child.kill();
  throw new Error('The server did not start.');
}

// What one screen is made of, with the words taken away: the parts that code builds by looking at its own English words (which cards a
// screen shows, which headings carry a help button, which part buttons the toolbar has). Anything that moves by itself is left out.
function shapeOf() {
  const shown = sel => [...document.querySelectorAll(sel)].filter(el => el.offsetParent && !el.closest('.orb-bubble-wrap, .orb-panel, #tester-dock')).length;
  return {
    cards: shown('main section.card, main section.stats, main .tab-sub'),
    headings: shown('main h2'),
    'help buttons': shown('main .xp-btn'),
    'part buttons': shown('#pb-parts [role="tab"]'),
    'sidebar places': shown('#rail a, #rail button[data-place], .rail-item'),
  };
}

// The visible texts, and which of them the pseudo language reached. A reached text carries an accent the English never has.
function textsOf() {
  const SKIP = 'script, style, pre, code, kbd, samp, textarea, [translate="no"], [data-no-i18n], svg, #twin-model';
  const reached = /[áéíóúýçñšž]/;
  const out = { total: 0, done: 0, missing: [] };
  const walker = document.createTreeWalker(document.body, 4);
  let n = walker.nextNode();
  while (n) {
    const el = n.parentElement;
    const core = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (el && core && /[A-Za-z]{2,}/.test(core) && !el.closest(SKIP) && (el.offsetParent || getComputedStyle(el).position === 'fixed')) {
      out.total++;
      if (reached.test(core)) out.done++;
      else out.missing.push(core);
    }
    n = walker.nextNode();
  }
  return out;
}

async function visit(browser, base, width, lang) {
  const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 800 }, hasTouch: width < 700, isMobile: width < 700 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(l => {
    try { localStorage.setItem('dejavu1.setup.done', '1'); localStorage.setItem('dejavu1.lang', l); } catch (e) { /* blocked */ }
    window.WebSocket = class { constructor() { throw new Error('WebSocket is off for this check'); } };
  }, lang);
  await page.goto(base + '/?i18n=debug#/overview');
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => (window.I18n ? I18n.source(x.textContent) : x.textContent).trim() === 'Skip setup' && x.offsetParent);
    if (b) b.click();
    const t = document.getElementById('demo-toggle');
    if (t && !t.checked) { t.checked = true; t.dispatchEvent(new Event('change')); }
  });
  await page.waitForTimeout(3200);
  const screens = {};
  for (const place of PLACES.filter(p => !option('--only') || option('--only').split(',').includes(p))) {
    await page.evaluate(x => { location.hash = '#/' + x; }, place);
    await page.waitForTimeout(1000);
    screens[place] = { shape: await page.evaluate(shapeOf), texts: await page.evaluate(textsOf) };
  }
  // The parts of each screen (Settings has eight groups, the Printer four): only one shows at a time, so each is opened in turn.
  const parts = await page.evaluate(() => (typeof SECTIONS === 'object' ? Object.entries(SECTIONS).map(([tab, groups]) => [tab, groups.map(g => g[0])]) : []));
  for (const [tab, keys] of parts) {
    if (option('--only')) break;
    await page.evaluate(t => { showTab(t); }, tab);
    await page.waitForTimeout(700);
    for (const key of keys) {
      await page.evaluate(([t, k]) => { Sections.choose(t, k); }, [tab, key]);
      await page.waitForTimeout(600);
      screens[`${tab}/${key}`] = { shape: await page.evaluate(shapeOf), texts: await page.evaluate(textsOf) };
    }
  }
  const settingsLanguage = await page.evaluate(() => { const s = document.getElementById('language-choice'); return s ? [...s.options].map(o => o.value) : null; });
  await context.close();
  return { screens, errors, settingsLanguage };
}

// Elements that came or went between two runs of the same screen, ignoring figures that change by themselves.
function shapeDiff(a, b) {
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] || 0, y = b[k] || 0;
    if (x !== y) out.push(`${k}: ${x} in English, ${y} in pseudo`);
  }
  return out;
}

/* ---- the loader's own scenarios ---------------------------------------------------------------------------------------------------- */
async function runtime(browser, base) {
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${detail}`); };
  const english = JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend', 'strings', 'en.json'), 'utf8'));
  const keyOf = text => Object.keys(english).find(k => english[k] === text);
  const open = async (url, setup) => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
    const page = await context.newPage();
    page.errors = [];
    page.requests = [];
    page.on('pageerror', e => page.errors.push(e.message));
    page.on('request', r => page.requests.push(r.url()));
    await page.addInitScript(() => { try { localStorage.setItem('dejavu1.setup.done', '1'); } catch (e) { /* blocked */ } window.WebSocket = class { constructor() { throw new Error('off'); } }; });
    if (setup) await setup(page, context);
    await page.goto(base + url);
    await page.waitForTimeout(1800);
    return { page, context };
  };
  for (const text of ['Temperatures', 'Removed: {0}']) if (!keyOf(text)) check('catalogue', false, `"${text}" is not in en.json: the scenarios below use it`);

  // 1. English costs nothing.
  {
    const { page, context } = await open('/');
    const asked = page.requests.filter(u => /\/strings\/(en|[a-z]{2}(-[A-Za-z]+)?)\.json/.test(u));
    check('english-is-free', asked.length === 0 && (await page.evaluate(() => I18n.lang())) === 'en', `lang en, ${asked.length} catalogue request(s)`);
    check('english-t', (await page.evaluate(() => I18n.t('Saved {name}', { name: 'x' }))) === 'Saved x', 'I18n.t fills pieces in English');
    check('english-source', (await page.evaluate(() => I18n.source('  Two   words ') + '|' + I18n.same('Close', 'Close'))) === 'Two words|true', 'source and same');
    check('english-errors', page.errors.length === 0, `${page.errors.length} script error(s)`);
    await context.close();
  }

  // 2. The pseudo language reaches texts that arrive later, patterns, attributes and dialogs, and leaves code alone.
  {
    const { page, context } = await open('/?lang=pseudo');
    const accent = /[áéíóúýçñšž]/;
    const out = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.innerHTML = '<p id="t-plain">Temperatures</p><p id="t-pattern">Removed: benchy.gcode</p><button id="t-attr" title="Temperatures" aria-label="Temperatures">x</button>'
        + '<code id="t-code">Temperatures</code><p id="t-no" translate="no">Temperatures</p><p id="t-unknown">Zzz qqq unknown sentence here</p>'
        + '<p id="t-space">   Temperatures  </p>';
      document.body.append(host);
      await new Promise(r => setTimeout(r, 100));
      const g = id => document.getElementById(id);
      const later = document.createElement('p');
      later.id = 't-later';
      later.textContent = 'Temperatures';
      host.append(later);
      g('t-plain').firstChild.nodeValue = 'Temperatures';                   // a text changed in place
      await new Promise(r => setTimeout(r, 100));
      const t0 = performance.now();
      for (let i = 0; i < 300; i++) later.textContent = i % 2 ? 'Temperatures' : 'Removed: x' + i;
      await new Promise(r => setTimeout(r, 100));
      return {
        plain: g('t-plain').textContent, pattern: g('t-pattern').textContent, title: g('t-attr').title, label: g('t-attr').getAttribute('aria-label'),
        code: g('t-code').textContent, no: g('t-no').textContent, unknown: g('t-unknown').textContent, space: g('t-space').textContent, later: later.textContent,
        lang: document.documentElement.lang, translated: I18n.t('Temperatures'), source: I18n.source(g('t-plain').textContent),
        same: I18n.same(g('t-plain').textContent, 'Temperatures'), ms: Math.round(performance.now() - t0),
      };
    });
    check('pseudo-text', accent.test(out.plain) && out.plain !== 'Temperatures', out.plain);
    check('pseudo-pattern', accent.test(out.pattern) && out.pattern.includes('benchy.gcode'), out.pattern);
    check('pseudo-attributes', accent.test(out.title) && accent.test(out.label), `${out.title} / ${out.label}`);
    check('pseudo-leaves-code', out.code === 'Temperatures' && out.no === 'Temperatures', 'code and translate="no" untouched');
    check('pseudo-unknown-stays', out.unknown === 'Zzz qqq unknown sentence here', 'an uncatalogued text stays as written');
    check('pseudo-spaces', /^ {3}\S.*\S {2}$/.test(out.space), JSON.stringify(out.space));
    check('pseudo-later-and-in-place', accent.test(out.later) && out.ms < 1500, `a text added later and 300 quick changes took ${out.ms} ms`);
    check('pseudo-api', out.lang === 'en-XA' && accent.test(out.translated) && out.source === 'Temperatures' && out.same, `lang ${out.lang}, source ${out.source}`);
    let message = '';
    page.once('dialog', d => { message = d.message(); d.dismiss(); });
    await page.evaluate(() => { setTimeout(() => alert('Temperatures'), 0); });
    await page.waitForTimeout(400);
    check('pseudo-dialog', accent.test(message), message);
    check('pseudo-nothing-saved', (await page.evaluate(() => localStorage.getItem('dejavu1.lang'))) === null, 'pseudo is never saved');
    check('pseudo-errors', page.errors.length === 0, `${page.errors.length} script error(s)`);
    await context.close();
  }

  // 3. A real language file: translations, reordered pieces, a text with no translation, the picker and the saved choice.
  {
    const lang = {};
    lang[keyOf('Temperatures')] = 'Temperaturen';
    lang[keyOf('Removed: {0}')] = '{0} entfernt';
    const meta = { strings: Object.keys(english).length, languages: { de: { translated: 2, updated: '2026-01-01', app_version: '0' } } };
    const { page, context } = await open('/?lang=de', async p => {
      await p.route('**/strings/de.json', r => r.fulfill({ json: lang }));
      await p.route('**/strings/meta.json', r => r.fulfill({ json: meta }));
    });
    const out = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.innerHTML = '<p id="a">Temperatures</p><p id="b">Removed: benchy.gcode</p><p id="c">Close</p>';
      document.body.append(host);
      await new Promise(r => setTimeout(r, 100));
      const select = document.getElementById('language-choice');
      return {
        a: document.getElementById('a').textContent, b: document.getElementById('b').textContent, c: document.getElementById('c').textContent,
        lang: document.documentElement.lang, saved: localStorage.getItem('dejavu1.lang'), t: I18n.t('Removed: {0}', { 0: 'x' }),
        options: select ? [...select.options].map(o => o.value + '=' + o.textContent) : null, chosen: select ? select.value : null,
        note: (document.getElementById('language-note') || {}).textContent, hidden: getComputedStyle(document.body).visibility,
      };
    });
    check('german-text', out.a === 'Temperaturen', out.a);
    check('german-pattern', out.b === 'benchy.gcode entfernt', out.b);
    check('german-missing-stays-english', out.c === 'Close', out.c);
    check('german-api', out.lang === 'de' && out.saved === 'de' && out.t === 'x entfernt', `lang ${out.lang}, saved ${out.saved}, t ${out.t}`);
    check('german-picker', out.options && out.options.join('|') === 'en=English|de=Deutsch (German)' && out.chosen === 'de', JSON.stringify(out.options));
    check('german-note', /2 of \d+ texts are translated/.test(out.note || ''), out.note);
    check('german-revealed', out.hidden === 'visible', 'the page is shown once the language is in');
    // Choosing English again reloads in English and forgets the language.
    await page.evaluate(() => { const s = document.getElementById('language-choice'); s.value = 'en'; s.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(1500);
    check('german-back-to-english', (await page.evaluate(() => I18n.lang() + '|' + localStorage.getItem('dejavu1.lang'))) === 'en|en', 'English again after choosing it');
    check('german-errors', page.errors.length === 0, `${page.errors.length} script error(s)`);
    await context.close();
  }

  // 4. A language whose file is missing or broken never breaks the page: it stays English and the page is shown.
  {
    const { page, context } = await open('/?lang=fr', async p => { await p.route('**/strings/fr.json', r => r.fulfill({ status: 404, body: 'no' })); });
    const out = await page.evaluate(() => ({ visible: getComputedStyle(document.body).visibility, text: document.querySelector('h1, h2, button') ? 'has text' : '' }));
    check('missing-file', out.visible === 'visible' && out.text === 'has text' && page.errors.length === 0, `body ${out.visible}, ${page.errors.length} script error(s)`);
    await context.close();
  }
  return results;
}

async function main() {
  let playwright;
  try { playwright = require('playwright'); } catch (e) { console.error('Playwright is not installed here.'); process.exit(2); }
  const exe = findChromium(playwright);
  if (!exe) { console.error('No Chromium found. Set DEJAVU_BROWSER to the file.'); process.exit(2); }
  if (flag('--probe')) { console.log('Playwright and a Chromium are available: ' + exe); process.exit(0); }
  const widths = (option('--widths') || '1366,390').split(',').map(Number);
  const own = option('--base') ? null : await startServer();
  const base = option('--base') || own.base;
  const browser = await playwright.chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const report = { widths: {}, errors: [], shape: [], missing: {}, total: 0, done: 0 };
  let scenarios = [];
  try {
    scenarios = await runtime(browser, base);
    if (flag('--runtime')) widths.length = 0;
    for (const width of widths) {
      const english = await visit(browser, base, width, 'en');
      const pseudo = await visit(browser, base, width, 'pseudo');
      report.errors.push(...english.errors.map(e => `${width}px English: ${e}`), ...pseudo.errors.map(e => `${width}px pseudo: ${e}`));
      for (const place of Object.keys(pseudo.screens)) {
        const diff = shapeDiff(english.screens[place].shape, pseudo.screens[place].shape);
        if (diff.length) report.shape.push({ place, width, diff });
        const t = pseudo.screens[place].texts;
        if (width === widths[0]) {
          report.total += t.total;
          report.done += t.done;
          for (const text of t.missing) { const m = report.missing[text] || (report.missing[text] = { count: 0, places: new Set() }); m.count++; m.places.add(place); }
        }
      }
      report.widths[width] = { settingsLanguage: pseudo.settingsLanguage };
    }
  } finally {
    await browser.close();
    if (own) own.child.kill();
  }
  const failed = scenarios.filter(r => !r.ok).length;
  console.log(`Loader scenarios: ${scenarios.length - failed} ok, ${failed} failed`);
  if (flag('--runtime')) process.exit(failed ? 1 : 0);
  const missing = Object.entries(report.missing).sort((a, b) => b[1].count - a[1].count);
  const pct = report.total ? Math.round((report.done / report.total) * 1000) / 10 : 0;
  console.log(`Translation check: ${PLACES.length} screens and every part of them at ${widths.join(' and ')} px, English against pseudo.`);
  console.log(`  script errors: ${report.errors.length}`);
  report.errors.slice(0, 10).forEach(e => console.log('    ' + e));
  console.log(`  screens built differently in pseudo: ${report.shape.length}`);
  report.shape.slice(0, 12).forEach(s => console.log(`    ${s.place} @${s.width}: ${s.diff.slice(0, 4).join('; ')}`));
  console.log(`  visible texts on the screens at ${widths[0]} px: ${report.total}, reached by the catalogue: ${report.done} (${pct}%), ${missing.length} different texts stayed English`);
  missing.slice(0, Number(option('--show') || 40)).forEach(([text, m]) => console.log(`    ${m.count}x [${[...m.places].slice(0, 3).join(', ')}] ${text.slice(0, 90)}`));
  if (option('--json')) {
    fs.writeFileSync(option('--json'), JSON.stringify({ ...report, missing: Object.fromEntries(missing.map(([t, m]) => [t, { count: m.count, places: [...m.places] }])) }, null, 1));
  }
  const max = option('--max-missing');
  const fail = failed || report.errors.length || report.shape.length || (max !== null && missing.length > Number(max));
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
