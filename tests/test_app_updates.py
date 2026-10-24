"""Release integrity, safe replacement, and recovery without touching user data."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
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
        # The pretend release is v0.2.0, so pretend 0.1.0 is installed, whatever VERSION says.
        installed = patch.object(updates, 'version', return_value='0.1.0')
        installed.start(); self.addCleanup(installed.stop)

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

    def test_broken_git_checkout_refused_without_changes(self):
        (self.root / '.git').mkdir()
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), self.assertRaisesRegex(ValueError, 'Nothing was changed'):
            updates.prepare(self.root)
        self.assertEqual((self.root / 'backend/app.py').read_text(), '# old')

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


class NewestBuilds(unittest.TestCase):
    """The "Newest builds" channel: only changed files, each checked against GitHub's record."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'backend/data').mkdir(parents=True)
        (self.root / 'backend/data/fleet.json').write_text('private settings')
        self.files = {'VERSION': b'0.1.0-dev\n', 'start.py': b'# launcher', 'backend/app.py': b'# server',
                      'frontend/index.html': b'<html>same</html>'}
        for name, data in self.files.items():
            (self.root / name).parent.mkdir(parents=True, exist_ok=True)
            (self.root / name).write_bytes(data)
        self.remote = dict(self.files, **{'backend/app.py': b'# server, improved', 'frontend/new.js': b'// new',
                                          'tests/test_x.py': b'# not shipped', 'backend/data/fleet.json': b'{}'})
        self.settings = patch.object(updates, '_PATH', str(self.root / 'prefs.json'))
        self.settings.start(); self.addCleanup(self.settings.stop)
        self.downloads = []

    def github(self, url, limit, tamper=None):
        sha, tree = 'a' * 40, 'b' * 40
        if url == updates.COMMIT_API:
            return json.dumps({'sha': sha, 'commit': {'tree': {'sha': tree}, 'message': 'Better twin\n\nlong text',
                                                      'committer': {'date': '2026-10-24T01:00:00Z'}}}).encode()
        if url.startswith('https://api.github.com/repos/Jbyjre/Deja_VU1/git/trees/' + tree):
            return json.dumps({'truncated': False, 'tree': [
                {'path': p, 'type': 'blob', 'mode': '100644', 'size': len(d), 'sha': updates.git_blob_sha(d)}
                for p, d in self.remote.items()]}).encode()
        for path, data in self.remote.items():
            if url == updates.RAW.format(repo=updates.REPO, sha=sha, path=updates.quote(path)):
                self.downloads.append(path)
                return (tamper or {}).get(path, data)
        raise AssertionError('unexpected URL ' + url)

    def test_check_counts_only_shipped_changed_files(self):
        with patch.object(updates, '_read_url', side_effect=self.github):
            info = updates.latest_info(self.root)
        self.assertEqual((info['changed'], info['available'], info['title'], info['commit']), (2, True, 'Better twin', 'aaaaaaa'))
        self.assertEqual(self.downloads, [])            # a check downloads no files

    def test_install_downloads_only_what_changed_and_records_the_build(self):
        updates.save_settings({'channel': 'latest'})
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), patch.object(updates, '_read_url', side_effect=self.github):
            result = updates.prepare(self.root)
        self.assertEqual(sorted(self.downloads), ['backend/app.py', 'frontend/new.js'])
        self.assertEqual(result['changed'], 2)
        self.assertTrue(updates.apply_pending(self.root, lambda v: v == '0.1.0-dev'))
        self.assertEqual((self.root / 'backend/app.py').read_bytes(), b'# server, improved')
        self.assertEqual((self.root / 'frontend/new.js').read_bytes(), b'// new')
        self.assertFalse((self.root / 'tests').exists())
        self.assertEqual((self.root / 'backend/data/fleet.json').read_text(), 'private settings')
        self.assertEqual(updates.build(self.root)['commit'], 'a' * 40)

    def test_a_file_that_does_not_match_installs_nothing(self):
        updates.save_settings({'channel': 'latest'})
        bad = lambda url, limit: self.github(url, limit, tamper={'frontend/new.js': b'// swapped'})
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), patch.object(updates, '_read_url', side_effect=bad):
            with self.assertRaisesRegex(ValueError, 'did not match'):
                updates.prepare(self.root)
        self.assertFalse((self.root / '.dejavu-update').exists())
        self.assertEqual((self.root / 'backend/app.py').read_bytes(), b'# server')

    def test_up_to_date_says_so(self):
        self.remote = dict(self.files)
        with patch.object(updates, '_read_url', side_effect=self.github):
            self.assertFalse(updates.latest_info(self.root)['available'])

    def test_settings_are_checked(self):
        for bad in ({'channel': 'nightly'}, {'auto_install': 'yes'}, {}):
            with self.assertRaises(ValueError):
                updates.save_settings(bad)
        s = updates.save_settings({'channel': 'latest', 'auto_install': True, 'automatic': True})
        self.assertEqual((s['channel'], s['auto_install'], s['automatic']), ('latest', True, True))

    def test_the_watcher_installs_by_itself_only_when_asked(self):
        updates.save_settings({'channel': 'latest', 'automatic': True})
        installed = []
        ready = {'install_supported': True, 'latest': {'installable': True}}
        with patch.object(updates, 'check', return_value=ready):
            stop = __import__('threading').Event()
            with patch.object(updates, 'automatic_check', side_effect=[ready, None]):
                def once(*a):
                    stop.set()
                    return True
                with patch.object(stop, 'wait', side_effect=once):
                    updates.watch(lambda: installed.append(1), stop=stop)
        self.assertEqual(installed, [])                 # auto_install is off
        updates.save_settings({'auto_install': True})
        stop = __import__('threading').Event()
        with patch.object(updates, 'automatic_check', return_value=ready), patch.object(stop, 'wait', side_effect=lambda *a: stop.set() or True):
            updates.watch(lambda: installed.append(1), stop=stop)
        self.assertEqual(installed, [1])


@unittest.skipUnless(shutil.which('git'), 'git is not installed')
class GitCopyUpdates(unittest.TestCase):
    """A copy made with git or GitHub Desktop: fast-forward only, never over local changes."""

    def git(self, cwd, *args):
        return subprocess.run(['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                               '-c', 'init.defaultBranch=main', *args], cwd=cwd, check=True,
                              capture_output=True, text=True).stdout.strip()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.github, self.author, self.copy = base / 'github.git', base / 'author', base / 'copy'
        self.git(base, 'init', '--bare', '-q', str(self.github))
        self.git(base, 'clone', '-q', str(self.github), str(self.author))
        (self.author / 'VERSION').write_text('0.8.0\n')
        (self.author / 'app.py').write_text('# old')
        self.git(self.author, 'add', '.'); self.git(self.author, 'commit', '-qm', 'first')
        self.git(self.author, 'push', '-q', 'origin', 'HEAD:main')
        self.git(base, 'clone', '-q', '--branch', 'main', str(self.github), str(self.copy))
        self.settings = patch.object(updates, '_PATH', str(base / 'prefs.json'))
        self.settings.start(); self.addCleanup(self.settings.stop)

    def publish(self, text='# new', ver='0.9.0'):
        (self.author / 'app.py').write_text(text)
        (self.author / 'VERSION').write_text(ver + '\n')
        self.git(self.author, 'commit', '-qam', 'A new feature')
        self.git(self.author, 'push', '-q', 'origin', 'HEAD:main')

    def test_up_to_date_copy_has_nothing_to_install(self):
        info = updates.git_release_info(updates.git_info(self.copy))
        self.assertFalse(info['available'])
        self.assertIn('latest', info['message'])

    def test_new_commit_on_github_is_found_and_installed(self):
        self.publish()
        info = updates.git_release_info(updates.git_info(self.copy))
        self.assertEqual((info['available'], info['installable'], info['version']), (True, True, '0.9.0'))
        self.assertEqual(info['changes'], ['A new feature'])
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'):
            self.assertEqual(updates.prepare(self.copy), {'ready': True, 'version': '0.9.0'})
        self.assertEqual((self.copy / 'app.py').read_text(), '# new')
        self.assertTrue(updates.apply_pending(self.copy, lambda v: v == '0.9.0'))
        self.assertFalse((self.copy / '.dejavu-update').exists())

    def test_files_changed_by_hand_are_never_overwritten(self):
        self.publish()
        (self.copy / 'app.py').write_text('# my own edit')
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), self.assertRaisesRegex(ValueError, 'changed by hand'):
            updates.prepare(self.copy)
        self.assertEqual((self.copy / 'app.py').read_text(), '# my own edit')

    def test_failed_start_returns_to_the_previous_commit(self):
        before = self.git(self.copy, 'rev-parse', 'HEAD')
        self.publish()
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'):
            updates.prepare(self.copy)
        self.assertFalse(updates.apply_pending(self.copy, lambda v: False))
        self.assertEqual(self.git(self.copy, 'rev-parse', 'HEAD'), before)
        self.assertEqual((self.copy / 'app.py').read_text(), '# old')

    def test_printer_starting_during_check_stops_the_update(self):
        self.publish()
        def busy():
            raise ValueError('printer started printing')
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), self.assertRaisesRegex(ValueError, 'started printing'):
            updates.prepare(self.copy, before_commit=busy)
        self.assertEqual((self.copy / 'app.py').read_text(), '# old')
        self.assertFalse((self.copy / '.dejavu-update').exists())

    def test_github_desktop_git_is_found_on_windows(self):
        local = Path(self.tmp.name) / 'local'
        for ver in ('3.4.9', '3.10.1'):
            exe = local / 'GitHubDesktop' / f'app-{ver}' / 'resources/app/git/cmd/git.exe'
            exe.parent.mkdir(parents=True); exe.write_text('')
        with patch.object(updates.shutil, 'which', return_value=None), patch.dict(os.environ, LOCALAPPDATA=str(local)):
            self.assertIn('app-3.10.1', updates.find_git(windows=True))  # newest, compared as numbers
