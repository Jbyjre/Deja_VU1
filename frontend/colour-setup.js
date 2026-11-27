/* colour-setup.js: the colour checker's setup window (Right colour loaded? card, "Set up the colour checker").
 *
 * Steps: 1 give the Pico its Wi-Fi details (four ways) or connect it by USB, 2 find it and assign it to a head,
 * 3 test the eight channels, 4 set the brightness, 5 record the white and dark references, 6 check the colour.
 * The Wi-Fi password is used in this window only: it goes into a file you copy, or down the USB cable, and is never
 * sent to Deja Vu1's server. Needs app.js (api, getJSON, postJSON, esc, paint, toast) and colour-bridge.js. */
const ColourSetup = (() => {
  const HEADS = ['T0', 'T1', 'T2', 'T3'];
  const BANDS = [['f1', 415, 295], ['f2', 445, 265], ['f3', 480, 225], ['f4', 515, 150],
    ['f5', 555, 120], ['f6', 590, 85], ['f7', 630, 45], ['f8', 680, 25]]; // name, nm, a hue that looks like the band
  const LEDS = [
    ['Steady on', 'Readings are reaching Deja Vu1 (or Wi-Fi is not set up and USB is in use).'],
    ['1 blink', 'Not on the Wi-Fi: wrong name or password, out of range, or a 5 GHz-only network.'],
    ['2 blinks', 'On the Wi-Fi but cannot reach Deja Vu1: is it running, is the address right, is the firewall open.'],
    ['3 blinks', 'Deja Vu1 answered but refused: the sensor is not assigned to a head yet, the module is off or the lock is on.'],
    ['4 blinks', 'The sensor is not answering: check its four wires.']];
  const st = { timer: null, sensors: [], unassigned: [], connection: null, head: 'T0', moduleOff: false, demo: false,
    simulated: false, test: { phase: 'idle' }, busy: {}, notes: {}, showPass: false, seenAt: 0, pick: {}, bench: { insertion: 1, busy: false, list: null } };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  /* -- pure helpers (also run by the tests in Node) ------------------------------------------------------------ */

  /* A TOML basic string, as CircuitPython's settings.toml reads it: quotes, backslashes and control characters
   * escaped, everything else (UTF-8) as it is. */
  function tomlString(value) {
    let out = '"';
    for (const ch of String(value)) {
      const code = ch.codePointAt(0);
      if (ch === '"') out += '\\"';
      else if (ch === '\\') out += '\\\\';
      else if (code < 0x20 || code === 0x7f) out += '\\u' + code.toString(16).padStart(4, '0');
      else out += ch;
    }
    return out + '"';
  }

  /* What is wrong with the Wi-Fi details, in words (an empty list means they can be used). `known` is false while the
   * app has not yet told this window its addresses and printer (switched off, or still asking): those two are not
   * judged then, so a fresh window does not open with complaints about things nobody could have typed. */
  function problems(v, known = true) {
    const list = [];
    const bytes = new TextEncoder().encode(v.ssid || '').length;
    if (!v.ssid) list.push('Type your Wi-Fi name.');
    else if (bytes > 32) list.push('A Wi-Fi name is at most 32 characters.');
    const pass = v.password || '';
    if (pass && pass.length < 8) list.push('A Wi-Fi password is at least 8 characters (leave it empty for an open network).');
    else if (pass.length > 64 || (pass.length === 64 && !/^[0-9a-f]{64}$/i.test(pass))) list.push('A Wi-Fi password is at most 63 characters.');
    if (known && !(v.servers || []).length) list.push("Choose this computer's address.");
    else if ((v.servers || []).length > 4) list.push('The Pico keeps at most four addresses. Untick some.');
    if (known && !v.printer) list.push('Select an added printer first (not a demo printer).');
    if (v.code && !/^\d{1,12}$/.test(v.code)) list.push('A pairing code is digits only.');
    return list;
  }

  /* The settings.toml text for the Pico. */
  function tomlFor(v) {
    const lines = [
      '# Deja Vu1 colour checker settings. This file holds your Wi-Fi password: keep it private.',
      `CIRCUITPY_WIFI_SSID = ${tomlString(v.ssid)}`,
      `CIRCUITPY_WIFI_PASSWORD = ${tomlString(v.password || '')}`,
      `DV1_SERVER = ${tomlString((v.servers || []).join(', '))}`,
      `DV1_PRINTER = ${tomlString(v.printer)}`];
    if (v.code) lines.push(`DV1_PAIR_CODE = ${tomlString(v.code)}`);
    return lines.join('\n') + '\n';
  }

  /* The eight bands of a reading against the ones that should move between a dark and a bright scene. */
  function channelVerdict(dark, light) {
    const names = BANDS.map(b => b[0]).concat(['clear']);
    const silent = names.filter(name => !(Number(light[name]) > Number(dark[name]) * 3 + 20));
    return { ok: silent.length === 0, silent, ratios: names.map(n => [n, (Number(light[n]) + 1) / (Number(dark[n]) + 1)]) };
  }

  /* -- reading the live state -------------------------------------------------------------------------------- */

  const sensorFor = head => st.sensors.find(s => s.toolhead === head) || null;

  /* Sensors waiting for a head: what the app has heard by Wi-Fi, plus a Pico this page is talking to over USB. */
  function waiting() {
    const list = st.unassigned.slice();
    const hello = ColourBridge.state.hello;
    const same = d => hello && d.device_id === hello.device_id && d.channel_id === hello.channel_id;
    const bound = st.sensors.some(same);
    if (hello && hello.sensor_ready && !bound && !list.some(same)) {
      list.push({ device_id: hello.device_id, channel_id: hello.channel_id, sensor_id: hello.sensor_id, sensor_model: hello.sensor_model,
        info: { transport: 'usb' }, age_s: 0 });
    }
    return list;
  }

  async function refresh() {
    const status = await getJSON(api('/api/colorcheck/sensors')).catch(() => null);
    if (!status) return;
    st.moduleOff = isModuleDisabled(status);
    st.simulated = !!status.simulated;
    st.sensors = status.sensors || [];
    st.unassigned = status.unassigned || [];
    if (Number.isInteger(status.server_time)) ColourBridge.setOffset(status.server_time - Math.floor(Date.now() / 1000));
    if (!st.connection || st.connection.printer_id !== currentPrinter) {
      const info = await getJSON(api('/api/colorcheck/connection')).catch(() => null);
      st.connection = info && !isModuleDisabled(info) ? info : null;
      if (st.connection) renderAddresses(); else renderPreview();
    }
    if (!sensorFor(st.head) && st.sensors.length) st.head = st.sensors[0].toolhead;
    renderLive();
  }

  function values() {
    const picked = [...document.querySelectorAll('#cs-addresses input[type=checkbox]:checked')].map(box => box.value);
    const typed = $('cs-address-typed').value.trim();
    return {
      ssid: $('cs-ssid').value, password: $('cs-pass').value,
      servers: picked.concat(typed ? typed.split(',').map(s => s.trim()).filter(Boolean) : []),
      printer: st.connection && st.connection.physical ? st.connection.printer_id : '',
      code: $('cs-code').value.trim(),
    };
  }

  /* -- step 1: giving the Pico its details ---------------------------------------------------------------------- */

  function renderAddresses() {
    const c = st.connection;
    if (!c) return;
    const rows = (c.addresses || []).map((a, i) =>
      `<label class="cs-check"><input type="checkbox" value="${esc(a)}"${i < 3 ? ' checked' : ''}> <span><code>${esc(a)}</code>${i === 0 ? ' <em>(this computer on your home network)</em>' : ' <em>(also this computer: the Pico tries it when the first does not answer)</em>'}</span></label>`);
    if (c.name) rows.push(`<label class="cs-check"><input type="checkbox" value="${esc(c.name)}"> <span><code>${esc(c.name)}</code> <em>(this computer's name, as a spare)</em></span></label>`);
    $('cs-addresses').innerHTML = rows.join('') || '<p class="field-hint">No home-network address was found. Type one below (for example 192.168.1.23:8000).</p>';
    $('cs-lock').hidden = !c.device_lock;
    renderPreview();
  }

  function renderPreview() {
    const v = values();
    const list = problems(v, !!st.connection);
    const text = tomlFor(v).replace(/(CIRCUITPY_WIFI_PASSWORD = ).*/, st.showPass ? '$&' : '$1"••••••••"');
    $('cs-toml').textContent = text;
    $('cs-problems').innerHTML = list.map(p => `<li>${esc(p)}</li>`).join('');
    $('cs-problems').hidden = !list.length;
    document.querySelectorAll('[data-cs-needs-details]').forEach(b => { b.disabled = list.length > 0 || !st.connection || b.dataset.csBusy === '1'; });
    renderUsb();
  }

  function download() {
    const v = values();
    if (problems(v).length) return;
    const url = URL.createObjectURL(new Blob([tomlFor(v)], { type: 'text/plain' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'settings.toml' });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('settings.toml saved. Copy it onto the CIRCUITPY drive.', 'ok', 5200);
  }

  async function copy() {
    const v = values();
    if (problems(v).length) return;
    try { await navigator.clipboard.writeText(tomlFor(v)); toast('Copied. Paste it into settings.toml on the CIRCUITPY drive.', 'ok', 5200); }
    catch (_) { toast('Your browser would not copy. Use the download button or select the text yourself.', 'bad', 6000); }
  }

  async function sendOverUsb() {
    const v = values();
    if (problems(v).length) return;
    const out = $('cs-usb-result');
    if (!ColourBridge.state.hello) { out.textContent = 'Connect the Pico by USB first (the USB cable panel below).'; return; }
    out.textContent = 'Sending to the Pico…';
    const saved = await ColourBridge.request({ cmd: 'wifi_set', ssid: v.ssid, password: v.password, server: v.servers.join(','),
      printer: v.printer, ...(v.code ? { code: v.code } : {}) });
    if (!saved || !saved.ok) { out.textContent = (saved && saved.message) || 'The Pico did not answer. Is it running the Deja Vu1 firmware?'; return; }
    out.textContent = 'Saved on the Pico. Trying the Wi-Fi now (up to 20 seconds)…';
    const tried = await ColourBridge.request({ cmd: 'wifi_test' }, 40000);
    out.textContent = tried ? `${tried.ok ? 'Works: ' : 'Not yet: '}${tried.message}` : 'Saved, but the test got no answer. Look at step 2.';
  }

  function renderUsb() {
    const s = ColourBridge.state;
    const open = s.status !== 'off' && ColourBridge.state.hello;
    paint($('cs-usb-live'), `<p class="cs-line"><span class="cs-dot" data-state="${open ? 'ok' : 'off'}"></span>${esc(ColourBridge.why() || s.message || 'Not connected.')}</p>` +
      (s.hello && ColourBridge.viaWifi() ? '<p class="field-hint">This Pico is sending its readings over Wi-Fi. The cable now serves setup and commands only.</p>' : '') +
      (s.hello ? `<p class="field-hint">Pico <code>${esc(s.hello.device_id)}</code>, firmware ${esc(s.hello.firmware)}. ${(s.net || s.hello.net || {}).ssid ? `Wi-Fi saved: ${esc((s.net || s.hello.net).ssid)} (${esc((s.net || s.hello.net).source)}).` : 'No Wi-Fi saved on it.'}</p>` : ''));
    $('cs-usb-connect').hidden = !!s.hello;
    $('cs-usb-disconnect').hidden = !s.hello;
    $('cs-usb-forget').hidden = !s.hello;
    $('cs-usb-connect').disabled = !ColourBridge.supported();
    document.querySelectorAll('[data-cs-needs-usb]').forEach(b => { b.disabled = !s.hello || problems(values()).length > 0; });
  }

  /* -- step 2: finding it and giving it a head ----------------------------------------------------------------------- */

  async function assign(device, head) {
    const kept = st.sensors.filter(s => s.toolhead !== head && !(s.device_id === device.device_id && s.channel_id === device.channel_id))
      .map(s => ({ toolhead: s.toolhead, device_id: s.device_id, channel_id: s.channel_id, sensor_id: s.sensor_id, sensor_model: s.sensor_model }));
    kept.push({ toolhead: head, device_id: device.device_id, channel_id: device.channel_id, sensor_id: device.sensor_id, sensor_model: device.sensor_model });
    const r = await postJSON(api('/api/colorcheck/sensors'), { version: 1, simulated: false, bindings: kept });
    toast(r.ok ? `Assigned to head ${head}` : (r.body && r.body.error) || 'Deja Vu1 refused that', r.ok ? 'ok' : 'bad');
    if (r.ok) { st.head = head; await ColourBridge.refreshAssignments(); }
    await refresh();
  }

  const firstFree = () => HEADS.find(h => !sensorFor(h)) || 'T0';

  function findHtml() {
    if (st.moduleOff) return '<p class="cs-line"><span class="cs-dot" data-state="wait"></span>Waiting for Right colour loaded? to be switched on (the notice at the top of this window).</p>';
    if (st.simulated) return '<p class="cs-line"><span class="cs-dot" data-state="bad"></span>This is a demo printer. Add your printer first (Printers), then select it.</p>';
    const rows = [];
    for (const d of waiting()) {
      const how = d.info && d.info.transport === 'wifi' ? `Wi-Fi${typeof d.info.rssi === 'number' && d.info.rssi ? `, signal ${d.info.rssi} dBm` : ''}` : (d.info && d.info.transport === 'usb' ? 'USB cable' : 'Sensor');
      rows.push(`<div class="cs-found"><div><strong>Found a colour checker</strong><span class="field-hint"> ${esc(how)} · <code>${esc(d.device_id)}</code> · ${Math.round(d.age_s)} s ago</span></div>
        <div class="field-row field-row-end"><label class="field field-narrow"><span>Head</span><select data-cs-head="${esc(d.device_id)}">${HEADS.map(h => `<option${sensorFor(h) ? ' disabled' : ''}${h === (st.pick[d.device_id] || firstFree()) ? ' selected' : ''}>${h}</option>`).join('')}</select></label>
        <button type="button" class="btn small primary" data-cs-assign="${esc(d.device_id)}|${esc(d.channel_id)}">Assign</button></div></div>`);
    }
    for (const s of st.sensors) {
      const info = (s.reading && s.reading.info) || {};
      const how = info.transport === 'wifi' ? `Wi-Fi${info.rssi ? `, signal ${info.rssi} dBm` : ''}` : (info.transport === 'usb' ? 'USB cable' : 'sensor');
      const age = s.age_s == null ? 'no reading yet' : `last reading ${Math.floor(s.age_s)} s ago`;
      rows.push(`<div class="cs-found"><div><strong>Head ${esc(s.toolhead)}</strong><span class="field-hint"> ${esc(how)} · ${esc(age)}</span></div>
        <div class="field-row field-row-end"><button type="button" class="btn small" data-cs-pick="${esc(s.toolhead)}"${s.toolhead === st.head ? ' aria-pressed="true"' : ''}>${s.toolhead === st.head ? 'Setting this one up' : 'Set this one up'}</button>
        <button type="button" class="btn small" data-cs-remove="${esc(s.toolhead)}">Unassign</button></div></div>`);
    }
    if (!rows.length) {
      const waited = Date.now() - st.seenAt;
      rows.push(`<p class="cs-line"><span class="cs-dot" data-state="wait"></span>Waiting for the Pico. Power it from a USB wall charger (or plug it into this computer) and give it up to a minute.</p>` +
        (waited > 25000 ? `<ul class="cs-list"><li>Is the Pico's own light on? Look at the table below.</li><li>Is Deja Vu1 running on this computer and is this window still open?</li><li>Open this computer's address from a phone on the same Wi-Fi. If the page does not load, this computer's firewall is blocking it: the guide's section Let the Pico reach this computer has the steps.</li><li>The Pico W cannot join a 5 GHz-only network.</li><li>Try the USB cable route (step 1): it shows what the Pico says in words.</li></ul>` : ''));
    }
    return rows.join('');
  }

  /* -- steps 3 to 6 ------------------------------------------------------------------------------------------------- */

  function barsHtml(sensor) {
    const reading = sensor && sensor.reading;
    if (!reading) return '<p class="field-hint">No reading yet.</p>';
    const full = (reading.settings && reading.settings.full_scale) || 65535;
    const flags = reading.quality_flags || [];
    // Bars are drawn against the brightest band (but never against less than a tenth of the chip's range), so the
    // shape of the spectrum shows even when the light is dim; the numbers underneath are the raw counts.
    const top = Math.max(full * 0.1, ...BANDS.map(([name]) => Number(reading.raw[name] || 0)));
    const bars = BANDS.map(([name, nm, hue]) => {
      const value = Number(reading.raw[name] || 0);
      const share = Math.max(0.015, Math.min(1, value / top));
      return `<div class="cs-bar" title="${nm} nm: ${value}"><span class="cs-fill" style="height:${(share * 100).toFixed(1)}%;--hue:${hue}"></span><span class="cs-nm">${nm}</span><span class="cs-val">${value}</span></div>`;
    }).join('');
    const s = reading.settings || {};
    return `<div class="cs-bars" role="img" aria-label="The eight colour bands of the latest reading">${bars}</div>
      <p class="field-hint">Bars compare the bands with the brightest one; the numbers are raw counts (full scale ${esc(full)}). Clear ${Number(reading.raw.clear || 0)} · NIR ${Number(reading.raw.nir || 0)} · ${s.gain ? `gain ${esc(s.gain)}, ` : ''}${s.led_ma ? `light ${esc(s.led_ma)} mA` : ''}${flags.length ? ` · <strong>${esc(flags.join(', '))}</strong>` : ''}</p>`;
  }

  function testHtml() {
    const t = st.test;
    const next = (label, key) => `<button type="button" class="btn small primary" data-cs-test="${key}"${st.busy.test ? ' disabled' : ''}>${label}</button>`;
    if (t.phase === 'cover') return `<p>Point the sensor into open space, at least 20 cm from anything, so it sees almost nothing of its own light. Then press Next.</p>${next('Next', 'dark')}`;
    if (t.phase === 'light') return `<p>Now hold a sheet of plain white paper about 5 mm in front of the sensor. Then press Next.</p>${next('Next', 'light')}`;
    if (t.phase === 'done' && t.result) {
      const r = t.result;
      return r.ok ? '<p class="cs-line"><span class="cs-dot" data-state="ok"></span>All eight bands and the clear channel reacted. The sensor is reading.</p>' +
        `<button type="button" class="btn small" data-cs-test="start">Test again</button>`
        : `<p class="cs-line"><span class="cs-dot" data-state="bad"></span>These did not react: ${esc(r.silent.map(n => (BANDS.find(b => b[0] === n) || [n, n])[1] + (n === 'clear' ? '' : ' nm')).join(', '))}.</p>
          <p class="field-hint">Check that the paper was close and white, and that nothing was covering the sensor. If it fails again with the same bands, the sensor board may be faulty.</p>
          <button type="button" class="btn small" data-cs-test="start">Test again</button>`;
    }
    return `<p class="field-hint">Two quick readings: the sensor looking at nothing, then at white paper. Every band should jump.</p><button type="button" class="btn small" data-cs-test="start"${sensorFor(st.head) ? '' : ' disabled'}>Start the channel test</button>`;
  }

  function calHtml(sensor) {
    if (!sensor) return '<p class="field-hint">Assign the sensor to a head first.</p>';
    const c = sensor.calibration || {};
    const mark = c.state === 'ready' ? 'ok' : (c.state === 'settings_changed' ? 'bad' : 'wait');
    return `<p class="cs-line"><span class="cs-dot" data-state="${mark}"></span>${esc(c.message || '')}${c.id ? ` <code>${esc(c.id)}</code>` : ''}</p>
      <div class="field-row"><button type="button" class="btn small primary" data-cs-cal="white"${st.busy.cal ? ' disabled' : ''}>Record white reference</button>
      <button type="button" class="btn small" data-cs-cal="dark"${st.busy.cal ? ' disabled' : ''}>Record dark reference</button>
      ${c.has_white || c.has_dark ? `<button type="button" class="btn small" data-cs-cal="clear">Forget references</button>` : ''}</div>`;
  }

  function doneHtml(sensor) {
    if (!sensor) return '';
    const chip = sensor.status === 'reading' && /^#[0-9a-f]{6}$/i.test(sensor.detected_hex || '')
      ? `<div class="sw"><span class="chip cs-big" style="background:${esc(sensor.detected_hex)}"></span> <strong>${esc(sensor.detected_hex)}</strong> measured on head ${esc(sensor.toolhead)}</div>` : '';
    return `${chip}<p class="field-hint">${esc(sensor.message || '')}</p>`;
  }

  function gainHtml(sensor) {
    if (!sensor) return '<p class="field-hint">Assign the sensor to a head first.</p>';
    const note = st.notes.gain ? `<p class="cs-line"><span class="cs-dot" data-state="${st.notes.gain.ok ? 'ok' : 'bad'}"></span>${esc(st.notes.gain.message)}</p>` : '';
    const cmd = sensor.command && ['sent', 'waiting'].includes(sensor.command.state) ? `<p class="field-hint">${esc(sensor.command.message)}</p>` : '';
    return `${note}${cmd}<div class="field-row field-row-end"><button type="button" class="btn small primary" data-cs-gain="auto"${st.busy.gain ? ' disabled' : ''}>${st.busy.gain ? 'Working…' : 'Find the right brightness'}</button></div>`;
  }

  function renderLive() {
    if (!$('colour-setup').open) return;
    const sensor = sensorFor(st.head);
    paint($('cs-module-live'), st.moduleOff ? '<div class="cs-notice"><p class="cs-line"><span class="cs-dot" data-state="bad"></span><span><strong>Right colour loaded?</strong> is switched off (Settings, Optional extras). Nothing below works until it is on.</span></p><button type="button" class="btn small primary" data-turn-on="color_check">Turn it on</button></div>' : '');
    if (!document.activeElement || !document.activeElement.closest('#cs-find-live select')) paint($('cs-find-live'), findHtml());
    paint($('cs-bars'), barsHtml(sensor));
    paint($('cs-test-live'), testHtml());
    paint($('cs-gain-live'), gainHtml(sensor));
    paint($('cs-cal-live'), calHtml(sensor));
    paint($('cs-done-live'), doneHtml(sensor));
    const marks = { connect: ColourBridge.state.hello || (st.sensors.length || waiting().length), find: st.sensors.length > 0,
      test: st.test.result && st.test.result.ok, gain: sensor && sensor.reading && sensor.reading.settings && st.notes.gain && st.notes.gain.ok,
      cal: sensor && sensor.calibration && sensor.calibration.state === 'ready', done: sensor && sensor.status === 'reading' };
    for (const [key, ok] of Object.entries(marks)) { const el = $(`cs-mark-${key}`); if (el) el.dataset.state = ok ? 'ok' : 'todo'; }
    renderUsb();
  }

  /* -- actions -------------------------------------------------------------------------------------------------------- */

  async function runCommand(body) {
    const sensor = sensorFor(st.head);
    if (!sensor) return { ok: false, message: 'Assign the sensor to a head first.' };
    const hello = ColourBridge.state.hello;
    if (hello && hello.device_id === sensor.device_id) {
      const ack = await ColourBridge.request({ ...body });
      return ack ? { ok: !!ack.ok, message: ack.message || '' } : { ok: false, message: 'The Pico did not answer over USB.' };
    }
    const queued = await postJSON(api('/api/colorcheck/command'), { toolhead: st.head, ...body });
    if (!queued.ok) return { ok: false, message: (queued.body && queued.body.error) || 'Deja Vu1 refused that.' };
    for (let i = 0; i < 45 && $('colour-setup').open; i++) {
      await sleep(1000);
      await refresh();
      const c = (sensorFor(st.head) || {}).command;
      if (c && c.id === queued.body.id && ['done', 'failed', 'expired'].includes(c.state)) return { ok: c.state === 'done', message: c.message };
    }
    return { ok: false, message: 'No answer from the sensor yet. It answers with its next reading: check that it is powered and its light is steady.' };
  }

  /* The second new reading after the press: the Pico averages a few readings, so the first may still hold the old scene. */
  async function waitForFresh(head) {
    const before = ((sensorFor(head) || {}).reading || {}).captured_at || 0;
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      await refresh();
      const reading = (sensorFor(head) || {}).reading;
      if (reading && reading.captured_at > before) seen.add(reading.captured_at);
      if (seen.size >= 2 && !(reading.quality_flags || []).includes('saturated')) return reading;
      await sleep(700);
    }
    return null;
  }

  async function channelTest(key) {
    const t = st.test;
    if (key === 'start') { st.test = { phase: 'cover' }; return renderLive(); }
    st.busy.test = true; renderLive();
    const reading = await waitForFresh(st.head);
    st.busy.test = false;
    if (!reading) { toast('No fresh reading arrived. Check the sensor is powered and reporting.', 'bad', 6000); return renderLive(); }
    if (key === 'dark') { t.dark = reading.raw; t.phase = 'light'; } else { t.light = reading.raw; t.result = channelVerdict(t.dark, t.light); t.phase = 'done'; }
    renderLive();
  }

  async function calibrate(step) {
    st.busy.cal = true; renderLive();
    const r = await postJSON(api('/api/colorcheck/calibration'), { toolhead: st.head, step });
    st.busy.cal = false;
    const done = { white: 'White reference recorded', dark: 'Dark reference recorded', clear: 'References forgotten' };
    toast(r.ok ? `${done[step]} for ${st.head}` : (r.body && r.body.error) || 'The sensor refused that', r.ok ? 'ok' : 'bad', r.ok ? 3000 : 7000);
    await refresh();
  }

  /* -- bench: spools whose colour is known ------------------------------------------------------------------------------ */

  async function loadBench() {
    const list = await getJSON(api('/api/colorcheck/bench')).catch(() => null);
    if (!list || list.error) return;
    st.bench.list = list;
    const rows = list.spools.map(sp => `<div class="cs-found"><div><strong>${esc(sp.brand)} ${esc(sp.material)} ${esc(sp.name)}</strong>${sp.blind ? ' <span class="badge">blind</span>' : ''}
      <span class="field-hint"> label <span class="chip" style="background:${esc(sp.hex)}"></span> ${esc(sp.hex)} · ${sp.samples} readings, ${sp.readable} readable, ${sp.insertions} insertion${sp.insertions === 1 ? '' : 's'}</span></div>
      <button type="button" class="btn small" data-cs-bench-remove="${esc(sp.key)}">Remove</button></div>`);
    paint($('cs-bench-list'), (rows.join('') || '<p class="field-hint">Nothing recorded yet.</p>') +
      `<p class="field-hint">${list.spools.length} spool${list.spools.length === 1 ? '' : 's'}, ${list.count} readings. A rate needs at least ${list.min_spools} spools with ${list.min_repeats} readable readings each.</p>`);
  }

  async function takeBench() {
    const sensor = sensorFor(st.head);
    const note = $('cs-b-note');
    if (!sensor) { note.textContent = 'Assign the sensor to a head first (step 2).'; return; }
    const spool = { brand: $('cs-b-brand').value.trim(), material: $('cs-b-material').value.trim(), name: $('cs-b-name').value.trim(), hex: $('cs-b-hex').value };
    if (!spool.brand || !spool.material || !spool.name) { note.textContent = 'Fill in the brand, the material and the colour name.'; return; }
    st.bench.busy = true;
    $('cs-b-take').disabled = true;
    let done = 0;
    for (let i = 0; i < 3; i++) {
      note.textContent = `Reading ${i + 1} of 3: hold the strand still…`;
      const last = ((sensorFor(st.head) || {}).reading || {}).captured_at || 0;
      let ok = false;
      for (let wait = 0; wait < 25 && !ok; wait++) {
        await refresh();
        const reading = (sensorFor(st.head) || {}).reading;
        if (reading && reading.captured_at > last) ok = true; else await sleep(600);
      }
      const r = ok ? await postJSON(api('/api/colorcheck/bench'), { toolhead: st.head, spool, blind: $('cs-b-blind').checked,
        insertion: st.bench.insertion, mode: $('cs-b-mode').value }) : { ok: false, body: { error: 'No new reading arrived.' } };
      if (!r.ok) { note.textContent = (r.body && r.body.error) || 'Could not record that.'; break; }
      done += 1;
    }
    st.bench.busy = false;
    $('cs-b-take').disabled = false;
    if (done === 3) note.textContent = 'Recorded 3 readings. Take the strand out and put it back, then press "I took it out and put it back" and take 3 more.';
    await loadBench();
  }

  async function downloadBench() {
    const all = await getJSON(api('/api/colorcheck/bench?full=1')).catch(() => null);
    if (!all || all.error) { toast('Could not read the bench readings.', 'bad'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(all)], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'colour-bench.json' });
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* -- a report to paste into a message ---------------------------------------------------------------------------- */

  /* Plain text with what this window, the app and the Pico say, for whoever helps. Whatever is in `secrets` (the Wi-Fi
   * name, the password, a pairing code) is blanked wherever it shows up, because the Pico's own sentences can name the
   * Wi-Fi. Kept as English on purpose: it goes to a person who may not read the app's language. */
  function diagnosticsText(d) {
    const out = [];
    const line = text => out.push(text);
    const one = (value, none = 'unknown') => (value === undefined || value === null || value === '' ? none : String(value));
    const c = d.connection || {};
    const usb = d.usb || {};
    const hello = usb.hello || null;
    const net = (hello && hello.net) || usb.net || null;
    line(`Deja Vu1 colour checker report, ${one(d.when)}`);
    line(`Deja Vu1 ${one(d.version)}; the colour checker firmware this build offers: ${one(d.firmware)}`);
    line(`Right colour loaded? switched ${d.moduleOff ? 'OFF' : 'on'}; ${d.simulated ? 'a demo printer is selected' : 'a real printer is selected'} (${one(c.printer_id)})`);
    line(`Addresses this computer offers the Pico: ${(c.addresses || []).join(', ') || 'none found'}; its name ${one(c.name, 'none')}; device lock ${c.device_lock ? 'on' : 'off'}`);
    line(`Window steps: ${(d.marks || []).map(([key, state]) => `${key} ${one(state)}`).join(', ')}`);
    const sensors = d.sensors || [];
    line(`Sensors with a head: ${sensors.length}`);
    for (const x of sensors) {
      const r = x.reading || {};
      const set = r.settings || {};
      const info = r.info || {};
      const cal = x.calibration || {};
      const cmd = x.command;
      line(`- ${one(x.toolhead)}: ${one(x.device_id)} / ${one(x.channel_id)} / ${one(x.sensor_id)}; ${one(x.status)}, ${x.age_s == null ? 'no reading' : `reading ${x.age_s} s old`}; ` +
        `via ${one(info.transport)}${info.rssi ? ` ${info.rssi} dBm` : ''}, firmware ${one(info.firmware)}; gain ${one(set.gain)}, light ${one(set.led_ma)} mA, flags ${(r.quality_flags || []).join(' ') || 'none'}; ` +
        `calibration ${one(cal.state)}${cal.message ? ` (${cal.message})` : ''}${cmd ? `; last command ${one(cmd.cmd)} ${one(cmd.state)}: ${one(cmd.message, '')}` : ''}`);
    }
    const waiting = d.unassigned || [];
    line(`Sensors waiting for a head: ${waiting.length}`);
    for (const x of waiting) {
      const info = x.info || {};
      line(`- ${one(x.device_id)} / ${one(x.channel_id)}; ${Math.round(Number(x.age_s) || 0)} s ago; via ${one(info.transport)}${info.rssi ? ` ${info.rssi} dBm` : ''}, firmware ${one(info.firmware)}`);
    }
    line(`USB: web serial ${d.serialSupported ? 'available' : 'not available here'}; ${one(usb.status, 'not connected')}${usb.message ? ` ("${usb.message}")` : ''}; readings posted by this page ${one(usb.posted, 0)}; last refusal ${one(usb.refused, 'none')}`);
    if (hello) line(`Pico over USB: ${one(hello.device_id)}, firmware ${one(hello.firmware)}, sensor ${hello.sensor_ready ? 'answering' : 'NOT answering'}`);
    if (net) {
      line(`Pico's Wi-Fi: ${net.ssid ? 'details saved' : 'no details saved'} (from ${one(net.source)}); joined ${net.joined ? 'yes' : 'no'}; state ${one(net.state)}; address ${one(net.ip, 'none')}; ` +
        `signal ${one(net.rssi, 'none')}; app address(es) ${(net.server || []).join(', ') || 'none'}; paired ${net.paired ? 'yes' : 'no'}`);
      if (net.message) line(`Pico says: ${net.message}`);
    }
    if (d.test && d.test.result) line(`Channel test: ${d.test.result.ok ? 'every band reacted' : `no reaction in ${(d.test.result.silent || []).join(', ')}`}`);
    if (d.gainNote) line(`Brightness: ${d.gainNote.ok ? 'ok' : 'failed'}: ${one(d.gainNote.message, '')}`);
    let text = out.join('\n') + '\n';
    for (const secret of (d.secrets || []).filter(x => typeof x === 'string' && x.length >= 3)) text = text.split(secret).join('<hidden>');
    return text;
  }

  async function collectDiagnostics() {
    const [status, alive, connection] = await Promise.all([
      getJSON(api('/api/colorcheck/sensors')).catch(() => null),
      getJSON('/api/app/alive').catch(() => null),
      getJSON(api('/api/colorcheck/connection')).catch(() => null)]);
    let firmware = null;
    try { const match = /FIRMWARE = "([^"]+)"/.exec(await (await fetch('colour-checker/code.py')).text()); firmware = match && match[1]; } catch (_) { /* a static host without the file */ }
    const bridge = ColourBridge.state;
    const field = id => ($(id) ? $(id).value : '');
    return {
      when: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC', version: alive && alive.version, firmware,
      moduleOff: !!(status && isModuleDisabled(status)), simulated: !!(status && status.simulated),
      connection: connection && !isModuleDisabled(connection) ? connection : st.connection,
      marks: ['connect', 'find', 'test', 'gain', 'cal', 'done'].map(key => [key, $(`cs-mark-${key}`) ? $(`cs-mark-${key}`).dataset.state : '']),
      sensors: (status && status.sensors) || st.sensors, unassigned: (status && status.unassigned) || st.unassigned,
      usb: { status: bridge.status, message: bridge.message, hello: bridge.hello, net: bridge.net, posted: bridge.posted, refused: bridge.refused },
      serialSupported: ColourBridge.supported(), test: st.test, gainNote: st.notes.gain,
      secrets: [field('cs-ssid'), field('cs-pass'), field('cs-code'), ((bridge.hello && bridge.hello.net) || bridge.net || {}).ssid],
    };
  }

  async function copyReport() {
    const text = diagnosticsText(await collectDiagnostics());
    const box = $('cs-report-text');
    box.textContent = text;
    box.hidden = false;
    try { await navigator.clipboard.writeText(text); toast('Report copied. Paste it into your message.', 'ok', 4000); }
    catch (_) { toast('Your browser would not copy. Select the text shown under the button instead.', 'bad', 6000); }
  }

  /* -- the window ---------------------------------------------------------------------------------------------------- */

  function bodyHtml() {
    return `
    <div id="cs-module-live" class="cs-live" role="status"></div>
    <ol class="cs-steps">
      <li class="cs-step"><h3><span class="cs-mark" id="cs-mark-connect" data-state="todo"></span>Give the Pico your Wi-Fi details, or plug it in</h3>
        <p class="field-hint">Put the Pico W beside the black block, within the sensor's 20 cm cable, and power it from a USB wall charger. Never from the printer. Choose any of these ways; they can be mixed.</p>
        <details class="cs-way" open><summary>Wi-Fi: the Pico sends readings to this computer</summary>
          <div class="field-row"><label class="field"><span>Wi-Fi name</span><input id="cs-ssid" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="64"></label>
            <label class="field"><span>Wi-Fi password</span><input id="cs-pass" type="password" autocomplete="off" spellcheck="false" maxlength="80"></label></div>
          <label class="cs-check"><input id="cs-showpass" type="checkbox"> <span>Show the password in the preview</span></label>
          <p class="field-hint">The Pico W joins 2.4 GHz networks only. The password stays in this window: it goes into a file you copy, or down the USB cable, and is never sent to Deja Vu1's server.</p>
          <fieldset class="cs-fieldset"><legend>This computer's address, which the Pico will call</legend><div id="cs-addresses"><p class="field-hint">Looking…</p></div>
            <label class="field"><span>Another address (optional)</span><input id="cs-address-typed" type="text" autocomplete="off" spellcheck="false" placeholder="192.168.1.23:8000"></label>
            <p class="field-hint">A home router can hand this computer a new address after a restart. If readings stop one day, make the file again, or ask your router to always give this computer the same address.</p></fieldset>
          <label class="field" id="cs-lock" hidden><span>Pairing code (the device lock is on)</span><input id="cs-code" type="text" inputmode="numeric" autocomplete="off" maxlength="12"><span class="field-hint">Show a code in Settings, Pair a phone, and type it here within 10 minutes.</span></label>
          <ul class="cs-problems" id="cs-problems" role="status" hidden></ul>
          <p class="cs-ways-title">Four ways to hand these to the Pico</p>
          <div class="cs-ways">
            <div><strong>A. Download the file</strong><button type="button" class="btn small" id="cs-download" data-cs-needs-details>Download settings.toml</button><span class="field-hint">Plug the Pico into this computer, copy the file onto the CIRCUITPY drive, replace the old one, then eject the drive.</span></div>
            <div><strong>B. Copy the lines</strong><button type="button" class="btn small" id="cs-copy" data-cs-needs-details>Copy to the clipboard</button><span class="field-hint">Open settings.toml on the CIRCUITPY drive in any text editor, paste, save. In Windows Notepad choose Save as type: All files, or the file becomes settings.toml.txt and the Pico ignores it.</span></div>
            <div><strong>C. Send it over USB</strong><button type="button" class="btn small" id="cs-send" data-cs-needs-details data-cs-needs-usb>Send to the Pico now</button><span class="field-hint">Needs the USB cable panel below to be connected. Nothing to copy: the Pico keeps it, and tries the Wi-Fi at once.</span><span class="field-hint" id="cs-usb-result" role="status"></span></div>
            <div><strong>D. Type it yourself</strong><span class="field-hint">The same lines, for any editor:</span><pre class="cs-toml" id="cs-toml" tabindex="0"></pre></div>
          </div>
          <p class="field-hint">The Pico reads settings.toml when it starts. If a change does not seem to apply, unplug the Pico and plug it in again.</p>
        </details>
        <details class="cs-way"><summary>USB cable: the Pico is plugged into this computer</summary>
          <p class="field-hint">Works in Chrome or Edge, on this computer, with the page opened at localhost. Readings go through this page, so it must stay open. A good second way when the Wi-Fi will not behave, because the Pico then tells you what is wrong in words.</p>
          <div id="cs-usb-live" class="cs-usb"></div>
          <div class="field-row"><button type="button" class="btn small primary" id="cs-usb-connect">Connect with USB</button><button type="button" class="btn small" id="cs-usb-disconnect" hidden>Disconnect</button>
            <button type="button" class="btn small" id="cs-usb-forget" hidden>Forget the Wi-Fi saved on the Pico</button></div>
        </details>
        <details class="cs-way"><summary>Printable parts: the black holder and the Pico's cradle</summary>
          <p class="field-hint">Print in black PLA or PETG: a light colour lets room light in. Print the short test piece first and check that the board fits and the chip sits over the slit before printing the whole block. The Pico stays outside the block, beside it, within the sensor's 20 cm cable, powered by its own USB wall charger. Never from the printer.</p>
          <p class="cs-files"><a class="btn small" href="colour-checker/holder/test-coupon.stl" download>test-coupon.stl</a> <a class="btn small" href="colour-checker/holder/sensor-block.stl" download>sensor-block.stl</a> <a class="btn small" href="colour-checker/holder/sensor-lid.stl" download>sensor-lid.stl</a> <a class="btn small" href="colour-checker/holder/pico-cradle.stl" download>pico-cradle.stl</a></p>
        </details>
        <details class="cs-way"><summary>Firmware: the program on the Pico</summary>
          <p class="field-hint">The Pico needs CircuitPython 10 and three library pieces from Adafruit's bundle (<code>adafruit_as7341.mpy</code> and the <code>adafruit_bus_device</code> and <code>adafruit_register</code> folders, into CIRCUITPY/lib). Then copy this file onto the CIRCUITPY drive as <code>code.py</code>:</p>
          <p><a class="btn small" href="colour-checker/code.py" download="code.py">Download code.py</a></p>
        </details>
      </li>
      <li class="cs-step"><h3><span class="cs-mark" id="cs-mark-find" data-state="todo"></span>Find the sensor and give it a head</h3>
        <div id="cs-find-live" class="cs-live"></div>
        <details class="cs-way"><summary>What the Pico's own light means</summary><table class="cs-led"><tbody>${LEDS.map(([a, b]) => `<tr><th scope="row">${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table></details>
        <details class="cs-way"><summary>If nothing works: copy a report to send</summary>
          <p class="field-hint">Gathers what this window, Deja Vu1 and the Pico say, so you can paste it into a message instead of describing it. It holds no Wi-Fi name, password or pairing code.</p>
          <div class="field-row"><button type="button" class="btn small" id="cs-report">Copy the report</button></div>
          <pre class="cs-toml" id="cs-report-text" hidden></pre>
        </details>
      </li>
      <li class="cs-step"><h3><span class="cs-mark" id="cs-mark-test" data-state="todo"></span>Test the channels</h3>
        <div id="cs-bars" class="cs-live"></div><div id="cs-test-live" class="cs-live"></div>
      </li>
      <li class="cs-step"><h3><span class="cs-mark" id="cs-mark-gain" data-state="todo"></span>Set the brightness</h3>
        <p class="field-hint">Put the white target (white paper or white filament) where the filament will go, then let the sensor pick the strongest setting that does not clip.</p>
        <div id="cs-gain-live" class="cs-live"></div>
        <details class="cs-way"><summary>Or set the gain and the light by hand</summary>
          <div class="field-row field-row-end"><label class="field field-narrow"><span>Gain</span><select id="cs-g-gain">${[0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512].map(g => `<option${g === 16 ? ' selected' : ''}>${g}</option>`).join('')}</select></label>
            <label class="field field-narrow"><span>Light (mA, 4 to 20)</span><input id="cs-g-led" type="number" min="4" max="20" step="2" value="10"></label>
            <button type="button" class="btn small" id="cs-g-apply">Apply</button></div>
          <p class="field-hint" id="cs-g-note" role="status">A higher gain reads dim colours better and clips bright ones sooner. A reference belongs to the gain and light it was recorded at: record it again after a change.</p>
        </details>
      </li>
      <li class="cs-step"><h3><span class="cs-mark" id="cs-mark-cal" data-state="todo"></span>Record the white and dark references</h3>
        <p class="field-hint">White: the white target in place. Dark: the holder empty. Record the white one first, at the brightness from the last step. If the brightness changes later, record them again.</p>
        <div id="cs-cal-live" class="cs-live"></div>
      </li>
      <li class="cs-step"><h3><span class="cs-mark" id="cs-mark-done" data-state="todo"></span>Check a colour</h3>
        <p class="field-hint">Put a strand of filament in the holder. The colour appears here and on the Right colour loaded? card. It is advice: Confirm Print never blocks a start because of it.</p>
        <div id="cs-done-live" class="cs-live"></div>
        <details class="cs-way" id="cs-bench"><summary>Bench test: measure spools whose colour you know (optional)</summary>
          <p class="field-hint">Take a spool, say what it is and the colour on its label or listing, put its strand in the holder and take three readings. Take the strand out and put it back for each new insertion. Hold a few spools back as <strong>blind</strong>: do not adjust anything because of them. The report needs at least 10 spools before it will quote a rate, and it shows its counts and a 95 % range.</p>
          <div class="field-row"><label class="field"><span>Brand</span><input id="cs-b-brand" type="text" maxlength="40" autocomplete="off"></label>
            <label class="field"><span>Material</span><input id="cs-b-material" type="text" maxlength="40" autocomplete="off" placeholder="PLA"></label>
            <label class="field"><span>Colour name</span><input id="cs-b-name" type="text" maxlength="40" autocomplete="off"></label>
            <label class="field field-narrow"><span>Label colour</span><input id="cs-b-hex" type="color" value="#c8281e"></label></div>
          <div class="field-row field-row-end"><label class="field field-narrow"><span>How</span><select id="cs-b-mode"><option value="strand">Strand in the holder</option><option value="surface">Pressed to the spool</option></select></label>
            <label class="cs-check"><input id="cs-b-blind" type="checkbox"> <span>Blind spool</span></label>
            <span class="field-hint" id="cs-b-insertion">Insertion 1</span>
            <button type="button" class="btn small" id="cs-b-again">I took it out and put it back</button></div>
          <div class="field-row"><button type="button" class="btn small primary" id="cs-b-take">Take 3 readings</button>
            <button type="button" class="btn small" id="cs-b-download">Download all readings</button></div>
          <p class="field-hint" id="cs-b-note" role="status"></p>
          <div id="cs-bench-list" class="cs-live"></div>
          <p class="field-hint">Then run <code>python3 tools/colour-bench.py report colour-bench.json</code> for the report.</p>
        </details>
        <details class="cs-way"><summary>I swapped the sensor board</summary><p class="field-hint">A new chip needs new references. This tells Deja Vu1 it is a different sensor, and drops the old calibration.</p>
          <button type="button" class="btn small" data-cs-newsensor>This is a new sensor</button></details>
      </li>
    </ol>`;
  }

  function open(fromEl) {
    const dialog = $('colour-setup');
    if (dialog.open) return;
    if (!dialog.dataset.built) { $('colour-setup-body').innerHTML = bodyHtml(); dialog.dataset.built = '1'; bind(); }
    st.seenAt = Date.now();
    st.connection = null;
    st.test = { phase: 'idle' };
    if (typeof Workshop !== 'undefined' && Workshop.openDialog) Workshop.openDialog(dialog, fromEl); else dialog.showModal();
    ColourBridge.resume();
    refresh();
    clearInterval(st.timer);
    st.timer = setInterval(refresh, 2000);
  }

  function bind() {
    const dialog = $('colour-setup');
    dialog.addEventListener('close', () => { clearInterval(st.timer); st.timer = null; document.body.classList.remove('has-glass-dialog'); });
    $('colour-setup-close').addEventListener('click', () => dialog.close());
    ['cs-ssid', 'cs-pass', 'cs-address-typed', 'cs-code'].forEach(id => $(id).addEventListener('input', renderPreview));
    $('cs-addresses').addEventListener('change', renderPreview);
    $('cs-showpass').addEventListener('change', e => { st.showPass = e.target.checked; renderPreview(); });
    $('cs-download').addEventListener('click', download);
    $('cs-copy').addEventListener('click', copy);
    $('cs-send').addEventListener('click', sendOverUsb);
    $('cs-g-apply').addEventListener('click', async () => {
      const note = $('cs-g-note');
      note.textContent = 'Sending…';
      const r = await runCommand({ cmd: 'set', gain: Number($('cs-g-gain').value), led_ma: Number($('cs-g-led').value) });
      note.textContent = r.ok ? 'Done: the sensor uses the new settings from its next reading.' : r.message;
    });
    $('cs-report').addEventListener('click', copyReport);
    $('cs-b-take').addEventListener('click', takeBench);
    $('cs-b-download').addEventListener('click', downloadBench);
    $('cs-b-again').addEventListener('click', () => { st.bench.insertion = Math.min(99, st.bench.insertion + 1); $('cs-b-insertion').textContent = `Insertion ${st.bench.insertion}`; });
    $('cs-bench').addEventListener('toggle', e => { if (e.target.open) loadBench(); });
    $('cs-usb-connect').addEventListener('click', () => ColourBridge.connect());
    $('cs-usb-disconnect').addEventListener('click', () => ColourBridge.disconnect());
    $('cs-usb-forget').addEventListener('click', async () => {
      const r = await ColourBridge.request({ cmd: 'wifi_clear' });
      toast(r ? r.message : 'The Pico did not answer.', r && r.ok ? 'ok' : 'bad', 6000);
    });
    ColourBridge.on(() => { if (dialog.open) { renderUsb(); renderLive(); } });
    dialog.addEventListener('change', e => { if (e.target.dataset && e.target.dataset.csHead) st.pick[e.target.dataset.csHead] = e.target.value; });
    dialog.addEventListener('click', async e => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.csAssign) {
        const [device_id, channel_id] = t.dataset.csAssign.split('|');
        const device = waiting().find(d => d.device_id === device_id && d.channel_id === channel_id);
        const head = t.closest('.cs-found').querySelector('select').value;
        if (device) await assign(device, head);
      } else if (t.dataset.csPick) { st.head = t.dataset.csPick; renderLive(); }
      else if (t.dataset.csRemove) {
        const kept = st.sensors.filter(s => s.toolhead !== t.dataset.csRemove).map(s => ({ toolhead: s.toolhead, device_id: s.device_id, channel_id: s.channel_id, sensor_id: s.sensor_id, sensor_model: s.sensor_model }));
        await postJSON(api('/api/colorcheck/sensors'), { version: 1, simulated: false, bindings: kept });
        await refresh();
      } else if (t.dataset.csTest) await channelTest(t.dataset.csTest);
      else if (t.dataset.csCal) await calibrate(t.dataset.csCal);
      else if (t.dataset.csGain) {
        st.busy.gain = true; st.notes.gain = null; renderLive();
        st.notes.gain = await runCommand({ cmd: 'autogain' });
        st.busy.gain = false; renderLive();
      } else if (t.dataset.csBenchRemove) {
        await postJSON(api('/api/colorcheck/bench/delete'), { spool: t.dataset.csBenchRemove });
        await loadBench();
      } else if (t.hasAttribute('data-cs-newsensor')) {
        const r = await runCommand({ cmd: 'new_sensor' });
        toast(r.ok ? 'Marked as a new sensor. Assign it again when it shows up above.' : r.message, r.ok ? 'ok' : 'bad', 6000);
      }
    });
  }

  function bindCard() {
    const button = $('colour-setup-open');
    if (button && !button.dataset.bound) { button.dataset.bound = '1'; button.addEventListener('click', () => open(button)); }
  }
  document.addEventListener('DOMContentLoaded', bindCard);

  return { open, tomlString, tomlFor, problems, channelVerdict, diagnosticsText, bindCard, state: st };
})();
window.ColourSetup = ColourSetup;
