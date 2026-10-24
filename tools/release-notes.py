"""Print the GitHub release notes for a version, from frontend/versions.json.

The app's version history and the release page read the same entry, so they
always say the same thing.  Usage: python3 tools/release-notes.py 0.8.0
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def notes(version):
    data = json.loads((ROOT / 'frontend' / 'versions.json').read_text(encoding='utf-8'))
    entry = next((v for v in data['versions'] if v['version'] == version), None)
    if entry is None:
        raise SystemExit(f'frontend/versions.json has no entry for {version}')
    lines = [f"## {entry['name']}", '', entry['summary'], '', '### What changed', '']
    lines += [f'- {change}' for change in entry['changes']]
    lines += ['', '### Install or update', '',
              '- **Already running Deja Vu1?** Open Settings → Version & updates → Check for updates.',
              '- **New here?** Paste one block into PowerShell (Windows) or Terminal (Mac, Linux): '
              '[install in one paste](https://github.com/Jbyjre/Deja_VU1#install). '
              'No code: download `deja-vu1-update.zip` below, extract it, and double-click the launcher for '
              'your computer. Step by step: '
              '[getting started](https://github.com/Jbyjre/Deja_VU1/blob/main/docs/getting-started.md).',
              '- **Try it first:** the [online demo](https://deja-vu1.jmath1110.workers.dev/?demo) needs no install.',
              '', 'In the app, Settings → Version & updates shows this version and can take you on a tour of it.']
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    sys.stdout.write(notes(sys.argv[1] if len(sys.argv) > 1 else (ROOT / 'VERSION').read_text().strip()))
