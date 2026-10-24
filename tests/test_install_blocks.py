"""The copy-and-paste install blocks say the same thing everywhere and fetch the real release asset."""
import html
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parent.parent
ASSET = 'https://github.com/Jbyjre/Deja_VU1/releases/latest/download/deja-vu1-update.zip'


def markdown_blocks(path):
    text = (ROOT / path).read_text(encoding='utf-8')
    found = {}
    for lang, body in re.findall(r'```(powershell|bash)\n(.*?)```', text, re.S):
        lines = [line.strip() for line in body.strip().splitlines()]
        if any(ASSET in line for line in lines):
            found[lang] = '\n'.join(lines)
    return found


def page_blocks():
    text = (ROOT / 'frontend/welcome.html').read_text(encoding='utf-8')
    blocks = [html.unescape(b) for b in re.findall(r'data-copy="([^"]*)"', text)]
    return {('powershell' if 'Expand-Archive' in b else 'bash'): b for b in blocks}


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


if __name__ == '__main__':
    unittest.main()
