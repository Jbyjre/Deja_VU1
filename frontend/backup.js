/* Restore is staged as a separate installation; it never overwrites active app data. */
'use strict';
(() => {
  const input = $('backup-upload'),
    review = $('backup-review');
  let preview = null;
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    preview = null;
    if (typeof tourOn === 'function' && tourOn()) {
      review.textContent = 'Backup and recovery need the local app. This public demo is a recording.';
      return;
    }
    input.disabled = true;
    review.textContent = 'Validating backup contents and checksums…';
    try {
      if (file.size > 256 * 1024 * 1024) throw new Error('Choose a backup ZIP no larger than 256 MB.');
      const response = await fetch('/api/backup/preview', { method: 'POST', body: file }),
        data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The backup could not be validated.');
      preview = data;
      review.innerHTML = `<h3>Review recovery copy</h3><p>${esc(data.files)} files · ${esc((data.bytes / 1048576).toFixed(1))} MB · ${esc(data.created_at || 'date unavailable')}</p><p>${esc(data.note)}</p><details><summary>Compare with current data</summary><ul>${data.changes
        .slice(0, 100)
        .map(c => `<li>${esc(c.name)} · ${esc(c.current)}</li>`)
        .join(
          ''
        )}</ul>${data.changes.length > 100 ? '<p>Showing the first 100 files.</p>' : ''}</details><details><summary>Credentials omitted (${data.secrets_left_out.length})</summary><ul>${data.secrets_left_out.map(s => `<li>${esc(s)}</li>`).join('')}</ul></details><label><input id="backup-confirm" type="checkbox"> Create a separate restored copy and keep my running installation.</label><button class="btn primary" id="backup-restore" disabled>Create recovery copy</button><button class="btn" id="backup-discard">Discard this preview</button>`;
      $('backup-discard').onclick = async () => {
        const r = await postJSON('/api/backup/discard', { id: preview.id });
        if (r.ok) {
          preview = null;
          review.textContent = 'Staged preview discarded. Your original backup and app data were kept.';
        } else review.textContent = r.body.error;
      };
      $('backup-confirm').onchange = e => ($('backup-restore').disabled = !e.target.checked);
      $('backup-restore').onclick = async e => {
        if (!preview || !$('backup-confirm').checked) return;
        e.currentTarget.disabled = true;
        const r = await postJSON('/api/backup/restore', { id: preview.id, confirmed: true });
        if (!r.ok) {
          review.textContent = r.body.error;
          return;
        }
        review.replaceChildren();
        const p = document.createElement('p');
        p.textContent = r.body.note;
        const folder = document.createElement('code');
        folder.textContent = r.body.folder;
        review.append(p, folder);
        preview = null;
      };
    } catch (e) {
      review.textContent = e.message;
    } finally {
      input.disabled = false;
      input.value = '';
    }
  };
})();
