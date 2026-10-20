"""Build the release asset. Run with a stable VERSION and upload the ZIP to GitHub Releases."""
import pathlib
import re
import subprocess
import sys
import zipfile
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'backend'))
import app_updates
version = app_updates.version()
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    sys.exit('Set VERSION to the stable release number first, for example 0.1.0')
output = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/deja-vu1-update.zip')
files = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines()
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in files:
        if app_updates.allowed_path(name):
            archive.write(ROOT / name, name)
print(output)
