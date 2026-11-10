"""REF-08/N3c policy-scenario calculator (math and contract surface only).

Deterministic, explicit-input scenario service. It never fetches a provider
and never invents a fixing. All compounding reuses
``services.stir.compound_sofr_rate`` (Actual/360 publication-interval form);
no compounding logic is duplicated here or in Node/TS.

Conventions (all explicit caller inputs):
- Rates are percent-100 (e.g. 4.33 means 4.33%); differences are basis points.
- ``stepBps`` is an explicit scenario input per meeting. It is never inferred
  from a target-range midpoint unless the request sets
  ``deriveStepFromMidpoint: true``, in which case the derivation is labelled
  in warnings/assumptions. Target bounds are display metadata, not observed data.
- Observed SOFR fixings keep provenance ``observed``; any predicted fixing on
  or after the first meeting effective date (and any fixing after the last
  observed fixing) is provenance ``scenario``, never observed.
- Scenario fixing model (documented assumption): the scenario value on a date
  equals the observed fixing where one was supplied, otherwise the last
  observed fixing plus the cumulative meeting steps effective on or before
  that date. This is a hypothetical scenario path, not a forecast.
- SR3/SR1 predicted rates compound the scenario-augmented daily series over
  the caller-supplied explicit windows. A missing required business-day
  fixing in a window yields predicted ``None`` (Unavailable) plus a
  machine-readable warning; weekend/holiday/leap/quarter-boundary semantics
  come from ``compound_sofr_rate`` unchanged.
- Current contract rates are observed only when explicitly supplied with a
  source and date; otherwise they stay null.
- Policy spread (``policySpreadBps``) is optional and stays null when omitted.
- Every numeric output is finite or null; missing inputs are never filled
  with zero or a guessed calendar. An exact computed zero remains valid.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from services.stir import compound_sofr_rate, is_business_day

MAX_FIXINGS = 500
MAX_MEETINGS = 50

_DATE_RE = None  # compiled lazily to keep import light


def _iso_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    parts = value.split("-")
    if len(parts) != 3:
        return None
    try:
        year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        parsed = date(year, month, day)
    except (ValueError, TypeError):
        return None
    if parsed.isoformat() != value or year < 1900 or year > 2200:
        return None
    return parsed


def _finite_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if number == number and number not in (float("inf"), float("-inf")) else None
    return None


def _round4(value: float | None) -> float | None:
    if value is None:
        return None
    rounded = round(float(value), 4)
    return rounded if rounded == rounded and abs(rounded) != float("inf") else None


class PolicyScenarioError(ValueError):
    """Typed invalid-request error; the worker maps it to 400."""


def _parse_fixings(raw: Any) -> dict[str, float]:
    if not isinstance(raw, list) or len(raw) == 0:
        raise PolicyScenarioError("fixings must be a non-empty array of {date, value}.")
    if len(raw) > MAX_FIXINGS:
        raise PolicyScenarioError(f"fixings limited to {MAX_FIXINGS} rows.")
    out: dict[str, float] = {}
    for entry in raw:
        if not isinstance(entry, dict):
            raise PolicyScenarioError("each fixing must be an object with date and value.")
        day = _iso_date(entry.get("date"))
        if day is None:
            raise PolicyScenarioError(f"fixing date must be YYYY-MM-DD, got {entry.get('date')!r}.")
        number = _finite_number(entry.get("value"))
        if number is None:
            raise PolicyScenarioError(f"fixing value must be a finite number, got {entry.get('value')!r}.")
        if not -5.0 <= number <= 30.0:
            raise PolicyScenarioError(f"fixing value {number} outside plausible percent range [-5, 30].")
        out[day.isoformat()] = number
    return out


def _parse_meetings(raw: Any, derive_midpoint: bool) -> tuple[list[dict[str, Any]], list[str]]:
    """Return normalized meetings sorted by date plus assumption notes."""
    notes: list[str] = []
    if raw is None:
        return [], notes
    if not isinstance(raw, list):
        raise PolicyScenarioError("meetings must be an array.")
    if len(raw) > MAX_MEETINGS:
        raise PolicyScenarioError(f"meetings limited to {MAX_MEETINGS} rows.")
    meetings: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            raise PolicyScenarioError("each meeting must be an object with date and stepBps.")
        day = _iso_date(entry.get("date"))
        if day is None:
            raise PolicyScenarioError(f"meeting date must be YYYY-MM-DD, got {entry.get('date')!r}.")
        step = _finite_number(entry.get("stepBps")) if "stepBps" in entry else None
        lower = _finite_number(entry.get("targetLower")) if "targetLower" in entry else None
        upper = _finite_number(entry.get("targetUpper")) if "targetUpper" in entry else None
        if "stepBps" in entry and step is None:
            raise PolicyScenarioError(f"meeting stepBps must be a finite number, got {entry.get('stepBps')!r}.")
        if step is not None and not -500.0 <= step <= 500.0:
            raise PolicyScenarioError(f"meeting stepBps {step} outside range [-500, 500].")
        for bound_name, bound in (("targetLower", lower), ("targetUpper", upper)):
            if bound_name in entry and bound is None:
                raise PolicyScenarioError(f"meeting {bound_name} must be a finite number when supplied.")
            if bound is not None and not -5.0 <= bound <= 30.0:
                raise PolicyScenarioError(f"meeting {bound_name} {bound} outside plausible percent range [-5, 30].")
        if lower is not None and upper is not None and lower > upper:
            raise PolicyScenarioError("meeting targetLower must not exceed targetUpper.")
        meetings.append({
            "date": day.isoformat(),
            "stepBps": step,
            "targetLower": lower,
            "targetUpper": upper,
        })
    meetings.sort(key=lambda m: m["date"])
    if derive_midpoint:
        prev_mid: float | None = None
        for meeting in meetings:
            lower, upper = meeting["targetLower"], meeting["targetUpper"]
            mid = (lower + upper) / 2.0 if lower is not None and upper is not None else None
            if meeting["stepBps"] is None:
                if mid is not None and prev_mid is not None:
                    meeting["stepBps"] = round((mid - prev_mid) * 100.0, 4)
                    notes.append(
                        f"meeting {meeting['date']}: stepBps {meeting['stepBps']} derived from "
                        "target-range midpoint difference (explicit deriveStepFromMidpoint request; "
                        "display metadata, not observed data)."
                    )
                elif mid is not None:
                    raise PolicyScenarioError(
                        f"meeting {meeting['date']} has target bounds but no prior midpoint: "
                        "first-meeting steps are explicit scenario inputs and are never "
                        "defaulted from missing data; supply stepBps or a prior baseline "
                        "meeting with target bounds (fail-closed, no 0.0 default)."
                    )
                else:
                    raise PolicyScenarioError(
                        f"meeting {meeting['date']} has no stepBps and insufficient target bounds "
                        "for midpoint derivation."
                    )
            if mid is not None:
                prev_mid = mid
    else:
        for meeting in meetings:
            if meeting["stepBps"] is None:
                raise PolicyScenarioError(
                    f"meeting {meeting['date']} omits stepBps: scenario steps are explicit inputs and "
                    "are never inferred from target-range midpoints unless deriveStepFromMidpoint is true."
                )
    return meetings, notes


def _parse_window(raw: Any, name: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise PolicyScenarioError(f"{name} must be an object with windowStart and windowEnd.")
    start = _iso_date(raw.get("windowStart"))
    end = _iso_date(raw.get("windowEnd"))
    if start is None or end is None:
        raise PolicyScenarioError(f"{name}.windowStart/windowEnd must be YYYY-MM-DD dates.")
    if end <= start:
        raise PolicyScenarioError(f"{name} window must satisfy windowEnd > windowStart.")
    if (end - start).days > 400:
        raise PolicyScenarioError(f"{name} window longer than 400 days is rejected.")
    current = _finite_number(raw.get("currentRate")) if "currentRate" in raw and raw.get("currentRate") is not None else None
    if "currentRate" in raw and raw.get("currentRate") is not None and current is None:
        raise PolicyScenarioError(f"{name}.currentRate must be a finite number or null.")
    if current is not None and not -5.0 <= current <= 30.0:
        raise PolicyScenarioError(f"{name}.currentRate {current} outside plausible percent range [-5, 30].")
    source = raw.get("currentSource")
    current_date = _iso_date(raw.get("currentDate")) if raw.get("currentDate") is not None else None
    if current is not None and (not isinstance(source, str) or not source.strip() or current_date is None):
        raise PolicyScenarioError(
            f"{name}.currentRate is observed only with explicit currentSource and currentDate; "
            "otherwise omit it (missing stays null)."
        )
    if "currentSource" in raw and raw.get("currentSource") is not None and not isinstance(source, str):
        raise PolicyScenarioError(f"{name}.currentSource must be a string.")
    if "currentDate" in raw and raw.get("currentDate") is not None and current_date is None:
        raise PolicyScenarioError(f"{name}.currentDate must be YYYY-MM-DD when supplied.")
    return {
        "windowStart": start.isoformat(),
        "windowEnd": end.isoformat(),
        "currentRate": current,
        "currentSource": source.strip() if isinstance(source, str) and source.strip() else None,
        "currentDate": current_date.isoformat() if current_date else None,
    }


def calculate_policy_scenario(payload: dict[str, Any]) -> dict[str, Any]:
    """Compute the deterministic policy-scenario result (pure function)."""
    if not isinstance(payload, dict):
        raise PolicyScenarioError("request body must be a JSON object.")
    derive_midpoint = payload.get("deriveStepFromMidpoint", False)
    if not isinstance(derive_midpoint, bool):
        raise PolicyScenarioError("deriveStepFromMidpoint must be a boolean.")

    observed = _parse_fixings(payload.get("fixings"))
    meetings, midpoint_notes = _parse_meetings(payload.get("meetings", []), derive_midpoint)
    sr3_spec = _parse_window(payload.get("sr3"), "sr3") if payload.get("sr3") is not None else None
    sr1_spec = _parse_window(payload.get("sr1"), "sr1") if payload.get("sr1") is not None else None

    spread_raw = payload.get("policySpreadBps", None)
    if spread_raw is None:
        spread: float | None = None
    else:
        spread = _finite_number(spread_raw)
        if spread is None:
            raise PolicyScenarioError("policySpreadBps must be a finite number or null.")
        if not -2000.0 <= spread <= 2000.0:
            raise PolicyScenarioError("policySpreadBps outside range [-2000, 2000].")

    warnings: list[str] = []
    assumptions: list[str] = [
        "Scenario steps (stepBps) are explicit scenario inputs; they are never inferred from "
        "target-range midpoints unless deriveStepFromMidpoint is true and the derivation is labelled.",
        "Target lower/upper bounds are display metadata, not observed data.",
        "Rates are percent-100; differences are basis points.",
        "A predicted fixing on or after the first meeting effective date — and any fixing after "
        "the last observed fixing — is scenario, never observed.",
        "SR3/SR1 windows are explicit caller-supplied dates; no venue settlement clock, monthly "
        "boundary, FOMC schedule, or historical-data entitlement is assumed.",
        "Scenario fixing model: observed where supplied; unobserved dates on/after the first "
        "meeting effective date use last-observed plus cumulative steps in percent (hypothetical "
        "scenario path, not a forecast); earlier unobserved dates fail closed."
        "Missing required business-day fixings yield predicted null (Unavailable), never a default, zero, or guessed calendar.",
    ]
    assumptions.extend(midpoint_notes)

    observed_dates = sorted(observed.keys())
    last_observed_date = observed_dates[-1]
    last_observed_value = observed[last_observed_date]

    # Cumulative steps keyed by effective date.
    cumulative = 0.0
    step_by_date: dict[str, float] = {}
    for meeting in meetings:
        cumulative += float(meeting["stepBps"])
        step_by_date[meeting["date"]] = cumulative

    def cumulative_step_on(day_iso: str) -> float:
        total = 0.0
        for meeting in meetings:
            if meeting["date"] <= day_iso:
                total += float(meeting["stepBps"])
            else:
                break
        return total

    # Fixing line: observed rows are immutable (provenance observed);
    # meeting dates without an observed fixing are scenario rows. A scenario
    # row inside observed coverage (date <= last observed) is a coverage gap
    # and stays null rather than inventing a value; a row beyond observed
    # coverage is last-observed plus cumulative steps (hypothetical path).
    scenario_dates = sorted(set(observed_dates) | {m["date"] for m in meetings})
    fixing_line: list[dict[str, Any]] = []
    for day_iso in scenario_dates:
        observed_value = observed.get(day_iso)
        step_total = cumulative_step_on(day_iso)
        if observed_value is not None:
            scenario_value = observed_value
            provenance = "observed"
        elif day_iso <= last_observed_date:
            scenario_value = None
            provenance = "scenario"
            warnings.append(
                f"fixing {day_iso}: scenario Unavailable — no observed fixing supplied "
                "inside observed coverage (no substitution)."
            )
        else:
            # stepBps are basis points; rates are percent-100.
            scenario_value = last_observed_value + step_total / 100.0
            provenance = "scenario"
        fixing_line.append({
            "date": day_iso,
            "observedValue": _round4(observed_value),
            "scenarioValue": _round4(scenario_value),
            "cumulativeStepBps": _round4(step_total),
            "provenance": provenance,
        })

    def build_window_result(spec: dict[str, Any] | None, label: str) -> dict[str, Any] | None:
        if spec is None:
            return None
        start = date.fromisoformat(spec["windowStart"])
        end = date.fromisoformat(spec["windowEnd"])
        row_warnings: list[str] = []
        # Scenario-augmented daily series over the window.
        scenario_by_date: dict[str, float] = {}
        cur = start
        while cur < end:
            day_iso = cur.isoformat()
            if day_iso in observed:
                # Observed history is never rewritten by scenario steps; steps
                # apply only beyond observed coverage (scenario tail below).
                scenario_by_date[day_iso] = observed[day_iso]
            elif day_iso <= last_observed_date:
                # Business-day gap inside observed coverage: leave absent so
                # compound_sofr_rate fails closed (None) with a warning.
                pass
            elif meetings and day_iso >= meetings[0]["date"] and is_business_day(cur):
                # Scenario tail: hypothetical path under explicit meeting
                # steps (basis points converted to percent-100), injected ONLY
                # on actual publication (business) days. Weekends and
                # recognized holidays carry the prior publication forward via
                # compound_sofr_rate's Actual/360 publication-interval law;
                # injecting synthetic weekend/holiday publications would split
                # the interval and silently change that law. Without
                # meetings, or before the first meeting effective date, an
                # unobserved date stays absent and fails closed.
                scenario_by_date[day_iso] = last_observed_value + cumulative_step_on(day_iso) / 100.0
            cur += timedelta(days=1)
        predicted = compound_sofr_rate(scenario_by_date, start, end)
        if predicted is None:
            # Distinguish missing-input failure from degenerate windows.
            missing = [d for d in _business_days(start, end) if d not in scenario_by_date]
            if missing:
                row_warnings.append(
                    f"{label}: predicted Unavailable — missing required business-day fixing(s), "
                    f"e.g. {missing[0]} (fail-closed, no substitution)."
                )
            else:
                row_warnings.append(f"{label}: predicted Unavailable — window not fully observed (fail-closed).")
        current = spec["currentRate"]
        current_provenance = (
            "observed-explicit-source-date" if current is not None else "unavailable-not-supplied"
        )
        if current is None:
            row_warnings.append(f"{label}: current Unavailable — not supplied with source/date (stays null).")
        difference_bps = (
            _round4((predicted - current) * 100.0)
            if predicted is not None and current is not None
            else None
        )
        status = "ok" if predicted is not None else "unavailable"
        warnings.extend(row_warnings)
        return {
            "windowStart": spec["windowStart"],
            "windowEnd": spec["windowEnd"],
            "currentRate": _round4(current),
            "currentSource": spec["currentSource"],
            "currentDate": spec["currentDate"],
            "currentProvenance": current_provenance,
            "predictedRate": _round4(predicted),
            "predictedProvenance": "scenario-compound-sofr-rate" if predicted is not None else "unavailable",
            "differenceBps": difference_bps,
            "status": status,
            "warnings": row_warnings,
        }

    sr3_result = build_window_result(sr3_spec, "sr3")
    sr1_result = build_window_result(sr1_spec, "sr1")

    result: dict[str, Any] = {
        "fixingLine": fixing_line,
        "sr3": sr3_result,
        "sr1": sr1_result,
        "policySpreadBps": _round4(spread),
        "policySpreadProvenance": "explicit-scenario-override" if spread is not None else "unavailable-not-supplied",
        "lastObservedDate": last_observed_date,
        "warnings": warnings,
        "assumptions": assumptions,
    }
    if spread is None:
        warnings.append("policy spread omitted: stays null/Unavailable (no default).")
    return result


def _business_days(start: date, end: date) -> list[str]:
    out: list[str] = []
    cur = start
    while cur < end:
        if is_business_day(cur):
            out.append(cur.isoformat())
        cur += timedelta(days=1)
    return out
