"""
tester_report_top.py
====================

The top of the tester report, shared by report.html and findings.md so the two always agree:

  1. a headline strip: time used, presses, errors, slow spots, freezes and server stalls;
  2. "Fix first": at most ten of the app's own faults, each with what happened, how often, the screen, the last presses
     before it and where to look in the code;
  3. "Around the app": conditions that are not the app's fault (the printer off, the network down, the computer asleep);
  4. "More findings": everything else, grouped by the part of the app.

It also holds the few formatting helpers both pages use. Nothing here reads a file, the clock or the network, and it imports
nothing from the report builder, so tester_report_render.py and tester_report_part*.py can both import it.
"""

import html


def _h(value):
    return html.escape("" if value is None else str(value), quote=True)


def _plural(n, one, many=None):
    return "%s %s" % (n, one if n == 1 else (many or one + "s"))


def _hm(minutes):
    minutes = float(minutes or 0)
    if minutes < 60:
        return "%d min" % round(minutes)
    return "%d h %02d min" % (minutes // 60, round(minutes % 60))


def _when(iso):
    return str(iso or "")[:16].replace("T", " ")


SEV_PILL = {"high": "bad", "medium": "warn", "low": "off"}
KIND_WORDS = {"error": "error", "slow": "slow", "request": "request", "server": "server", "refused": "refused", "printer": "printer",
              "slice": "slice", "convert": "converter", "smooth": "smoothness", "note": "tester note", "answer": "tester answer",
              "network": "network", "onboarding": "first run", "stall": "server stall"}

TOP_CSS = """
.strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin:0 0 14px;padding:0;list-style:none}
.strip li{border:1px solid var(--line);border-radius:10px;padding:8px 12px;background:var(--card)}
.strip b{display:block;font:700 1.35rem/1.15 var(--mono);font-variant-numeric:tabular-nums}.strip span{color:var(--dim);font-size:.82rem}
.strip li.bad b{color:var(--bad)}.strip li.warn b{color:var(--warn)}.strip li.ok b{color:var(--ok)}
.fixlist{margin:0;padding:0;list-style:none;display:grid;gap:6px}
.fix{border:1px solid var(--line);border-radius:10px;background:var(--bg)}.fix>summary{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;padding:8px 12px;color:var(--ink)}
.fix>summary b{font-weight:650}.fix .rank{font:700 .85rem var(--mono);color:var(--faint);min-width:1.6em}.fix .meta{color:var(--faint);font-size:.82rem;font-weight:400;overflow-wrap:anywhere}
.fix .facts{padding:2px 14px 12px;grid-template-columns:minmax(110px,max-content) 1fr}.fix .facts dd ol{margin:0;padding-left:1.2em}
.fix code{font:.82rem var(--mono);background:var(--card);border:1px solid var(--line);border-radius:6px;padding:0 5px;white-space:nowrap}
.groups details{border:1px solid var(--line);border-radius:10px;padding:2px 10px;margin:.4rem 0}
@media(max-width:560px){.fix .facts{grid-template-columns:1fr}}
"""


def headline(report):
    """[(value, label, class)] for the strip: time used, presses, errors, slow spots, freezes, stalls."""
    h = report.get("headline") or {}
    days = h.get("days_used", 0)
    return [(_hm(h.get("minutes_used")), "used over %s" % _plural(days, "day"), ""),
            (h.get("presses", 0), "presses", ""),
            (h.get("errors", 0), "errors in %s" % _plural(h.get("error_kinds", 0), "kind"), "bad" if h.get("errors") else "ok"),
            (h.get("slow_spots", 0), "slow spots", "warn" if h.get("slow_spots") else "ok"),
            (h.get("freezes", 0), "page freezes (%d s)" % h.get("freeze_seconds", 0), "warn" if h.get("freezes") else "ok"),
            (h.get("stalls", 0), "server stalls", "bad" if h.get("stalls") else "ok")]


def headline_text(report):
    h = report.get("headline") or {}
    return "%s used over %s, %s, %s in %s, %s, %s, %s." % (
        _hm(h.get("minutes_used")), _plural(h.get("days_used", 0), "day"), _plural(h.get("presses", 0), "press", "presses"),
        _plural(h.get("errors", 0), "error"), _plural(h.get("error_kinds", 0), "kind"), _plural(h.get("slow_spots", 0), "slow spot"),
        _plural(h.get("freezes", 0), "page freeze") + " (%d s)" % h.get("freeze_seconds", 0), _plural(h.get("stalls", 0), "server stall"))


def how_often(f):
    n = f.get("count") or 1
    text = "once" if n == 1 else "%d times" % n
    if f.get("sessions"):
        text += " in %s" % _plural(f["sessions"], "session")
    if n > 1 and f.get("first") and f.get("last"):
        text += ", first %s, last %s" % (_when(f["first"]), _when(f["last"]))
    return text


def screen_of(f):
    names = [s for s in (f.get("screens") or []) if s]
    return ", ".join(names) if names else (f.get("area") or "not recorded")


def _output_of(report, f):
    """The engine's whole output for a failed slice, as text, or ''."""
    index = f.get("slice")
    rows = report.get("slicing") or []
    if not isinstance(index, int) or not 0 <= index < len(rows):
        return ""
    row = rows[index]
    parts = []
    if row.get("stderr"):
        parts.append("--- the engine's error output ---\n%s" % row["stderr"])
    if row.get("stdout"):
        parts.append("--- the engine's other output ---\n%s" % row["stdout"])
    return "\n\n".join(parts)


def finding_html(report, f, number=None):
    """One finding as a closed row (title, how often, screen, first place to look) that opens to the five facts."""
    pills = "<span class=\"pill %s\">%s</span> <span class=\"pill off\">%s</span> " % (
        SEV_PILL.get(f["severity"], "off"), _h(f["severity"]), _h(KIND_WORDS.get(f["kind"], f["kind"])))
    if f.get("tester_said"):
        pills += "<span class=\"pill ok\">the tester said</span> "
    code = f.get("code") or []
    meta = " &middot; ".join(_h(x) for x in (how_often(f), screen_of(f), code[0] if code else "") if x)
    out = ["<li><details class=\"fix\" id=\"%s\"><summary>%s%s%s<b>%s</b><span class=\"meta\">%s</span></summary><dl class=\"facts\">" % (
        _h(f["id"]), ("<span class=\"rank\">%d</span>" % number) if number else "", pills, "", _h(f["title"]), meta)]
    out.append("<dt>What happened</dt><dd>%s</dd>" % _h(f.get("detail") or f["title"]))
    out.append("<dt>How often</dt><dd>%s</dd>" % _h(how_often(f)))
    out.append("<dt>Screen</dt><dd>%s</dd>" % _h(screen_of(f)))
    trail = f.get("trail") or []
    out.append("<dt>Last presses before it</dt><dd>%s</dd>" % (
        ("<ol>%s</ol>" % "".join("<li>%s</li>" % _h(x) for x in trail[-5:])) if trail else "none recorded in the ten minutes before"))
    places = ["<code>%s</code>" % _h(c) for c in code] + [_h(w) for w in (f.get("where") or []) if not str(w).startswith("Code: ")]
    out.append("<dt>Where to look</dt><dd>%s</dd>" % (" ".join(places) if places else "not enough was recorded to point at code"))
    text = _output_of(report, f)
    if text:
        out.append("<dt>The engine's whole output</dt><dd><details><summary>Show %d characters</summary><pre>%s</pre></details></dd>" % (len(text), _h(text)))
    out.append("</dl></details></li>")
    return "".join(out)


def top_html(report):
    """The sections that open the report: headline strip, fix first, around the app, more findings."""
    findings = report.get("findings") or []
    first = sorted((f for f in findings if f.get("fix_first")), key=lambda f: f["fix_first"])
    around = [f for f in findings if f["origin"] == "condition"]
    more = [f for f in findings if f["origin"] == "app" and not f.get("fix_first")]
    out = ["<ul class=\"strip\" aria-label=\"What was recorded\">%s</ul>" % "".join(
        "<li class=\"%s\"><b>%s</b><span>%s</span></li>" % (cls, _h(v), _h(label)) for v, label, cls in headline(report))]
    out.append("<section aria-labelledby=\"fix\"><h2 id=\"fix\">Fix first</h2><p class=\"small\">The %s worst faults in Deja Vu1 itself, worst first. "
               "Open one for what happened, how often, the screen, the last presses before it and where to look in the code. "
               "The same list is in findings.md.</p>" % ("ten" if len(first) >= 10 else str(len(first)) if first else "no"))
    if first:
        out.append("<ol class=\"fixlist\">%s</ol>" % "".join(finding_html(report, f, f["fix_first"]) for f in first))
    else:
        out.append("<p class=\"empty\">Nothing needed fixing in what was recorded.</p>")
    out.append("</section>")
    if around:
        out.append("<section aria-labelledby=\"around\"><h2 id=\"around\">Around the app</h2><p class=\"small\">These are conditions around Deja Vu1, "
                   "not faults in it: the printer off, the network down, the computer asleep or restarting. They are kept apart so they do not hide a fix.</p>"
                   "<ul class=\"fixlist\">%s</ul></section>" % "".join(finding_html(report, f) for f in around))
    if more:
        groups = {}
        for f in more:
            groups.setdefault(f.get("area") or "Other", []).append(f)
        out.append("<section aria-labelledby=\"more\" class=\"groups\"><h2 id=\"more\">More findings</h2><p class=\"small\">The rest of the app's faults, "
                   "grouped by the part of the app.</p>")
        for area, rows in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            out.append("<details><summary>%s &middot; %s</summary><ul class=\"fixlist\">%s</ul></details>" % (
                _h(area), _h(_plural(len(rows), "finding")), "".join(finding_html(report, f) for f in rows)))
        out.append("</section>")
    return "".join(out)


def finding_md(report, f, number=None):
    lines = ["### %s%s [%s] %s" % (("%d. " % number) if number else "", f["id"], f["severity"], f["title"]),
             "- What happened: %s" % (f.get("detail") or f["title"]),
             "- How often: %s" % how_often(f),
             "- Screen: %s" % screen_of(f),
             "- Last presses before it: %s" % ("; ".join(f["trail"][-5:]) if f.get("trail") else "none recorded in the ten minutes before"),
             "- Where to look: %s" % ("; ".join((f.get("code") or []) + [w for w in (f.get("where") or []) if not str(w).startswith("Code: ")])
                                     or "not enough was recorded to point at code")]
    if f.get("tester_said"):
        lines.append("- The tester said this.")
    text = _output_of(report, f)
    if text:
        lines += ["- The engine's whole output:", "", "```", text, "```"]
    lines.append("")
    return lines


def top_md(report):
    findings = report.get("findings") or []
    first = sorted((f for f in findings if f.get("fix_first")), key=lambda f: f["fix_first"])
    around = [f for f in findings if f["origin"] == "condition"]
    more = [f for f in findings if f["origin"] == "app" and not f.get("fix_first")]
    lines = ["## Fix first", ""]
    if not first:
        lines += ["Nothing needed fixing in what was recorded.", ""]
    for f in first:
        lines += finding_md(report, f, f["fix_first"])
    if around:
        lines += ["## Around the app", "", "Conditions around Deja Vu1, not faults in it (the printer off, the network down, the computer asleep or restarting).", ""]
        for f in around:
            lines += finding_md(report, f)
    if more:
        lines += ["## More findings", ""]
        groups = {}
        for f in more:
            groups.setdefault(f.get("area") or "Other", []).append(f)
        for area, rows in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            lines += ["### %s (%s)" % (area, _plural(len(rows), "finding")), ""]
            for f in rows:
                lines.append("- %s [%s] %s: %s (%s). Look at: %s" % (f["id"], f["severity"], f["title"], (f.get("detail") or "")[:200], how_often(f),
                                                                  ", ".join(f.get("code") or []) or "n/a"))
            lines.append("")
    return lines
