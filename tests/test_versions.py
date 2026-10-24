"""The version history, the VERSION file, the changelog and the GitHub release agree."""
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'backend'))
import app_updates

HISTORY = json.loads((ROOT / 'frontend/versions.json').read_text(encoding='utf-8'))['versions']
FRONTEND = ''.join(p.read_text(encoding='utf-8') for p in (ROOT / 'frontend').glob('*.js')) + \
    (ROOT / 'frontend/index.html').read_text(encoding='utf-8')
TABS = set(re.findall(r'data-tab="([a-z]+)"', (ROOT / 'frontend/index.html').read_text(encoding='utf-8')))


class VersionHistory(unittest.TestCase):
    def test_newest_entry_is_the_installed_version(self):
        self.assertEqual(HISTORY[0]['version'], app_updates.version(ROOT))

    def test_newest_first_with_real_dates(self):
        keys = [app_updates.version_key(v['version']) for v in HISTORY]
        self.assertEqual(keys, sorted(keys, reverse=True))
        self.assertEqual(len(set(keys)), len(keys))
        dates = [v['date'] for v in HISTORY]
        self.assertEqual(dates, sorted(dates, reverse=True))
        for d in dates:
            self.assertRegex(d, r'^2\d{3}-\d\d-\d\d$')

    def test_every_version_is_in_the_changelog(self):
        changelog = (ROOT / 'CHANGELOG.md').read_text(encoding='utf-8')
        for v in HISTORY:
            self.assertTrue(f"## {v['version']} " in changelog, f"CHANGELOG.md has no ## {v['version']} heading")

    def test_every_entry_is_complete_and_tours_point_at_real_screens(self):
        for v in HISTORY:
            for field in ('name', 'summary', 'changes', 'highlights'):
                self.assertTrue(v.get(field), f"{v['version']} has no {field}")
            self.assertIsInstance(v['published'], bool)
            for h in v['highlights']:
                self.assertTrue(h['title'] and h['text'])
                self.assertTrue(h['target'].startswith('#'), h['target'])
                ident = h['target'][1:]
                self.assertTrue(re.search(rf"""(id="{ident}"|id = '{ident}'|id='{ident}'|'{ident}')""", FRONTEND),
                                f'{ident} is not on any screen')
                if 'tab' in h:
                    self.assertIn(h['tab'], TABS)

    def test_release_notes_come_from_the_same_entry(self):
        out = subprocess.run([sys.executable, str(ROOT / 'tools/release-notes.py'), HISTORY[0]['version']],
                             capture_output=True, text=True, check=True).stdout
        self.assertIn(HISTORY[0]['name'], out)
        for change in HISTORY[0]['changes']:
            self.assertIn(change, out)

    def test_release_workflow_publishes_the_package_the_updater_wants(self):
        workflow = (ROOT / '.github/workflows/release.yml').read_text(encoding='utf-8')
        self.assertIn('deja-vu1-update.zip', workflow)
        self.assertIn("a.get('name') == 'deja-vu1-update.zip'", (ROOT / 'backend/app_updates.py').read_text())
        self.assertIn('tools/package-update.py', workflow)
        self.assertIn('tools/release-notes.py', workflow)
