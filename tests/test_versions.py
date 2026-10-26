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


class EveryMergeIsARelease(unittest.TestCase):
    """A merge that did not raise VERSION still becomes the next numbered release."""

    def test_workflow_runs_on_every_merge_and_numbers_the_next_one(self):
        workflow = (ROOT / '.github/workflows/release.yml').read_text(encoding='utf-8')
        self.assertNotIn('paths:', workflow)                    # every push to main, not only VERSION changes
        self.assertIn('tools/next-release.py', workflow)
        self.assertIn('git push origin HEAD:main', workflow)

    def test_a_marketing_video_merge_publishes_no_release(self):
        # The owner (26 October 2026): the one merge that is not a release. The message reaches the
        # shell through env, never pasted into the script, so a merge title cannot run as code.
        workflow = (ROOT / '.github/workflows/release.yml').read_text(encoding='utf-8')
        self.assertIn("MESSAGE: ${{ github.event.head_commit.message }}", workflow)
        self.assertIn("grep -qiF '[marketing video]'", workflow)
        decide = workflow.index('[marketing video]\'; then')
        self.assertLess(decide, workflow.index('python tools/next-release.py'))   # checked before any numbering

    def test_next_release_writes_an_entry_the_version_tests_accept(self):
        import datetime
        import importlib.util
        import shutil
        import tempfile
        spec = importlib.util.spec_from_file_location('next_release', ROOT / 'tools/next-release.py')
        nr = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(nr)
        self.assertEqual(nr.bump('0.9.0'), '0.9.1')
        self.assertEqual(nr.bump('1.9.19'), '1.9.20')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'frontend').mkdir()
            shutil.copy(ROOT / 'frontend/versions.json', root / 'frontend/versions.json')
            shutil.copy(ROOT / 'CHANGELOG.md', root / 'CHANGELOG.md')
            new = nr.bump(app_updates.version(ROOT))
            nr.write(root, new, ['Smoother updates', 'A fix'], datetime.date(2099, 1, 2))
            self.assertEqual((root / 'VERSION').read_text().strip(), new)
            top = json.loads((root / 'frontend/versions.json').read_text(encoding='utf-8'))['versions'][0]
            self.assertEqual((top['version'], top['name'], top['changes'], top['published']),
                             (new, 'Smoother updates', ['Smoother updates', 'A fix'], True))
            self.assertTrue(top['highlights'][0]['target'].startswith('#'))
            log = (root / 'CHANGELOG.md').read_text(encoding='utf-8')
            self.assertIn(f'## {new} (2 January 2099): Smoother updates\n\n- Smoother updates\n- A fix\n', log)
            self.assertLess(log.index(f'## {new} '), log.index(f'## {HISTORY[0]["version"]} '))
