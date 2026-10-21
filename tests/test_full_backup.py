import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'backend'))
import backup


class FullBackup(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        p=patch.object(backup,'_DATA_DIR',str(self.root));p.start();self.addCleanup(p.stop)
        for name,data in {'fleet.json':[{'id':'real','api_key':'private'}],
                          'modules.json':{'automations':True},
                          'maintenance_log.real.json':{'history':[1]},
                          'print_queue.json':{'real':{'items':[{'name':'part.gcode'}],'auto_advance':True}},
                          'slicer.json':{'last_check':{'ok':True},'profiles':[{'machine':str(self.root/'slicer-presets/private/machine.json')}]},
                          'slicer-presets/private/machine.json':{'name':'private'}}.items():
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(data))
        (self.root/'files').mkdir();(self.root/'files/part.gcode').write_bytes(b'G90\n')
        (self.root/'timelapse/real/session').mkdir(parents=True);(self.root/'timelapse/real/session/001.jpg').write_bytes(b'camera')

    def archive(self):return backup.create_backup()[1]

    def test_complete_scope_secrets_and_internal_paths(self):
        original=(self.root/'fleet.json').read_bytes()
        with zipfile.ZipFile(io.BytesIO(self.archive())) as z:
            self.assertIn('maintenance_log.real.json',z.namelist())
            self.assertIn('timelapse/real/session/001.jpg',z.namelist())
            self.assertEqual(json.loads(z.read('fleet.json'))[0]['api_key'],'')
            self.assertIn('@DATA@/slicer-presets',z.read('slicer.json').decode())
        self.assertEqual((self.root/'fleet.json').read_bytes(),original)

    def test_preview_and_isolated_restore_keep_active_data(self):
        original=(self.root/'print_queue.json').read_bytes()
        review=backup.preview_restore(self.archive())
        with self.assertRaisesRegex(ValueError,'confirm'):backup.restore({'id':review['id']})
        result=backup.restore({'id':review['id'],'confirmed':True});folder=Path(result['folder'])
        self.assertEqual((self.root/'print_queue.json').read_bytes(),original)
        self.assertFalse(json.loads((folder/'data/print_queue.json').read_text())['real']['auto_advance'])
        self.assertFalse(json.loads((folder/'data/modules.json').read_text())['automations'])
        self.assertIsNone(json.loads((folder/'data/slicer.json').read_text())['last_check'])
        self.assertEqual(json.loads((folder/'data/slicer.json').read_text())['profiles'][0]['machine'],str(folder/'data/slicer-presets/private/machine.json'))
        self.assertTrue((folder/'Start restored app.bat').is_file())
        self.assertTrue((folder/'Start restored app.command').is_file())
        self.assertEqual((folder/'data/files/part.gcode').read_bytes(),b'G90\n')

    def test_checksum_traversal_duplicate_and_old_exports_refused(self):
        valid=self.archive()
        for change in ('checksum','traversal','extra','old'):
            out=io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(valid)) as src,zipfile.ZipFile(out,'w') as dest:
                for name in src.namelist():
                    data=src.read(name)
                    if name=='manifest.json':
                        manifest=json.loads(data)
                        if change=='checksum':manifest['entries'][0]['sha256']='0'*64
                        if change=='traversal':manifest['entries'][0]['name']='../outside'
                        if change=='old':manifest['version']=1
                        data=json.dumps(manifest).encode()
                    dest.writestr(name,data)
                if change=='extra':dest.writestr('unlisted.json','{}')
            with self.assertRaises(ValueError):backup.preview_restore(out.getvalue())

    def test_restore_write_failure_never_publishes_partial_copy(self):
        review=backup.preview_restore(self.archive())
        with patch.object(Path,'write_bytes',side_effect=OSError('disk full')):
            with self.assertRaises(OSError):backup.restore({'id':review['id'],'confirmed':True})
        self.assertEqual(list((self.root/'restored').iterdir()),[])
        self.assertEqual((self.root/'files/part.gcode').read_bytes(),b'G90\n')

    def test_setting_urls_are_redacted_and_symlinks_are_excluded(self):
        (self.root/'camera_settings.json').write_text(json.dumps({'url':'https://user:pass@example.test/frame?token=private&size=2'}))
        try:(self.root/'external.json').symlink_to('/etc/passwd')
        except OSError:pass
        with zipfile.ZipFile(io.BytesIO(self.archive())) as z:
            self.assertNotIn('external.json',z.namelist())
            self.assertEqual(json.loads(z.read('camera_settings.json'))['url'],'https://example.test/frame?size=2')
