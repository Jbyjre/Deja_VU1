/* recall.js: Deja Vu1 remembers (RECALL).
 *
 * The print record (prints.js, backend/print_record.py) keeps every print; this script connects it to the files you
 * open. A file that comes back, in Files, in Confirm Print or in the Slicer, gets a short line with its history: how
 * often it printed, how the last time ended, where it stopped and what the AI watch noted. A file that once finished
 * offers "Print it like the time it worked": the same G-code, and Confirm Print says what is on the heads now that was
 * not then. Printer › Prints gets plain facts from your own ended prints, each with the prints behind it.
 *
 * The server works out each file's fingerprint on this computer (backend/recall.py); nothing is sent anywhere. Every
 * sentence here is whole, so a translation can order it its own way, and every figure comes from the record: when the
 * record holds nothing, nothing is shown.
 */
'use strict';
window.Recall = (() => {
  const cache = new Map();                       // file -> { at, info } for a few seconds, so two screens ask once
  const KEEP_MS = 8000;

  const stamp = iso => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? null : d; };
  const day = iso => {
    const d = stamp(iso);
    return d ? d.toLocaleDateString([], { day: 'numeric', month: 'long', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : '';
  };

  async function about(file, fresh) {
    const known = cache.get(file);
    if (!fresh && known && Date.now() - known.at < KEEP_MS) return known.info;
    const info = await getJSON(api(`/api/prints/recall?file=${encodeURIComponent(file)}`)).catch(() => null);
    if (info && typeof info.count === 'number') cache.set(file, { at: Date.now(), info });
    return info && typeof info.count === 'number' ? info : null;
  }

  /* How the last print ended, with when and where, as one sentence. */
  function lastSentence(p) {
    const when = day(p.ended_at || p.started_at), where = p.printer_name || p.printer || '';
    if (when && where) {
      if (p.status === 'finished') return `The last time, on ${when} on ${where}, it finished.`;
      if (p.status === 'failed') return `The last time, on ${when} on ${where}, it failed.`;
      if (p.status === 'cancelled') return `The last time, on ${when} on ${where}, it was stopped.`;
      return `The last time was on ${when} on ${where}.`;
    }
    if (p.status === 'finished') return 'The last time, it finished.';
    if (p.status === 'failed') return 'The last time, it failed.';
    if (p.status === 'cancelled') return 'The last time, it was stopped.';
    return '';
  }

  /* Where a print that did not finish stopped, and why, in the record's own words. */
  function whySentences(p) {
    const out = [];
    const layer = p.layer || {};
    if (layer.current && layer.total) out.push(`It stopped at layer ${layer.current} of ${layer.total}.`);
    else if (layer.current) out.push(`It stopped at layer ${layer.current}.`);
    const notes = Array.isArray(p.watch) ? p.watch : [];
    const note = notes[notes.length - 1];
    if (note && note.why) out.push(`The AI watch noted: “${note.why}”`);
    else if (p.ended_because) out.push(`The printer said: “${p.ended_because}”`);
    return out;
  }

  /* The history of a file as plain sentences. Nothing when it has never been printed. */
  function sentences(info, file) {
    if (!info || !info.count || !info.last) return [];
    const done = (info.counts || {}).finished || 0;
    const out = [];
    if (info.count === 1) out.push('Printed once before.');
    else if (done === info.count) out.push(`Printed ${info.count} times before, every time to the end.`);
    else if (done) out.push(`Printed ${info.count} times before, ${done} of them to the end.`);
    else out.push(`Printed ${info.count} times before, none of them to the end.`);
    const last = info.last;
    if (last.file && last.file.toLowerCase() !== String(file).toLowerCase()) out.push(`The last print of it was ${last.file}.`);
    const said = lastSentence(last);
    if (said) out.push(said);
    if (last.status === 'failed' || last.status === 'cancelled') out.push(...whySentences(last));
    if (last.status !== 'finished' && info.worked) {
      const when = day(info.worked.ended_at || info.worked.started_at);
      if (when) out.push(`It last finished on ${when}.`);
    }
    return out;
  }

  /* One difference on one head as whole sentences, one for each thing that changed: material, colour, roll. */
  function differenceLines(d) {
    const out = [], then = d.then || {}, now = d.now || {}, changed = d.changed || [];
    if (changed.includes('material')) out.push(`${d.toolhead} had ${then.material} then and has ${now.material} now.`);
    if (changed.includes('colour')) {
      out.push(then.colour_name && now.colour_name && then.colour_name !== now.colour_name
        ? `${d.toolhead} was ${then.colour_name} then and is ${now.colour_name} now.` : `${d.toolhead} holds a different colour now.`);
    }
    if (changed.includes('roll')) out.push(`${d.toolhead} used the roll ${then.spool} then and uses ${now.spool} now.`);
    return out;
  }

  /* The block shown in Files and Confirm Print. `opts.repeat` adds "Print it like the time it worked". */
  function block(info, file, opts = {}) {
    const lines = sentences(info, file);
    if (!lines.length) return '';
    const worked = info.worked;
    const canRepeat = opts.repeat && worked && worked.in_library && worked.status === 'finished';
    const failedLast = info.last.status === 'failed' || info.last.status === 'cancelled';
    return `<div class="recall" data-tone="${failedLast ? 'warn' : 'ok'}" role="note" aria-label="This file in the print record">
      <span class="recall-mark" aria-hidden="true">↺</span>
      <div class="recall-text"><p>${lines.map(esc).join(' ')}</p>
        ${opts.differences && opts.differences.length ? `<p class="recall-diff-h">On the printer now, not as the time it worked:</p>
          <ul class="recall-diff">${opts.differences.flatMap(differenceLines).map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${opts.differences && !opts.differences.length && opts.checked ? '<p class="recall-same">The heads it used hold the same filament as the time it worked.</p>' : ''}
        <div class="recall-tools">
          ${canRepeat ? `<button class="btn small primary" type="button" data-recall-repeat="${esc(file)}">Print it like the time it worked</button>` : ''}
          ${info.prints && info.prints.length ? `<button class="btn small" type="button" data-recall-show="${esc(file)}">${info.prints.length === 1 ? 'Show that print' : 'Show those prints'}</button>` : ''}
        </div>
      </div></div>`;
  }

  /* "Print it like the time it worked": the G-code of the last print that finished, checked again by Confirm Print, which
   * also lists what is loaded differently now. */
  async function repeat(file, fromEl) {
    const r = await getJSON(api(`/api/prints/repeat?file=${encodeURIComponent(file)}`)).catch(e => ({ error: e.message }));
    if (!r || r.error || !r.file) { toast((r && r.error) || 'The record has no finished print of this file', 'warn'); return; }
    if (!r.ready) { toast(`The G-code of the time it worked, ${r.file}, is no longer in Files. Add it again to print it from here.`, 'warn', 8000); return; }
    if (window.Workshop && Workshop.openConfirm) Workshop.openConfirm(r.file, fromEl, null, { repeat: r });
  }

  /* Printer › Prints, filtered to the prints behind a line or a fact. */
  function show(ids, label) {
    if (window.Rail) Rail.goDest('history');
    if (window.Prints && Prints.only) Prints.only(ids, label);
  }

  function bind(host) {
    if (host.dataset.recallBound) return;
    host.dataset.recallBound = '1';
    host.addEventListener('click', e => {
      const b = e.target.closest('[data-recall-repeat], [data-recall-show]');
      if (!b) return;
      if (b.dataset.recallRepeat) { repeat(b.dataset.recallRepeat, b); return; }
      const dialog = b.closest('dialog');
      if (dialog && dialog.open) { if (window.Workshop && Workshop.closeDialog) Workshop.closeDialog(dialog); else dialog.close(); }
      const known = cache.get(b.dataset.recallShow);
      if (known) show(known.info.prints, b.dataset.recallShow);
    });
  }

  /* Files: the line under the file's name. Hidden when the file has no history. */
  async function intoFiles(host, file) {
    if (!host) return;
    host.hidden = true;
    host.innerHTML = '';
    const info = await about(file);
    if (!info || host.dataset.file !== file) return;
    const html = block(info, file, { repeat: true });
    host.innerHTML = html;
    host.hidden = !html;
    bind(host);
  }

  /* Confirm Print: the history at the top of the dialog, and, when the file once finished, what differs on the heads
   * now. `repeat` is the answer of /api/prints/repeat when the dialog was opened from "Print it like the time it worked". */
  async function intoConfirm(body, file, repeatAnswer) {
    if (!body) return;
    const info = await about(file);
    if (!info || !info.count) return;
    let differences = repeatAnswer ? repeatAnswer.differences : null;
    if (!differences && info.worked) {
      const r = await getJSON(api(`/api/prints/repeat?file=${encodeURIComponent(file)}`)).catch(() => null);
      differences = r && Array.isArray(r.differences) ? r.differences : null;
    }
    if (!body.isConnected || body.querySelector('.recall')) return;
    const html = block(info, file, { differences, checked: differences != null });
    if (!html) return;
    const wrap = document.createElement('div');
    wrap.className = 'recall-host';
    wrap.innerHTML = html;
    body.prepend(wrap);
    bind(wrap);
  }

  /* The Slicer: one sentence in its status line when a model from Files has a history. */
  async function intoSlicer(file, say) {
    const info = await about(file);
    const lines = sentences(info, file);
    if (lines.length) say(lines.slice(0, 2).join(' '));
  }

  /* ---- what the history says (RECALL.3), for Printer › Prints ---- */
  function factSentence(f) {
    if (f.kind === 'time') {
      if (Math.abs(f.percent) < 2) return `${f.printer_name} finishes on its estimates (${f.count} prints).`;
      return f.percent > 0 ? `${f.printer_name} takes ${f.percent} % longer than its estimates (${f.count} prints).`
        : `${f.printer_name} finishes ${-f.percent} % sooner than its estimates (${f.count} prints).`;
    }
    if (f.kind === 'material') return `${f.material} finished ${f.finished} of ${f.count} prints.`;
    if (f.kind === 'filament') {
      if (Math.abs(f.percent) < 2) return `Prints use the filament their files plan (${f.count} prints).`;
      return f.percent > 0 ? `Prints use ${f.percent} % more filament than their files plan (${f.count} prints).`
        : `Prints use ${-f.percent} % less filament than their files plan (${f.count} prints).`;
    }
    if (f.kind === 'first_layers') return `${f.early} of ${f.count} failed prints stopped in the first three layers.`;
    return '';
  }

  async function facts(host) {
    if (!host) return;
    const r = await getJSON(api('/api/prints/facts')).catch(() => null);
    const list = r && Array.isArray(r.facts) ? r.facts.filter(factSentence) : [];
    if (!list.length) {
      host.innerHTML = r && r.ended < r.needs * 2 ? `<p class="recall-facts-empty">Facts from your prints show here once there are a few of each kind to go on.</p>` : '';
      host.hidden = !host.innerHTML;
      return;
    }
    host.hidden = false;
    host.innerHTML = `<p class="recall-facts-h">What your prints say</p><ul class="recall-facts">${list.map((f, i) => `
      <li><button class="recall-fact" type="button" data-fact="${i}">${esc(factSentence(f))}</button></li>`).join('')}</ul>`;
    host.onclick = e => {
      const b = e.target.closest('[data-fact]');
      if (!b) return;
      const f = list[+b.dataset.fact];
      if (f && window.Prints && Prints.only) Prints.only(f.prints, factSentence(f));
    };
  }

  window.addEventListener('dv-live-event', e => {
    if (e.detail && e.detail.type === 'print_event') cache.clear();
  });

  return { about, sentences, intoFiles, intoConfirm, intoSlicer, repeat, facts, show };
})();
