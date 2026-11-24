/* Deja Vu1 - one time-lapse player (FLOW.5).
 *
 * Deja Vu1's own flipbooks (frames kept during a print) and the printer's own videos play here, in one window that
 * behaves the same for both: play and pause, a scrub bar, a frame back and forward, speed, full screen and a Loop
 * switch that is off, so a time-lapse stops at its last frame. A video can be downloaded to open in the computer's
 * own player; a flipbook can be saved as a video. Keys: Space plays and pauses, the arrows step a frame, F fills
 * the screen. Opened from Printer › Camera & time-lapses, Printer › Prints and the finished-print summary.
 */
'use strict';
(() => {
  const dialog = $('flip-dialog');
  if (!dialog) return;
  const img = $('flip-img'), video = $('pl-video'), scrub = $('flip-scrub'), playBtn = $('flip-play'), count = $('flip-count');
  const speedSel = $('pl-speed'), loopBox = $('pl-loop'), stage = $('pl-stage');
  const FPS = 12;
  const st = { kind: null, frames: [], i: 0, timer: 0, session: null, printer: '', title: '' };
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const speed = () => +(speedSel.value || 1);
  const mmss = s => (isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
  const withDemo = url => (typeof demoOn !== 'undefined' && demoOn ? `${url}&demo=1` : url);

  function playing() { return st.kind === 'video' ? !video.paused && !video.ended : !!st.timer; }
  function label() {
    const atEnd = st.kind === 'video' ? video.ended : st.i >= st.frames.length - 1;
    playBtn.textContent = playing() ? 'Pause' : atEnd && !loopBox.checked ? 'Play again' : 'Play';
    playBtn.setAttribute('aria-pressed', String(playing()));
  }

  /* ---- frames ---- */
  function show() {
    const f = st.frames[st.i];
    if (!f) return;
    img.src = f.src;
    scrub.value = st.i;
    count.textContent = `${st.i + 1} / ${st.frames.length}`;
  }
  function stopFrames() { clearInterval(st.timer); st.timer = 0; label(); }
  function playFrames() {
    clearInterval(st.timer);
    if (st.i >= st.frames.length - 1) st.i = 0;
    st.timer = setInterval(() => {
      if (st.i >= st.frames.length - 1) {
        if (!loopBox.checked) { stopFrames(); return; }
        st.i = -1;
      }
      st.i += 1;
      show();
    }, 1000 / (FPS * speed()));
    label();
  }

  /* ---- the controls, for both kinds ---- */
  function toggle() {
    if (st.kind === 'video') {
      if (video.paused || video.ended) video.play().catch(() => toast('This video would not play here. Download it to open it in your computer’s own player.', 'warn'));
      else video.pause();
    } else if (st.timer) stopFrames();
    else playFrames();
    label();
  }
  function step(n) {
    if (st.kind === 'video') {
      video.pause();
      video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + n / 30));
    } else {
      stopFrames();
      st.i = Math.max(0, Math.min(st.frames.length - 1, st.i + n));
      show();
    }
    label();
  }
  playBtn.onclick = toggle;
  $('pl-back').onclick = () => step(-1);
  $('pl-fwd').onclick = () => step(1);
  scrub.addEventListener('input', () => {
    if (st.kind === 'video') { video.currentTime = (+scrub.value / 1000) * (video.duration || 0); return; }
    stopFrames();
    st.i = +scrub.value;
    show();
  });
  speedSel.addEventListener('change', () => { video.playbackRate = speed(); if (st.timer) playFrames(); });
  loopBox.addEventListener('change', () => { video.loop = loopBox.checked; label(); });
  $('pl-full').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => toast('Full screen is not allowed here', 'warn'));
  };
  document.addEventListener('fullscreenchange', () => { $('pl-full').textContent = document.fullscreenElement === stage ? 'Exit full screen' : 'Full screen'; });
  video.addEventListener('timeupdate', () => {
    if (st.kind !== 'video') return;
    scrub.value = video.duration ? Math.round((video.currentTime / video.duration) * 1000) : 0;
    count.textContent = `${mmss(video.currentTime)} / ${mmss(video.duration)}`;
  });
  ['play', 'pause', 'ended', 'loadedmetadata'].forEach(ev => video.addEventListener(ev, () => { label(); video.dispatchEvent(new Event('timeupdate')); }));
  video.addEventListener('error', () => {
    if (st.kind !== 'video' || !video.getAttribute('src')) return;
    $('flip-sub').textContent = $('pl-download').hidden
      ? 'This video did not load. The file may be gone, or the printer may not have finished writing it.'
      : 'This video did not play here. Download it to open it in your computer’s own player.';
  });
  dialog.addEventListener('keydown', e => {
    if (e.target.closest('select')) return;                                             // the speed list keeps its own keys
    if (e.target.closest('input[type="checkbox"], a, button:not(#flip-play)') && e.key === ' ') return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowLeft' && e.target !== scrub) { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight' && e.target !== scrub) { e.preventDefault(); step(1); }
    else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); $('pl-full').click(); }
  });
  dialog.addEventListener('close', () => {
    stopFrames();
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  });
  $('pl-save').onclick = e => { if (st.session && window.Workshop && Workshop.flipbookVideo) Workshop.flipbookVideo(st.session, st.title, e.currentTarget); };

  function open(kind, title, sub, links) {
    st.kind = kind;
    st.title = title || 'print';
    $('flip-title').textContent = title ? `Time-lapse: ${title}` : 'Time-lapse';
    $('flip-sub').textContent = sub;
    img.hidden = kind !== 'frames';
    video.hidden = kind !== 'video';
    $('pl-download').hidden = !links.download;
    if (links.download) $('pl-download').href = links.download;
    // Save as a video reads the current printer's frames, so it shows only for a flipbook of that printer.
    const other = st.printer && typeof currentPrinter !== 'undefined' && st.printer !== String(currentPrinter || '');
    $('pl-save').hidden = kind !== 'frames' || !window.MediaRecorder || st.frames.length < 2 || !!other;
    loopBox.checked = false;
    video.loop = false;
    video.playbackRate = speed();
    if (!dialog.open) {
      if (window.Workshop && Workshop.openDialog) Workshop.openDialog(dialog);
      else dialog.showModal();
    }
    playBtn.focus();
  }

  window.Player = {
    /* Deja Vu1's own flipbook of one print. `printer` picks whose frames (the current printer when left out). */
    async frames(session, opts = {}) {
      const who = opts.printer ? `&printer=${encodeURIComponent(opts.printer)}` : '';
      const base = opts.printer ? withDemo : api;
      const data = await getJSON(base(`/api/timelapse/frames?session=${encodeURIComponent(session)}${who}`)).catch(() => null);
      if (!data || !data.frames || !data.frames.length) { toast('No frames in that time-lapse yet', 'warn'); return; }
      stopFrames();
      st.session = session;
      st.printer = opts.printer ? String(opts.printer) : '';
      st.frames = data.frames.map(n => {
        const f = new Image();
        f.src = base(`/api/timelapse/frame?session=${encodeURIComponent(session)}&name=${encodeURIComponent(n)}${who}`);
        return f;
      });
      st.i = 0;
      scrub.min = 0;
      scrub.max = st.frames.length - 1;
      scrub.step = 1;
      open('frames', opts.title || data.filename || '', `${st.frames.length} frames from Deja Vu1’s camera, ${FPS} a second at normal speed. It stops at the last frame unless Loop is on.`, {});
      show();
      if (!reduced()) playFrames(); else label();
    },
    /* A video file: the printer's own recording or one kept on this computer. */
    video(url, opts = {}) {
      stopFrames();
      st.session = null;
      st.frames = [];
      scrub.min = 0;
      scrub.max = 1000;
      scrub.step = 1;
      scrub.value = 0;
      count.textContent = '0:00 / 0:00';
      video.src = url;
      open('video', opts.title || '', opts.sub || 'Plays here. Download it to keep it or open it in your computer’s own player.', { download: opts.download });
      if (!reduced()) video.play().catch(() => label()); else label();
    }
  };
})();
