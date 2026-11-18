"""
tester_questions.py
===================

The questions a tester answers inside Deja Vu1 when the test is over (or whenever they like): 52 questions
in 12 sections, in the same order as the tester questions sheet, so a tester never needs a separate sheet.

Each question has
  n         its number, 1 to 52 (the id is "q<n>")
  text      the question
  help      an optional line that tells the tester how to find the answer
  kind      "text" (a free answer) or "yn" (Yes, No or Didn't try it, plus an optional note)
  optional  True where "Didn't try it" is a normal answer (the phone, the AI assistant, a few others)
  auto      a fact the app already recorded (os, python, browser, firmware, engine), shown next to the question
  saw       what the report can say about it: "feature:<id>" (tester_report.FEATURES), "screen:<name>",
            "fact:<name>" (see tester_study.hints)
  bad       the choice ("yes" or "no") that points at a problem, for the report's findings list (see _TROUBLE)
  sev       how serious that answer is: "high", "medium" or "low"
  finding   a free-text question whose answer goes into the findings list as it is (see _TELL_US)

The questions hold nothing private and are the same for every tester. Nothing here reads or writes a file.
"""

CHOICES = {"yes": "Yes", "no": "No", "didnt_try": "Didn't try it"}


def _q(n, text, kind="text", help=None, optional=None, auto=None, saw=()):
    return {"n": n, "id": "q%d" % n, "text": text, "kind": kind, "help": help, "optional": optional, "auto": auto,
            "saw": list(saw), "bad": None, "sev": None, "finding": False}


SECTIONS = [
    {"id": 1, "name": "Your setup", "optional": False,
     "blurb": "About your computer and your printer. The app already noted some of this, so a short answer is fine.",
     "questions": [
         _q(1, "What computer and operating system are you on (Windows, macOS or Linux, and which version)?", auto="os"),
         _q(2, "Which Python version do you have?",
            help="On Windows, open PowerShell and type python --version. On a Mac or Linux, open Terminal and type "
                 "python3 --version.", auto="python"),
         _q(3, "Which firmware is your U1 on, stock or Paxx's Extended Firmware, and which version?", auto="firmware"),
         _q(4, "How is your computer connected to the printer: the same Wi-Fi, a cable, or something else? "
               "Does the printer have a fixed IP address?",
            help="Yes or no is enough. Please leave out your network's name and the printer's address."),
         _q(5, "Which browser do you open Deja Vu1 in?", auto="browser"),
         _q(6, "How did you install it, and how long did it take from download to seeing the dashboard? "
               "Where did you get stuck, if anywhere?"),
     ]},
    {"id": 2, "name": "First run", "optional": False,
     "blurb": "The first minutes with the app.",
     "questions": [
         _q(7, "Did Find printers on my network find your U1, or did you type the address? What happened?",
            saw=["screen:printers"]),
         _q(8, "Did the printer show as connected within a few seconds? If not, what did the message say?",
            kind="yn", saw=["fact:connects"]),
         _q(9, "Did you turn on watch-only first (Settings)? What did you look at while it was on?",
            kind="yn", saw=["fact:watch_only"]),
         _q(10, "First impression: what made sense straight away, and what took you a moment to find?"),
     ]},
    {"id": 3, "name": "Speed: slow or laggy spots", "optional": False,
     "blurb": "The app timed every press already. Your own feeling matters more than the numbers.",
     "questions": [
         _q(11, "Did any button take more than a second to react? Which one, and on which screen?",
            kind="yn", saw=["fact:slow"]),
         _q(12, "Did any screen feel slow to open or freeze for a moment? Which one?", kind="yn", saw=["fact:slow"]),
         _q(13, "Did the 3D twin or the G-code preview stutter? Roughly how big was the model?",
            kind="yn", saw=["feature:twin", "feature:gcode_preview"]),
         _q(14, "Did anything slow your whole computer down while Deja Vu1 was open?", kind="yn"),
     ]},
    {"id": 4, "name": "Watching the printer", "optional": False,
     "blurb": "Overview, the Printer page, the camera and the 3D twin.",
     "questions": [
         _q(15, "Overview and the Printer page: did temperatures, state, progress and time left match the touchscreen?",
            kind="yn", saw=["screen:overview", "screen:printer"]),
         _q(16, "Did all four heads (T0 to T3) show up with the right temperatures?", kind="yn",
            saw=["screen:printer"]),
         _q(17, "Did the color and material shown for each head match what's loaded? Change one on the touchscreen: "
                "did Deja Vu1 update within about 30 seconds?", kind="yn"),
         _q(18, "Chamber: did it show a temperature, or say the printer doesn't report one?"),
         _q(19, "Needs you: did it put the right things at the top (a finished print, a fault, maintenance due)? "
                "Did anything show up there that shouldn't have?", kind="yn", saw=["feature:needs_you"]),
         _q(20, "The camera: did the picture appear, and how long did it take? Did it keep up during a print?",
            kind="yn", saw=["feature:camera"]),
         _q(21, "Time-lapses: did one get made, and did it play back?", kind="yn", saw=["feature:timelapse"]),
         _q(22, "The 3D twin: did the head, the bed and the part follow the real print? Anything that looked wrong?",
            kind="yn", saw=["feature:twin"]),
     ]},
    {"id": 5, "name": "Printing", "optional": False,
     "blurb": "Confirm Print, pausing, skipping an object and the Printer page controls.",
     "questions": [
         _q(23, "Print a small file through Confirm Print. Did the summary make sense before you pressed Start? "
                "Anything in it you didn't understand?", saw=["feature:confirm_print"]),
         _q(24, "Did Confirm Print ever stop a start? What reason did it give, and was it right?",
            kind="yn", saw=["feature:confirm_print", "fact:gate"]),
         _q(25, "If you can, open a file that wants a different color on one head than the one loaded. Did Confirm "
                "Print catch it? If it ever lets a mismatch through, cancel the print and say so here: that is a "
                "serious bug.", kind="yn", saw=["feature:confirm_print"]),
         _q(26, "Pause and resume once during a print. Did each one say \"confirmed by the printer\"?",
            kind="yn", saw=["fact:confirmed"]),
         _q(27, "Skip one object: put two or three small objects on one plate, then skip one during the print. "
                "Did the bed map show them, and did only that one stop?", kind="yn", saw=["feature:skip_object"]),
         _q(28, "When the print finished, did Deja Vu1 notice by itself? Did the print show in history with the "
                "right grams?", kind="yn", saw=["fact:prints"]),
         _q(29, "The Printer page controls (move, heat, fans, lights): which did you use, and did each do what you "
                "expected?", saw=["feature:printer_controls"]),
     ]},
    {"id": 6, "name": "Files, slicing and converting", "optional": False,
     "blurb": "The file library, the slicing engine, the G-code preview and the converter.",
     "questions": [
         _q(30, "Did you slice a model in Deja Vu1? Which engine (Snapmaker Orca or OrcaSlicer), and did it work? "
                "If it failed, paste the report from Copy report for help.", kind="yn",
            saw=["feature:slicing", "fact:slices"], auto="engine"),
         _q(31, "The G-code preview: did the layers and the colors per head look right?", kind="yn",
            saw=["feature:gcode_preview"]),
         _q(32, "The converter: did you convert a MakerWorld, Printables, Bambu Studio or PrusaSlicer project? Were "
                "the objects on the right plates and the colors on the right heads? Did it slice without warnings?",
            kind="yn", saw=["feature:converter"]),
         _q(33, "The Photo Studio: did the color changes land on the layers the plan said?", kind="yn",
            optional=True, saw=["feature:photo_studio"]),
     ]},
    {"id": 7, "name": "Filament and care", "optional": False,
     "blurb": "Spools, maintenance and the print queue.",
     "questions": [
         _q(34, "Did you add your spools, or import them from Spoolman (optional)? Did the grams left look right "
                "after a print?", kind="yn", saw=["screen:filament", "feature:spoolman"]),
         _q(35, "Maintenance: did the tasks and their due dates make sense for your printer?", kind="yn",
            saw=["feature:maintenance"]),
         _q(36, "Did you use the print queue? Did it wait for you to confirm the bed was clear?", kind="yn",
            saw=["feature:queue"]),
     ]},
    {"id": 8, "name": "Phone and away from home", "optional": True,
     "blurb": "Optional. If you didn't try these, tap Didn't try it.",
     "questions": [
         _q(37, "Did you open Deja Vu1 on your phone with the QR code? How did it work on the small screen?",
            kind="yn", saw=["feature:phone"]),
         _q(38, "Did you try Away from home (Tailscale)? Did it connect?", kind="yn", saw=["feature:away"]),
         _q(39, "Did you set up a notification (ntfy, Discord or Telegram) or Home Assistant? Did it arrive?",
            kind="yn", saw=["feature:notifications"]),
     ]},
    {"id": 9, "name": "The AI assistant", "optional": True,
     "blurb": "Optional. Skip this part if you didn't use the assistant.",
     "questions": [
         _q(40, "Did you try the assistant? What did you ask it to do?", kind="yn", saw=["feature:ai_assistant"]),
         _q(41, "Was it helpful? Did it explain things clearly, and did you trust what it did? Anything it got wrong?"),
         _q(42, "Did you try Print watch or Print doctor? What happened?", kind="yn",
            saw=["feature:print_watch", "feature:print_doctor"]),
         _q(43, "Would you use it again, or would you rather do things by hand?"),
     ]},
    {"id": 10, "name": "Updates and settings", "optional": False,
     "blurb": "Self-updates and the Settings screen.",
     "questions": [
         _q(44, "Did Deja Vu1 update itself while you were testing? Did anything break after it did?", kind="yn",
            saw=["feature:updates"]),
         _q(45, "Did you change any settings or switch features off? Did anything surprise you?", kind="yn",
            saw=["screen:settings"]),
     ]},
    {"id": 11, "name": "Overall", "optional": False,
     "blurb": "Your own words. These are the most useful answers of all.",
     "questions": [
         _q(46, "What did you like most?"),
         _q(47, "What frustrated you most, or felt broken or unfinished?"),
         _q(48, "What was the most confusing part: anything you had to guess at or look up?"),
         _q(49, "If you could change one thing first, what would it be?"),
         _q(50, "Would you keep using Deja Vu1 for your own printing? Why or why not?", kind="yn"),
     ]},
    {"id": 12, "name": "Evidence", "optional": False,
     "blurb": "The last two. Your report is saved right after this.",
     "questions": [
         _q(51, "Before you save your report you can open it (View report). Did anything in it look private or wrong?",
            kind="yn"),
         _q(52, "Anything that broke: the exact error words and what you were doing right before. And anything else "
                "you noticed that no question above covered."),
     ]},
]

# The answer that points at a problem, and how serious it is. "Did any button take more than a second?" is a
# problem on Yes; "Did the printer show as connected?" is a problem on No. Questions with no entry are not scored.
_TROUBLE = {8: ("no", "high"), 11: ("yes", "medium"), 12: ("yes", "medium"), 13: ("yes", "medium"), 14: ("yes", "medium"),
            15: ("no", "medium"), 16: ("no", "medium"), 17: ("no", "medium"), 20: ("no", "medium"), 21: ("no", "low"),
            22: ("no", "medium"), 25: ("no", "high"), 26: ("no", "medium"), 27: ("no", "medium"), 28: ("no", "medium"),
            30: ("no", "medium"), 31: ("no", "medium"), 32: ("no", "medium"), 33: ("no", "low"), 34: ("no", "medium"),
            35: ("no", "low"), 36: ("no", "medium"), 37: ("no", "medium"), 38: ("no", "low"), 39: ("no", "low"),
            50: ("no", "low"), 51: ("yes", "high")}
# Free answers that are findings in their own right (what frustrated them, what confused them, what to change, what broke).
_TELL_US = {47: "medium", 48: "medium", 49: "medium", 52: "high"}

QUESTIONS = []
for _section in SECTIONS:
    for _question in _section["questions"]:
        if _question["optional"] is None:
            _question["optional"] = _section["optional"]
        _question["section"] = _section["id"]
        if _question["n"] in _TROUBLE:
            _question["bad"], _question["sev"] = _TROUBLE[_question["n"]]
        if _question["n"] in _TELL_US:
            _question["finding"], _question["sev"] = True, _TELL_US[_question["n"]]
        QUESTIONS.append(_question)

BY_ID = {q["id"]: q for q in QUESTIONS}
COUNT = len(QUESTIONS)


def section_of(question_id):
    q = BY_ID.get(question_id)
    return next((s for s in SECTIONS if q and s["id"] == q["section"]), None)


def public():
    """The sections as the browser needs them (all of it is plain data)."""
    return [{"id": s["id"], "name": s["name"], "blurb": s["blurb"], "optional": s["optional"],
             "questions": [{k: q[k] for k in ("n", "id", "text", "help", "kind", "optional", "auto")}
                           for q in s["questions"]]} for s in SECTIONS]
