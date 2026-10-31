"""
An update never leaves the dashboard out of reach (the owner, 31 October 2026):
Install runs in the background with its progress readable after a reload,
refusals say which printer and why, applying an update survives files Windows
keeps locked, and the ready check says in words whether everything works.
"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'backend'))
import app_updates as updates  # noqa: E402
import paste_blocks  # noqa: E402
import readiness  # noqa: E402


def package():
    files = {'VERSION': '0.2.0', 'start.py': '# launcher', 'backend/app.py': '# new',
             'frontend/index.html': '<html>new</html>'}
    b = io.BytesIO()
    with zipfile.ZipFile(b, 'w') as z:
        for n, value in files.items():
            z.writestr(n, value)
    return b.getvalue()


class Staged(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'backend/data').mkdir(parents=True)
        (self.root / 'backend/app.py').write_text('# old')
        for p in (patch.object(updates, '_PATH', str(self.root / 'prefs.json')),
                  patch.object(updates, 'version', return_value='0.1.0')):
            p.start()
            self.addCleanup(p.stop)

    def stage(self, step=None):
        data = package()
        release = {'tag_name': 'v0.2.0', 'assets': [{'name': 'deja-vu1-update.zip',
                   'browser_download_url': 'https://github.com/Jbyjre/Deja_VU1/releases/download/v0.2.0/x.zip',
                   'digest': 'sha256:' + hashlib.sha256(data).hexdigest()}]}

        def fake_read(url, limit, progress=None):
            if url == updates.API:
                return json.dumps(release).encode()
            if progress:
                progress(len(data) // 2, len(data))
                progress(len(data), len(data))
            return data
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), patch.object(updates, '_read_url', side_effect=fake_read):
            return updates.prepare(self.root, step=step)


class ApplyingSurvivesWindows(Staged):
    def test_each_step_is_reported_with_download_progress(self):
        steps = []
        self.stage(step=lambda name, **extra: steps.append((name, extra.get('done'), extra.get('total'))))
        names = [s[0] for s in steps]
        self.assertEqual(names[0], 'download')
        self.assertIn('verify', names)
        self.assertEqual(names[-1], 'unpack')
        done = [s for s in steps if s[0] == 'download']
        self.assertEqual(done[-1][1], done[-1][2])            # the last reading is the whole file

    def test_a_folder_windows_keeps_locked_is_never_applied_or_rolled_back_twice(self):
        self.stage()
        real = shutil.rmtree

        def locked(path, ignore_errors=False, **kw):
            if ignore_errors:
                return None              # pretend an antivirus scan holds the folder
            return real(path, **kw)
        with patch.object(shutil, 'rmtree', side_effect=locked):
            self.assertTrue(updates.apply_pending(self.root, lambda v: True))
        self.assertEqual((self.root / 'backend/app.py').read_text(), '# new')
        self.assertFalse((self.root / '.dejavu-update' / 'pending.json').exists())
        self.assertFalse((self.root / '.dejavu-update' / 'journal.json').exists())
        # The next start finds nothing to do: it neither re-applies nor puts the old files back.
        self.assertIsNone(updates.apply_pending(self.root, lambda v: self.fail('nothing to start')))
        self.assertEqual((self.root / 'backend/app.py').read_text(), '# new')

    def test_a_failed_start_says_why(self):
        self.stage()
        self.assertFalse(updates.apply_pending(self.root, lambda v: False))
        self.assertIn('0.2.0 did not start', updates.last_error)
        self.assertEqual((self.root / 'backend/app.py').read_text(), '# old')

    def test_old_files_that_cannot_be_put_back_keep_the_journal_for_the_next_start(self):
        self.stage()
        with patch.object(shutil, 'copy2', wraps=shutil.copy2) as copy:
            def health(version):
                copy.side_effect = PermissionError('in use')       # restoring fails from here on
                return False
            with self.assertRaisesRegex(ValueError, 'next start tries again'):
                updates.apply_pending(self.root, health)
        self.assertTrue((self.root / '.dejavu-update' / 'journal.json').exists())
        self.assertFalse(updates.apply_pending(self.root, lambda v: self.fail('restore first')))
        self.assertEqual((self.root / 'backend/app.py').read_text(), '# old')


class InstallJob(unittest.TestCase):
    """The Install button starts a job and comes straight back; the job carries the steps."""

    def setUp(self):
        import app
        self.app = app
        updates.set_job('idle')
        self.addCleanup(updates.set_job, 'idle')
        self.stopped = threading.Event()
        self.server = type('S', (), {'shutdown': lambda s: self.stopped.set()})()

    def test_install_returns_at_once_and_the_job_reaches_restarting(self):
        gate = threading.Event()

        def slow_prepare(**kw):
            kw['step']('download', done=1, total=4, version='0.2.0')
            gate.wait(5)
            return {'ready': True, 'version': '0.2.0'}
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), patch.object(self.app, '_require_idle_for_update'), \
                patch.object(self.app.memory, 'snapshot'), patch.object(updates, 'prepare', side_effect=slow_prepare):
            started = time.monotonic()
            reply = self.app._install_update(self.server, background=True)
            self.assertLess(time.monotonic() - started, 1)
            self.assertTrue(reply['started'])
            deadline = time.monotonic() + 3
            while updates.job().get('step') != 'download' and time.monotonic() < deadline:
                time.sleep(.02)
            self.assertEqual(updates.job()['total'], 4)
            with self.assertRaisesRegex(ValueError, 'already being installed'):
                self.app._install_update(self.server, background=True)
            gate.set()
            self.assertTrue(self.stopped.wait(5))
        self.assertEqual(updates.job()['state'], 'restarting')

    def test_a_failed_download_is_said_in_words_and_nothing_restarts(self):
        with patch.dict(os.environ, DEJAVU_LAUNCHER='1'), patch.object(self.app, '_require_idle_for_update'), \
                patch.object(self.app.memory, 'snapshot'), \
                patch.object(updates, 'prepare', side_effect=ValueError('The download checksum did not match')):
            self.app._install_update(self.server, background=True)
            deadline = time.monotonic() + 3
            while updates.job()['state'] != 'failed' and time.monotonic() < deadline:
                time.sleep(.02)
        self.assertEqual(updates.job()['message'], 'The download checksum did not match')
        self.assertFalse(self.stopped.wait(2))

    def test_without_the_launcher_it_refuses_before_doing_anything(self):
        with patch.dict(os.environ, DEJAVU_LAUNCHER='0'), patch.object(updates, 'prepare') as prepare:
            with self.assertRaisesRegex(ValueError, 'without the double-click launcher'):
                self.app._install_update(self.server, background=True)
            prepare.assert_not_called()
        self.assertEqual(updates.job()['state'], 'idle')

    def test_refusals_name_the_printer_and_the_reason(self):
        mm = self.app.mock_moonraker
        cases = [(False, {'state': 'standby'}, "isn't answering"), (True, {'state': 'printing'}, 'is printing')]
        for connected, state, words in cases:
            with self.subTest(words=words), \
                    patch.object(self.app.fleet, 'registered', return_value=[{'id': 'p1', 'name': 'Workshop U1'}]), \
                    patch.object(mm, 'printer_ids', return_value=['p1']), patch.object(mm, 'is_real', return_value=True), \
                    patch.object(mm, 'use_printer', return_value=contextlib.nullcontext()), \
                    patch.object(mm, 'is_connected', return_value=connected), \
                    patch.object(mm, 'get_printer_state', return_value=state):
                with self.assertRaises(ValueError) as caught:
                    self.app._require_idle_for_update()
                self.assertIn('Workshop U1', str(caught.exception))
                self.assertIn(words, str(caught.exception))


class ReadyCheck(unittest.TestCase):
    def test_this_copy_is_ready_and_every_check_is_in_words(self):
        rep = readiness.report(8000)
        self.assertTrue(rep['ready'], rep)
        self.assertEqual(rep['headline'], 'Deja Vu1 is ready and fully working')
        ids = {c['id'] for c in rep['checks']}
        self.assertTrue({'program', 'pages', 'demo', 'data', 'updates'} <= ids)
        for c in rep['checks']:
            self.assertIn(c['state'], ('ok', 'note', 'bad'))
            self.assertTrue(c['detail'])

    def test_the_pages_check_lists_real_files(self):
        files = readiness.page_files('index.html')
        self.assertIn('app.js', files)
        self.assertIn('style.css', files)
        self.assertFalse([f for f in files if f.startswith(('http', '//'))])

    def test_a_missing_file_is_not_ready_and_points_at_the_repair_block(self):
        with patch.object(readiness, 'page_files', return_value=['app.js', 'gone-for-good.js']):
            rep = readiness.summarise([readiness._pages()], 8000)
        self.assertFalse(rep['ready'])
        self.assertEqual(rep['next'], 'repair')
        self.assertIn('gone-for-good.js', rep['checks'][0]['detail'])
        text = readiness.render(rep, stream=io.StringIO(), windows=True)
        self.assertIn('PowerShell', text)
        self.assertIn(paste_blocks.UPDATE_POWERSHELL.splitlines()[-1], text)

    def test_a_console_that_cannot_draw_symbols_gets_plain_text(self):
        class Ascii(io.StringIO):
            encoding = 'ascii'
        rep = readiness.summarise([readiness._check('pages', 'Pages', 'ok', 'All there')], 8000)
        text = readiness.render(rep, stream=Ascii(), windows=False)
        text.encode('ascii')
        self.assertIn('OK', text)

    def test_the_launcher_note_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as folder:
            readiness.record_update(folder, False, '0.2.0', '0.1.0', 'Version 0.2.0 did not start')
            last = readiness.last_update(folder)
        self.assertEqual((last['ok'], last['previous']), (False, '0.1.0'))
        self.assertIn('did not start', last['message'])


if __name__ == '__main__':
    unittest.main()
