# Plugins

A plugin adds something to Deja Vu1 without changing the app: a small screen of its own (a pane), house rules that
Confirm Print checks before every print, and buttons that send the printer a few G-code lines. You add one in
Settings, Plugins, with Add a plugin folder.

A plugin can do only what you allow. Each one starts switched off and allowed nothing, so you read what it asks for
first, tick what you agree to, then switch it on.

## What a plugin folder holds

One `plugin.json` and, if it has a pane, one script. Only `.json`, `.js`, `.css`, `.md` and `.txt` files are taken,
200 KB a file and 500 KB in all.

```json
{
  "id": "house-rules",
  "name": "House rules",
  "version": "1.0.0",
  "description": "What it does, in one sentence.",
  "author": "Your name",
  "permissions": ["printer.read", "printer.command"],
  "pane": { "title": "Heads at a glance", "script": "pane.js" },
  "checks": [
    { "id": "no-petg-smooth", "level": "refuse", "say": "No PETG on the smooth plate.",
      "when": { "material": "PETG", "bed_type_contains": "smooth" } }
  ],
  "actions": [
    { "id": "say-hello", "name": "Say hello on the printer's screen", "gcode": ["M117 Hello"] }
  ]
}
```

- `id`: 2 to 40 characters, lower-case letters, digits and hyphens. A new copy with the same `id` replaces the old
  one, starts off again and goes back to the practice printer.
- `permissions`: any of the five below. Ask only for what the plugin needs.
- `pane`: optional. A title and the script that draws it.
- `checks`: optional, up to 20. Each is a refusal (`"level": "refuse"`, the print can't start) or a warning
  (`"level": "warn"`, you confirm it), with the sentence Confirm Print shows and the conditions that must all be
  true.
- `actions`: optional, up to 10, each 1 to 20 G-code lines. They need `printer.command`. Each one gets a button on
  the plugin's card and is offered under Then in Workshop, Automations.

The folder `docs/plugins/house-rules` is a full example you can add as it is.

## Permissions

| Permission | What it lets the plugin do |
|---|---|
| `printer.read` | See the printer's state, temperatures and loaded filament |
| `printer.command` | Send the printer G-code |
| `files.read` | See your list of print files |
| `files.write` | Save a G-code or text file to your files |
| `network` | Reach websites from its pane |

The plugin never sees the printer's address or serial number. `storage.get` and `storage.set` keep a few values of
its own and need no permission.

## Conditions for checks

All the conditions in a check's `when` must be true for it to apply.

| Condition | True when |
|---|---|
| `material` | A head the print uses holds this material (`"PETG"`) |
| `bed_type_contains` | The plate the file was sliced for contains this text |
| `hours_over` | The print is estimated at more than this many hours |
| `grams_over` | It uses more than this many grams of filament |
| `cost_over` | Its estimated cost is more than this |
| `heads_over` | It uses more than this many heads |

## The pane

A pane's script runs in a sealed frame: it has no origin of its own, so it can't read Deja Vu1's page, its storage or
its cookies, and it can't reach the network unless you granted `network`. It talks to Deja Vu1 only through one
function:

```js
const state = await dejavu.call('printer.state');
document.getElementById('root').textContent = state.state;
```

The calls are `printer.state`, `printer.command` (`{ gcode: 'M117 Hi' }`, one line a call), `files.list`, `files.save`
(`{ name, text }`), `storage.get` (`{ key }`) and `storage.set` (`{ key, value }`). Each is checked again by the
server against what you allowed. A pane may make 20 calls a second at most. Write text with `textContent`, not
`innerHTML`, when it comes from the printer or a file.

## Staying safe

- **The practice printer.** Until you press Allow the real printer on its card, everything a plugin sends goes to a
  simulated printer, and its card lists what it sent. A changed plugin goes back to practice.
- **Switched off on a problem.** A pane that throws an error, or misses three answers in a row, is closed and its
  plugin switched off, with the reason on its card.
- **Safe start.** Start with every plugin off is always on the Plugins card. Opening Deja Vu1 with `?safe=1` at the end
  of the address does the same, and Deja Vu1 offers it by itself when a plugin's pane was open as the page last froze.
- Watch-only mode and a running update hold still apply to everything a plugin sends.

## Built in

Print cost is a built-in plugin: its switch is the same as the Prints screen's Print cost card, safe start turns it off
too, and taking away its `printer.read` permission stops its routes.

## From your slicer

To send each export from Snapmaker Orca or OrcaSlicer to Deja Vu1 for Confirm Print, where your plugins' checks run, see
`slicer-handoff/README.md`.
