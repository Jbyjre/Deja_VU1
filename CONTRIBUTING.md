# Contributing to Deja Vu1

Thanks for helping improve Deja Vu1. The project deliberately stays small, dependency-free, and honest about what is simulated versus connected to real hardware.

## Before changing code

Please preserve these project rules:

- **No fake live data.** Without a real printer connection or explicit demo mode, API endpoints must not return simulated figures.
- **Keep the zero-dependency path.** Python's standard library and plain HTML/CSS/JavaScript are intentional unless a dependency solves a clearly documented problem.
- **Keep hardware optional.** The maintenance dashboard must remain useful without LED rings or color sensors attached.
- **Respect accessibility settings.** Motion, transparency, and contrast fallbacks should continue to work.
- **Prefer small, reviewable changes.** A focused improvement is easier to test and safer for printer-adjacent software.

## Run locally

```bash
python3 backend/app.py
```

Open `http://localhost:8000`, then enable **Demo data** to preview simulated printer information.

## Run tests

```bash
python3 -m unittest discover -s tests -v
```

The project supports Python 3.8+ and CI checks several Python versions.

## Good contribution areas

Useful contributions include:

- Moonraker integration and compatibility testing
- Snapmaker U1 hardware observations and API samples
- maintenance-threshold research backed by manufacturer documentation or measured wear
- accessible dashboard improvements
- robust error handling and tests
- LED controller and optical color-sensor drivers once hardware is available
- documentation, setup guides, diagrams, and reproducible test data

## Pull requests

Explain what changed, why it improves the project, how you tested it, and whether the change uses simulated or physical hardware. Avoid combining unrelated refactors with a feature or bug fix.

If a change affects printer behavior, data interpretation, or maintenance advice, include the source or measurement that supports it.
