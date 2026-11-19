"""
tester_questions.py
===================

The 22 questions a tester can answer inside Deja Vu1, in nine sections, in the same order and words as the tester
questions sheet, so a tester can answer in the app or in a message and never needs a second list. They ask only what
the tester report cannot record: what the tester expected, what confused them, whether the app's figures matched
reality and whether they would trust it. Every question can be skipped. Questions 16 and 17 are optional, and
"Didn't try it" is a one-press answer for them.

Each question has
  n         its number, 1 to 22 (the id is "q<n>")
  text      the question, as the sheet words it
  help      an optional line that tells the tester how to find the answer
  optional  True where "Didn't try it" is a normal answer (the phone, the AI assistant)
  auto      a fact the app already recorded ("firmware", "computer", "engine"), shown next to the question
  saw       what the report can say about it: "feature:<id>" (tester_report.FEATURES), "screen:<name>",
            "fact:<name>" (see tester_study.hints)
  finding   True for a free answer that goes into the findings list as written (see _TELL_US)
  sev       how serious that answer is for the findings list

The questions hold nothing private and are the same for every tester. Nothing here reads or writes a file.
"""

CHOICES = {"didnt_try": "Didn't try it"}


def _q(n, text, help=None, optional=None, auto=None, saw=()):
    return {"n": n, "id": "q%d" % n, "text": text, "help": help, "optional": optional, "auto": auto,
            "saw": list(saw), "sev": None, "finding": False}


SECTIONS = [
    {"id": 1, "name": "Your setup", "optional": False,
     "blurb": "About you and your printer. The app already noted some of this.",
     "questions": [
         _q(1, "How long have you had your U1, what nozzle sizes are on each head, and what slicer do you normally "
               "use? Are you on stock firmware or Paxx's Extended Firmware?", auto="firmware"),
         _q(2, "How long did the download and install take, and did anything confuse you before the dashboard "
               "first opened?", auto="computer"),
     ]},
    {"id": 2, "name": "First run", "optional": False,
     "blurb": "The first minutes with the app.",
     "questions": [
         _q(3, "Was it obvious how to add your printer, or did you have to guess? What did you try first?",
            saw=["screen:printers", "fact:connects"]),
         _q(4, "First impression: what made sense straight away, and what took you a moment to find?"),
     ]},
    {"id": 3, "name": "Speed", "optional": False,
     "blurb": "The app timed every press already. Your own feeling matters more than the numbers.",
     "questions": [
         _q(5, "Did anything feel slow enough to bother you, even if it eventually worked? Did you ever press "
               "something twice because you thought the first press didn't register?", saw=["fact:slow"]),
     ]},
    {"id": 4, "name": "Watching the printer", "optional": False,
     "blurb": "Overview, the Printer page, the camera and the 3D twin.",
     "questions": [
         _q(6, "Overview and the Printer page: did temperatures, state, progress and time left match the "
               "touchscreen? Did all four heads (T0 to T3) show up with the right temperatures? Did the Needs you "
               "list put the right things at the top?",
            saw=["screen:overview", "screen:printer", "feature:needs_you"]),
         _q(7, "Did the color and material shown for each head match what's loaded? Change one on the touchscreen: "
               "did Deja Vu1 update within about 30 seconds?", saw=["screen:printer"]),
         _q(8, "The camera and the 3D twin: did the picture match what you could see on the printer? Did the twin "
               "move with the real print, or lag behind it?", saw=["feature:camera", "feature:twin"]),
     ]},
    {"id": 5, "name": "Printing", "optional": False,
     "blurb": "Confirm Print, pausing, skipping an object and what the print left behind.",
     "questions": [
         _q(9, "Print a small file through Confirm Print. Did the summary make sense before you pressed Start, or "
               "did any line confuse you? If Confirm Print stopped a start, was it right to stop it?",
            saw=["feature:confirm_print", "fact:gate"]),
         _q(10, "If you can, open a file that wants a different color on one head than the one loaded. Did Confirm "
                "Print catch it, and was its reason clear and correct? (If it ever lets a mismatch through, cancel "
                "the print and tell me: that's a serious bug.)", saw=["feature:confirm_print", "fact:gate"]),
         _q(11, "Pause and resume once during a print, and skip one object if you can (two or three small objects "
                "on one plate). Did each pause and resume say \"confirmed by the printer\"? When you paused, did the "
                "printer actually stop when you expected? When you skipped an object, did it really stop printing "
                "while the others kept going?", saw=["fact:confirmed", "feature:skip_object"]),
         _q(12, "When the print finished, did the grams in history match what the spool actually lost?",
            saw=["fact:prints"]),
     ]},
    {"id": 6, "name": "Files, slicing and converting", "optional": False,
     "blurb": "The slicing engine, the G-code preview and the converter.",
     "questions": [
         _q(13, "Did you slice a model in Deja Vu1? Did the G-code preview's layers and colors per head look "
                "right, and did the sliced file print the way you expected?",
            saw=["feature:slicing", "fact:slices", "feature:gcode_preview"], auto="engine"),
         _q(14, "The converter: did you convert a MakerWorld, Printables, Bambu Studio or PrusaSlicer project? Did "
                "the result open in Snapmaker Orca looking right, and when you printed it, did the colors land on "
                "the heads you expected?", saw=["feature:converter"]),
     ]},
    {"id": 7, "name": "Filament and care", "optional": False,
     "blurb": "Spools and maintenance.",
     "questions": [
         _q(15, "Did you add your spools, or import them from Spoolman? After a print, did the grams left match "
                "what you know the spool has? Did the maintenance tasks and their due dates make sense for your "
                "printer?", saw=["screen:filament", "feature:spoolman", "feature:maintenance"]),
     ]},
    {"id": 8, "name": "Phone and AI", "optional": True,
     "blurb": "Optional. If you didn't try these, press Didn't try it.",
     "questions": [
         _q(16, "Did you open Deja Vu1 on your phone with the QR code? Could you actually use it on the small "
                "screen, or was anything too small, hard to tap, or hard to read?", saw=["feature:phone"]),
         _q(17, "Did you try the AI assistant, Print watch or Print doctor? What did you ask it to do, was the "
                "answer right, and anything it got wrong?",
            saw=["feature:ai_assistant", "feature:print_watch", "feature:print_doctor"]),
     ]},
    {"id": 9, "name": "Overall", "optional": False,
     "blurb": "Your own words. These are the most useful answers of all.",
     "questions": [
         _q(18, "What did you like most?"),
         _q(19, "What frustrated you most, or felt broken or unfinished, even if it technically worked? What was "
                "the most confusing part, anything you had to guess at or look up?"),
         _q(20, "If you could change one thing first, what would it be?"),
         _q(21, "Would you trust Deja Vu1 to start a print while you were out of the room? Why or why not?"),
         _q(22, "Would you keep using Deja Vu1 for your own printing? Why or why not? What do you normally use to "
                "watch or control your printer, and how did Deja Vu1 compare?"),
     ]},
]

# Free answers that are findings in their own right: what frustrated or confused them, and the one change they would make
# first. The other answers are read in the report's Answers section next to what the app recorded.
_TELL_US = {19: "medium", 20: "medium"}

QUESTIONS = []
for _section in SECTIONS:
    for _question in _section["questions"]:
        if _question["optional"] is None:
            _question["optional"] = _section["optional"]
        _question["section"] = _section["id"]
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
             "questions": [{k: q[k] for k in ("n", "id", "text", "help", "optional", "auto")}
                           for q in s["questions"]]} for s in SECTIONS]
