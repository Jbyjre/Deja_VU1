import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'backend'))
import storage  # noqa: F401  (sets the temporary data folder first)
import logbook
import mock_moonraker


class Logbook(unittest.TestCase):
    def setUp(self):
        logbook.reset()
        mock_moonraker.reset_all()

    def tearDown(self):
        logbook.reset()

    def test_add_search_fix_and_delete(self):
        with mock_moonraker.use_printer('u1-garage'):
            a = logbook.add('Nozzle clog on T2 after PETG', tags=['clog'], demo=True)
            logbook.add('Bed not sticking at the front', demo=True)
            self.assertIsNotNone(a['print_hours'])
            self.assertEqual(logbook.entries('u1-garage', demo=True)['open'], 2)
            hits = logbook.entries('u1-garage', demo=True, query='clog')['entries']
            self.assertEqual([e['id'] for e in hits], [a['id']])
            logbook.update(a['id'], fix='Cold pull at 230 °C, then 260 °C', printer_id='u1-garage')
            self.assertEqual(logbook.entries('u1-garage', demo=True, query='cold pull')['entries'][0]['id'], a['id'])
            logbook.delete(a['id'], printer_id='u1-garage')
            self.assertEqual(len(logbook.entries('u1-garage', demo=True)['entries']), 1)
            with self.assertRaises(KeyError):
                logbook.delete(a['id'], printer_id='u1-garage')

    def test_demo_and_real_entries_never_mix(self):
        logbook.add('Simulated jam', printer_id='u1-studio', demo=True)
        self.assertEqual(logbook.entries('u1-studio', demo=False)['entries'], [])
        self.assertEqual(len(logbook.entries('u1-studio', demo=True)['entries']), 1)

    def test_empty_and_overlong_text_refused(self):
        with self.assertRaises(ValueError):
            logbook.add('   ', printer_id='u1-studio')
        with self.assertRaises(ValueError):
            logbook.add('x' * 700, printer_id='u1-studio')

    def test_reported_failures_are_logged_but_own_pauses_are_not(self):
        e = logbook.record_event('u1-workshop', 'failed', {'state_message': 'Filament jam on T1', 'current_file': 'a.gcode'}, True)
        self.assertIn('Filament jam on T1', e['problem'])
        self.assertTrue(e['auto'])
        self.assertIsNone(logbook.record_event('u1-workshop', 'paused', {'state_message': 'Paused'}, True))
        self.assertIsNone(logbook.record_event('u1-workshop', 'resumed', {'state_message': 'x'}, True))


if __name__ == '__main__':
    unittest.main()
