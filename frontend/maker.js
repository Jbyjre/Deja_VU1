/* Local image decoding; only a small pixel grid reaches the standard-library backend. */
'use strict';
(() => {
  const host = document.createElement('section');
  host.className = 'card liquid-glass maker-workspace';
  host.id = 'maker-workspace';
  host.innerHTML = `<div class="card-head"><div><span class="eyebrow">FOUR TOOLS · REAL MODEL GEOMETRY</span><h2>From image to print project</h2><p class="card-sub">Make colour tiles, a measured layer print, or a heightmap relief. Your saved tool colours travel with the 3MF.</p></div></div>
    <div class="maker-layout"><div><label>Image<input id="mk-image" type="file" accept="image/png,image/jpeg,image/webp"></label><button class="btn" id="mk-test">Try a colour test image</button><label>Make<select id="mk-mode"><option value="mosaic">Colour tiles · four filaments</option><option value="layered">Layered colour · measured swatches</option><option value="terrain">Heightmap relief · lighter is higher</option></select></label><div class="profile-options"><label>Print width, mm<input id="mk-width" type="number" min="5" max="240" value="80"></label><label>Image detail, pixels across<select id="mk-detail"><option>16</option><option selected>32</option><option>64</option><option>96</option></select></label><label>Layer thickness, mm<input id="mk-height" type="number" min=".04" max=".56" value=".2" step=".01"></label><label>Relief height, mm<input id="mk-rise" type="number" min=".2" max="80" value="15" step=".1"></label></div><label><input type="checkbox" id="mk-dither" checked> Dither colours · small neighbouring tiles blend at a distance</label><div class="fd-actions"><button class="btn primary" id="mk-build">Build & save a 3MF</button><button class="btn" id="mk-open" hidden>Open generated model</button></div><p id="mk-status" role="status" aria-live="polite">Save Tools & filaments in Files › Slicing first. Choose an image or try the test image. No time or filament figure is guessed here.</p></div>
    <figure><canvas id="mk-preview" width="384" height="256" aria-label="Image or quantized colour preview"></canvas><figcaption id="mk-caption">Small-grid image preview. Transparent pixels use white.</figcaption></figure></div>
    <details id="mk-calibration"><summary>Calibrate layered colours with your printed swatches</summary><label>Calibration slicing profile<select id="mk-profile"><option value="">Load saved profiles first</option></select></label><button class="btn" id="mk-profiles">Load slicing profiles</button><p>Build the sixteen-swatch sheet with your exact four tools. Slice it at the layer thickness above. After printing, record each tile’s measured colour in row order, from the top left. Thin filament layers can change colour; a screen calculation cannot measure that.</p><button class="btn" id="mk-sheet">Build calibration sheet</button><button class="btn" id="mk-load">Load this setup’s measurements</button><div id="mk-swatches" class="calibration-swatches"></div><label><input id="mk-measured" type="checkbox"> These values came from my printed swatches</label><button class="btn" id="mk-save-calibration">Save measured colours</button><p class="field-hint">Changing saved spools, colours, nozzles or layer thickness selects a different calibration. There is no automatic camera measurement.</p></details>`;
  const tab = $('tab-studio');
  tab.insertBefore(host, tab.firstElementChild?.nextSibling || null);
  let source = null,
    built = null;
  const canvas = $('mk-preview'),
    ctx = canvas.getContext('2d');
  const height = () => Number($('mk-height').value);
  function pixels() {
    if (!source) throw new Error('Choose an image or try the test image first.');
    const w = Number($('mk-detail').value),
      h = Math.max(2, Math.round((w * source.height) / source.width));
    if (h > 96) throw new Error('This image is very tall. Reduce image detail or crop it first.');
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.drawImage(source, 0, 0, w, h);
    const rgba = g.getImageData(0, 0, w, h).data,
      rgb = [];
    for (let i = 0; i < rgba.length; i += 4) rgb.push(rgba[i], rgba[i + 1], rgba[i + 2]);
    return { pixels: rgb, pixels_w: w, pixels_h: h };
  }
  function showSource() {
    canvas.width = 384;
    canvas.height = Math.round((384 * source.height) / source.width);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    $('mk-caption').textContent = 'Source image. A printed result depends on your physical filaments.';
  }
  $('mk-image').onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 20 * 1024 * 1024) throw new Error('Use an image smaller than 20 MB.');
      const img = await createImageBitmap(f, { resizeWidth: 1024, resizeQuality: 'high' });
      source = img;
      showSource();
      $('mk-status').textContent = 'Image loaded. Choose what to make, then build a new 3MF.';
    } catch (err) {
      $('mk-status').textContent = err.message;
    }
    e.target.value = '';
  };
  $('mk-test').onclick = () => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const g = c.getContext('2d'),
      gradient = g.createLinearGradient(0, 0, 64, 48);
    gradient.addColorStop(0, '#f26a1b');
    gradient.addColorStop(0.45, '#f2f2f0');
    gradient.addColorStop(1, '#3b82f6');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 48);
    g.fillStyle = '#1c1c1e';
    g.fillRect(16, 12, 20, 24);
    source = c;
    showSource();
  };
  async function build(mode) {
    const printer = currentPrinter;
    const b = $('mk-build');
    b.disabled = true;
    try {
      const payload = {
        mode,
        profile: $('mk-profile').value || null,
        layer_height: height(),
        width: Number($('mk-width').value),
        rise: Number($('mk-rise').value),
        dither: $('mk-dither').checked,
        ...(mode === 'calibration' ? {} : pixels())
      };
      const r = await postJSON(api('/api/maker/build'), payload);
      if (printer !== currentPrinter) {
        $('mk-status').textContent =
          'Printer changed. The earlier model belongs to its original tool setup; generate again for this printer.';
        return;
      }
      if (!r.ok)
        throw new Error(
          r.body.error || 'The model could not be built. Enable Photo Studio and File library in Settings.'
        );
      built = r.body.file.name;
      $('mk-open').hidden = false;
      $('mk-status').textContent = 'Saved ' + built + '. ' + r.body.note;
      const p = r.body.preview;
      if (p) {
        canvas.width = p.width * 8;
        canvas.height = p.height * 8;
        p.indices.forEach((n, i) => {
          ctx.fillStyle = p.colours[n];
          ctx.fillRect((i % p.width) * 8, Math.floor(i / p.width) * 8, 8, 8);
        });
        $('mk-caption').textContent =
          'Recipe selection preview · ' + p.source + '. This is not a photograph of a print.';
      }
      await Workshop.loadFiles();
    } catch (err) {
      $('mk-status').textContent = err.message;
    } finally {
      b.disabled = false;
    }
  }
  $('mk-build').onclick = () => build($('mk-mode').value);
  $('mk-sheet').onclick = () => build('calibration');
  $('mk-open').onclick = async () => {
    showTab('files');
    await Workshop.openFile(built);
  };
  $('mk-swatches').innerHTML = Array.from(
    { length: 16 },
    (_, i) =>
      `<label>Row ${Math.floor(i / 4) + 1}, column ${(i % 4) + 1}<input type="text" data-swatch="${i}" placeholder="#RRGGBB" pattern="#[0-9A-Fa-f]{6}" maxlength="7" aria-label="Measured colour row ${Math.floor(i / 4) + 1} column ${(i % 4) + 1}"></label>`
  ).join('');
  $('mk-load').onclick = async () => {
    const r = await getJSON(
      api('/api/maker/settings?height=' + height() + '&profile=' + encodeURIComponent($('mk-profile').value))
    );
    if (r?.calibration) {
      r.calibration.colours.forEach((c, i) => (host.querySelector('[data-swatch="' + i + '"]').value = c));
      $('mk-status').textContent = 'Loaded user-measured colours for this tool setup and thickness.';
    } else
      $('mk-status').textContent =
        r?.calibration_state === 'process_changed'
          ? 'Process changed. Print and measure new swatches.'
          : r?.error || 'No measured calibration for this tool setup and thickness. Build and measure the sheet first.';
  };
  $('mk-profiles').onclick = async () => {
    const printer = currentPrinter;
    const data = await getJSON(api('/api/slicer/settings'));
    if (printer !== currentPrinter) return;
    $('mk-profile').innerHTML =
      '<option value="">Choose the swatch print profile</option>' +
      (data?.profiles || []).map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  };
  $('mk-save-calibration').onclick = async () => {
    const colours = [...host.querySelectorAll('[data-swatch]')].map(el => el.value.trim());
    if (!$('mk-profile').value) {
      $('mk-status').textContent = 'Choose the slicing profile used to print your measured swatches.';
      return;
    }
    const r = await postJSON(api('/api/maker/calibration'), {
      profile: $('mk-profile').value,
      layer_height: height(),
      colours,
      measured: $('mk-measured').checked
    });
    $('mk-status').textContent = r.ok ? 'Measured colours saved for these tools and this thickness.' : r.body.error;
  };
})();
