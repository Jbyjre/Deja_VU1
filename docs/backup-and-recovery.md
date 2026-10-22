# Back up and recover app data

Settings → **Printer firmware & app recovery** → **Download full app backup**.
This is a ZIP of Deja Vu1's data, not a printer firmware/configuration backup.

It includes regular files under the application data folder: library and original
files, file index/thumbnails, printer registry, queues, automations, per-printer
maintenance logs, tool/spool records, measured recipes, working presets, settings
and saved time-lapse frames. Restore/update staging, symlinks and temporary writes
are excluded. External engine installations, external exported presets, browser-only
names/preferences and printer-side files are separate resources.

Connection secrets in JSON settings are omitted, including API keys, notification
tokens and credentials in URLs. The manifest lists omissions. Uploaded library
and camera payloads remain private content and are retained verbatim. Store the ZIP
privately; checksum validation detects damage, not whether its author is trusted.

The snapshot refuses data that changes during capture, files over 64 MB, more
than 10,000 files, over 512 MB unpacked or a ZIP over 256 MB. Finish file operations
and camera captures before retrying. Larger installations need an offline copy of
the whole data directory while the app is stopped. Nothing is silently truncated.

## Restore without replacing existing data

1. Choose **Preview a backup** and select a version 2 full app-data ZIP.
   Older selected-settings exports are incomplete and cannot use this restore.
2. Review file differences and omitted credentials. Validation checks the manifest,
   paths, duplicates, sizes, JSON and every file's checksum before writing data.
3. Confirm **Create a separate restored copy**. A new folder is prepared and
   published only when complete. Disk/write failure removes only that staging
   folder. Your current data and original ZIP remain intact. Discarding a preview
   removes only its uploaded staging copy.
4. Stop the running app. Open the recovery folder shown on screen. Double-click
   **Start restored app.command** on Linux/macOS or **Start restored app.bat** on
   Windows. These launch the installed app with the restored data directory.
   Keep the app installation available; recovery is not an application package.
5. Re-enter credentials, review printer addresses and fitted tools, then check
   your engine. Review automatic modules before enabling them. Recovery disables
   automations, queue advancement, Auto-print, notifications and external bridges.
   Saved queue items and records remain available after those modules are reviewed.

To return to the previous data, stop the recovery instance and use your original
launcher. Internal working-preset paths are remapped. External engine and exported
preset paths may need selecting again on another computer. In-progress engine jobs
and camera captures are not resumed as live operations.

Linux preview, restore, failure recovery and the actual generated launcher were
tested. Windows/macOS launchers are generated but were not executed here.
