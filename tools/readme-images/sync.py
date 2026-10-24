"""Copy the current marketing sources into their shipped locations.

Run capture.js, render.js, then this script from any directory. Historical
engine captures, icons and versioned films are retained. Python standard library.
"""
import hashlib
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
OUT = HERE / 'out'
LIBRARY = ROOT / 'marketing-library'
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
        records[entry['file']] = {**entry, 'source': source,
                                 'capturedAt': datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat()}
if not records:
    raise SystemExit('Run capture.js first')

assets = []
def copy(source, relative, kind):
    destination = ROOT / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    assets.append({'path': relative, 'source': str(source.relative_to(ROOT)),
                   'kind': kind, 'bytes': destination.stat().st_size,
                   'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()})

for name, entry in sorted(records.items()):
    if name in ['twin-model.jpg', 'fleet-cards.jpg']:
        continue
    copy(entry['source'], 'docs/img/' + name, 'app capture')
    folder = '04-digital-twin' if name in ['twin-3d-printing.jpg', 'twin-front-printing.jpg',
                                         'twin-top-printing.jpg', 'twin-phone.jpg'] else '03-screenshots'
    copy(entry['source'], 'marketing-library/' + folder + '/' + name, 'app capture copy')
for name in ['overview', 'fleet', 'phone']:
    copy(records[name + '.jpg']['source'], 'frontend/img/' + name + '.jpg', 'product page')
    copy(records[name + '.jpg']['source'], 'marketing-library/03-screenshots/product-page-' + name + '.jpg', 'product page copy')
for source, name in [('twin-3d-printing', 'twin'), ('twin-drawing', 'twin-drawing')]:
    copy(records[source + '.jpg']['source'], 'frontend/img/' + name + '.jpg', 'product page')
for source, name in [('twin-model', 'twin'), ('needs-you', 'needs-you'), ('fleet-cards', 'fleet-cards')]:
    copy(records[source + '.jpg']['source'], 'tools/readme-images/img/' + name + '.jpg', 'share card source')
copy(ROOT / 'docs/img/slicer-after-workspace-1366.png', 'frontend/img/workspace.png', 'historical Linux validation capture')
if '--sources' in sys.argv:
    print('Copied current source captures; render.js can now use them')
    raise SystemExit(0)
boards = {'b-problem': 'silent-docks', 'b-confirm': 'confirm-print', 'b-arch': 'how-it-connects',
          'b-features': 'whats-in-it', 'b-numbers': 'by-the-numbers'}
for source, name in boards.items():
    for folder in ['docs/img/', 'marketing-library/02-explainer-boards/']:
        copy(OUT / (source + '.jpg'), folder + 'explainer-' + name + '.jpg', 'rendered explainer')
copy(OUT / 'card-1200x630.png', 'frontend/img/social-card.png', 'link preview')
copy(OUT / 'card-1200x630.png', 'marketing-library/01-main-image/link-preview-card-1200x630.png', 'link preview copy')
copy(OUT / 'card-1280x640.png', 'marketing-library/01-main-image/github-social-preview-1280x640.png', 'GitHub preview candidate')
manifest = json.loads((OUT / 'campaign-manifest.json').read_text())
if len(manifest) != 24:
    raise SystemExit('Expected six subjects in four formats')
for card in manifest:
    copy(OUT / card['file'], 'marketing-library/09-current-campaign/' + card['file'], 'campaign card')
copy(OUT / 'campaign-manifest.json', 'marketing-library/09-current-campaign/captions.json', 'captions and alternatives')
art = HERE / 'img/brand-loop.png'
assets.append({'path': str(art.relative_to(ROOT)), 'source': 'image_gen original conceptual artwork',
               'kind': 'conceptual brand art; not hardware or a physical print',
               'bytes': art.stat().st_size, 'sha256': hashlib.sha256(art.read_bytes()).hexdigest()})
provenance = {'source': 'Actual app, isolated simulated farm; stand-in connection explicitly labelled',
              'images': [{k: v for k, v in entry.items() if k != 'source'} for entry in records.values()],
              'errors': []}
(LIBRARY / 'capture-record.json').write_text(json.dumps(provenance, indent=2) + '\n')
(LIBRARY / 'current-assets.json').write_text(json.dumps({'generatedAt': datetime.now(timezone.utc).isoformat(),
                                                       'assets': assets}, indent=2) + '\n')
print('Copied', len(assets), 'current assets;', len(records), 'capture records; 24 campaign cards')
