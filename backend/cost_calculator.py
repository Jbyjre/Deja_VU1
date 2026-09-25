"""
cost_calculator.py
===================

Turns a print job into a dollar figure: filament used, priced per material,
plus the electricity the printer drew while it ran. Nothing here talks to a
payment system or a store — it's an estimate built entirely from numbers the
dashboard already has (print history, live progress, and prices the user
types in once).

Two things it answers:
  - "What did my last N prints cost?"   -> cost_history()
  - "What is this print costing so far?" -> estimate_current_job()

Both are honest about being estimates: filament grams for a job in progress
are extrapolated from how far it's gotten, not measured by a scale, and the
printer's power draw is a flat wattage the user sets, not a live meter
reading. That's stated in the API, not hidden behind a precise-looking number.
"""

import json
import os

import mock_moonraker
import storage

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_SETTINGS_PATH = os.path.join(_DATA_DIR, "cost_settings.json")

_DEFAULT_SETTINGS = {
    # $ per kilogram of filament, by material. A material not listed here
    # falls back to _FALLBACK_PRICE.
    "filament_price_per_kg": {
        "PLA": 20.0,
        "PETG": 25.0,
        "ABS": 22.0,
    },
    "electricity_rate_per_kwh": 0.15,
    "printer_watts": 250,
}

_FALLBACK_PRICE_PER_KG = 20.0

# The average grams-per-hour rate used to extrapolate filament for a job
# still in progress. Matches the rate mock_moonraker uses to generate its
# fake history, so demo figures are internally consistent.
_ESTIMATED_GRAMS_PER_HOUR = 12.0


def _load_settings():
    if not os.path.exists(_SETTINGS_PATH):
        _save_settings(_DEFAULT_SETTINGS)
        return json.loads(json.dumps(_DEFAULT_SETTINGS))
    settings = storage.load_json(_SETTINGS_PATH, {})
    merged = json.loads(json.dumps(_DEFAULT_SETTINGS))
    merged.update({k: v for k, v in settings.items() if k != "filament_price_per_kg"})
    if "filament_price_per_kg" in settings:
        merged["filament_price_per_kg"].update(settings["filament_price_per_kg"])
    return merged


def _save_settings(settings):
    storage.save_json(_SETTINGS_PATH, settings)


def get_settings():
    return _load_settings()


def save_settings(updates):
    """
    Only known keys are applied. `filament_price_per_kg` merges by material
    instead of replacing the whole table, so setting one price doesn't wipe
    out the others.
    """
    settings = _load_settings()
    if "electricity_rate_per_kwh" in updates:
        settings["electricity_rate_per_kwh"] = float(updates["electricity_rate_per_kwh"])
    if "printer_watts" in updates:
        settings["printer_watts"] = float(updates["printer_watts"])
    if "filament_price_per_kg" in updates and isinstance(updates["filament_price_per_kg"], dict):
        for material, price in updates["filament_price_per_kg"].items():
            settings["filament_price_per_kg"][material] = float(price)
    _save_settings(settings)
    return settings


def compute_job_cost(filament_type, filament_grams, duration_hours, settings=None):
    settings = settings or get_settings()
    price_per_kg = settings["filament_price_per_kg"].get(filament_type, _FALLBACK_PRICE_PER_KG)
    material_cost = (filament_grams / 1000.0) * price_per_kg
    energy_kwh = (settings["printer_watts"] / 1000.0) * duration_hours
    energy_cost = energy_kwh * settings["electricity_rate_per_kwh"]
    return {
        "filament_type": filament_type,
        "filament_grams": round(filament_grams, 1),
        "duration_hours": round(duration_hours, 2),
        "material_cost": round(material_cost, 2),
        "energy_cost": round(energy_cost, 2),
        "total_cost": round(material_cost + energy_cost, 2),
    }


def cost_history(filename=None, limit=10):
    """Cost for each of the most recent print jobs, newest first."""
    jobs = mock_moonraker.get_print_history()
    if filename:
        jobs = [j for j in jobs if j["filename"] == filename]
    jobs = list(reversed(jobs))[:limit]
    settings = get_settings()
    return [
        {
            "job_id": job["job_id"],
            "filename": job["filename"],
            "status": job["status"],
            "end_time": job["end_time"],
            **compute_job_cost(
                job["filament_type"], job["filament_used_grams"],
                job["print_duration_hours"], settings=settings),
        }
        for job in jobs
    ]


def estimate_current_job():
    """
    Estimated cost so far for whatever is printing right now.

    Extrapolates filament used from elapsed progress rather than reading a
    scale, and is explicit that it's an estimate. Raises ValueError if
    nothing is currently printing — there is nothing honest to estimate.
    """
    state = mock_moonraker.get_printer_state()
    if state["state"] not in ("printing", "paused"):
        raise ValueError("Nothing is printing right now")

    duration_hours = state["print_duration_hours"]
    progress = state["progress"]
    elapsed_grams = duration_hours * _ESTIMATED_GRAMS_PER_HOUR
    total_estimated_grams = elapsed_grams / progress if progress > 0 else elapsed_grams

    requirements = mock_moonraker.get_current_job_requirements()
    materials = [r["expected_material"] for r in requirements.get("required_filament", [])]
    filament_type = materials[0] if materials else "PLA"

    total_estimated_hours = duration_hours / progress if progress > 0 else duration_hours

    result = compute_job_cost(filament_type, total_estimated_grams, total_estimated_hours)
    result["filename"] = state["current_file"]
    result["progress"] = round(progress, 3)
    result["is_estimate"] = True
    result["cost_so_far"] = compute_job_cost(
        filament_type, elapsed_grams, duration_hours)["total_cost"]
    return result


def reset():
    """Restore default pricing. Useful for tests."""
    _save_settings(_DEFAULT_SETTINGS)
    return get_settings()
