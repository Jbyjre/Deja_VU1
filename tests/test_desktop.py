"""The launcher opens a browser tab, its own app window, or nothing, as chosen."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'backend'))
import desktop


class DesktopWindow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = patch.object(desktop, '_PATH', os.path.join(self.tmp.name, 'desktop.json'))
        p.start()
        self.addCleanup(p.stop)
        env = patch.dict(os.environ, {}, clear=False)
        env.start()
        self.addCleanup(env.stop)
        os.environ.pop('DEJAVU_WINDOW', None)
        os.environ.pop('DEJAVU_NO_BROWSER', None)

    def test_browser_tab_is_the_default_and_choices_are_checked(self):
        self.assertEqual(desktop.settings()['open_as'], 'browser')
        self.assertEqual(desktop.save_settings({'open_as': 'window'})['open_as'], 'window')
        with self.assertRaises(ValueError):
            desktop.save_settings({'open_as': 'fullscreen'})
        self.assertEqual(desktop.settings()['open_as'], 'window')

    def test_environment_overrides_the_saved_choice(self):
        desktop.save_settings({'open_as': 'window'})
        with patch.dict(os.environ, DEJAVU_WINDOW='browser'):
            self.assertEqual(desktop.launch_mode(), 'browser')
        with patch.dict(os.environ, DEJAVU_NO_BROWSER='1'):
            self.assertEqual(desktop.launch_mode(), 'none')
        self.assertEqual(desktop.launch_mode(), 'window')

    def test_app_window_uses_edge_or_chrome_app_mode(self):
        fake = Path(self.tmp.name) / 'chrome'
        fake.write_text('')
        with patch.object(desktop, 'app_browser', return_value=('Google Chrome', str(fake))), \
                patch.object(desktop.subprocess, 'Popen') as popen, patch.object(desktop.webbrowser, 'open') as tab:
            self.assertEqual(desktop.open_dashboard('http://localhost:8000', 'window'), 'window')
            self.assertEqual(popen.call_args[0][0], [str(fake), '--app=http://localhost:8000'])
            tab.assert_not_called()

    def test_without_edge_or_chrome_a_normal_tab_opens(self):
        with patch.object(desktop, 'app_browser', return_value=None), patch.object(desktop.webbrowser, 'open') as tab:
            self.assertEqual(desktop.open_dashboard('http://localhost:8000', 'window'), 'browser')
            tab.assert_called_once_with('http://localhost:8000')

    def test_nothing_opens_when_asked(self):
        with patch.object(desktop.webbrowser, 'open') as tab, patch.object(desktop.subprocess, 'Popen') as popen:
            self.assertEqual(desktop.open_dashboard('http://localhost:8000', 'none'), 'none')
            tab.assert_not_called()
            popen.assert_not_called()

    def test_windows_prefers_edge_which_windows_includes(self):
        base = Path(self.tmp.name)
        edge = base / 'x86' / 'Microsoft' / 'Edge' / 'Application' / 'msedge.exe'
        chrome = base / 'pf' / 'Google' / 'Chrome' / 'Application' / 'chrome.exe'
        for f in (edge, chrome):
            f.parent.mkdir(parents=True)
            f.write_text('')
        env = {'PROGRAMFILES(X86)': str(base / 'x86'), 'PROGRAMFILES': str(base / 'pf'), 'LOCALAPPDATA': str(base / 'none')}
        with patch.dict(os.environ, env), patch.object(desktop.os.path, 'join', lambda *a: '/'.join(a).replace('\\', '/')):
            self.assertEqual(desktop.app_browser('windows')[0], 'Microsoft Edge')

    def test_linux_finds_chromium_on_path(self):
        fake = Path(self.tmp.name) / 'chromium'
        fake.write_text('')
        with patch.object(desktop.shutil, 'which', lambda c: str(fake) if c == 'chromium' else None):
            self.assertEqual(desktop.app_browser('linux'), ('Chromium', str(fake)))

    def test_the_server_saves_the_choice(self):
        app = (Path(__file__).resolve().parent.parent / 'backend' / 'app.py').read_text()
        self.assertIn('if route == "/api/app/desktop":', app)
        self.assertIn('"desktop": desktop.settings()', app)


if __name__ == '__main__':
    unittest.main()
