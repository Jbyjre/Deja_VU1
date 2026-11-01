"""
The copy-and-paste blocks, written once. README, getting started, the product
page, Settings, the offline page and the launcher window show these exact lines
(tests/test_install_blocks.py). tools/update_blocks.py reads them from here, so
the copy that travels with every update (backend/) is the one the tests check.

Both kinds start Deja Vu1 with --background: it keeps running after the
PowerShell or Terminal window closes. The START blocks add --autostart, so it
also starts by itself at every sign-in (Settings -> Desktop app turns that off).

START blocks ("Start and check"): start the copy in Documents/Deja_VU1 (or
download it first when that folder has no start.py), then the launcher prints
whether Deja Vu1 is ready and fully working, or what is wrong and which block
to paste next. When Deja Vu1 is already running they only print that check.

UPDATE blocks (also the Repair blocks): stop the copy in Documents/Deja_VU1
(politely through /api/app/stop when the version has it, otherwise by ending
its server process and the launcher that would start it again), put the newest
release over it and start it again. Saved data is never in the ZIP.
"""
ASSET = 'https://github.com/Jbyjre/Deja_VU1/releases/latest/download/deja-vu1-update.zip'

UPDATE_POWERSHELL = '\n'.join([
    "$ProgressPreference = 'SilentlyContinue'",
    "$dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Deja_VU1'",
    "try { Invoke-RestMethod -Method Post 'http://localhost:8000/api/app/stop' -TimeoutSec 5 | Out-Null; Start-Sleep 2 } catch {}",
    "Get-CimInstance Win32_Process -Filter \"Name LIKE 'python%'\" | Where-Object { $_.CommandLine -like '*Deja_VU1*app.py*' }"
    " | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter \"ProcessId=$($_.ParentProcessId)\";"
    " if ($p.CommandLine -like '*start.py*') { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue };"
    " Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    f"Invoke-WebRequest '{ASSET}' -OutFile \"$env:TEMP\\dejavu1.zip\"",
    "Expand-Archive \"$env:TEMP\\dejavu1.zip\" -DestinationPath $dest -Force",
    "Set-Location $dest",
    "if (Get-Command py -ErrorAction SilentlyContinue) { py -3 start.py --background }"
    " else { python start.py --background }",
])

UPDATE_BASH = '\n'.join([
    "curl -s -o /dev/null -X POST http://localhost:8000/api/app/stop; sleep 2; pkill -f 'Deja_VU1/backend/app.py'",
    f"curl -fL -o /tmp/dejavu1.zip {ASSET}",
    "python3 -m zipfile -e /tmp/dejavu1.zip ~/Documents/Deja_VU1 && chmod +x ~/Documents/Deja_VU1/*.command ~/Documents/Deja_VU1/*.sh",
    "cd ~/Documents/Deja_VU1 && python3 start.py --background",
])

START_POWERSHELL = '\n'.join([
    "$dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Deja_VU1'",
    "if (-not (Test-Path \"$dest\\start.py\")) { $ProgressPreference = 'SilentlyContinue';"
    f" Invoke-WebRequest '{ASSET}' -OutFile \"$env:TEMP\\dejavu1.zip\";"
    " Expand-Archive \"$env:TEMP\\dejavu1.zip\" -DestinationPath $dest -Force }",
    "Set-Location $dest",
    "if (Get-Command py -ErrorAction SilentlyContinue) { py -3 start.py --background --autostart }"
    " elseif (Get-Command python -ErrorAction SilentlyContinue) { python start.py --background --autostart }"
    " else { Write-Host 'Deja Vu1 needs Python 3.8 or newer: https://www.python.org/downloads/' }",
])

START_BASH = '\n'.join([
    "[ -f ~/Documents/Deja_VU1/start.py ] || { curl -fL -o /tmp/dejavu1.zip"
    f" {ASSET} && python3 -m zipfile -e /tmp/dejavu1.zip ~/Documents/Deja_VU1"
    " && chmod +x ~/Documents/Deja_VU1/*.command ~/Documents/Deja_VU1/*.sh; }",
    "cd ~/Documents/Deja_VU1 && python3 start.py --background --autostart",
])


def for_this_computer(kind, windows=None):
    """One block for the operating system this runs on: kind is 'start' or 'update'."""
    import os
    windows = os.name == 'nt' if windows is None else windows
    if kind == 'start':
        return START_POWERSHELL if windows else START_BASH
    return UPDATE_POWERSHELL if windows else UPDATE_BASH
