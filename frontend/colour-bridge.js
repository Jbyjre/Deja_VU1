/* colour-bridge.js: the USB route for the colour checker.
 *
 * A Pico plugged into this computer prints one line per reading ("DV1 {json}"). With Web Serial (Chrome and Edge, on
 * this computer's own address: localhost) this page reads those lines and posts each reading to the app, and it
 * sends the Pico commands down the same cable. Nothing runs until you press Connect (or you allowed it before and
 * the Pico is plugged in). The Wi-Fi route does not need this file: the Pico posts by itself.
 *
 * Time: the Pico has no clock, so every reading is stamped here in whole seconds on the app's clock (the app tells
 * us its time, `server_time`), never in the future and never repeated. */
const ColourBridge = (() => {
  const VENDOR = 0x239A; // Adafruit's USB vendor id, which CircuitPython boards (the Pico W among them) report
  const KEY = 'dejavu1.colour.usb';
  const MAX_LINE = 65536;
  const listeners = new Set();
  const state = { status: 'off', message: '', hello: null, net: null, lastReading: null, posted: 0, refused: '', unassigned: false, viaWifi: false };
  let port = null;
  let reader = null;
  let writer = null;
  let offset = null;
  let lastStamp = 0;
  let waiting = [];
  let closing = false;
  let assigned = null; // "device|channel|sensor" of every sensor the app has given a head, from the app's own list
  let assignedAt = 0;

  const remembered = () => { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; } };
  const remember = on => { try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch (_) { /* private window */ } };

  function supported() { return 'serial' in navigator && window.isSecureContext !== false; }

  /* Why USB is not available here, in words (or '' when it is). */
  function why() {
    if (!('serial' in navigator)) {
      return window.isSecureContext === false
        ? 'Chrome only allows USB on this computer\'s own address. Open Deja Vu1 at http://localhost:8000 on the computer the Pico is plugged into.'
        : 'This browser cannot talk to a USB device. Use Chrome or Edge on a computer, or use the Wi-Fi route.';
    }
    return '';
  }

  /* One line from the Pico -> an object, or null for anything that is not ours (the console's own chatter). */
  function parseLine(line) {
    const text = String(line).replace(/\r$/, '');
    if (!text.startsWith('DV1 ')) return null;
    try {
      const body = JSON.parse(text.slice(4));
      return body && typeof body === 'object' && !Array.isArray(body) && typeof body.t === 'string' ? body : null;
    } catch (_) { return null; }
  }

  /* A capture time in whole seconds on the app's clock that never goes backwards or repeats. */
  function stamp(now = Date.now()) {
    const seconds = Math.floor(now / 1000) + (offset || 0);
    lastStamp = Math.max(seconds, lastStamp + 1);
    return lastStamp;
  }

  function set(status, message) {
    state.status = status;
    state.message = message;
    emit();
  }
  function emit() { listeners.forEach(fn => { try { fn(state); } catch (err) { console.error(err); } }); }
  function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /* Which sensors have a head, and the app's clock, from one ordinary read. Asked at most every 10 seconds. */
  async function loadAssigned(force) {
    if (!force && assigned && Date.now() - assignedAt < 10000) return;
    const status = await getJSON(api('/api/colorcheck/sensors')).catch(() => null);
    if (!status) return;
    assigned = new Set((status.sensors || []).map(x => `${x.device_id}|${x.channel_id}|${x.sensor_id}`));
    assignedAt = Date.now();
    if (Number.isInteger(status.server_time)) offset = status.server_time - Math.floor(Date.now() / 1000);
  }

  async function post(reading) {
    if (!state.hello || !currentPrinter || demoOn) return;
    // A Pico that is already posting over Wi-Fi needs no help: both routes at once would send every reading twice and
    // the app would refuse the second as a repeat. The cable then serves setup and commands only.
    if (viaWifi()) return;
    await loadAssigned(false);
    // A sensor with no head yet is not posted: the setup window lists it from what the cable says, and the app would
    // only refuse the reading (a failed request in the console every two seconds).
    state.unassigned = !assigned || !assigned.has(`${reading.device_id}|${reading.channel_id}|${reading.sensor_id}`);
    if (state.unassigned) return;
    const body = {
      version: 1, simulated: false, captured_at: stamp(), calibrated: null,
      device_id: reading.device_id, channel_id: reading.channel_id, sensor_id: reading.sensor_id,
      sensor_model: reading.sensor_model, raw: reading.raw, quality_flags: reading.quality_flags || [],
      settings: reading.settings, info: { firmware: String((state.hello || {}).firmware || ''), transport: 'usb' },
    };
    const reply = await postJSON(api('/api/colorcheck/readings'), body);
    if (reply.ok) {
      state.posted += 1; state.refused = '';
      offset = reply.body.server_time - Math.floor(Date.now() / 1000);
    } else {
      state.refused = (reply.body && reply.body.error) || 'Deja Vu1 refused that reading.';
      if (/clock/i.test(state.refused)) offset = null;
      assignedAt = 0; // look again: it may have been unassigned
    }
    emit();
  }

  const viaWifi = () => !!(state.net && state.net.state === 'ok' && state.net.joined);

  function handle(message) {
    if (message.t === 'hello') {
      state.hello = message;
      state.net = message.net || null;
      set('connected', message.sensor_ready ? 'Pico found, sensor answering.' : 'Pico found, but the sensor is not answering. Check its four wires.');
    } else if (message.t === 'reading') {
      state.lastReading = message;
      if (state.status !== 'reading') set('reading', 'Readings are arriving over USB.');
      state.viaWifi = viaWifi();
      post(message);
    } else if (message.t === 'error') {
      set('trouble', message.message || 'The Pico reported a problem.');
    } else if (message.t === 'net') {
      state.net = message;
      emit();
    }
    if (message.t === 'ack' || message.t === 'autogain') {
      if (message.net) state.net = message.net;
      waiting = waiting.filter(item => {
        if (item.cmd !== message.cmd) return true;
        clearTimeout(item.timer);
        item.resolve(message);
        return false;
      });
    }
  }

  async function readLoop() {
    const decoder = new TextDecoder();
    let buffer = '';
    while (port && port.readable && !closing) {
      reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut;
          while ((cut = buffer.indexOf('\n')) >= 0) {
            const parsed = parseLine(buffer.slice(0, cut));
            buffer = buffer.slice(cut + 1);
            if (parsed) handle(parsed);
          }
          if (buffer.length > MAX_LINE) buffer = '';
        }
      } catch (error) {
        /* A non-fatal read error (framing, overflow) leaves port.readable usable; a fatal one (unplugged) nulls it. */
        if (closing) break;
      } finally {
        try { reader.releaseLock(); } catch (_) { /* already released */ }
        reader = null;
      }
    }
    if (!closing) {
      port = null; writer = null;
      state.hello = null; state.lastReading = null;
      set('off', 'The Pico was unplugged.');
    }
  }

  async function open(chosen) {
    port = chosen;
    closing = false;
    state.hello = null;
    set('opening', 'Opening the USB connection…');
    try {
      await port.open({ baudRate: 115200 });
      // CircuitPython counts the host as connected only while DTR is asserted.
      await port.setSignals({ dataTerminalReady: true, requestToSend: true }).catch(() => {});
    } catch (error) {
      port = null;
      const busy = /busy|in use|Failed to open/i.test(String(error && error.message));
      set('off', busy
        ? 'The USB port is busy. Close other pages or programs that show the Pico (a serial console, code.circuitpython.org, Mu) and try again.'
        : `Could not open the USB port (${error && error.message ? error.message : error}).`);
      return false;
    }
    writer = port.writable.getWriter();
    remember(true);
    set('connected', 'Connected. Waiting for the Pico to say hello…');
    readLoop();
    await send({ cmd: 'hello' });
    return true;
  }

  /* Ask for a port (a click is needed) or reuse one this page was allowed before. */
  async function connect({ choose = true } = {}) {
    if (!supported()) { set('off', why()); return false; }
    if (port) return true;
    const known = (await navigator.serial.getPorts()).filter(p => (p.getInfo().usbVendorId || VENDOR) === VENDOR);
    if (known.length && !choose) return open(known[0]);
    try {
      return await open(await navigator.serial.requestPort({ filters: [{ usbVendorId: VENDOR }] }));
    } catch (error) {
      set('off', error && error.name === 'NotFoundError'
        ? 'No port was chosen. Plug the Pico in with a USB cable that carries data, then press Connect again.'
        : `Could not ask for a USB port (${error && error.message ? error.message : error}).`);
      return false;
    }
  }

  /* On page load: reconnect only when the person connected before and the Pico is still plugged in. */
  async function resume() {
    if (!supported() || !remembered() || port) return;
    try { await connect({ choose: false }); } catch (_) { /* nothing plugged in: stay quiet */ }
  }

  async function disconnect() {
    closing = true;
    remember(false);
    waiting.forEach(item => { clearTimeout(item.timer); item.resolve(null); });
    waiting = [];
    try { if (reader) await reader.cancel(); } catch (_) { /* done */ }
    try { if (writer) { writer.releaseLock(); } } catch (_) { /* done */ }
    try { if (port) await port.close(); } catch (_) { /* done */ }
    port = null; writer = null; reader = null;
    state.hello = null; state.lastReading = null;
    set('off', 'Disconnected.');
  }

  async function send(body) {
    if (!writer) return false;
    await writer.write(new TextEncoder().encode(`DV1 ${JSON.stringify(body)}\n`));
    return true;
  }

  /* Send a command and wait for the Pico's answer (null after the time runs out). */
  function request(body, ms = 20000) {
    return new Promise(resolve => {
      if (!writer) return resolve(null);
      const item = { cmd: body.cmd, resolve, timer: setTimeout(() => { waiting = waiting.filter(w => w !== item); resolve(null); }, ms) };
      waiting.push(item);
      send(body).catch(() => resolve(null));
    });
  }

  if (supported() && navigator.serial.addEventListener) {
    navigator.serial.addEventListener('disconnect', () => { if (port && !closing) { /* readLoop notices and reports */ } });
    navigator.serial.addEventListener('connect', () => { if (!port) resume(); });
  }
  document.addEventListener('DOMContentLoaded', () => { setTimeout(resume, 1500); });

  return { supported, why, viaWifi, connect, disconnect, resume, send, request, on, state, parseLine, stamp, refreshAssignments: () => loadAssigned(true),
    setOffset: value => { offset = value; }, remembered };
})();
window.ColourBridge = ColourBridge;
