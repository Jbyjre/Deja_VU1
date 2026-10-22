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

## Maintainer preparation

1. Test the release on Linux, Windows and macOS with disposable saved data.
   Run the full suite and the phone/real-printer checks. Keep launch claims honest.
2. Set `VERSION` to a stable number, update the changelog and commit the release.
3. Run `python3 tools/package-update.py` from the clean checkout. It builds
   `/tmp/deja-vu1-update.zip` from tracked application files. This tool needs git
   on the maintainer's computer; users do not need it. Review the package contents.
4. Publish that exact `deja-vu1-update.zip` as a GitHub Release asset with a matching
   tag, such as `v0.1.0`. Verify GitHub reports its `digest` as `sha256:…`.
   A digest is a fingerprint of the bytes. The app refuses an asset without it.
   [GitHub release-asset API](https://docs.github.com/en/rest/releases/assets#get-a-release-asset).
5. From a disposable older downloaded installation, check and install it using
   the UI. Verify the new version, preserved data and startup. Test interrupted
   installation and a broken startup package separately before relying on it.

No stable release was published as part of the launch-polish changes. The initial
version remains `0.1.0-dev` until the owner is ready to release it.

## What installation protects

Checks are opt-in at startup, at most daily, or run manually. Requests contain
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
checkout refuses self-updates to protect development changes. Old application
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
