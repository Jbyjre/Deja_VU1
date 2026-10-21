# Slicer launch-readiness audit

The round-two checklist is historical evidence, not proof of physical readiness.
Current evidence is in [workspace validation](slicer-workspace-validation.md).

1. Establish current repository state, read working rules and relevant documentation, and preserve unrelated work. — **Done and verified.** Fetched main; HEAD matched 9efb807; clean tree preserved; working rules/docs read.

2. Locate and apply the three requested skills, or record their absence and follow their stated intent. — **Done and verified.** Requested three skills absent from catalog/filesystem; stated intent applied. Cloud runtime skill was actually read.

3. Audit the previous delivery’s 40-point checklist against actual code and evidence; identify incomplete, misleading or unverified claims. — **Done and verified.** All forty historical points reconciled below with code, new checks and remaining limits.

4. Study established slicer workflows and define a coherent, familiar workspace suited to this app. — **Done and verified.** Primary engine GUI/setting/workflow sources studied; Prepare, objects, process/material groups and Preview conventions applied independently.

5. Implement the workspace redesign with a usable viewport, object controls, settings organization and clear preparation/preview flow. — **Done and verified.** Integrated existing editor/forms/engine; large viewport, object list, precise edits, slicing status and output inspection.

6. Balance practical information density with beginner-friendly defaults, clear labels and discoverable advanced controls. — **Done and verified.** Grouped validated process/material settings, inherited values and edit-as-new. Per-object settings change real engine paths.

7. Make the workflow work at 1366 px and 390 px, including touch, keyboard, focus, screen-reader labels and accessible contrast. — **Partly done.** 1366/390 browser, keyboard/focus, labels, contrast fixes and compact phone modes checked; physical touch and assistive-technology testing remain.

8. Apply restrained Layer lines/glass styling, stable refresh behaviour and correct reduced-motion/transparency/contrast overrides. — **Done and verified.** Layer lines/fonts retained; opaque editing panels, stable focused forms and reduced-effect overrides inspected.

9. Study the winning multi-nozzle implementation, verify its licence and document the actual engine requirements privately. — **Done and verified.** Actual height scheduling/configuration/GUI code and AGPLv3 release/source licence checked. Private records stay in chat.

10. Deliver genuine per-tool nozzle/layer-height configuration through a capable engine, with understandable controls and real-output verification. — **Done but not verified on a real printer.** Three real-engine pairs demonstrate distinct deposition steps and consistent extrusion amounts. No physical mixed-nozzle print.

11. Coordinate mixed-nozzle scheduling, allowed heights, tool changes and incompatible combinations; provide actionable refusals. — **Done and verified.** Exact conservative grids, first layers, limits, stale tools and unsupported engines refuse clearly; actual tool output inspected.

12. Diagnose and resolve or precisely isolate the observed mixed-nozzle startup-coordinate failure without weakening safety checks. — **Done but not verified on a real printer.** Generic inherited X290/X300 startup isolated; native U1 macros pass unchanged, limits preserved. Firmware purge behaviour unverified.

13. Make four-head material, colour, nozzle and spool assignments consistent across editing, slicing, preview, Confirm Print and farm planning. — **Done but not verified on a real printer.** Saved assignments feed editing, working presets, preview and print checks; authenticated fake-printer and stale-form coverage preserved.

14. Expand profile editing into a serious, organized experience with validated values, useful presets and understandable compatibility feedback. — **Done and verified.** Quality, shells, infill, supports, adhesion, speed, temperature, flow and cooling reach validated engine settings; not every engine option is exposed.

15. Provide reliable profile persistence and recovery, including clear treatment of inherited, unsupported and incompatible settings. — **Done and verified.** Flattened private working copies, inherited/unsupported value handling, edit-as-new, stale-tool checks and internal-path recovery.

16. Complete dependable engine setup, capability/version detection, progress, cancellation, failures and missing-engine guidance. — **Partly done.** Version/schema/executable checks, bounded jobs, stages, cancellation and failures verified. Windows/macOS setup and all engine versions remain unverified.

17. Improve model importing and display for STL, OBJ and 3MF, including supported colours, units and material information. — **Partly done.** STL/triangular OBJ/3MF, units, colours and malformed files checked; complete textures, external OBJ materials and subdivided paint remain unsupported.

18. Improve non-destructive transforms, lay-flat, mirror, scale, drop-to-plate, selection and useful measurement interactions. — **Done and verified.** Numeric transforms, mirror, lay-flat, drop, selection and bounded surface measurement retained; Arrange reframes automatically.

19. Make multi-object editing, arrange, per-object settings and undo/redo dependable and natural to use. — **Done and verified.** Multi-object edit/save/undo/redo, tool assignment and object settings tested; one/four walls differ in actual output.

20. Verify build-volume checks and collision/contact reporting; distinguish actual checks from unsupported clearance or geometry guarantees. — **Done and verified.** Build bounds and bounded contact reporting tested; unsupported support, watertightness and head-clearance guarantees remain explicit.

21. Improve colour, paint, material/tool and per-part preservation through import, editing, saving, reopening and slicing. — **Partly done.** Source data/paint/per-part payloads preserved, temporary identity repair scoped; complete vendor material/texture/paint semantics remain incomplete.

22. Diagnose multi-plate conversion failures and deliver reliable plate selection/separation and slicing where supported. — **Done and verified.** Select and separate one plate; all three historical fixture plates now real-slice clearly. Arbitrary vendor/simultaneous multi-plate editing is not claimed.

23. Make the G-code preview a practical inspection workspace with responsive layer scrubbing, clear legends and useful visibility controls. — **Done and verified.** Direct layer jump, slider, visibility, legends, events and viewport-connected results; optional controls adapt to phone width.

24. Verify extrusion/travel, tool/speed/feature colouring, retraction/tool-change markers and correct file-order layer handling. — **Done and verified.** File-order layers, extrusion/retraction debt, travel, tools and requested speed/feature semantics covered; sampling remains disclosed.

25. Show honest time and filament figures, explain calculation assumptions, and preserve “unknown” when information is missing. — **Done and verified.** Engine figures separated from file calculations; unknown metadata preserved; nominal time and weight assumptions labelled.

26. Verify end-to-end library → editor → engine → pre-flight → Confirm Print → queue/farm handoff, including refused and blocked outputs. — **Done but not verified on a real printer.** Browser editing through real engine/preview/Confirm Print entry; queue/refusal/blocked-output fake-printer paths. No physical print started.

27. Complete the colour/image workflow’s usability, valid multi-colour projects and correct physical-tool assignments. — **Done but not verified on a real printer.** Current real engine slices four-tool tiles and layered fixtures; physical appearance remains unverified.

28. Improve measured colour calibration and invalidate or warn about recipes when relevant material or process conditions change. — **Done but not verified on a real printer.** Tracked process/material/backing/order invalidation and generated-layer contract; synthetic fixtures only, physical measurement remains owner work.

29. Improve image-relief/model generation where useful, while clearly distinguishing it from geographic terrain or full CAD. — **Done and verified.** Closed image relief real-sliced; geography, AI generation and full CAD are explicitly separate unimplemented capabilities.

30. Verify per-printer camera/time-lapse lifecycle, reconnects, failures, printer switching and simultaneous printers. — **Done but not verified on a real printer.** Per-printer camera/authentication/reconnect/stale/duplicate/module lifecycle tests retained and run; no physical camera verified.

31. Improve hardware/add-on compatibility reporting and investigate useful feeder integration; do not imply detection is working control. — **Partly done.** Read-only add-on/virtual-tool guard inspected and tested. Feeder drivers, control and installation remain unimplemented.

32. Deliver a sound full backup/restore workflow if feasible, including preview, validation, recovery and protection of existing data. — **Done and verified.** Versioned full app-data backup, validation/preview, isolated restore, rollback on write failure and actual Linux launcher start. Other OS launchers unexecuted.

33. Verify cancellation history, active-head cleanup, live status delivery and protection against stale printer-specific forms or replies. — **Partly done.** Cancel history/head cleanup and stale replies covered; engine cancellation/queue races fixed. Heater-fault ring and error-clear reachability remain open.

34. Preserve security, route/module gating, real/demo separation, selected-printer scope, refusal wording and data honesty throughout. — **Done and verified.** Existing host/origin/anti-framing, module/storage/printer scopes, escaping and data honesty preserved; full suite checks them.

35. Measure before/after performance using large models and long G-code; optimize the real bottlenecks and report the test environment. — **Partly done.** 400k-triangle selection improved; comparable full-frame measurements regressed under SwiftShader. No heavy-model/real-phone smoothness claim.

36. Test malformed files, awkward geometry, empty states, unsupported settings, engine failures and authenticated fake-printer paths. — **Done and verified.** Malformed XML/archives/checksums, invalid heights/options, engine crashes/cancellation, recovery failures and authenticated fake-printer paths checked.

37. Run appropriate focused checks, then the full test suite with no demo server running; investigate failures properly. — **Done and verified.** Clean full suite: 759 tests in 128.765 seconds, passing, with app/demo servers stopped. Interrupted early run excluded.

38. Inspect real-browser screenshots at both target widths, re-record the online demo, and update documentation, boards and affected media. — **Partly done.** Inspected paired viewport images, demo recording, guides and boards refreshed. New preview GIF added; older editorial crops/video cuts still need a final pass.

39. Commit finished features separately, open a clear pull request, resolve relevant failures, and merge according to the authorized convention. — **Partly done.** Separate feature commits exist. Pull-request/check/merge outcome is reported in the owner delivery chat; no polling or auto-merge.

40. Deliver the complete final report: all 40 statuses, evidence, remaining limits, private research records and concise owner testing steps. — **Done and verified.** Complete owner report supplied with delivery: forty statuses, evidence, private historical/reverified research and practical testing steps.

## Audit of the historical forty-point record

| Historical point(s) | Checked outcome |
| --- | --- |
| 1–3 | Working rules/main verified; requested skills still absent; runtime remains standard-library/plain JS. |
| 4–6 | Twenty-project record supplied by owner is historical. This pass reverified the multi-nozzle engine/release; no new bundled engine or winner-source copying. Missing historical studied-file records were not invented. |
| 7–10 | Tool assignment/readback/refusal and per-printer camera paths exist with authenticated stand-in coverage; physical claims remain unverified. |
| 11–12 | Shared-height limitation was real. Distinct heights now reach a capable engine, with actual extrusion evidence. |
| 13–15 | Image tiles/layered colours/reliefs exist and were real-sliced again; physical calibration/geographic terrain/full CAD remain distinct gaps. |
| 16 | Add-on detection remains read-only. No feeder driver/control/installer was completed. |
| 17–19 | Preservation/display limits remain. Three-plate failure now has a verified separation/identity-slot repair; full vendor fidelity is still incomplete. |
| 20–22 | Transforms, multi-object settings and bounded contact/measurement exist; no support/head-clearance/watertightness guarantee follows. |
| 23–24 | Preview semantics and honest calculations remain; new navigation/legends and output connection were browser checked. |
| 25–27 | Common-settings editor/bridge existed; now grouped settings, capability checks, cancellation and current real-engine/queue checks extend them. |
| 28–29 | Security/scope retained; responsive browser proof is not physical-phone or assistive-technology verification. |
| 30 | Historical heavy-mesh regression was not solved by documentation. Selection is faster now; current full-frame regressions are reported. |
| 31–34 | Difficult-file/fake-printer/lifecycle tests exist and were extended; historical totals were replaced by a clean current run. |
| 35 | Selected export was incomplete. Full versioned app-data snapshot plus isolated recovery is now implemented and Linux-tested. |
| 36–37 | Current docs/boards/screens/demo updated; older editorial and 75-second video material remains unfinished. |
| 38–40 | Current feature commits, PR/merge outcome and owner report are tracked separately from historical delivery. |
