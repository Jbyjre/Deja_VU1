#!/usr/bin/env python3
"""
Reports on bench readings of known spools: how steady the colour checker is, how far it sits from each spool's label
colour, which near shades it mixes up, and how the held-back blind spools did. Real data only: it will not quote a rate from
fewer than 10 spools, and it shows exact counts with a 95 % range.

    python3 tools/colour-bench.py report colour-bench.json                # the app's file, or what the setup window exports
    python3 tools/colour-bench.py report colour-bench.json --out report.md --csv samples.csv
    python3 tools/colour-bench.py synthetic --out test.json               # invented readings, to see what a report looks like

The app keeps its bench readings in its data folder as colour_bench.json (backend/data/ unless DEJAVU_DATA_DIR says
otherwise). The setup window's Bench test part has a Download button that saves the same readings with their raw counts.
`synthetic` makes readings from the label colours plus noise and marks every one synthetic, so the report carries a banner:
it checks the report, never the sensor.
"""

import argparse
import csv
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

import colour_bench  # noqa: E402


def load(path):
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    samples = data["samples"] if isinstance(data, dict) else data
    if not isinstance(samples, list):
        raise SystemExit("That file holds no list of samples.")
    return samples


def synthetic(spools, repeats, noise, seed):
    """Readings made from each spool's label colour plus noise. Marked synthetic: it tests the report, not a sensor."""
    rng = random.Random(seed)
    names = ["Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Navy", "Purple", "Pink", "Grey", "Black", "White",
             "Lime", "Brown", "Sand", "Mint"]
    out = []
    for number in range(spools):
        label = [rng.randrange(20, 235) for _ in range(3)]
        hex_value = "#{:02x}{:02x}{:02x}".format(*label)
        for repeat in range(repeats):
            measured = [min(255, max(0, c + rng.gauss(0, noise) + 6)) for c in label]
            out.append({"id": f"s-{number}-{repeat}", "recorded_at": 0, "printer_id": "synthetic", "toolhead": "T0",
                        "spool": {"brand": "Synthetic", "material": "PLA", "name": names[number % len(names)] + str(number),
                                  "hex": hex_value},
                        "blind": number % 4 == 3, "insertion": repeat // 3 + 1, "mode": "strand", "notes": "",
                        "captured_at": repeat, "quality_flags": [], "measured_hex": "#{:02x}{:02x}{:02x}".format(*(int(round(c)) for c in measured)),
                        "status": "reading", "synthetic": True})
    return out


def write_csv(path, samples):
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["id", "brand", "material", "colour_name", "label_hex", "blind", "insertion", "mode", "measured_hex",
                         "status", "quality_flags", "gain", "calibration_id"])
        for s in samples:
            settings = s.get("settings") or {}
            reference = s.get("reference") or {}
            writer.writerow([s["id"], s["spool"]["brand"], s["spool"]["material"], s["spool"]["name"], s["spool"]["hex"],
                             int(bool(s["blind"])), s["insertion"], s["mode"], s.get("measured_hex") or "", s.get("status", ""),
                             " ".join(s["quality_flags"]), settings.get("gain", ""), reference.get("id", "")])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    rep = sub.add_parser("report", help="analyse bench readings")
    rep.add_argument("file")
    rep.add_argument("--out", help="write the report here (Markdown); it is printed otherwise")
    rep.add_argument("--csv", help="also write every reading as a CSV file")
    rep.add_argument("--min-spools", type=int, default=colour_bench.MIN_SPOOLS)
    rep.add_argument("--min-repeats", type=int, default=colour_bench.MIN_REPEATS)
    syn = sub.add_parser("synthetic", help="invent readings to see what a report looks like")
    syn.add_argument("--out", required=True)
    syn.add_argument("--spools", type=int, default=12)
    syn.add_argument("--repeats", type=int, default=6)
    syn.add_argument("--noise", type=float, default=6.0)
    syn.add_argument("--seed", type=int, default=1)
    args = parser.parse_args(argv)
    if args.command == "synthetic":
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump({"samples": synthetic(args.spools, args.repeats, args.noise, args.seed)}, handle)
        print("Wrote", args.out, "(synthetic: it tests the report, not a sensor)")
        return 0
    samples = load(args.file)
    text = colour_bench.render(colour_bench.analyse(samples, args.min_spools, args.min_repeats))
    if args.csv:
        write_csv(args.csv, samples)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as handle:
            handle.write(text)
        print("Wrote", args.out)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
