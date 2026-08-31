"""
Keyless primary-source macro chips (OFR NY Fed repo + ECB policy rate).

Complements FRED stress pack — never invents levels; null on failure.
Shared TTL via caller (MacroVol cache).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

_UA = "volatern-terminal/1.0 (educational rates desk; contact via github)"
_OFR_BASE = "https://data.financialresearch.gov/v1/series/full"
_ECB_DFR = (
    "https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV"
    "?lastNObservations=1"
)


def _get_json(url: str, timeout: float = 20.0, accept: str | None = None) -> Any:
    headers = {"User-Agent": _UA}
    if accept:
        headers["Accept"] = accept
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def _ofr_last(mnemonic: str) -> dict[str, Any]:
    """Return {value, date, mnemonic} or empty fields on failure."""
    out: dict[str, Any] = {
        "value": None,
        "date": None,
        "mnemonic": mnemonic,
        "source": "OFR",
    }
    try:
        data = _get_json(f"{_OFR_BASE}?mnemonic={mnemonic}")
        block = data.get(mnemonic) or next(iter(data.values()), None)
        if not block:
            return out
        series = (block.get("timeseries") or {}).get("aggregation") or []
        if not series:
            return out
        last = series[-1]
        if isinstance(last, (list, tuple)) and len(last) >= 2:
            out["date"] = str(last[0])
            out["value"] = float(last[1]) if last[1] is not None else None
    except (urllib.error.URLError, TimeoutError, ValueError, TypeError, StopIteration, json.JSONDecodeError):
        pass
    return out


def _ecb_dfr() -> dict[str, Any]:
    out: dict[str, Any] = {
        "value": None,
        "date": None,
        "series": "FM.D.U2.EUR.4F.KR.DFR.LEV",
        "source": "ECB",
        "label": "ECB deposit facility rate",
    }
    try:
        data = _get_json(
            _ECB_DFR,
            accept="application/vnd.sdmx.data+json;version=1.0.0-wd",
        )
        datasets = data.get("dataSets") or []
        if not datasets:
            return out
        series = (datasets[0].get("series") or {})
        if not series:
            return out
        first = next(iter(series.values()))
        obs = first.get("observations") or {}
        if not obs:
            return out
        # observations keyed "0","1",... value is list [level, ...]
        last_key = sorted(obs.keys(), key=lambda k: int(k))[-1]
        row = obs[last_key]
        if isinstance(row, list) and row:
            out["value"] = float(row[0]) if row[0] is not None else None
        # structure dimensions may carry time — best-effort
        struct = (data.get("structure") or {}).get("dimensions") or {}
        obs_dim = struct.get("observation") or []
        for dim in obs_dim:
            if dim.get("id") == "TIME_PERIOD":
                vals = dim.get("values") or []
                if vals:
                    out["date"] = vals[-1].get("id") or vals[-1].get("name")
                break
    except (urllib.error.URLError, TimeoutError, ValueError, TypeError, StopIteration, json.JSONDecodeError, KeyError):
        pass
    return out


def build_primary_board() -> dict[str, Any]:
    """
    Free keyless primary-source board for Rates stress context.
    Fields are percent levels unless noted.
    """
    bgcr = _ofr_last("FNYR-BGCR-A")
    tgcr = _ofr_last("FNYR-TGCR-A")
    sofr_ofr = _ofr_last("FNYR-SOFR-A")
    dfr = _ecb_dfr()

    fields = {
        "bgcr": bgcr.get("value"),
        "tgcr": tgcr.get("value"),
        "sofr_ofr": sofr_ofr.get("value"),
        "ecb_dfr": dfr.get("value"),
    }
    missing = [k for k, v in fields.items() if v is None]
    live_n = sum(1 for v in fields.values() if v is not None)

    return {
        **fields,
        "units": {
            "bgcr": "percent",
            "tgcr": "percent",
            "sofr_ofr": "percent",
            "ecb_dfr": "percent",
        },
        "labels": {
            "bgcr": "Broad General Collateral Rate",
            "tgcr": "Tri-party General Collateral Rate",
            "sofr_ofr": "SOFR (OFR / NY Fed)",
            "ecb_dfr": "ECB deposit facility",
        },
        "obs_dates": {
            "bgcr": bgcr.get("date"),
            "tgcr": tgcr.get("date"),
            "sofr_ofr": sofr_ofr.get("date"),
            "ecb_dfr": dfr.get("date"),
        },
        "field_source": {
            "bgcr": "OFR",
            "tgcr": "OFR",
            "sofr_ofr": "OFR",
            "ecb_dfr": "ECB",
        },
        "series_ids": {
            "bgcr": "FNYR-BGCR-A",
            "tgcr": "FNYR-TGCR-A",
            "sofr_ofr": "FNYR-SOFR-A",
            "ecb_dfr": "FM.D.U2.EUR.4F.KR.DFR.LEV",
        },
        "missing_fields": missing,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": (
            "OFR+ECB"
            if not missing
            else ("OFR+ECB+partial" if live_n else "unavailable")
        ),
        "note": (
            "Keyless primary sources · OFR NY Fed repo (BGCR/TGCR/SOFR) + ECB DFR. "
            "Complements FRED stress (VIXCLS/credit). Null = fetch miss, not a fake print. "
            "Not Trading Economics / not gs-quant Marquee."
        ),
    }
