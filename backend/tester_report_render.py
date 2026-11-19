"""
tester_report_render.py
=======================

The tester report's pages: report.html (one page, no scripts, nothing loaded from outside) and findings.md, plus the
README.txt that goes in the zip. Split out of tester_report.py (18 November 2026) so a session that changes how the
report looks reads only this file. tester_report.py builds the numbers (Aggregator, the findings) and the zip, and
imports README, render_html and render_findings from here; nothing here imports tester_report.
"""

import html  # noqa: F401  (tests and callers escape through _h)
from tester_report_top import SEV_PILL as _SEV_PILL, TOP_CSS, _h, _hm, _plural, finding_md, headline_text, top_html, top_md  # noqa: F401

# ---------------------------------------------------------------------------
# report.html: one page, no scripts, nothing loaded from outside
# ---------------------------------------------------------------------------

def _ms(value):
    """A duration as plain text (escape it where it is put into a page)."""
    if value is None:
        return "\u2013"
    value = float(value)
    return "%d ms" % value if value < 1000 else "%.1f s" % (value / 1000.0)


_NUMERIC = {"Times", "Median", "Slowest", "Pressed", "Failed", "Slow", "Sessions", "Open", "Actions", "Prints", "Errors", "Slow spots", "Visits",
            "Time open", "Time", "Plates", "Colours", "Samples", "Lowest", "Length", "Status", "Screen changed after", "Request finished after"}


def _table(headers, rows, caption=None, cls=""):
    if not rows:
        return ""
    if len(headers) >= 4:
        cls = (cls + " wide").strip()              # wide tables scroll sideways inside their frame instead of squeezing their columns
    head = "".join("<th scope=\"col\"%s>%s</th>" % (" class=\"n\"" if h in _NUMERIC else "", _h(h)) for h in headers)
    body = "".join("<tr>%s</tr>" % "".join(c if isinstance(c, _Raw) else "<td>%s</td>" % _h(c) for c in row) for row in rows)
    cap = "<caption class=\"sr\">%s</caption>" % _h(caption) if caption else ""
    # A frame that scrolls sideways on a phone must be reachable with the keyboard, and have a name.
    name = caption or "%s table" % ", ".join(headers[:3])
    return "<div class=\"scroll\" tabindex=\"0\" role=\"region\" aria-label=\"%s\"><table class=\"%s\">%s<thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>" % (
        _h(name), cls, cap, head, body)


class _Raw(str):
    """A table cell that is already safe HTML (built here from escaped parts)."""


def _cell(text, cls=""):
    return _Raw("<td%s>%s</td>" % (" class=\"%s\"" % cls if cls else "", _h(text)))


def _empty(text):
    return "<p class=\"empty\">%s</p>" % _h(text)


def _when(iso):
    """A time in a table: it stays on one line."""
    return _Raw("<td class=\"when\">%s</td>" % _h(str(iso or "").replace("T", " ")))


_CSS = """
:root{color-scheme:light dark;--bg:#f4f5f8;--card:#fff;--ink:#1c1c1e;--dim:#48484a;--faint:#636366;--line:#d8dbe3;
--accent:#0a64d6;--fill:#4a8df8;--warn:#8a4b00;--warn-bg:#fff4df;--bad:#b42318;--bad-bg:#fdecea;--ok:#17692f;--ok-bg:#e6f5ea;
--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121316;--card:#1b1d22;--ink:#f2f2f4;--dim:#d0d0d6;--faint:#a6a6ae;
--line:#2f323a;--accent:#7db2ff;--fill:#6aa6ff;--warn:#f5b86a;--warn-bg:#2b2113;--bad:#ff9d94;--bad-bg:#2c1614;--ok:#7bd99a;--ok-bg:#13251a}}
:root[data-theme="dark"]{--bg:#121316;--card:#1b1d22;--ink:#f2f2f4;--dim:#d0d0d6;--faint:#a6a6ae;--line:#2f323a;--accent:#7db2ff;
--fill:#6aa6ff;--warn:#f5b86a;--warn-bg:#2b2113;--bad:#ff9d94;--bad-bg:#2c1614;--ok:#7bd99a;--ok-bg:#13251a}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 var(--sans);overflow-wrap:anywhere}
main{max-width:1080px;margin:0 auto;padding:24px 16px 64px}
header.top{padding:8px 0 20px}.kicker{font:600 12px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
h1{font-size:clamp(1.6rem,4vw+1rem,2.6rem);line-height:1.1;margin:.4rem 0 .5rem;text-wrap:balance}
h2{font-size:1.25rem;margin:0 0 .75rem;text-wrap:balance}h3{font-size:1rem;margin:1.1rem 0 .4rem}
p{margin:.35rem 0}.sub{color:var(--dim);max-width:62ch;text-wrap:pretty}header.top .sub{max-width:none}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 18px 16px;margin:0 0 16px}
section.hero{padding:22px 18px}.lead{font-size:1.1rem;line-height:1.55;max-width:70ch;text-wrap:pretty}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0 0;padding:0;list-style:none}
.tile{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg)}
.tile b{display:block;font:700 1.9rem/1.1 var(--mono);font-variant-numeric:tabular-nums}.tile span{color:var(--dim);font-size:.9rem}
.tile.bad b{color:var(--bad)}.tile.warn b{color:var(--warn)}.tile.ok b{color:var(--ok)}
.scroll{overflow-x:auto;margin:.4rem 0 .2rem;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);white-space:nowrap}
table.wide{min-width:700px}table.wide td:last-child{min-width:200px}td.when{white-space:nowrap}
td{overflow-wrap:break-word}td.n,th.n{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
td.mono{font-family:var(--mono);font-size:.85rem}
.pill{display:inline-block;padding:1px 9px;border-radius:99px;font-size:.8rem;font-weight:600;border:1px solid currentColor}
.pill.ok{color:var(--ok);background:var(--ok-bg)}.pill.bad{color:var(--bad);background:var(--bad-bg)}.pill.warn{color:var(--warn);background:var(--warn-bg)}
.pill.off{color:var(--faint)}dl{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:4px 16px;margin:0}dt{color:var(--dim)}dd{margin:0}
.empty{color:var(--faint);font-style:italic}.note{border-left:3px solid var(--accent);padding:6px 12px;margin:8px 0;background:var(--bg);border-radius:0 8px 8px 0}
.note small,.small{color:var(--faint);font-size:.85rem}details{margin:.5rem 0}summary{cursor:pointer;color:var(--accent);font-weight:600}
summary:focus-visible,a:focus-visible,.scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;overflow:auto;font:.8rem/1.45 var(--mono);white-space:pre-wrap}
.beat{display:block;width:100%;height:auto;margin:10px 0 2px}.beat text{font:11px var(--mono);fill:var(--faint)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.featgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;padding:0;margin:8px 0;list-style:none}
.featgrid li{display:flex;gap:8px;align-items:baseline;border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.featgrid small{color:var(--faint);display:block}.featgrid .pill{flex:none;white-space:nowrap}footer{color:var(--faint);font-size:.85rem;margin-top:24px}
@media(max-width:560px){section{padding:14px 12px}dl{grid-template-columns:1fr}dt{margin-top:6px}}
@media print{body{background:#fff}section{break-inside:avoid;border-color:#bbb}details{display:block}}
""" + TOP_CSS


def _beat(days):
    """The signature: one bar per day (how much they used it), a red mark for errors, an amber one for slow spots."""
    if not days:
        return ""
    count = len(days)
    width, height, pad = max(320, min(1040, 56 * count + 40)), 120, 22
    biggest = max([d["clicks"] for d in days] + [1])
    step = (width - 2 * pad) / float(max(count, 1))
    bar = min(40.0, step * 0.55)
    parts = ["<svg class=\"beat\" viewBox=\"0 0 %d %d\" style=\"max-width:%dpx\" role=\"img\" aria-label=\"%s\">" % (
        width, height, width, _h("Activity for each day: %s" % "; ".join(
            "%s %s, %s, %s" % (d["day"], _plural(d["clicks"], "action"), _plural(d["errors"], "error"), _plural(d["slow"], "slow spot")) for d in days)))]
    base = height - 26
    parts.append("<line x1=\"%d\" y1=\"%d\" x2=\"%d\" y2=\"%d\" stroke=\"currentColor\" opacity=\".25\"/>" % (pad, base, width - pad, base))
    for i, d in enumerate(days):
        x = pad + i * step + (step - bar) / 2.0
        h = 0 if not d["clicks"] else max(3.0, (base - 18) * d["clicks"] / float(biggest))
        parts.append("<rect x=\"%.1f\" y=\"%.1f\" width=\"%.1f\" height=\"%.1f\" rx=\"4\" fill=\"var(--fill)\"/>" % (x, base - h, bar, h))
        mid = x + bar / 2.0
        if d["errors"]:
            parts.append("<circle cx=\"%.1f\" cy=\"10\" r=\"5\" fill=\"var(--bad)\"><title>%s</title></circle>" % (mid - 7, _h(_plural(d["errors"], "error"))))
        if d["slow"]:
            parts.append("<rect x=\"%.1f\" y=\"5\" width=\"10\" height=\"10\" rx=\"2\" fill=\"var(--warn)\"><title>%s</title></rect>" % (mid + 2, _h(_plural(d["slow"], "slow spot"))))
        parts.append("<text x=\"%.1f\" y=\"%d\" text-anchor=\"middle\">%s</text>" % (mid, height - 8, _h(d["day"][5:])))
    parts.append("</svg>")
    return "".join(parts)


def _pill(text, cls):
    return _Raw("<td><span class=\"pill %s\">%s</span></td>" % (cls, _h(text)))


def _hours_svg(hours):
    """Presses by hour of the day: when they used the app."""
    top = max(hours + [1])
    width, height, pad = 720, 110, 18
    step = (width - 2 * pad) / 24.0
    parts = ["<svg class=\"beat\" viewBox=\"0 0 %d %d\" style=\"max-width:%dpx\" role=\"img\" aria-label=\"%s\">" % (
        width, height, width, _h("Presses by hour of the day: %s" % "; ".join("%02d:00 %d" % (h, n) for h, n in enumerate(hours) if n) or "none"))]
    base = height - 22
    parts.append("<line x1=\"%d\" y1=\"%d\" x2=\"%d\" y2=\"%d\" stroke=\"currentColor\" opacity=\".25\"/>" % (pad, base, width - pad, base))
    for hour, n in enumerate(hours):
        h = 0 if not n else max(2.0, (base - 10) * n / float(top))
        parts.append("<rect x=\"%.1f\" y=\"%.1f\" width=\"%.1f\" height=\"%.1f\" rx=\"2\" fill=\"var(--fill)\"><title>%s</title></rect>" % (
            pad + hour * step + 1, base - h, step - 2, h, _h("%02d:00, %d presses" % (hour, n))))
        if hour % 3 == 0:
            parts.append("<text x=\"%.1f\" y=\"%d\" text-anchor=\"middle\">%02d</text>" % (pad + hour * step + step / 2, height - 6, hour))
    parts.append("</svg>")
    return "".join(parts)


def render_html(report, theme=None, sample=False):
    s, setup = report["summary"], report["setup"]
    server = setup.get("server") or {}
    thin = report["thinning"]
    study = report.get("study") or {}
    usage, stats, perf = report["usage"], report["stats"], report["performance"]
    out = []
    add = out.append
    theme_attr = " data-theme=\"%s\"" % theme if theme in ("light", "dark") else ""
    add("<!doctype html><html lang=\"en\"%s><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<meta name=\"color-scheme\" content=\"light dark\"><title>Deja Vu1 tester report</title><style>%s</style></head><body><main>" % (theme_attr, _CSS))
    span = "%s to %s" % (_h((s["first"] or "")[:10]), _h((s["last"] or "")[:10])) if s["first"] else "no use recorded yet"
    if sample:
        add("<header class=\"top\"><div class=\"kicker\">Deja Vu1 tester report &middot; sample</div><h1>How Deja Vu1 behaved on this computer</h1>"
            "<p class=\"note\"><b>Sample report.</b> Every number here is made up to show the layout. A real report holds your own use of the app.</p></header>")
    else:
        add("<header class=\"top\"><div class=\"kicker\">Deja Vu1 tester report</div><h1>How Deja Vu1 behaved on this computer</h1>"
            "<p class=\"sub\">Written %s from %s. Recorded on this computer and sent nowhere; you send this file yourself.</p></header>"
            % (_h(report["generated"].replace("T", " ")), span))

    # What to fix: the headline strip, the ten worst faults, the conditions around the app, the rest by part of the app
    add(top_html(report))

    # The short version
    found = s.get("findings") or {}
    add("<section class=\"hero\" aria-labelledby=\"sum\"><h2 id=\"sum\">The short version</h2><p class=\"lead\">")
    add("Deja Vu1 was open on <b>%s</b> in <b>%s</b>, for <b>%s</b> in all. " % (_plural(s["days_used"], "day"), _plural(s["sessions"], "session"), _hm(s["minutes_open"])))
    add("Buttons and controls were pressed %s across %s. " % (_plural(s["clicks"], "time"), _plural(s["screens_opened"], "screen visit")))
    add("%s started on a printer, %s finished, %s failed and %s were cancelled%s. " % (
        _plural(s["prints_started"], "print"), s["prints_finished"], s["prints_failed"], s["prints_cancelled"],
        " (%s more on demo data)" % s["demo_prints_started"] if s["demo_prints_started"] else ""))
    add("<b>%d of %d</b> main features were tried, and <b>%d of %d</b> questions were answered." % (
        s["features_tried"], s["features_total"], study.get("answered", 0), study.get("total", 0)))
    add("</p><ul class=\"tiles\">")
    for value, label, cls in ((s["days_used"], "days used", ""), (s["prints_started"], "prints started", ""),
                              ("%d / %d" % (s["features_tried"], s["features_total"]), "features tried", ""),
                              (found.get("high", 0), "high findings", "bad" if found.get("high") else "ok"),
                              ("%d / %d" % (study.get("answered", 0), study.get("total", 0)), "questions answered", "")):
        add("<li class=\"tile %s\"><b>%s</b><span>%s</span></li>" % (cls, _h(value), _h(label)))
    add("</ul>")
    if thin["happened"]:
        add("<p class=\"note\"><b>Thinned:</b> the record passed %s MB, so %s routine events (clicks that were not slow, background requests that worked, "
            "screen visits) were summed up into one line per day. Every error, every slow action, every note and the printer's story are kept whole, and "
            "the totals above were counted before anything was dropped. Medians for thinned controls are estimates.</p>" % (_h(thin["limit_mb"]), _h(thin["dropped_events"])))
    add("</section>")

    # Their answers
    add("<section aria-labelledby=\"ans\"><h2 id=\"ans\">Their answers</h2>")
    answers = study.get("answers") or []
    if not study.get("answered"):
        add(_empty("No answers were saved."))
    else:
        add("<p>%d of %d questions answered, %d with words and %d marked \"Didn't try it\".</p>" % (
            study.get("answered", 0), study.get("total", 0), study.get("with_words", 0), study.get("didnt_try", 0)))
        words = [a for a in answers if a["answered"] and a["section"] == 9]
        if words:
            add("<h3>In their own words</h3>")
            for a in words:
                add("<div class=\"note\"><small>%d. %s</small><br><b>%s</b></div>" % (a["n"], _h(a["question"]), _h(a["answer"] or a["choice_label"] or "")))
        for sec in study.get("sections") or []:
            rows = [a for a in answers if a["section"] == sec["section"] and a["answered"]]
            add("<details%s><summary>%s &middot; %d of %d answered%s</summary>" % (
                " open" if rows and not sec["optional"] else "", _h("%d. %s" % (sec["section"], sec["name"])), sec["answered"], sec["of"],
                " &middot; optional" if sec["optional"] else ""))
            add(_table(["No.", "Question", "Answer"], [[_cell(a["n"], "n"), a["question"], a["answer"] or a["choice_label"] or ""] for a in rows]) or _empty("Not answered."))
            add("</details>")
    add("</section>")

    add("<section aria-labelledby=\"nt\"><h2 id=\"nt\">Their notes</h2><p class=\"small\">Written with the \"Something felt off\" button. "
        "Each carries the screen, the last actions and, when it was written right after one, the error.</p>")
    for n in report["notes"]:
        add("<div class=\"note\"><b>%s</b>%s <small>%s &middot; on %s%s</small>" % (
            _h(n["text"] or "(a tag only)"), (" <span class=\"pill warn\">%s</span>" % _h(n["tag"])) if n.get("tag") else "",
            _h(n["t"].replace("T", " ")), _h(n["screen"] or "unknown"), (" &middot; the printer was %s" % _h(n["printer_state"])) if n.get("printer_state") else ""))
        if n.get("error"):
            add("<br><small>Right after the error: %s</small>" % _h(n["error"]))
        if n["last_actions"]:
            add("<details><summary>The last %d actions</summary><pre>%s</pre></details>" % (len(n["last_actions"]), _h("\n".join(n["last_actions"]))))
        add("</div>")
    if not report["notes"]:
        add(_empty("No notes were written."))
    add("</section>")

    add("<section aria-labelledby=\"days\"><h2 id=\"days\">Day by day</h2><p class=\"small\">Bars are actions per day. A red dot marks errors, an amber square marks slow spots.</p>%s" % _beat(report["timeline"]))
    add(_table(["Day", "Sessions", "Open", "Actions", "Prints", "Errors", "Slow spots"],
               [[d["day"], _cell(d["sessions"], "n"), _cell(_hm(d["minutes"]), "n"), _cell(d["clicks"], "n"), _cell(d["prints"], "n"),
                 _cell(d["errors"], "n"), _cell(d["slow"], "n")] for d in report["timeline"]], "Each day"))
    if not report["timeline"]:
        add(_empty("Nothing has been recorded yet."))
    add("</section>")

    # Onboarding
    ob = report["onboarding"]
    wz, tr = ob["wizard"], ob["tour"]
    add("<section aria-labelledby=\"ob\"><h2 id=\"ob\">The first run</h2><p class=\"small\">How the start went: when each first thing happened, measured from the first event, "
        "the setup screens and the tour.</p>")
    add(_table(["What happened", "When", "Minutes after the start"], [[m["what"], _when(m["at"]), _cell(m["minutes_after_start"], "n")] for m in report["milestones"]], "First times") or _empty("No first times recorded yet."))
    if wz["opened"]:
        add("<p>Setup opened %s: finished %d, skipped %d, closed early %d. Furthest step %s of %s, %s in setup.%s</p>" % (
            _h(_plural(wz["opened"], "time")), wz["finished"], wz["skipped"], wz["closed_early"], _h(wz["furthest_step"]), _h(wz["steps_total"] or "?"), _h(_hm(wz["minutes"])),
            " It opened by itself on the first run." if ob["first_run"] else ""))
        add(_table(["Step", "Name", "Visits", "Median time", "Left by"], [[_cell(x["step"], "n"), x["name"], _cell(x["visits"], "n"), _cell("%s s" % x["median_seconds"], "n"),
                                                                     ", ".join("%s %d" % (k, v) for k, v in x["left_by"].items())] for x in wz["steps"]], "Setup steps"))
    else:
        add(_empty("The setup screens were not opened while this was recorded."))
    if tr["started"]:
        add("<p>Tours started: %d, finished: %d, ended early: %d. %s seen, a median of %s per stop.</p>" % (
            tr["started"], tr["finished"], tr["ended_early"], _h(_plural(tr["steps_seen"], "stop")), _h("%s s" % tr["median_step_seconds"] if tr["median_step_seconds"] is not None else "unknown")))
    add("</section>")

    # How they used it
    clickmap = usage["how_they_click"]
    cp = stats["click_to_paint"]
    add("<section aria-labelledby=\"use\"><h2 id=\"use\">How they used it</h2>")
    add("<ul class=\"tiles\">")
    for value, label in ((_ms(cp["median_ms"]), "median press to change"), (_ms(cp["p95_ms"]), "95th percentile"),
                         ("%s%%" % clickmap["touch_percent"] if clickmap["touch_percent"] is not None else "n/a", "pressed by touch"),
                         ("%s%%" % clickmap["keyboard_percent"] if clickmap["keyboard_percent"] is not None else "n/a", "pressed by keyboard"),
                         (stats["sessions"]["median_minutes"] if stats["sessions"]["median_minutes"] is not None else "n/a", "median visit (min)"),
                         ("%s%%" % stats["requests"]["failed_percent"], "requests failed"),
                         (stats["errors"]["per_100_presses"] if stats["errors"]["per_100_presses"] is not None else "n/a", "errors per 100 presses")):
        add("<li class=\"tile\"><b>%s</b><span>%s</span></li>" % (_h(value), _h(label)))
    add("</ul>")
    add("<h3>When they used it</h3><p class=\"small\">Presses by hour of the day, in this computer's time.</p>%s" % _hours_svg(usage["hours"]))
    add("<h3>How long the screen took to change</h3>")
    add(_table(["Time", "Presses"], [[b["label"], _cell(b["count"], "n")] for b in cp["histogram"]], "Press to change"))
    add("<h3>How they pressed</h3>")
    add("<p>Methods: %s. Buttons: %s. Think time between presses: median %s, 90th percentile %s.%s</p>" % (
        _h(", ".join("%s %d" % (k, v) for k, v in clickmap["methods"].items()) or "none recorded"),
        _h(", ".join("%s %d" % (k, v) for k, v in clickmap["buttons"].items()) or "none recorded"),
        _h("%s s" % clickmap["think_time_seconds"]["median"] if clickmap["think_time_seconds"]["median"] is not None else "n/a"),
        _h("%s s" % clickmap["think_time_seconds"]["p90"] if clickmap["think_time_seconds"]["p90"] is not None else "n/a"),
        (" With modifier keys: %s." % _h(", ".join("%s %d" % (k, v) for k, v in clickmap["modifiers"].items()))) if clickmap["modifiers"] else ""))
    if clickmap["double_presses"]:
        add("<p class=\"small\">Pressed twice in a row (often a sign the first press seemed to do nothing):</p>")
        add(_table(["Control", "Times"], [[d["control"], _cell(d["count"], "n")] for d in clickmap["double_presses"]]))
    add("<details><summary>Where on the screen they pressed</summary><p class=\"small\">Percent of presses, in a 4 by 4 grid from the top left to the bottom right.</p>")
    add(_table(["", "Left", "Centre left", "Centre right", "Right"], [["Top" if i == 0 else "Upper middle" if i == 1 else "Lower middle" if i == 2 else "Bottom"] + [_cell("%s%%" % v, "n") for v in row]
                                                                      for i, row in enumerate(clickmap["screen_map_percent"])]))
    add("</details>")
    paths = usage["paths"]
    add("<h3>How they moved around</h3>")
    add(_table(["From", "To", "Times"], [[x["from"], x["to"], _cell(x["count"], "n")] for x in paths["transitions"]], "Screen to screen") or _empty("No moves between screens recorded."))
    add("<p>First screen of a visit: %s. Last screen before leaving: %s.</p>" % (
        _h(", ".join("%s %d" % kv for kv in paths["entry_screens"].items()) or "none"), _h(", ".join("%s %d" % kv for kv in paths["exit_screens"].items()) or "none")))
    if paths["reached_by"]:
        add("<details><summary>What they pressed to reach a screen</summary>")
        add(_table(["Control or address", "Times"], [[x["via"], _cell(x["count"], "n")] for x in paths["reached_by"]]))
        add("</details>")
    ch = usage["changes"]
    if ch["total"]:
        add("<h3>Switches, sliders and choices they changed</h3>")
        add(_table(["When", "Control", "Screen", "Set to"], [[_when(c["t"]), c["control"], c["screen"], c["value"]] for c in (ch["settings"] or ch["recent"])[:40]], "Changes"))
        add(_table(["Control", "Times"], [[c["control"], _cell(c["count"], "n")] for c in ch["most_changed"][:10]]))
    if usage["keys"]:
        add("<h3>Keyboard shortcuts</h3>")
        add(_table(["Keys", "Times"], [[k["combo"], _cell(k["count"], "n")] for k in usage["keys"]]))
    add("<p>Window sizes: %s.</p>" % _h(", ".join("%s %d" % kv for kv in usage["window_sizes"].items()) or "not recorded"))
    add("<details><summary>The first visits, action by action (the order they did things)</summary>")
    for visit in usage["journey"]:
        add("<h3>Visit %d, from %s</h3>" % (visit["visit"], _h((visit["start"] or "").replace("T", " "))))
        add(_table(["When", "Did", "What", "Detail"], [[_when(a["t"]), a["did"], a["what"], ", ".join("%s %s" % (k, v) for k, v in a.items() if k not in ("t", "did", "what"))] for a in visit["actions"]]))
    if not usage["journey"]:
        add(_empty("No actions recorded yet."))
    add("</details></section>")

    # Setup
    add("<section aria-labelledby=\"setup\"><h2 id=\"setup\">Setup</h2><dl>")
    for label, value in (("Deja Vu1", server.get("app_version")), ("Computer", server.get("os")), ("Python", server.get("python")),
                         ("Printers added", server.get("printers_added")), ("Watch-only", {True: "on", False: "off"}.get(server.get("watch_only"))),
                         ("Slicing engine", " ".join(str(x) for x in ((server.get("engine") or {}).get("app"), (server.get("engine") or {}).get("version")) if x) or "none set up")):
        add("<dt>%s</dt><dd>%s</dd>" % (_h(label), _h(value if value not in (None, "") else "not recorded")))
    for name, facts in sorted((report["printer"].get("firmware") or {}).items()):
        add("<dt>Firmware, %s</dt><dd>%s</dd>" % (_h(name), _h(", ".join("%s %s" % (k, v) for k, v in sorted(facts.items())) or "the printer reported no version")))
    for b in setup.get("browsers", []):
        extra = ", ".join(x for x in (("%s cores" % b["cores"]) if b.get("cores") else "", ("%s GB memory" % b["mem"]) if b.get("mem") else "", ("%s pointer" % b["ptr"]) if b.get("ptr") else "",
                                      "installed as an app" if b.get("standalone") else "", ("%s contrast" % b["contrast"]) if b.get("contrast") == "more" else "",
                                      "reduced transparency" if b.get("transp") == "reduce" else "", ("%s motion" % b["motion"]) if b.get("motion") == "reduced" else "") if x)
        add("<dt>Browser</dt><dd>%s %s on %s, %sx%s px at %sx, %s look, %s, %s%s</dd>" % (
            _h(b.get("browser")), _h(b.get("bver")), _h(b.get("ua_os")), _h(b.get("w")), _h(b.get("h")), _h(b.get("dpr")), _h(b.get("look")),
            _h(b.get("theme")), _h(b.get("lang")), (", " + _h(extra)) if extra else ""))
    add("</dl>")
    if server.get("modules_off"):
        add("<p class=\"small\">Switched off: %s</p>" % _h(", ".join(server["modules_off"])))
    add("</section>")

    # Slowest actions
    slow = report["slow"]
    add("<section aria-labelledby=\"slow\"><h2 id=\"slow\">The slowest 25 actions</h2><p class=\"small\">A click counts as slow when the screen took over %s to change; a request over %s; "
        "the browser itself freezing for over %s is a long task.</p>" % (_h(_ms(slow["thresholds_ms"]["click"])), _h(_ms(slow["thresholds_ms"]["request"])), _h(_ms(slow["thresholds_ms"]["long_task"]))))
    add(_table(["When", "Control", "Screen", "Screen changed after", "Request finished after"],
               [[_when(r["t"]), r["control"], r["screen"], _cell(_ms(r["paint_ms"]), "n"), _cell(_ms(r["request_ms"]), "n")] for r in slow["slowest_actions"]], "Slowest actions") or _empty("No actions recorded."))
    if slow["per_control"]:
        add("<h3>Controls that were slow more than once</h3>")
        add(_table(["Control", "Pressed", "Slow", "Median", "Slowest"], [[c["control"], _cell(c["count"], "n"), _cell(c["slow_count"], "n"), _cell(_ms(c["median_ms"]), "n"), _cell(_ms(c["slowest_ms"]), "n")] for c in slow["per_control"][:25]]))
    if slow["slow_requests"]:
        add("<h3>Requests over %s</h3>" % _h(_ms(slow["thresholds_ms"]["request"])))
        add(_table(["When", "Request", "Status", "Time", "Screen"], [[_when(r["t"]), "%s %s" % (r["method"], r["route"]), r["status"], _cell(_ms(r["ms"]), "n"), r["screen"]] for r in slow["slow_requests"][:30]]))
    lt = slow["long_tasks"]
    add("<h3>Browser freezes</h3>")
    add("<p>%s over %s, %s in total.</p>" % (_h(_plural(lt["count"], "long task")), _h(_ms(slow["thresholds_ms"]["long_task"])), _h(_ms(lt["total_ms"]))) if lt["count"] else _empty("No freezes over %s." % _ms(slow["thresholds_ms"]["long_task"])))
    add(_table(["When", "Length", "Screen"], [[_when(r["t"]), _cell(_ms(r["ms"]), "n"), r["screen"]] for r in lt["examples"][:20]]))
    add("</section>")

    # Errors
    errs = report["errors"]
    add("<section aria-labelledby=\"err\"><h2 id=\"err\">Errors</h2><p class=\"small\">Grouped by what they said. Each group says what kind of error it is, which part of the app it belongs to, "
        "which control the tester pressed just before and where the code is.</p>")
    if not errs["groups"]:
        add(_empty("No errors were recorded."))
    for g in errs["groups"][:60]:
        add("<div class=\"note\"><span class=\"pill bad\">%s</span> <b>%s</b><br><small>%s &middot; %s &middot; first %s, last %s%s%s</small>" % (
            _h(g["category_label"]), _h(g["message"]), _h(_plural(g["count"], "time")), _h(_plural(g["sessions"], "session")), _h(g["first"].replace("T", " ")), _h(g["last"].replace("T", " ")),
            " &middot; on %s" % _h(", ".join(g["screens"])) if g["screens"] else "", " &middot; part of the app: %s" % _h(g["area"]) if g["area"] else ""))
        if g["controls"]:
            add("<br><small>Right after pressing: %s</small>" % _h(", ".join(g["controls"])))
        if g["where"]:
            add("<br><small>Where: %s</small>" % _h(g["where"] if isinstance(g["where"], str) else " / ".join(g["where"])))
        if g["stack"]:
            add("<br><small>Call stack: %s</small>" % _h(" < ".join(g["stack"])))
        if g["meaning"]:
            add("<br><small>%s</small>" % _h(g["meaning"]))
        for number, trail in enumerate(g["samples"] or ([g["last_actions"]] if g["last_actions"] else []), 1):
            add("<details><summary>The last %d actions before it (time %d)</summary><pre>%s</pre></details>" % (len(trail), number, _h("\n".join(trail))))
        add("</div>")
    if len(errs["groups"]) > 60:
        add("<p class=\"small\">%d more kinds of error are in report.json.</p>" % (len(errs["groups"]) - 60))
    failed = report["requests"]["failed"]
    if failed:
        add("<details><summary>%s failed in full</summary>" % _plural(report["requests"]["failed_total"], "request"))
        add(_table(["When", "Request", "Status", "Time", "What the app said"], [[_when(r["t"]), "%s %s" % (r["method"], r["route"]), r["status"], _cell(_ms(r["ms"]), "n"), r["error"]] for r in failed[:150]]))
        add("</details>")
    add("</section>")

    # The printer
    pr = report["printer"]
    add("<section aria-labelledby=\"pr\"><h2 id=\"pr\">The printer</h2>")
    link = pr["connections"]
    add("<p>Connected %s, dropped %s, reconnected %s.</p>" % (_plural(link.get("connect", 0), "time"), _plural(link.get("drop", 0), "time"), _plural(link.get("reconnect", 0), "time")))
    if pr["confirmed_by_printer"]:
        add("<h3>Commands the printer confirmed</h3>")
        add(_table(["Command", "Times", "Median", "Slowest"], [[c["what"], _cell(c["count"], "n"), _cell(_ms(c["median_ms"]), "n"), _cell(_ms(c["slowest_ms"]), "n")] for c in pr["confirmed_by_printer"]]))
    if pr["sent_not_read_back"]:
        add("<h3>Commands sent, timed by the app</h3><p class=\"small\">Deja Vu1 does not read these back from the printer, so it says "
            "\"sent\" and not \"confirmed\". The emergency stop is one.</p>")
        add(_table(["Command", "Times", "Median", "Slowest"], [[c["what"], _cell(c["count"], "n"), _cell(_ms(c["median_ms"]), "n"), _cell(_ms(c["slowest_ms"]), "n")] for c in pr["sent_not_read_back"]]))
    if pr["refused"]:
        add("<h3>Commands that were refused</h3>")
        add(_table(["When", "Printer or route", "In the app's words"], [[_when(r["t"]), r["route"] or r["printer"] or "", r["words"]] for r in pr["refused"][:100]]))
    add("<h3>Timeline</h3>")
    add(_table(["When", "What happened", "Printer", "Detail"], [[_when(r["t"]), (r["event"] or "").replace("_", " ") + (" (demo)" if r["demo"] else ""), r["printer"], r["file"] or r["words"]] for r in pr["timeline"][:200]]) or _empty("No printer events recorded."))
    add("</section>")

    cp = report["confirm_print"]
    add("<section aria-labelledby=\"cp\"><h2 id=\"cp\">Confirm Print</h2>")
    add("<p>%s: %s clear, %s needed a confirm, %s refused. %s went on to a print.</p>" % (
        _plural(cp["checks"], "check"), cp["by_verdict"].get("clear", 0), cp["by_verdict"].get("confirm", 0), cp["by_verdict"].get("blocked", 0), cp["went_on_to_print"]) if cp["checks"] else _empty("Confirm Print was not used."))
    if cp["reasons"]:
        add(_table(["Reason shown", "Times"], [[r["reason"], _cell(r["count"], "n")] for r in cp["reasons"][:20]]))
    add(_table(["When", "File", "Result", "Went on", "Reasons"], [[_when(r["t"]), r["file"], _Raw("<td><span class=\"pill %s\">%s</span></td>" % ({"clear": "ok", "confirm": "warn", "blocked": "bad"}.get(r["verdict"], "off"), _h(r["verdict"]))), "yes" if r["went_on"] else "no", "; ".join(r["blocking"] + r["warnings"])] for r in cp["list"][:100]]))
    add("</section>")

    add("<section aria-labelledby=\"sl\"><h2 id=\"sl\">Slicing and converting</h2><h3>Slices</h3>")
    add(_table(["When", "Engine", "Result", "Time", "Model", "Stage"], [[_when(r["t"]), ("%s %s" % (r["engine"] or "", r["version"] or "")).strip(), _Raw("<td><span class=\"pill %s\">%s</span></td>" % ("ok" if r["ok"] else "bad", "worked" if r["ok"] else _h(r["status"] or "failed"))), _ms(r["seconds"] * 1000) if r["seconds"] is not None else "", r["model"], r["stage"]] for r in report["slicing"][:60]]) or _empty("No slices recorded."))
    for r in report["slicing"]:
        if r.get("report"):
            add("<details><summary>Report for help, %s</summary><pre>%s</pre></details>" % (_h(r["t"].replace("T", " ")), _h(r["report"])))
        if r.get("stderr") or r.get("stdout"):
            add("<details><summary>The engine's whole output, %s%s</summary><pre>%s</pre></details>" % (
                _h(r["t"].replace("T", " ")), (", exit code %s" % _h(r["exit_code"])) if r.get("exit_code") is not None else "",
                _h("\n\n".join(x for x in (("--- error output ---\n" + r["stderr"]) if r.get("stderr") else "",
                                           ("--- other output ---\n" + r["stdout"]) if r.get("stdout") else "") if x))))
    add("<h3>Conversions</h3>")
    add(_table(["When", "Source", "Result", "Plates", "Colours", "Warnings shown"], [[_when(r["t"]), r["source"], _Raw("<td><span class=\"pill %s\">%s</span></td>" % ("ok" if r["ok"] else "bad", "worked" if r["ok"] else "failed")), r["plates"], r["colours"], "; ".join(r["warnings"] or []) or (r["error"] or "")] for r in report["converter"][:60]]) or _empty("No conversions recorded."))
    add("</section>")

    sm = report["smoothness"]
    add("<section aria-labelledby=\"fp\"><h2 id=\"fp\">Smoothness and speed</h2><p class=\"small\">Frames per second the page drew while the 3D twin or the G-code preview was on screen, sampled a few seconds at a time.</p>")
    if sm:
        add(_table(["Surface", "Samples", "Median", "Lowest", "Largest model", "Slowest sample at"], [[{"twin": "3D twin", "gcode": "G-code preview"}.get(k, k), _cell(v["samples"], "n"), _cell("%s fps" % v["median_fps"], "n"), _cell("%s fps" % v["lowest_fps"], "n"), ("%s layers" % v["largest_layers"]) if v["largest_layers"] else (("%s triangles" % v["largest_triangles"]) if v["largest_triangles"] else "not recorded"), ("%s layers" % v["lowest_at_size"]["layers"] if v["lowest_at_size"] and v["lowest_at_size"]["layers"] else "")] for k, v in sorted(sm.items())]))
    else:
        add(_empty("The twin and the G-code preview were not on screen long enough to sample."))
    su, mem = perf["start_up"], perf["memory"]
    if su["samples"]:
        add("<h3>Opening the app</h3><p>%s. First paint %s, largest paint %s, fully loaded %s (slowest %s). Layout shift %s.</p>" % (
            _h(_plural(su["samples"], "start")), _h(_ms(su["first_paint_ms"])), _h(_ms(su["largest_paint_ms"])), _h(_ms(su["page_loaded_ms"])), _h(_ms(su["slowest_load_ms"])),
            _h("n/a" if su["layout_shift"] is None else "%.3f" % (su["layout_shift"] / 1000.0))))
    if mem["samples"]:
        add("<p>Page memory: %s MB at first, %s MB at last, highest %s MB over %s h. Most page elements at once: %s.</p>" % (
            _h(mem["first_mb"]), _h(mem["last_mb"]), _h(mem["highest_mb"]), _h(mem["hours_between"]), _h(mem["page_elements_highest"] or "n/a")))
    health = report["server_health"]
    if health["samples"]:
        add("<h3>The server</h3><p>Memory %s MB at first, %s MB at last (highest %s MB). Processor use %s%% since it started, threads up to %s, disk space lowest %s MB, running %s h.</p>" % (
            _h(health["memory_mb"]["first"] if health["memory_mb"]["first"] is not None else "n/a"), _h(health["memory_mb"]["last"] if health["memory_mb"]["last"] is not None else "n/a"),
            _h(health["memory_mb"]["highest"] if health["memory_mb"]["highest"] is not None else "n/a"), _h(health["cpu_percent_since_start"] if health["cpu_percent_since_start"] is not None else "n/a"),
            _h(health["threads_highest"] or "n/a"), _h(health["disk_free_mb_lowest"] if health["disk_free_mb_lowest"] is not None else "n/a"), _h(health["hours_running"])))
    if health["slow_routes"]:
        add(_table(["Request", "Times", "Median", "Slowest", "First", "Last"], [["%s %s" % (r["method"], r["route"]), _cell(r["count"], "n"), _cell(_ms(r["median_ms"]), "n"), _cell(_ms(r["slowest_ms"]), "n"), _when(r["first"]), _when(r["last"])] for r in health["slow_routes"][:15]],
                   "Requests the server answered slowly"))
    nw = report["network"]
    if nw["went_offline"] or nw["live_link_closed_unexpectedly"]:
        add("<h3>The connection</h3><p>The browser went offline %s and the live link to the server closed unexpectedly %s (%s offline in all).</p>" % (
            _h(_plural(nw["went_offline"], "time")), _h(_plural(nw["live_link_closed_unexpectedly"], "time")), _h("%d s" % nw["seconds_offline"])))
    add("</section>")

    add("<section aria-labelledby=\"ft\"><h2 id=\"ft\">Features used and not used</h2><p class=\"small\">Used means the tester opened it or pressed one of its controls at least once. "
        "The section is where the 22 questions ask about it.</p><ul class=\"featgrid\">")
    for f in report["features"]["detail"]:
        add("<li><span class=\"pill %s\">%s</span><span>%s<small>Questions, section %s: %s</small></span></li>" % ("ok" if f["used"] else "off", "used" if f["used"] else "not used", _h(f["name"]), f["questions_section"] or "none", _h(f["questions_section_name"] or "no question asks about it")))
    add("</ul></section>")

    sc = report["screens"]
    add("<section aria-labelledby=\"wh\"><h2 id=\"wh\">Where they went</h2>")
    add(_table(["Screen", "Visits", "Time open"], [[r["screen"], _cell(r["opens"], "n"), _cell(_hm(r["seconds"] / 60.0), "n")] for r in sc["totals"]]) or _empty("No screens recorded."))
    add("<details><summary>The controls pressed most</summary>")
    add(_table(["Control", "Pressed", "Median", "Slowest", "On"], [[c["control"], _cell(c["count"], "n"), _cell(_ms(c["median_ms"]), "n"), _cell(_ms(c["slowest_ms"]), "n"), ", ".join(c["screens"])] for c in report["clicks"]["controls"][:60]]))
    add("</details><details><summary>Every kind of request</summary>")
    add("<p class=\"small\">Routine background reads are summed up in five-minute groups; every other request, and every failed or slow one, is recorded on its own.</p>")
    add(_table(["Request", "Times", "Failed", "Median", "Slowest"], [["%s %s" % (r["method"], r["route"]), _cell(r["count"], "n"), _cell(r["failed"], "n"), _cell(_ms(r["median_ms"]), "n"), _cell(_ms(r["slowest_ms"]), "n")] for r in report["requests"]["routes"][:80]]))
    add("</details></section>")

    add("<section aria-labelledby=\"up\"><h2 id=\"up\">Updates</h2>")
    add(_table(["When", "From", "To", "Result", "What it said"], [[_when(u["t"]), u["from"], u["to"], _Raw("<td><span class=\"pill %s\">%s</span></td>" % ("ok" if u["ok"] else "bad", "worked" if u["ok"] else "did not work")), u["words"]] for u in report["updates"]]) or _empty("No self-update happened during the test."))
    add("</section>")

    add("<section aria-labelledby=\"nv\"><h2 id=\"nv\">What this report never holds</h2><ul>%s</ul>"
        "<p class=\"small\">Anything that looks like an IP address, a key, a Wi-Fi name or a home-folder path is replaced before it is written. "
        "events.jsonl in the same zip is the raw record: open it in any text editor to check.</p></section>" % "".join("<li>%s</li>" % _h(n) for n in report["never_recorded"]))
    add("<footer>report.json holds the same data for machines (schema_version %s). Made by Deja Vu1's Tester mode.</footer></main></body></html>" % _h(report["schema_version"]))
    return "".join(out)


def render_findings(report):
    """findings.md: what to fix first, as plain text a developer can read or paste into a work session."""
    server = (report["setup"].get("server") or {})
    lines = ["# Deja Vu1 tester findings", "",
             "Report written %s. Deja Vu1 %s on %s, Python %s." % (
                 report["generated"].replace("T", " "), server.get("app_version") or "?", server.get("os") or "?", server.get("python") or "?"),
             headline_text(report), "",
             "Fix first holds at most ten of the app's own faults, worst first. Around the app lists conditions that are not the app's fault",
             "(the printer off, the network down, the computer asleep). Severity: high means a bug or a failure, medium means something that",
             "went wrong or felt wrong more than once, low means worth a look. \"the tester said\" marks something they wrote or answered.", ""]
    lines += top_md(report)
    answers = [a for a in (report.get("study") or {}).get("answers", []) if a["answered"]]
    if answers:
        lines.append("## Their answers (%d of %d questions)" % (report["study"]["answered"], report["study"]["total"]))
        lines.append("")
        for a in answers:
            lines.append("%d. %s" % (a["n"], a["question"]))
            lines.append("   Answer: %s" % (a["answer"] or a["choice_label"] or ""))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# The zip
# ---------------------------------------------------------------------------

README = """Deja Vu1 tester report
======================

This zip holds five files. Nothing in it was sent anywhere: Deja Vu1 saved it on this computer and you
attach it to a forum message yourself.

report.html   The report. Open it in any browser; it works with no internet and runs no scripts.
findings.md   What to fix first: the ten worst faults in the app, then conditions around it (the printer off, the
              network down), then the rest. Each says what happened, how often, the screen, the last presses
              before it and where to look in the code.
report.json   The same numbers as data, with a schema_version, so several reports can be combined later.
events.jsonl  The raw record, one event per line, after private details were hidden. Open it in any text
              editor if you want to check what was kept.
README.txt    This file.

What is recorded: how the app was used (screens, every button press and how it was pressed, the order you
did things in, how long the screen took to change, the switches and sliders you changed, how the setup
and the tour went), every error with what you pressed just before it, every slow request, the printer's
connects, drops, refused commands and print results, Confirm Print results, slices and conversions (engine,
worked or not, how long), how smoothly the 3D twin and the G-code preview drew, how quickly the app opened,
how much memory the page and the server used, which features were tried, any notes you wrote with
"Something felt off", your answers to the 22 questions (only the ones you answered), and any self-update.

What is never recorded:
%s

Before anything is saved, text that looks like an IP address, an API key or password, a Wi-Fi name, a
serial number, a home-folder path (such as /Users/<name>/ or C:\\Users\\<name>\\) or a file name is
replaced with a marker such as <ip> or "file 3". A file is only described as "file 3, .3mf, 2.4 MB".
If a message mentions a file the app does not know, a few words of its name might remain, and your own
notes and answers are written by you, so read report.html and events.jsonl before you send it. You can
delete everything in Settings, Tester mode, Delete tester data.

Thinning: if the record grows past %d MB, the oldest routine events (clicks that were not slow, background
requests that worked, screen visits) are summed up into one line per day and control. Errors, slow
actions, notes and the printer's story are never thinned. The report says if this happened and how many
events it dropped.
"""
