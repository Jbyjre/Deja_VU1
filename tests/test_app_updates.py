"""Release integrity, safe replacement, and recovery without touching user data."""
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'backend'))
import app_updates as updates


def package(extra=None):
    files = {'VERSION': '0.2.0', 'start.py': '# launcher', 'backend/app.py': '# new',
             'frontend/index.html': '<html>new</html>'}
    files.update(extra or {})
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w') as z:
        for n, value in files.items(): z.writestr(n, value)
    return b.getvalue()


class AppUpdates(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'backend/data').mkdir(parents=True)
        (self.root / 'backend/data/fleet.json').write_text('private settings')
        (self.root / 'backend/app.py').write_text('# old')
        self.settings = patch.object(updates, '_PATH', str(self.root / 'prefs.json'))
        self.settings.start(); self.addCleanup(self.settings.stop)

    def release(self, data):
        return {'tag_name': 'v0.2.0', 'assets': [{'name': 'deja-vu1-update.zip',
                'browser_download_url': 'https://github.com/Jbyjre/Deja_VU1/releases/download/v0.2.0/deja-vu1-update.zip',
                'digest': 'sha256:' + hashlib.sha256(data).hexdigest()}]}

    def stage(self):
        data = package()
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), patch.object(updates, '_read_url',
                side_effect=[json.dumps(self.release(data)).encode(), data]):
            updates.prepare(self.root)

    def test_newer_release_and_numerical_comparison(self):
        self.assertGreater(updates.version_key('1.10.0'), updates.version_key('1.9.9'))
        self.assertTrue(updates.release_info(self.release(package()))['installable'])
        self.assertFalse(updates.settings()['automatic'])

    def test_checksum_failure_leaves_installation_untouched(self):
        data = package()
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), patch.object(updates, '_read_url',
                side_effect=[json.dumps(self.release(data)).encode(), b'wrong download']):
            with self.assertRaisesRegex(ValueError, 'checksum'): updates.prepare(self.root)
        self.assertEqual((self.root / 'backend/app.py').read_text(), '# old')
        self.assertFalse((self.root / '.dejavu-update').exists())

    def test_unsafe_archive_cannot_write_user_data_or_escape(self):
        for name in ('../escape.py', 'backend/data/fleet.json', '/absolute.py', 'backend/../data/x', 'frontend\\x',
                     'backend/DATA/private.json', 'frontend/CON.txt', 'frontend/file. ', 'frontend/x:stream'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                updates.unpack(package({name: 'bad'}), self.root / 'stage', '0.2.0')
        self.assertEqual((self.root / 'backend/data/fleet.json').read_text(), 'private settings')

    def test_custom_data_folder_is_never_replaced(self):
        custom = self.root / 'frontend' / 'private'
        with patch.dict(os.environ, DEJAVU_DATA_DIR=str(custom)):
            with self.assertRaisesRegex(ValueError, 'custom data'):
                updates._protect_data(self.root, ['frontend/private/settings.json'])
        with patch.dict(os.environ, DEJAVU_DATA_DIR=str(self.root / 'outside')):
            updates._protect_data(self.root, ['frontend/index.html'])

    def test_release_redirect_refuses_untrusted_destination_before_request(self):
        from urllib.request import Request
        handler = updates._ReleaseRedirect()
        for url in ('http://github.com/update.zip', 'https://evil.example/update.zip',
                    'https://github.com:8443/update.zip', 'https://user:secret@github.com/update.zip'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                handler.redirect_request(Request(updates.API), None, 302, 'Found', {}, url)

    def test_install_preserves_data_and_checks_new_version(self):
        self.stage()
        check = []
        self.assertTrue(updates.apply_pending(self.root, lambda v: check.append(v) or True))
        self.assertEqual(check, ['0.2.0'])
        self.assertEqual((self.root / 'backend/app.py').read_text(), '# new')
        self.assertEqual((self.root / 'backend/data/fleet.json').read_text(), 'private settings')

    def test_failed_start_rolls_back_and_removes_new_files(self):
        self.stage()
        self.assertFalse(updates.apply_pending(self.root, lambda v: False))
        self.assertEqual((self.root / 'backend/app.py').read_text(), '# old')
        self.assertFalse((self.root / 'VERSION').exists())
        self.assertEqual((self.root / 'backend/data/fleet.json').read_text(), 'private settings')

    def test_interrupted_update_recovers_before_another_start(self):
        self.stage()
        base = self.root / '.dejavu-update'
        (base / 'backup/backend').mkdir(parents=True)
        (base / 'backup/backend/app.py').write_text('# old')
        (self.root / 'backend/app.py').write_text('# interrupted')
        (base / 'journal.json').write_text(json.dumps([['backend/app.py', True]]))
        self.assertFalse(updates.apply_pending(self.root, lambda v: self.fail('must recover first')))
        self.assertEqual((self.root / 'backend/app.py').read_text(), '# old')

    def test_git_checkout_refused(self):
        (self.root / '.git').mkdir()
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), self.assertRaisesRegex(ValueError, 'development'):
            updates.prepare(self.root)

    def test_disabled_auto_check_never_uses_the_network(self):
        with patch.object(updates, '_read_url') as network:
            updates.automatic_check()
            network.assert_not_called()

    def test_printer_becoming_busy_during_download_cancels_install(self):
        data = package()
        def busy():
            raise ValueError('printer started printing')
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), patch.object(updates, '_read_url',
                side_effect=[json.dumps(self.release(data)).encode(), data]):
            with self.assertRaisesRegex(ValueError, 'started printing'):
                updates.prepare(self.root, before_commit=busy)
        self.assertFalse((self.root / '.dejavu-update').exists())
        self.assertEqual((self.root / 'backend/app.py').read_text(), '# old')
