# Preparing a release for the in-app updater

A release is a named version published on GitHub. The app checks this project's
fixed `/releases/latest` endpoint, which selects a published stable release, not
a draft or prerelease. The root `VERSION` file identifies the installed version.
Only `major.minor.patch` stable releases are offered; numerical comparison makes
`1.10.0` newer than `1.9.0`. [GitHub release API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release).

The launcher stays a small Python program. Python 3.8+ is still required;
there is no bundled Python, native installer, signing service or added runtime
dependency. A native packaged installer is a separate product decision, not
part of this release work.

## Publishing a version

Releases publish by themselves. `.github/workflows/release.yml` runs on every
push to `main` that changes `VERSION` or `frontend/versions.json`. When
`VERSION` holds a stable number with no release yet, it runs the test suite,
builds `deja-vu1-update.zip` with `tools/package-update.py`, writes the notes
with `tools/release-notes.py` and publishes release `v<VERSION>`, marked latest.
A `-dev` version, or one already released, publishes nothing.

1. Test the change on Linux, Windows and macOS with disposable saved data where
   you can. Run the full suite and the phone/real-printer checks. Keep claims honest.
2. Raise `VERSION`. Add the version's entry at the top of `frontend/versions.json`:
   name, date, summary, `highlights` (each one a stop on the version's in-app
   tour, pointing at a real element) and `changes`. Add a
   `## <version> (<date>): <name>` heading to `CHANGELOG.md`.
   `tests/test_versions.py` fails if `VERSION`, the history, the changelog or
   the release notes disagree, or if a tour stop points at nothing.
3. Merge to `main`. Check the workflow run and the new release. GitHub records a
   SHA-256 `digest` for each uploaded asset (a fingerprint of the bytes); the app
   refuses an asset without one.
   [GitHub release-asset API](https://docs.github.com/en/rest/releases/assets#get-a-release-asset).
4. From a disposable older installation, check and install it using the UI.
   Verify the new version, preserved data and startup.

To publish by hand instead, run `python3 tools/package-update.py` from a clean
checkout (it needs git) and upload that exact ZIP to a release whose tag matches
`VERSION`, such as `v0.8.0`.

0.8.0 is the first version published this way. Earlier version numbers were
given afterwards to rounds of work and were never published as downloads.

## Copies made with git or GitHub Desktop

A copy with a `.git` folder follows its branch on GitHub instead of releases.
**Check for updates** runs `git fetch` and compares the copy with its upstream
branch; it lists the incoming commit titles and the upstream `VERSION`.
**Install** checks printer and slicer idleness again, records the current commit
in `.dejavu-update/git-pending.json`, then runs `git merge --ff-only`. The
launcher restarts the server and runs the same startup check as for releases; if
the new version fails it, the launcher runs `git reset --keep <previous commit>`,
which refuses rather than discard anything changed since.

It refuses to start when tracked files were changed by hand, when the copy has
commits of its own, when the branch has no upstream, or when it is not on a
branch. Untracked and ignored files, including `backend/data/`, are left alone.
On Windows it uses git from PATH, or else the git that GitHub Desktop keeps in
`%LOCALAPPDATA%\GitHubDesktop\app-<version>\resources\app\git\cmd\git.exe`
(newest version folder first). That location comes from community answers, not
GitHub documentation; without git the app explains how to pull in GitHub Desktop.
Tested with real git repositories on Linux; not yet run on Windows or macOS.

## What installation protects

Checks are opt-in: at startup and then at most daily while the server runs, or run manually. Requests contain
the app name, not the private name, printer details, API keys or configuration.
The server's public network address is visible to GitHub as for any web request.

The app downloads over HTTPS from restricted GitHub hosts, checks SHA-256 and
validates every archive entry. It rejects traversal, duplicate/case-colliding
paths, links, Windows reserved filenames, oversized archives and data paths.
It stages application files, checks printer/slicer idleness again, and asks the
launcher to restart. The launcher stops the old server, saves prior files and
records replacements before making them. The new child must answer with the
expected version and its own process ID. Failure restores old files; a journal
left after interruption triggers recovery at the next launch.

Default `backend/data/` and any custom `DEJAVU_DATA_DIR` are excluded. A custom
folder overlapping application files makes installation refuse safely. A `.git`
checkout never receives the release package; it updates through git as above,
fast-forward only, so local code changes are protected. Old application
files absent from the new archive are retained, so removals need a future
versioned migration policy.

This is integrity checking, not an independent signature: someone able to
replace both the project's release and its digest could publish different code.
Protect the GitHub publishing account. A successful startup check does not prove
all features of a new version work. Data migrations, disk failure, platform
permissions and real release delivery need additional release testing. The
updater does not run database/data migrations or promise rollback of them.

If installation says a recovery copy exists, leave `.dejavu-update/` intact and
restart with the launcher. If recovery itself errors, stop and inspect the error;
do not delete the backup folder or saved data. Keep an independent copy of the
whole data directory before first use of the updater. The current
[app-data backup](backup-and-recovery.md) supports validated, isolated recovery
within its file/archive limits. It excludes external engines, external presets
and printer firmware; keep those separately. Test recovery before relying on it.
