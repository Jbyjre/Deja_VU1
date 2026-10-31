"""The copy-and-paste install and update blocks say the same thing everywhere and fetch the real release asset."""
import html
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import update_blocks  # noqa: E402
ASSET = 'https://github.com/Jbyjre/Deja_VU1/releases/latest/download/deja-vu1-update.zip'
STOP = 'api/app/stop'          # only the update blocks stop a running copy first


def is_start(block):
    """A Start and check block: it downloads only when the folder has no start.py."""
    return 'Test-Path' in block or '[ -f ' in block


def markdown_blocks(path, update=False, start=False):
    text = (ROOT / path).read_text(encoding='utf-8')
    found = {}
    for lang, body in re.findall(r'```(powershell|bash)\n(.*?)```', text, re.S):
        lines = [line.strip() for line in body.strip().splitlines()]
        block = '\n'.join(lines)
        if is_start(block) != start:
            continue
        if any(ASSET in line for line in lines) and any(STOP in line for line in lines) == update:
            found[lang] = block
    return found


def page_blocks(update=False):
    text = (ROOT / 'frontend/welcome.html').read_text(encoding='utf-8')
    blocks = [html.unescape(b) for b in re.findall(r'data-copy="([^"]*)"', text)]
    return {('powershell' if 'Expand-Archive' in b else 'bash'): b for b in blocks if (STOP in b) == update}


def html_blocks(path, attribute):
    text = (ROOT / path).read_text(encoding='utf-8')
    found = {}
    for os_name, body in re.findall(attribute + r'="(win|unix)".*?<code>(.*?)</code>', text, re.S):
        found.setdefault('powershell' if os_name == 'win' else 'bash', []).append(html.unescape(body))
    return found


def app_blocks():
    text = (ROOT / 'frontend/index.html').read_text(encoding='utf-8')
    found = {}
    for os_name, body in re.findall(r'data-os-block="(win|unix)".*?<code>(.*?)</code>', text, re.S):
        found['powershell' if os_name == 'win' else 'bash'] = html.unescape(body)
    return found


class InstallBlocks(unittest.TestCase):
    def test_readme_guide_and_product_page_match(self):
        readme = markdown_blocks('README.md')
        self.assertEqual(set(readme), {'powershell', 'bash'})
        self.assertEqual(markdown_blocks('docs/getting-started.md'), readme)
        self.assertEqual(page_blocks(), readme)

    def test_blocks_fetch_the_asset_the_release_workflow_publishes(self):
        workflow = (ROOT / '.github/workflows/release.yml').read_text(encoding='utf-8')
        self.assertIn('deja-vu1-update.zip', workflow)
        for block in markdown_blocks('README.md').values():
            self.assertIn(ASSET, block)

    def test_blocks_start_the_app_and_never_touch_saved_data(self):
        blocks = markdown_blocks('README.md')
        self.assertIn('start-windows.bat', blocks['powershell'])
        self.assertIn('python3 start.py', blocks['bash'])
        self.assertIn('chmod +x', blocks['bash'])          # the double-click launchers stay runnable
        for block in blocks.values():
            self.assertNotIn('backend/data', block)
            self.assertNotRegex(block, r'\b(rm|del|Remove-Item)\b')


class UpdateBlocks(unittest.TestCase):
    """Another way to update: the same two blocks in the README, the guide, the product page and Settings."""

    def test_every_copy_matches_the_one_source(self):
        source = {'powershell': update_blocks.POWERSHELL, 'bash': update_blocks.BASH}
        self.assertEqual(markdown_blocks('README.md', update=True), source)
        self.assertEqual(markdown_blocks('docs/getting-started.md', update=True), source)
        self.assertEqual(page_blocks(update=True), source)
        self.assertEqual(app_blocks(), source)

    def test_blocks_stop_install_and_start_without_touching_data(self):
        for block in (update_blocks.POWERSHELL, update_blocks.BASH):
            self.assertIn(STOP, block)
            self.assertIn(ASSET, block)
            self.assertNotIn('backend/data', block)
            self.assertNotRegex(block, r'\b(rm|del|Remove-Item)\b')
        self.assertIn('start-windows.bat', update_blocks.POWERSHELL)
        self.assertIn('python3 start.py', update_blocks.BASH)


if __name__ == '__main__':
    unittest.main()


class StartBlocks(unittest.TestCase):
    """Start and check: the same two blocks in the README, the guide, Settings and the offline page."""

    def test_every_copy_matches_the_one_source(self):
        source = {'powershell': update_blocks.START_POWERSHELL, 'bash': update_blocks.START_BASH}
        self.assertEqual(markdown_blocks('README.md', start=True), source)
        self.assertEqual(markdown_blocks('docs/getting-started.md', start=True), source)
        self.assertEqual({k: v for k, (v,) in html_blocks('frontend/index.html', 'data-start-block').items()}, source)
        offline = html_blocks('frontend/offline.html', 'data-block')
        self.assertEqual(offline['powershell'], [update_blocks.START_POWERSHELL, update_blocks.POWERSHELL])
        self.assertEqual(offline['bash'], [update_blocks.START_BASH, update_blocks.BASH])

    def test_blocks_start_the_launcher_and_never_touch_saved_data_or_stop_anything(self):
        for block in (update_blocks.START_POWERSHELL, update_blocks.START_BASH):
            self.assertIn('start.py', block)
            self.assertIn(ASSET, block)                     # only when the folder has no copy yet
            self.assertNotIn(STOP, block)
            self.assertNotIn('backend/data', block)
            self.assertNotRegex(block, r'\b(rm|del|Remove-Item|Stop-Process|pkill)\b')
        self.assertIn('py -3 start.py', update_blocks.START_POWERSHELL)
        self.assertIn('python3 start.py', update_blocks.START_BASH)

    def test_the_windows_update_block_also_stops_the_launcher_that_would_restart_a_stuck_server(self):
        # Only a parent whose command line runs start.py, never the window someone typed into.
        self.assertIn("$p.CommandLine -like '*start.py*'", update_blocks.POWERSHELL)

