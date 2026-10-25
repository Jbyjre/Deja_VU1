"""The copy-and-paste UPDATE commands, written once. README, getting started, the
product page and Settings show these exact lines (tests/test_install_blocks.py).

Each one stops the copy in Documents/Deja_VU1 (politely through /api/app/stop
when the version has it, otherwise by ending its server process), puts the
newest release over it and starts it again. Saved data is never in the ZIP.
"""
ASSET = 'https://github.com/Jbyjre/Deja_VU1/releases/latest/download/deja-vu1-update.zip'

POWERSHELL = '\n'.join([
    "$ProgressPreference = 'SilentlyContinue'",
    "$dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Deja_VU1'",
    "try { Invoke-RestMethod -Method Post 'http://localhost:8000/api/app/stop' -TimeoutSec 5 | Out-Null; Start-Sleep 2 } catch {}",
    "Get-CimInstance Win32_Process -Filter \"Name LIKE 'python%'\" | Where-Object { $_.CommandLine -like '*Deja_VU1*app.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
    f"Invoke-WebRequest '{ASSET}' -OutFile \"$env:TEMP\\dejavu1.zip\"",
    "Expand-Archive \"$env:TEMP\\dejavu1.zip\" -DestinationPath $dest -Force",
    "Start-Process \"$dest\\start-windows.bat\"",
])

BASH = '\n'.join([
    "curl -s -o /dev/null -X POST http://localhost:8000/api/app/stop; sleep 2; pkill -f 'Deja_VU1/backend/app.py'",
    f"curl -fL -o /tmp/dejavu1.zip {ASSET}",
    "python3 -m zipfile -e /tmp/dejavu1.zip ~/Documents/Deja_VU1 && chmod +x ~/Documents/Deja_VU1/*.command ~/Documents/Deja_VU1/*.sh",
    "cd ~/Documents/Deja_VU1 && python3 start.py",
])

if __name__ == '__main__':
    print(POWERSHELL, BASH, sep='\n\n')
