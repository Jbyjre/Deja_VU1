"""Copy the current captures and renders into their places in this repository.

Run capture.js, render.js, then this script from any directory. Historical
engine captures are retained. Copies for the marketing library are made by the
owner's private repository (tools/campaign/sync-library.py). Python standard library.
"""
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / 'out'
records = {}
for directory in [OUT / 'captures', OUT / 'extras', OUT / 'conversion', OUT / 'copy-review']:
    record_path = directory / 'capture-record.json'
    if not record_path.exists():
        continue
    record = json.loads(record_path.read_text())
    if record.get('errors'):
        raise SystemExit('Capture contains browser errors: ' + str(record_path))
    for entry in record['images']:
        source = directory / entry['file']
        if not source.is_file():
            raise SystemExit('Missing capture: ' + str(source))
        previous = records.get(entry['file'])
        if previous and previous['source'].stat().st_mtime > source.stat().st_mtime:
            continue
        records[entry['file']] = {**entry, 'source': source}
if not records:
    raise SystemExit('Run capture.js first')

copied = []


def copy(source, relative):
    destination = ROOT / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    copied.append(relative)


for name, entry in sorted(records.items()):
    if name in ['twin-model.jpg', 'fleet-cards.jpg']:
        continue
    copy(entry['source'], 'docs/img/' + name)
for name in ['overview', 'fleet', 'phone']:
    copy(records[name + '.jpg']['source'], 'frontend/img/' + name + '.jpg')
for source, name in [('twin-3d-printing', 'twin'), ('twin-drawing', 'twin-drawing')]:
    copy(records[source + '.jpg']['source'], 'frontend/img/' + name + '.jpg')
for source, name in [('twin-model', 'twin'), ('needs-you', 'needs-you'), ('fleet-cards', 'fleet-cards')]:
    copy(records[source + '.jpg']['source'], 'tools/readme-images/img/' + name + '.jpg')
copy(ROOT / 'docs/img/slicer-after-workspace-1366.png', 'frontend/img/workspace.png')
if '--sources' in sys.argv:
    print('Copied current source captures; render.js can now use them')
    raise SystemExit(0)
boards = {'b-problem': 'silent-docks', 'b-confirm': 'confirm-print', 'b-arch': 'how-it-connects',
          'b-features': 'whats-in-it', 'b-numbers': 'by-the-numbers'}
for source, name in boards.items():
    copy(OUT / (source + '.jpg'), 'docs/img/explainer-' + name + '.jpg')
copy(OUT / 'card-1200x630.png', 'frontend/img/social-card.png')
print('Copied', len(copied), 'files from', len(records), 'capture records')
