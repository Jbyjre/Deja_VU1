# Next for the live background and the 3D twin

The owner (23 October 2026) wants both to keep getting better, and expects to think
of more ideas later. This brief gives the next session goals and room to choose how.

## Where things stand

- `frontend/backdrop.js`: Dots by default, plus Constellation, Flow, Layer lines and
  Still; six colour sets (including Time of day); Reaction (Gentle, Lively, Wild);
  "Little surprises": click ripple, triple-click bloom, long-press charge and
  release, a sweep each minute, the time in dots on the hour, a burst when a print
  finishes, typing "u1", and the Konami code. A running print fills the dots from the
  bottom in its filament's colour. Everything stops drawing when nothing moves.
- `frontend/twin3d.js` + `twin3d-scene.js`: a WebGL 2 model of the U1 built from
  Snapmaker's official product picture and published figures, in two modes (a
  realistic model and an engineering drawing made from the same geometry).

## Goals (pick what helps most; measure frame time before and after)

1. Background ideas the owner may like: seasonal and holiday designs (dates from the
   browser's clock), a print's first layer drawn as a path across the dots, the next
   queued job previewed in dots, a gentle "breathing" when a printer needs attention,
   sound off by default if any is added, and a hidden gallery of the surprises in
   Settings once each has been seen. Keep text contrast; keep idle cost at zero.
2. The 3D twin: real dock positions if Snapmaker publishes them (they live in the
   printer's own Klipper config, not in u1-klipper's public files), a moving filament
   path while printing, the bed's actual heat colour, the camera view on the model's
   screen, and an exploded view of one toolhead. Confirm any estimated size against a
   measured machine before stating it as fact.
3. Performance on real phones and GPUs: the model was only measured in software
   rendering (about 250 ms a frame on the CPU); measure on hardware and add a
   lower-detail level if needed.
4. Film the new background and twin in the next launch video (promo-video/README.md).
