"""Number the next release when a merge did not raise VERSION by hand.

Every merge to main publishes a release (.github/workflows/release.yml). When
VERSION is already released, this raises the last number by one (0.9.0 ->
0.9.1) and writes the new entry everywhere the version tests look: VERSION,
the top of frontend/versions.json and a CHANGELOG.md heading. The changes are
the titles of the merges since the last release.

Usage: python3 tools/next-release.py <last released tag, e.g. v0.9.0>
Prints the new version number.
"""
import datetime
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def titles(since, root=ROOT):
    """One line per change on main since the tag, newest first: the pull request title where there is one."""
    out = subprocess.check_output(['git', 'log', '--first-parent', '--format=%s%x1f%b%x1e', f'{since}..HEAD'],
                                  cwd=root, text=True)
    found = []
    for record in out.split('\x1e'):
        if not record.strip():
            continue
        subject, _, body = record.strip().partition('\x1f')
        if subject.startswith('Merge pull request') and body.strip():
            subject = body.strip().splitlines()[0]
        subject = re.sub(r'^Merge #\d+:\s*', '', subject).strip()
        if subject and not subject.startswith('Merge branch'):
            found.append((subject[:1].upper() + subject[1:])[:200])
    return found


def bump(version):
    major, minor, patch = (int(n) for n in re.fullmatch(r'(\d+)\.(\d+)\.(\d+)', version).groups())
    return f'{major}.{minor}.{patch + 1}'


def write(root, new, changes, today):
    root = pathlib.Path(root)
    changes = changes or ['Small improvements and fixes']
    name = changes[0].rstrip('.')
    if len(name) > 80:
        name = name[:77].rstrip() + '...'
    (root / 'VERSION').write_text(new + '\n')
    path = root / 'frontend' / 'versions.json'
    data = json.loads(path.read_text(encoding='utf-8'))
    data['versions'].insert(0, {
        'version': new, 'date': today.isoformat(), 'name': name, 'published': True,
        'summary': (f'{len(changes)} changes' if len(changes) != 1 else 'One change') + ' merged on GitHub since the last release.',
        'changes': changes,
        'highlights': [{'title': 'What changed', 'tab': 'modules', 'target': '#version-history',
                        'text': 'Every version is listed here, newest first. Open What changed for the full list.'}],
    })
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    log = root / 'CHANGELOG.md'
    text = log.read_text(encoding='utf-8')
    first = text.index('\n## ') + 1
    entry = f'## {new} ({today.day} {today:%B %Y}): {name}\n\n' + \
        ''.join(f'- {c}\n' for c in changes) + '\n'
    log.write_text(text[:first] + entry + text[first:], encoding='utf-8')


if __name__ == '__main__':
    tag = sys.argv[1]
    current = (ROOT / 'VERSION').read_text().strip()
    new = bump(re.sub(r'-.*$', '', max(current, tag.lstrip('v'), key=lambda v: tuple(int(n) for n in re.findall(r'\d+', v)[:3]))))
    write(ROOT, new, titles(tag), datetime.datetime.now(datetime.timezone.utc).date())
    print(new)
