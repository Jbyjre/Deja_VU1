"""
app_post.py: the web server's answers to every POST request (/api/...): the actions a page or the assistant asks for.
Split out of app.py's DejaVuHandler on 19 November 2026 so a session reads only the part it needs: DejaVuHandler
takes these methods on as a mixin (class PostRoutes), so self.<anything> works exactly as before.
"""

import os
import threading
import time
import app_updates
import autostart
import desktop
import automations
import backup
import project_plates
import logbook
import print_record
import camera
import color_check
import companion_sensor
import colour_map
import storage
import converter_3mf
import cost_calculator
import discovery
import webrtc_relay
import file_library
import filament_inventory
import spoolman_bridge
import fleet
import handoff
import webrtc_camera
import home_assistant_bridge
import live_feed
import layer_planner
import maintenance
import mock_moonraker
import modules
import notifications
import pairing
import photo_studio
import memory
import orca_import
import readiness
import selfcheck
import sandbox
import engine_installer
import slicer_bridge
import slicer_working
import timelapse
import tool_setup
import plate_project
import model_maker
import update_hold
import remote
import ai_assistant
import ai_providers
import tester
import tester_study
import watch_only
import wled_bridge
from app_part1 import (  # noqa: F401
    PORT, _CONTROL_ACTIONS, _QUEUE_ACTIONS, _q, _restart_soon,
)

# app.py hands these over right after it defines them (they stay there because they read settings that tests and
# the launcher change on app itself): _install_update, phone_link.
_install_update = None
phone_link = None


class PostRoutes:
    """Methods of DejaVuHandler (app.py), kept here by area."""

    def _handle_api_post(self, printer_id, force_disconnected=False):
        route = self.path.split("?")[0].rstrip("/")
        query = self._query()
        connected = mock_moonraker.is_connected(printer_id)

        if route in ("/api/colorcheck/sensors", "/api/colorcheck/readings"):
            if self._module_blocked("color_check"):
                return None
            body = self._read_json_body()
            action = companion_sensor.configure if route.endswith("/sensors") else companion_sensor.ingest
            return self._send_json(action(body))

        if route == "/api/colorcheck/calibration":
            if self._module_blocked("color_check"):
                return None
            body = self._read_json_body()
            return self._send_json(color_check.calibrate(body.get("toolhead"), body.get("step") or "white"))

        if route.startswith("/api/assistant/"):
            if self._module_blocked("ai_assistant"):
                return None
            body = self._read_json_body()
            verb = route[len("/api/assistant/"):]
            demo = self._wants_demo()
            try:
                if verb == "key":
                    ai_providers.save_key(body.get("provider"), body.get("api_key"), body.get("base_url"))
                    return self._send_json(ai_assistant.status())
                if verb == "forget":
                    return self._send_json(ai_assistant.forget(body.get("provider")))
                if verb == "select":
                    return self._send_json(ai_assistant.select(body.get("provider"), body.get("model"), body.get("mode"),
                                                               body.get("never_ask")))
                if verb == "budget":
                    return self._send_json(ai_assistant.budget(body.get("provider"), body.get("model"), body.get("price_in"),
                                                               body.get("price_out"), body.get("cap_usd"),
                                                               bool(body.get("clear_price"))))
                if verb == "watch":
                    extra = {k: body.get(k) for k in ("first_layer", "last_layers", "compare", "confirm", "picture", "notify",
                                                      "looks", "sensitivity", "notes", "policy")}
                    return self._send_json(ai_assistant.watch_settings(body.get("on"), body.get("minutes"),
                                                                       body.get("pause"), **extra))
                if verb == "watch/now":
                    return self._send_json(ai_assistant.watch_now(body.get("printer") or printer_id))
                if verb == "watch/judge":
                    return self._send_json(ai_assistant.watch_judge(body.get("look"), body.get("judged")))
                if verb == "watch/rehearse":
                    return self._send_json(ai_assistant.watch_rehearse(body.get("frame"), body.get("label"), body.get("name")))
                if verb == "estimate":
                    return self._send_json(ai_assistant.estimate(body.get("thread"), body.get("text"), printer_id, demo,
                                                                 body.get("context")))
                if verb == "models":
                    return self._send_json(ai_providers.list_models(body.get("provider"), bool(body.get("refresh"))))
                if verb == "check":
                    ai_providers.check(body.get("provider"))
                    return self._send_json(ai_assistant.status())
                if verb == "test":
                    return self._send_json(ai_assistant.test(body.get("provider")))
                if verb == "signin":
                    return self._send_json(ai_assistant.signin(body.get("provider"), body.get("action"),
                                                               body.get("value")))
                if verb == "chat":
                    return self._send_json(ai_assistant.chat(body.get("thread"), body.get("text"), printer_id, demo,
                                                             body.get("context"), body.get("picture")))
                if verb == "retry":
                    return self._send_json(ai_assistant.retry(body.get("thread"), body.get("provider"), printer_id, demo))
                if verb == "decide":
                    return self._send_json(ai_assistant.decide(body.get("thread"), body.get("n"), body.get("approve"),
                                                               printer_id, demo, bool(body.get("always"))))
                if verb == "stop":
                    return self._send_json(ai_assistant.stop(body.get("thread")))
                if verb == "clear":
                    return self._send_json(ai_assistant.clear(body.get("thread")))
            except ai_providers.AIError as error:
                return self._send_json({"error": str(error)}, status=502)
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        if route in ('/api/backup/preview','/api/backup/restore','/api/backup/discard'):
            if self._module_blocked('backup'):
                return None
            if route.endswith('/preview'):
                return self._send_json(backup.preview_restore(self._read_raw_body(backup.MAX_ARCHIVE_BYTES)))
            if route.endswith('/discard'):
                return self._send_json(backup.discard_preview(self._read_json_body()))
            return self._send_json(backup.restore(self._read_json_body()))

        if route == "/api/app/desktop":
            return self._send_json(desktop.save_settings(self._read_json_body()))
        if route == "/api/app/watch-only":
            return self._send_json(watch_only.set_on(self._read_json_body().get("on")))
        if route == "/api/app/autostart":
            # It writes into this computer's sign-in items, so only a browser on this computer may.
            body = self._read_json_body()
            if not self._this_computer():
                return self._send_json({"error": "Change this on the computer that runs Deja Vu1"}, status=403)
            if body.get("on"):
                return self._send_json({"error": "Deja Vu1 no longer starts with the computer or keeps running in "
                                                 "the background. It starts when you open it and stops by itself "
                                                 "when nobody uses it."}, status=410)
            autostart.retire()
            return self._send_json(autostart.status())
        if route == "/api/app/updates/settings":
            return self._send_json(app_updates.save_settings(self._read_json_body()))
        if route == "/api/app/updates/check":
            self._read_json_body()
            return self._send_json(app_updates.check())
        if route == "/api/app/updates/install":
            self._read_json_body()
            return self._send_json(_install_update(self.server, background=True))
        if route == "/api/app/repair":
            # The newest published files over this copy, even at the same version.
            self._read_json_body()
            return self._send_json(_install_update(self.server, repair=True, background=True))
        if route == "/api/app/ready":
            # "Is it really working?" in words: the launcher window, Settings and start.py --check show it.
            self._read_json_body()
            return self._send_json(readiness.report(PORT))
        if route == "/api/app/report":
            # A text report to paste when asking for help. It names folders on this computer, so only here.
            self._read_json_body()
            if not self._this_computer():
                return self._send_json({"error": "Copy the report on the computer that runs Deja Vu1"}, status=403)
            return self._send_json({"text": readiness.help_report(PORT)})
        if route == "/api/app/restart":
            self._read_json_body()
            if os.environ.get("DEJAVU_LAUNCHER") != "1":
                raise ValueError("This copy was started without the double-click launcher, so it can't restart itself. "
                                 "Close its window and start it again")
            _restart_soon(self.server, reason="restart")
            return self._send_json({"restarting": True, "version": app_updates.version()})
        if route == "/api/app/stop":
            # Only from the computer it runs on: a phone could stop it but never start it again.
            body = self._read_json_body()
            if not self._this_computer():
                return self._send_json({"error": "Stop Deja Vu1 from the computer it runs on. "
                                                 "A phone can't start it again"}, status=403)
            # Stopped on purpose: the 5-minute check (Task Scheduler) leaves it stopped until it is
            # started again by hand, the computer restarts or a few hours pass. Not when the update
            # blocks ask (for_update): they stop it only to start it again, and one that failed half way
            # (no internet, a locked file) must not leave a note that keeps Deja Vu1 off.
            if not (isinstance(body, dict) and body.get("for_update") is True):
                autostart.mark_stopped(storage.DATA_DIR)
            threading.Timer(0.5, self.server.shutdown).start()
            return self._send_json({"stopping": True})
        if route == "/api/app/selfcheck":
            self._read_json_body()
            return self._send_json(selfcheck.run())
        if route == "/api/app/memory/snapshot":
            self._read_json_body()
            return self._send_json(memory.snapshot("manual"))
        if route == "/api/app/memory/restore":
            body = self._read_json_body()
            result = memory.restore(body.get("id"), body.get("file"))
            # Every module re-reads the restored records after a restart.
            if os.environ.get("DEJAVU_LAUNCHER") == "1":
                result["restarting"] = True
                _restart_soon(self.server, reason="restore")
            else:
                result["restart_needed"] = True
            return self._send_json(result)
        if route == "/api/import/orca/projects":
            if self._module_blocked("file_library"):
                return None
            return self._send_json(orca_import.import_projects(self._read_json_body().get("ids")))
        if route == "/api/import/orca/profile":
            if self._module_blocked("auto_print"):
                return None
            return self._send_json(orca_import.import_profile(self._read_json_body()))
        if route == "/api/app/updates/git":
            # A development copy: git pull --ff-only, then a restart through
            # the launcher if there is one (otherwise the person restarts it).
            self._read_json_body()
            result = app_updates.git_update()
            if result["updated"] and os.environ.get("DEJAVU_LAUNCHER") == "1":
                result["restarting"] = True
                _restart_soon(self.server, reason="update")
            return self._send_json(result)

        if route == "/api/tools/layer-plan":
            # A calculator: no printer needed, nothing stored.
            body = self._read_json_body()
            return self._send_json(layer_planner.plan(body.get("heads") or [], bool(body.get("exact")),
                                                      body.get("part_height")))

        if route == "/api/tools/assignments":
            if self._module_blocked("filament_inventory"):
                return None
            return self._send_json(tool_setup.save(self._read_json_body()))

        if route == '/api/files/plates/extract':
            if self._module_blocked('file_library'):
                return None
            return self._send_json(project_plates.save(self._read_json_body()))

        if route == "/api/files/plate":
            if self._module_blocked("file_library"):
                return None
            return self._send_json(plate_project.save(self._read_json_body()))

        if route in ("/api/maker/build", "/api/maker/calibration"):
            if self._module_blocked("photo_studio") or self._module_blocked("file_library"):
                return None
            body=self._read_json_body()
            return self._send_json(model_maker.build(body) if route.endswith("/build") else model_maker.save_calibration(body))

        if route == "/api/maintenance/done":
            return self._handle_maintenance(connected, force_disconnected, lambda body: maintenance.mark_done(
                body.get("task_id") or "", note=body.get("note", "")), require="task_id")

        if route == "/api/maintenance/swap":
            return self._handle_maintenance(connected, force_disconnected, lambda body: maintenance.record_swap(
                body.get("kind"), body.get("toolhead"), note=body.get("note", ""), nozzle=body.get("nozzle")))

        if route == "/api/maintenance/snooze":
            return self._handle_maintenance(connected, force_disconnected, lambda body: maintenance.snooze(
                body.get("task_id") or "", body.get("days")), require="task_id")

        if route in ("/api/tester/events", "/api/tester/delete", "/api/tester/answers"):
            if self._module_blocked("tester"):
                return None
            body = self._read_json_body()
            if route == "/api/tester/delete":
                return self._send_json(tester.delete_all())
            if route == "/api/tester/answers":
                return self._send_json(tester_study.save_answers(body.get("answers")))
            return self._send_json(tester.ingest(body))

        if route.startswith("/api/modules/") and route.endswith("/toggle"):
            module_id = route[len("/api/modules/"):-len("/toggle")]
            body = self._read_json_body()
            result = modules.set_enabled(module_id, body.get("enabled", True))
            if module_id == "tester":
                tester.refresh()                 # turning it off stops the recording at once
            if module_id == "printer_link":
                fleet.sync_real_printers()
            return self._send_json({"modules": result})

        if route in _CONTROL_ACTIONS or route in _QUEUE_ACTIONS:
            is_control = route in _CONTROL_ACTIONS
            if self._module_blocked("printer_control" if is_control else "print_queue"):
                return None
            if force_disconnected or (not connected and not self._wants_demo()):
                return self._send_json({"connected": False, "demo": False}, status=409)
            body = self._read_json_body()
            if (is_control and route != "/api/printer/control/estop" and watch_only.is_on()
                    and mock_moonraker.is_real(printer_id)):
                # Said first, whatever else the command would be refused for. moonraker_client
                # refuses it again underneath, for anything that reaches a printer another way.
                raise watch_only.WatchOnly(watch_only.MESSAGE)
            if route != "/api/printer/control/estop" and mock_moonraker.is_real(printer_id) and update_hold.active():
                raise update_hold.UpdateHold(update_hold.MESSAGE)
            started = time.perf_counter()
            action = _CONTROL_ACTIONS[route] if is_control else _QUEUE_ACTIONS[route]
            result = action(body)
            # Re-read the printer straight away rather than waiting for the
            # next 250 ms tick, and wake every live connection with it.
            fresh = live_feed.refresh(printer_id)
            payload = result if isinstance(result, dict) else {"result": result}
            payload.update({"confirmed_state": fresh,
                            "server_ms": round((time.perf_counter() - started) * 1000, 1)})
            return self._send_json(self._tag(payload, connected))

        if route in ("/api/fleet/broadcast", "/api/fleet/route"):
            is_broadcast = route == "/api/fleet/broadcast"
            if self._module_blocked("fleet_command") or \
                    self._module_blocked("printer_control" if is_broadcast else "print_queue"):
                return None
            connected = connected or mock_moonraker.any_connected()
            demo = self._wants_demo()
            if not connected and not demo:
                return self._send_json({"connected": False, "demo": False}, status=409)
            body = self._read_json_body()
            if is_broadcast:
                result = fleet.broadcast(body.get("action"), body.get("printers"), body.get("params"),
                                         include_demo=demo)
                # Push each printer's read-back to every open dashboard now.
                for row in result["results"]:
                    if mock_moonraker.has_printer(row["printer"]):
                        live_feed.refresh(row["printer"])
            else:
                result = fleet.route_file(body.get("filename"), body.get("to"),
                                          body.get("from_printer"), body.get("item_id"), include_demo=demo)
            return self._send_json(self._tag(result, connected))

        if route.startswith("/api/sandbox/"):
            if self._module_blocked("sandbox") or not self._demo_allowed(connected):
                return None
            body = self._read_json_body()
            verb = route[len("/api/sandbox/"):]
            actions = {
                "farm": lambda: sandbox.build_farm(body.get("count", 6), body.get("busy_fraction", 0.5),
                                                   body.get("seed")),
                "teardown": sandbox.teardown,
                "scenario": lambda: sandbox.load_scenario(body.get("steps"), body.get("preset"), body.get("seed")),
                "run": lambda: sandbox.set_running(body.get("running", True)),
                "speed": lambda: sandbox.set_speed(body.get("speed", 1)),
                "step": lambda: sandbox.step(body.get("seconds", 60)),
                "fire": lambda: {"outcomes": sandbox.fire(body.get("event"), body.get("printer") or "random",
                                                          body.get("params")), **sandbox.status()},
                "reset": sandbox.reset,
            }
            if verb not in actions:
                return self._send_json({"error": "Unknown endpoint"}, status=404)
            return self._send_json(actions[verb]())

        if route.startswith("/api/demo/"):
            if not self._demo_allowed(connected):
                return None
            body = self._read_json_body()
            if route == "/api/demo/fail-next":
                return self._send_json(mock_moonraker.fail_next(
                    body.get("action"), body.get("message") or "Moonraker did not accept the command"))
            if route == "/api/demo/time-scale":
                return self._send_json(mock_moonraker.set_time_scale(body.get("scale", 1)))
            if route == "/api/demo/reset":
                sandbox.reset()                 # its printers' queues and logs go with them
                mock_moonraker.reset_all()
                for pid in mock_moonraker.printer_ids():
                    live_feed.refresh(pid)
                return self._send_json({"reset": True})
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        if route == "/api/files/upload":
            if self._module_blocked("file_library"):
                return None
            name = _q(query, "name")
            file_library.clean_name(name)          # refuse bad names before reading the body
            return self._send_json(file_library.save(name, self._read_raw_body(), origin="upload"))

        if route.startswith("/api/files/"):
            if self._module_blocked("file_library"):
                return None
            body = self._read_json_body()
            if route == "/api/files/samples":
                return self._send_json(file_library.add_samples())
            if route == "/api/files/delete":
                return self._send_json(file_library.delete(body.get("name")))
            if route == "/api/files/edit":
                return self._send_json(file_library.save_edit(body.get("name"), body.get("edits")))
            if route == "/api/files/restore":
                return self._send_json(file_library.restore_original(body.get("name")))
            if route == "/api/files/opened":
                file_library.touch(body.get("name"), "last_opened")
                return self._send_json({"ok": True})
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        if route == "/api/studio/save":
            if self._module_blocked("photo_studio") or self._module_blocked("file_library"):
                return None
            name = _q(query, "name")
            file_library.clean_name(name)          # refuse bad names before reading the body
            return self._send_json(photo_studio.save(name, self._read_raw_body(), query.get("note", [""])[0]))

        if route in ("/api/timelapse/keep", "/api/timelapse/forget"):
            if self._module_blocked("timelapse"):
                return None
            body = self._read_json_body()
            if route.endswith("/forget"):
                return self._send_json(timelapse.remove_saved_video(printer_id, body.get("name")))
            root, path = body.get("root"), body.get("path")
            if force_disconnected or not connected:
                return self._send_json({"connected": False, "demo": False})
            # Checked now, in words, so a wrong press is refused at once; the copy itself runs in the background and streams to disk.
            if not mock_moonraker.is_real(printer_id):
                raise ValueError("Demo printers record no videos")
            if not mock_moonraker.is_connected(printer_id):
                raise ValueError("The printer is not connected. Check its address and power")
            mock_moonraker.real_printer(printer_id)._video_path(root, path)
            job = timelapse.start_keep(printer_id, root, path, lambda out, progress: mock_moonraker.printer_video_download(
                printer_id, root, path, out, timelapse.MAX_VIDEO_BYTES, progress))
            return self._send_json({"job": job, "running": job["state"] == "running"}, status=202)

        if route.startswith("/api/slicer/"):
            if self._module_blocked("auto_print"):
                return None
            body = self._read_json_body()
            verb = route[len("/api/slicer/"):]
            if verb == "settings":
                return self._send_json(slicer_bridge.save_settings(body))
            if verb == "check":
                return self._send_json(slicer_bridge.check())
            if verb == "report":
                # The slicing report (one slice, or the engine alone): what ran, where it stopped, why.
                return self._send_json(slicer_bridge.export(body.get("job")))
            if verb == "find":
                return self._send_json(slicer_bridge.find_slicers())
            if verb == "engine/check":
                # The person pressed "Check for a newer engine": the only time the engine's release list is asked for.
                return self._send_json(engine_installer.check_for_update())
            if verb == "engine/install":
                return self._send_json(engine_installer.install(allow_unverified=bool(body.get("allow_unverified"))), status=202)
            if verb == "engine/cancel":
                return self._send_json(engine_installer.cancel())
            if verb == "working":
                return self._send_json(slicer_working.set_working(body))
            if verb == "working/sync-heads":
                return self._send_json(slicer_working.sync_heads())
            if verb == "profiles":
                return self._send_json(slicer_bridge.add_profile(body.get("name"), body.get("machine"),
                                                                 body.get("process"), body.get("filaments")))
            if verb == "profiles/from-installed":
                return self._send_json(slicer_bridge.add_installed_profile(body))
            if verb == "profiles/stock":
                return self._send_json(slicer_bridge.use_stock_profile())
            if verb.startswith('jobs/') and verb.endswith('/cancel'):
                return self._send_json(slicer_bridge.cancel_job(verb.split('/')[1]))
            if verb.startswith("profiles/") and verb.endswith("/remove"):
                return self._send_json(slicer_bridge.remove_profile(verb.split("/")[1]))
            if verb == "slice":
                queue_to = None
                if body.get("queue"):
                    # Queueing is a printer action: the same rules as /api/queue/add.
                    if self._module_blocked("print_queue"):
                        return None
                    if force_disconnected or (not connected and not self._wants_demo()):
                        return self._send_json({"error": "No printer connected to queue it on - slice without "
                                                         "queueing, or turn on demo data", "connected": False,
                                                "demo": False}, status=409)
                    queue_to = printer_id
                job = slicer_bridge.start_job(body.get("name"), body.get("profile"), queue_to,
                                              on_done=lambda j: live_feed.publish_event({
                                                  "type": "slicer", "job": {k: j.get(k) for k in (
                                                      "id", "model", "status", "step", "error", "queued")}}))
                return self._send_json(job)
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        if route == "/api/convert":
            if self._module_blocked("converter"):
                return None
            body = self._read_json_body()
            name = body.get("name")
            try:
                data, report = converter_3mf.convert(file_library.read_bytes(name), body.get("plan"))
            except converter_3mf.ConversionError as exc:
                tester.note_convert(name, None, error=str(exc))
                return self._send_json(exc.as_dict(), status=400)
            tester.note_convert(name, report)
            new_name = converter_3mf.converted_name(file_library.clean_name(name))
            entry = file_library.save(new_name, data, origin="converted",
                                      note=f"Converted from {name} ({report['source_label']})")
            return self._send_json({"file": entry, "report": report})

        if route == "/api/colours/apply":
            if self._module_blocked("converter") or self._module_blocked("file_library"):
                return None
            body = self._read_json_body()
            name = body.get("name")
            data, report = colour_map.apply(file_library.read_bytes(name), body.get("plan"))
            entry = file_library.save(colour_map.mapped_name(file_library.clean_name(name)), data, origin="colours",
                                      note=f"{name} with its colours on the U1's heads ({report['summary']})")
            return self._send_json({"file": entry, "report": report})

        if route in ("/api/prints/note", "/api/prints/settings", "/api/prints/forget"):
            body = self._read_json_body()
            if route == "/api/prints/note":
                return self._send_json(print_record.set_note(body.get("id"), body.get("note")))
            if route == "/api/prints/forget":
                return self._send_json(print_record.forget(body.get("id")))
            return self._send_json(print_record.set_settings(body.get("keep_days")))

        if route.startswith("/api/logbook"):
            if self._module_blocked("maintenance"):
                return None
            body = self._read_json_body()
            demo = not mock_moonraker.is_connected()
            if route == "/api/logbook/add":
                return self._send_json(logbook.add(body.get("problem"), body.get("fix") or "", body.get("tags"), demo=demo))
            parts = route.split("/")
            if len(parts) == 5 and parts[4] == "fix":
                return self._send_json(logbook.update(parts[3], fix=body.get("fix") or ""))
            if len(parts) == 5 and parts[4] == "delete":
                return self._send_json(logbook.delete(parts[3]))
            return self._send_json({"error": "Unknown logbook action"}, status=404)

        if route.startswith("/api/automations"):
            if self._module_blocked("automations"):
                return None
            body = self._read_json_body()
            if route == "/api/automations":
                return self._send_json(automations.add_rule(body.get("rule"), demo=self._wants_demo()))
            parts = route.split("/")
            if len(parts) == 5:
                rule_id, verb = parts[3], parts[4]
                if verb == "update":
                    return self._send_json(automations.update_rule(rule_id, body.get("changes") or {}))
                if verb == "delete":
                    return self._send_json({"rules": automations.delete_rule(rule_id)})
                if verb == "test":
                    rule = next((r for r in automations.list_rules() if r["id"] == rule_id), None)
                    if rule and rule.get("demo") and not self._wants_demo():
                        return self._send_json({"error": "This rule was made with demo data - "
                                                         "switch demo data on to test it"}, status=409)
                    target = printer_id if mock_moonraker.has_printer(printer_id) else mock_moonraker.default_printer_id()
                    return self._send_json(automations.test_fire(rule_id, target))
            return self._send_json({"error": "Unknown endpoint"}, status=404)

        if route == "/api/printers/discover":
            # This computer's own home networks; with {"wider": true} also nearby home ranges and
            # the Tailscale network (discovery.wider_places). Nothing outside networks you control.
            if self._module_blocked("fleet"):
                return None
            body = self._read_json_body() or {}
            urls = [p["moonraker_url"] for p in fleet.registered()]
            return self._send_json(discovery.discover(urls, wider=bool(body.get("wider"))))

        if route == "/api/printers/test":
            # Tries an address before it is added; nothing is saved.
            if self._module_blocked("fleet"):
                return None
            body = self._read_json_body()
            url = fleet.normalise_url(body.get("moonraker_url"))
            fleet.check_url(url)
            key = str(body.get("api_key") or "").strip() or None
            result = discovery.probe(url, key)
            # "http://192.168.1.50" is the printer's web page; when nothing
            # there speaks Moonraker, try Moonraker's own port before saying no.
            other = fleet.moonraker_port_variant(url)
            if other and not result["ok"] and not result["needs_key"]:
                second = discovery.probe(other, key)
                if second["ok"] or second["needs_key"]:
                    result, url = second, other
            # And the other way round: the U1's web server on port 80 forwards to the same
            # Moonraker (the door the printer's own web page uses), for when 7125 doesn't answer.
            web = fleet.web_port_variant(url)
            if web and not result["ok"] and not result["needs_key"]:
                third = discovery.probe(web, key)
                if third["ok"] or third["needs_key"]:
                    result, url = third, web
            return self._send_json({**result, "url": url})

        if route == "/api/printers/login":
            # Signs in once with the printer's own username and password and
            # hands back its API key. Neither the password nor the key is saved here.
            if self._module_blocked("fleet"):
                return None
            body = self._read_json_body()
            url = fleet.normalise_url(body.get("moonraker_url"))
            fleet.check_url(url)
            key = discovery.key_from_login(url, body.get("username"), body.get("password"))
            return self._send_json({"url": url, "api_key": key})

        if route == "/api/fleet/registry":
            if self._module_blocked("fleet"):
                return None
            body = self._read_json_body()
            return self._send_json(fleet.add(body.get("name"), body.get("moonraker_url"), body.get("api_key")))

        if route.startswith("/api/fleet/registry/") and route.endswith("/remove"):
            if self._module_blocked("fleet"):
                return None
            return self._send_json({"printers": fleet.remove(route.split("/")[4])})

        if route == "/api/camera/settings":
            if self._module_blocked("camera"):
                return None
            return self._send_json(camera.save_settings(self._read_json_body()))

        if route == "/api/printer/files/fetch":
            # A file on the printer itself, copied into the library so Confirm Print can check it.
            if self._module_blocked("printer_control") or self._module_blocked("file_library"):
                return None
            body = self._read_json_body()
            return self._send_json(mock_moonraker.fetch_printer_file(body.get("path")))

        if route == "/api/camera/webrtc":
            # One WebRTC signalling message to the printer's own camera (webrtc_relay.py).
            if self._module_blocked("camera"):
                return None
            printer = mock_moonraker.real_printer(mock_moonraker.selected_printer_id())
            if printer is None or not printer.is_connected():
                raise ValueError("Choose a connected printer first. Demo printers have no camera")
            return self._send_json(webrtc_relay.signal(printer, self._read_json_body()))

        if route == "/api/camera/find":
            # Reads the selected printer's camera list and saves the first
            # feed that really answers with a picture.
            if self._module_blocked("camera"):
                return None
            self._read_json_body()
            printer = mock_moonraker.real_printer(mock_moonraker.selected_printer_id())
            if printer is None:
                raise ValueError("Choose a connected printer first. Demo printers have no camera")
            found = camera.find_printer_stream(printer)
            camera.save_settings({"stream_url": found["stream_url"]})
            return self._send_json(found)

        if route == "/api/camera/webrtc/settings":
            if self._module_blocked("webrtc_camera"):
                return None
            return self._send_json(webrtc_camera.save_settings(self._read_json_body()))

        if route == "/api/camera/webrtc/offer":
            if self._module_blocked("webrtc_camera"):
                return None
            return self._send_json(webrtc_camera.exchange(self._read_json_body()))

        if route == "/api/handoff":
            if self._module_blocked("handoff"):
                return None
            body = self._read_json_body()
            return self._send_json(handoff.report(body.get("device_id"), body.get("device_name"),
                                                  body.get("view") or {}))

        if route == "/api/filament/spools":
            if self._module_blocked("filament_inventory"):
                return None
            body = self._read_json_body()
            spool = filament_inventory.add_spool(
                body.get("material"), body.get("color_name"),
                body.get("color_hex"), body.get("grams_remaining"), body.get("weight_source"))
            return self._send_json(spool)

        if route == "/api/filament/spoolman":
            if self._module_blocked("filament_inventory"):
                return None
            body = self._read_json_body()
            return self._send_json(spoolman_bridge.import_spools(body.get("url")))

        if route.startswith("/api/filament/charges/") and route.endswith("/move"):
            if self._module_blocked("filament_inventory"):
                return None
            charge_id = route[len("/api/filament/charges/"):-len("/move")]
            body = self._read_json_body()
            return self._send_json(filament_inventory.move_charge(charge_id, str(body.get("spool_id") or "")))

        if route.startswith("/api/filament/spools/") and route.endswith("/remove"):
            if self._module_blocked("filament_inventory"):
                return None
            spool_id = route[len("/api/filament/spools/"):-len("/remove")]
            inventory = filament_inventory.remove_spool(spool_id)
            return self._send_json({"spools": inventory})

        if route.startswith("/api/filament/spools/") and route.endswith("/grams"):
            if self._module_blocked("filament_inventory"):
                return None
            spool_id = route[len("/api/filament/spools/"):-len("/grams")]
            body = self._read_json_body()
            spool = filament_inventory.update_grams(spool_id, body.get("grams_remaining"),
                                                    body.get("weight_source") or "weighed")
            return self._send_json(spool)

        if route == "/api/notifications/settings":
            if self._module_blocked("notifications"):
                return None
            body = self._read_json_body()
            return self._send_json(notifications.public_settings(notifications.save_settings(body)))

        if route == "/api/notifications/test":
            if self._module_blocked("notifications"):
                return None
            body = self._read_json_body()
            message = str(body.get("message") or "Test notification from Deja Vu1")[:500]
            return self._send_json(notifications.notify(message, priority="high"))

        if route == "/api/pairing/code":
            return self._send_json(pairing.generate_code())

        if route == "/api/pairing/link":
            return self._send_json(phone_link(self._read_json_body().get("base")))

        if route in ("/api/remote/share", "/api/remote/stop", "/api/remote/link"):
            body = self._read_json_body()
            if route == "/api/remote/link":
                # A code to scan at home: the phone then opens the private address anywhere.
                shared = remote.status(PORT)["shared_url"]
                if not shared:
                    raise ValueError("Turn on Away from home first, on the computer running Deja Vu1")
                return self._send_json(phone_link(shared))
            # Sharing changes this computer's Tailscale settings, so only this
            # computer may switch it (not a phone, not through the share itself).
            if not self._this_computer():
                return self._send_json({"error": "Switch Away from home on or off on the computer running "
                                                 "Deja Vu1, at http://localhost:%d" % PORT}, status=403)
            return self._send_json(remote.share(PORT) if route == "/api/remote/share" else remote.stop(PORT))

        if route == "/api/pairing/redeem":
            body = self._read_json_body()
            known = self._device()
            device = pairing.redeem_code(body.get("code"), body.get("device_name"),
                                         replaces=known.get("id") if known else None)
            # The device's key goes into a cookie the page's scripts can't read.
            cookie = (f"{pairing.COOKIE}={device.pop('token')}; Path=/; Max-Age={pairing.COOKIE_DAYS * 86400}; "
                      "HttpOnly; SameSite=Strict")
            return self._send_json(device, cookie=cookie)

        if route == "/api/pairing/lock":
            body = self._read_json_body()
            if not (self._this_computer() or self._device()):
                raise ValueError("Pair this device first, or change the lock on the computer running Deja Vu1, "
                                 "so nobody can lock you out")
            return self._send_json({"lock": pairing.set_lock(body.get("on"))})

        if route.startswith("/api/pairing/devices/") and route.endswith("/unpair"):
            device_id = route[len("/api/pairing/devices/"):-len("/unpair")]
            devices = pairing.unpair(device_id)
            return self._send_json({"devices": devices})

        if route == "/api/cost/settings":
            if self._module_blocked("cost_calculator"):
                return None
            body = self._read_json_body()
            return self._send_json(cost_calculator.save_settings(body))

        if route == "/api/wled/settings":
            if self._module_blocked("wled_bridge"):
                return None
            body = self._read_json_body()
            return self._send_json(wled_bridge.save_settings(body))

        if route == "/api/wled/test":
            if self._module_blocked("wled_bridge"):
                return None
            return self._send_json(wled_bridge.test_connection())

        if route == "/api/wled/push":
            if self._module_blocked("wled_bridge"):
                return None
            return self._send_json(wled_bridge.push_ring_states())

        if route == "/api/homeassistant/settings":
            if self._module_blocked("home_assistant_bridge"):
                return None
            body = self._read_json_body()
            return self._send_json(home_assistant_bridge.public_settings(
                home_assistant_bridge.save_settings(body)))

        if route == "/api/homeassistant/push":
            if self._module_blocked("home_assistant_bridge"):
                return None
            return self._send_json(home_assistant_bridge.push_sensors())

        return self._send_json({"error": "Unknown endpoint"}, status=404)
