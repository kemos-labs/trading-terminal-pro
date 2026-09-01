"""
Rate risk primitives — curve shape, generic Treasury DV01, key-rate DV01, r(T).

All math is transparent and unit-labeled. No fake inventory models.
"""
from __future__ import annotations

import math
from typing import Any


# Years to maturity for FRED constant-maturity series used in the curve
TENOR_YEARS: dict[str, float] = {
    "DGS1MO": 1 / 12,
    "DGS3MO": 0.25,
    "DGS6MO": 0.5,
    "DGS1": 1.0,
    "DGS2": 2.0,
    "DGS5": 5.0,
    "DGS10": 10.0,
    "DGS20": 20.0,
    "DGS30": 30.0,
}

LABEL_TO_ID = {
    "1M": "DGS1MO",
    "3M": "DGS3MO",
    "6M": "DGS6MO",
    "1Y": "DGS1",
    "2Y": "DGS2",
    "5Y": "DGS5",
    "10Y": "DGS10",
    "20Y": "DGS20",
    "30Y": "DGS30",
}


def _y(curve: dict[str, float | None], label: str) -> float | None:
    """Yield in percent for a tenor label."""
    return curve.get(label)


def spread_pp(a: float | None, b: float | None) -> float | None:
    """a − b in percentage points."""
    if a is None or b is None:
        return None
    return round(a - b, 4)


def to_bps(pp: float | None) -> float | None:
    if pp is None:
        return None
    return round(pp * 100.0, 1)


def compute_shape(curve_by_label: dict[str, float | None]) -> dict[str, Any]:
    """
    Curve shape metrics from constant-maturity yields (percent).
    Spreads returned both in percentage points and bps.
    """
    y2 = _y(curve_by_label, "2Y")
    y5 = _y(curve_by_label, "5Y")
    y10 = _y(curve_by_label, "10Y")
    y30 = _y(curve_by_label, "30Y")
    y3m = _y(curve_by_label, "3M")
    y1 = _y(curve_by_label, "1Y")

    s_2s10s = spread_pp(y10, y2)
    s_5s30s = spread_pp(y30, y5)
    s_2s5s = spread_pp(y5, y2)
    s_5s10s = spread_pp(y10, y5)
    s_10s30s = spread_pp(y30, y10)
    s_3m10y = spread_pp(y10, y3m)
    # Butterfly 2s5s10s = 2*5Y − 2Y − 10Y  (positive = belly rich / curve more humped)
    fly = None
    if y2 is not None and y5 is not None and y10 is not None:
        fly = round(2 * y5 - y2 - y10, 4)

    # Simple steepener regime
    s2s10_bps = to_bps(s_2s10s)
    if s2s10_bps is None:
        regime = "unknown"
    elif s2s10_bps < -10:
        regime = "inverted"
    elif s2s10_bps < 25:
        regime = "flat"
    else:
        regime = "steep"

    def _tsy_imply(key: str, bps: float | None) -> dict[str, str]:
        if bps is None:
            return _imply(bias="neutral", label="—", text="Missing tenor.", confidence="low")
        if key == "2s10s":
            if bps < -25:
                return _imply(
                    bias="inverted",
                    label="DEEP INVERT",
                    text="2s>>10s — historically recession / front tight; not a pure cut count.",
                    confidence="high",
                )
            if bps < -10:
                return _imply(
                    bias="inverted",
                    label="INVERTED",
                    text="2s10s inverted — front end rich vs 10s; often hike cycle / cut expectations mixed.",
                    confidence="high",
                )
            if bps < 25:
                return _imply(
                    bias="flat",
                    label="FLAT",
                    text="2s10s flat-ish — limited steepener/flattener edge from level alone.",
                    confidence="medium",
                )
            if bps < 80:
                return _imply(
                    bias="steepener",
                    label="STEEP",
                    text="Upward curve — classic steepener / recovery-style slope.",
                    confidence="high",
                )
            return _imply(
                bias="steepener",
                label="VERY STEEP",
                text="Very steep 2s10s — aggressive steepener bias in the cash curve.",
                confidence="high",
            )
        if key == "5s30s":
            if abs(bps) < 15:
                return _imply(bias="flat", label="5s30s FLAT", text="Long end flat vs 5s.", confidence="medium")
            if bps > 0:
                return _imply(bias="steepener", label="LONG STEEP", text="30s above 5s — long-end steepener bias.", confidence="medium")
            return _imply(bias="flattener", label="LONG FLAT", text="30s below 5s — long flattener / rich long end.", confidence="medium")
        if key == "fly_2s5s10s":
            if bps is None:
                return _imply(bias="neutral", label="—", text="No fly.", confidence="low")
            if abs(bps) < 5:
                return _imply(bias="flat", label="LINEAR", text="2s5s10s fly ~0 — little belly richness.", confidence="medium")
            if bps > 0:
                return _imply(bias="humped", label="BELLY RICH", text="Positive fly — 5s rich vs 2s/10s (humped).", confidence="medium")
            return _imply(bias="trough", label="BELLY CHEAP", text="Negative fly — 5s cheap vs wings.", confidence="medium")
        if key == "3m10y":
            if bps is not None and bps < -50:
                return _imply(bias="inverted", label="FRONT RICH", text="3m well above 10y — deep front-end tightness / inversion.", confidence="high")
            if bps is not None and bps > 50:
                return _imply(bias="steepener", label="RISK-ON SLOPE", text="10y well above 3m — steep front-to-long.", confidence="medium")
            return _imply(bias="neutral", label="TERM SLOPE", text="3m10y level — context only without history z-score.", confidence="low")
        # generic residual
        if abs(bps) < 10:
            return _imply(bias="flat", label="FLAT", text="Small spread — limited shape call.", confidence="low")
        if bps > 0:
            return _imply(bias="steepener", label="POSITIVE", text="Positive spread — longer tenor higher yield.", confidence="low")
        return _imply(bias="flattener", label="NEGATIVE", text="Negative spread — longer tenor lower yield.", confidence="low")

    s5s30 = to_bps(s_5s30s)
    s2s5 = to_bps(s_2s5s)
    s5s10 = to_bps(s_5s10s)
    s10s30 = to_bps(s_10s30s)
    s3m10 = to_bps(s_3m10y)
    fly_bps = to_bps(fly)

    return {
        "spreads": {
            "2s10s": {
                "pp": s_2s10s, "bps": s2s10_bps, "formula": "10Y − 2Y",
                "imply": _tsy_imply("2s10s", s2s10_bps),
            },
            "5s30s": {
                "pp": s_5s30s, "bps": s5s30, "formula": "30Y − 5Y",
                "imply": _tsy_imply("5s30s", s5s30),
            },
            "2s5s": {
                "pp": s_2s5s, "bps": s2s5, "formula": "5Y − 2Y",
                "imply": _tsy_imply("2s5s", s2s5),
            },
            "5s10s": {
                "pp": s_5s10s, "bps": s5s10, "formula": "10Y − 5Y",
                "imply": _tsy_imply("5s10s", s5s10),
            },
            "10s30s": {
                "pp": s_10s30s, "bps": s10s30, "formula": "30Y − 10Y",
                "imply": _tsy_imply("10s30s", s10s30),
            },
            "3m10y": {
                "pp": s_3m10y, "bps": s3m10, "formula": "10Y − 3M",
                "imply": _tsy_imply("3m10y", s3m10),
            },
            "fly_2s5s10s": {
                "pp": fly,
                "bps": fly_bps,
                "formula": "2×5Y − 2Y − 10Y",
                "note": "Positive = belly rich vs wings (humped).",
                "imply": _tsy_imply("fly_2s5s10s", fly_bps),
            },
        },
        "levels": {
            "3M": y3m,
            "1Y": y1,
            "2Y": y2,
            "5Y": y5,
            "10Y": y10,
            "30Y": y30,
        },
        "regime": regime,
        "regime_note": {
            "inverted": "2s10s < −10 bps — curve inverted (front tight vs long end).",
            "flat": "2s10s between −10 and +25 bps — relatively flat.",
            "steep": "2s10s > +25 bps — upward sloping / steepener bias.",
            "unknown": "Insufficient tenors for regime.",
        }.get(regime, ""),
        "imply": _tsy_imply("2s10s", s2s10_bps) if regime != "unknown" else _imply(
            bias="neutral", label="—", text="Insufficient data.", confidence="low"
        ),
        "unit_note": "FRED yields in percent. Spread bps = pp × 100. imply = general shape read.",
    }


def macaulay_duration_par_semiannual(y_pct: float, years: float) -> float:
    """
    Macaulay duration (years) for a par bond, semi-annual coupons.
    y_pct: bond-equivalent yield in percent (e.g. 4.19).
    """
    if years <= 0:
        return 0.0
    y = y_pct / 100.0
    if y <= 0:
        # zero yield limit: duration ≈ (n+1)/(2n) * T roughly → T/2 for continuous; use T
        return years
    m = 2  # semi-annual
    n = max(1, int(round(years * m)))
    c = y / m  # coupon rate per period for par
    # At par, cash flows: c*100 each period + 100 at end; price = 100
    # D_mac = sum(t * PV(CF_t)) / Price
    # Closed form for par bond:
    # D_mac = (1+y/m)/y * (1 - (1+y/m)^(-n))   ... wait that's for level annuity weight
    # Standard textbook (Fabozzi):
    # D = [1 + y/m] / y  −  (1 + y/m + n(c − y/m)) / (c*((1+y/m)^n − 1) + y/m) / m
    # For par, c = y:
    # D = (1 + y/m) / y * (1 - (1 + y/m)^(-n))   ... this is wrong units
    # Correct closed form for par semi-annual:
    # D_mac = (1/m) * (1+r)/r * (1 - (1+r)^(-n)) where r = y/m, for zero coupon annuity...
    # For coupon bond at par: D = (1+r)/r * (1 - (1+r)^(-n)) / m   with r=y/m  — YES for par.
    r = y / m
    d_periods = (1 + r) / r * (1 - (1 + r) ** (-n))
    return d_periods / m


def modified_duration_par_semiannual(y_pct: float, years: float) -> float:
    y = y_pct / 100.0
    d_mac = macaulay_duration_par_semiannual(y_pct, years)
    return d_mac / (1 + y / 2) if y > -1 else d_mac


def dv01_per_mm(y_pct: float, years: float, face_mm: float = 1.0) -> dict[str, Any]:
    """
    DV01 in USD for face_mm million notional of a generic par Treasury.
    DV01 = mod_duration × price × 0.0001 × face
    At par, price = face → per $1mm face: mod_dur × 1000 × 0.01 wait:
      price_per_100 = 100
      dP for 1bp = D_mod * 100 * 0.0001 = D_mod * 0.01  ($ per 100 face)
      per $1,000,000 face: D_mod * 0.01 * 10_000 = D_mod * 100
    """
    if y_pct is None or years <= 0:
        return {
            "years": years,
            "yield_pct": y_pct,
            "mod_duration": None,
            "mac_duration": None,
            "dv01_usd": None,
            "face_mm": face_mm,
        }
    d_mac = macaulay_duration_par_semiannual(y_pct, years)
    d_mod = modified_duration_par_semiannual(y_pct, years)
    # $ per 1bp per $1mm face
    dv01_1mm = d_mod * 100.0
    return {
        "years": years,
        "yield_pct": round(y_pct, 4),
        "mac_duration": round(d_mac, 4),
        "mod_duration": round(d_mod, 4),
        "dv01_usd": round(dv01_1mm * face_mm, 2),
        "dv01_per_mm": round(dv01_1mm, 2),
        "face_mm": face_mm,
        "convention": "Generic par semi-annual Treasury · price≈100 · DV01 = D_mod × $100 per $1mm per bp",
    }


def build_dv01_book(
    curve_by_label: dict[str, float | None],
    notionals_mm: dict[str, float] | None = None,
) -> dict[str, Any]:
    """
    DV01 book for standard tenors. Default $1mm each of 2Y/5Y/10Y/30Y.
    Positive notional = long bonds (rates down = gain).
    """
    default_n = {"2Y": 1.0, "5Y": 1.0, "10Y": 1.0, "30Y": 1.0}
    n = {**default_n, **(notionals_mm or {})}
    tenor_years = {"2Y": 2.0, "5Y": 5.0, "10Y": 10.0, "30Y": 30.0}
    rows = []
    total = 0.0
    for label, years in tenor_years.items():
        y = curve_by_label.get(label)
        face = float(n.get(label, 0.0) or 0.0)
        if y is None or face == 0:
            rows.append({
                "tenor": label,
                "years": years,
                "yield_pct": y,
                "face_mm": face,
                "mod_duration": None,
                "dv01_usd": None,
            })
            continue
        d = dv01_per_mm(y, years, abs(face))
        # sign: long (+) gains when yields fall
        signed = (d["dv01_usd"] or 0) * (1 if face >= 0 else -1)
        total += signed
        rows.append({
            "tenor": label,
            "years": years,
            "yield_pct": d["yield_pct"],
            "face_mm": face,
            "mac_duration": d["mac_duration"],
            "mod_duration": d["mod_duration"],
            "dv01_usd": round(signed, 2),
            "dv01_per_mm": d["dv01_per_mm"],
        })

    # Parallel DV01 = sum
    # Key-rate: approximate by assigning each bucket its own DV01 (diagonal KR01)
    kr01 = {r["tenor"]: r["dv01_usd"] for r in rows}

    return {
        "rows": rows,
        "parallel_dv01_usd": round(total, 2),
        "key_rate_dv01_usd": kr01,
        "shock_bp": 1,
        "pnl_if_parallel_up_1bp_usd": round(-total, 2),
        "pnl_if_parallel_down_1bp_usd": round(total, 2),
        "note": (
            "Generic par Treasuries (not CTD/futures). "
            "Parallel P&L ≈ −DV01 × Δy_bp. Key-rate column is diagonal bucket DV01 (no curve interpolation shock)."
        ),
        "units": {
            "yield": "percent",
            "dv01": "USD per 1bp",
            "face": "USD millions",
        },
    }


def key_rate_shock_pnl(
    curve_by_label: dict[str, float | None],
    notionals_mm: dict[str, float],
    shocks_bp: dict[str, float],
) -> dict[str, Any]:
    """
    Approximate P&L from key-rate shocks (bp) using diagonal KR01.
    shocks_bp e.g. {"2Y": 1, "5Y": 0, "10Y": -1, "30Y": 0}
    """
    book = build_dv01_book(curve_by_label, notionals_mm)
    pnl = 0.0
    details = []
    for row in book["rows"]:
        ten = row["tenor"]
        dv01 = row.get("dv01_usd")
        sh = float(shocks_bp.get(ten, 0) or 0)
        if dv01 is None:
            details.append({"tenor": ten, "shock_bp": sh, "pnl_usd": None})
            continue
        # rates up → long bond loses ≈ -DV01 * shock
        p = -dv01 * sh
        pnl += p
        details.append({"tenor": ten, "shock_bp": sh, "dv01_usd": dv01, "pnl_usd": round(p, 2)})
    return {
        "total_pnl_usd": round(pnl, 2),
        "details": details,
        "note": "Diagonal key-rate approximation: P&L_i = −DV01_i × shock_bp_i",
    }


def interpolate_r(curve_points: list[tuple[float, float]], T: float) -> float | None:
    """
    Piecewise-linear interpolation of continuously-usable risk-free rate.
    curve_points: list of (years, yield_decimal) sorted by years.
    Returns decimal rate for maturity T (years), or None when no curve exists.
    Fail-closed: a missing curve is Unavailable, never a fabricated default
    rate (no 0.04 / 4% stub).
    """
    if not curve_points:
        return None
    if T <= curve_points[0][0]:
        return curve_points[0][1]
    if T >= curve_points[-1][0]:
        return curve_points[-1][1]
    for i in range(1, len(curve_points)):
        t0, r0 = curve_points[i - 1]
        t1, r1 = curve_points[i]
        if t0 <= T <= t1:
            if t1 == t0:
                return r0
            w = (T - t0) / (t1 - t0)
            return r0 + w * (r1 - r0)
    return curve_points[-1][1]


def curve_to_points(
    labels: list[str],
    yields_pct: list[float | None],
) -> list[tuple[float, float]]:
    """Build (T_years, r_decimal) from curve arrays."""
    pts = []
    for lab, y in zip(labels, yields_pct):
        if y is None:
            continue
        sid = LABEL_TO_ID.get(lab)
        t = TENOR_YEARS.get(sid or "", None)
        if t is None:
            # try label years
            try:
                if lab.endswith("M"):
                    t = float(lab[:-1]) / 12.0
                elif lab.endswith("Y"):
                    t = float(lab[:-1])
            except ValueError:
                continue
        if t is not None:
            pts.append((t, y / 100.0))
    pts.sort(key=lambda x: x[0])
    return pts


def align_spread_history(
    series_a: list[dict],
    series_b: list[dict],
    max_points: int = 90,
) -> list[dict]:
    """
    series sorted desc (latest first) with {date, value}.
    Returns chronological list of {date, a, b, spread_bps}.
    """
    mb = {r["date"]: r["value"] for r in series_b}
    out = []
    for r in series_a:
        d = r["date"]
        if d not in mb:
            continue
        a, b = r["value"], mb[d]
        out.append({
            "date": d,
            "a": a,
            "b": b,
            "spread_bps": round((a - b) * 100.0, 1),
        })
        if len(out) >= max_points:
            break
    out.reverse()  # chronological
    return out


def _imply(
    *,
    bias: str,
    label: str,
    text: str,
    confidence: str = "medium",
) -> dict[str, str]:
    """
    Structured trader read. bias ∈ easing | tightening | steepener | flattener |
    inverted | humped | trough | stress | ample | flat | neutral.
    confidence ∈ high | medium | low. Use neutral when the print does not force a view.
    """
    return {
        "bias": bias,
        "label": label,
        "text": text,
        "confidence": confidence,
    }


def imply_for_spread(kind: str, name: str, rate_bps: float | None, **extra: Any) -> dict[str, str] | None:
    """
    Map a desk spread level to a general market implication.
    Returns None only if we deliberately omit (caller may still store neutral).
    """
    if rate_bps is None and kind not in ("pack",):
        return _imply(
            bias="neutral",
            label="—",
            text="No rate level to interpret.",
            confidence="low",
        )

    bps = float(rate_bps) if rate_bps is not None else None
    abs_b = abs(bps) if bps is not None else 0.0

    # ── Cash overnight corridor ──
    if kind == "cash":
        n = (name or "").upper()
        if "SOFR" in n and "EFFR" in n:
            if abs_b < 3:
                return _imply(
                    bias="flat",
                    label="NORMAL",
                    text="SOFR≈EFFR — typical overnight corridor; no stress signal.",
                    confidence="high",
                )
            if bps is not None and bps >= 8:
                return _imply(
                    bias="stress",
                    label="TIGHT FUNDING",
                    text="SOFR rich vs EFFR — secured funding firmer; watch quarter-end / collateral.",
                    confidence="medium",
                )
            if bps is not None and bps <= -5:
                return _imply(
                    bias="ample",
                    label="SOFT SECURED",
                    text="SOFR cheap vs EFFR — unusual; often data noise or specials, not a clear policy signal.",
                    confidence="low",
                )
            return _imply(
                bias="neutral",
                label="MILD BASIS",
                text="Small SOFR−EFFR gap — not a strong ease/tighten read by itself.",
                confidence="low",
            )
        if "SOFR" in n and "IORB" in n:
            if bps is not None and bps >= 10:
                return _imply(
                    bias="stress",
                    label="SCARCE RESERVES",
                    text="SOFR well above IORB — plumbing tight / balance-sheet pressure.",
                    confidence="high",
                )
            if bps is not None and bps >= 3:
                return _imply(
                    bias="tightening",
                    label="ABOVE FLOOR",
                    text="SOFR above reserve floor — mild scarcity bias.",
                    confidence="medium",
                )
            if bps is not None and bps <= -5:
                return _imply(
                    bias="ample",
                    label="AMPLE",
                    text="SOFR soft vs IORB — ample reserves / RRP-style ease in plumbing.",
                    confidence="medium",
                )
            return _imply(
                bias="flat",
                label="NEAR FLOOR",
                text="SOFR near IORB — classic ample-reserves corridor.",
                confidence="high",
            )
        if "EFFR" in n and "IORB" in n:
            if abs_b < 5:
                return _imply(
                    bias="flat",
                    label="IN CORRIDOR",
                    text="EFFR close to IORB — policy corridor intact.",
                    confidence="high",
                )
            if bps is not None and bps > 10:
                return _imply(
                    bias="tightening",
                    label="FF FIRM",
                    text="EFFR elevated vs IORB — unsecured firmness; not a full path signal.",
                    confidence="medium",
                )
            return _imply(
                bias="neutral",
                label="CORRIDOR WIDTH",
                text="Corridor width print — descriptive; pair with RRP/reserves for a view.",
                confidence="low",
            )

    # ── SERFF: same-month SR1 − ZQ inter-commodity spread ──
    if kind == "serff":
        if abs_b < 8:
            return _imply(
                bias="flat",
                label="NEAR CASH",
                text="1M SOFR futures ≈ 30-Day FF futures — path ≈ funds rate; little ease/hike priced.",
                confidence="medium",
            )
        if bps is not None and bps <= -15:
            return _imply(
                bias="easing",
                label="CUTS PRICED",
                text="SR1 leg below ZQ leg — market prices the one-month SOFR path below the funds path (easing).",
                confidence="high",
            )
        if bps is not None and bps <= -8:
            return _imply(
                bias="easing",
                label="MILD EASE",
                text="Modest SR1-below-ZQ basis in that delivery month.",
                confidence="medium",
            )
        if bps is not None and bps >= 15:
            return _imply(
                bias="tightening",
                label="HIKES / FIRM",
                text="SR1 leg above ZQ leg — SOFR path firm vs Fed Funds (tightening or funding pressure).",
                confidence="high",
            )
        if bps is not None and bps >= 8:
            return _imply(
                bias="tightening",
                label="MILD HIKE",
                text="Slight SR1-above-ZQ firmness in that delivery month.",
                confidence="medium",
            )
        return _imply(
            bias="neutral",
            label="BASIS",
            text="SERFF level is a basis print; direction clearer only when |gap| is large.",
            confidence="low",
        )

    # ── Calendar: near − far in rate bps ──
    if kind == "calendar":
        # +rate_bps ⇒ near rate > far rate ⇒ cuts over the window (downward strip)
        if abs_b < 5:
            return _imply(
                bias="flat",
                label="FLAT SEGMENT",
                text="Near≈far — little cut/hike priced across this calendar.",
                confidence="medium",
            )
        if bps is not None and bps >= 15:
            return _imply(
                bias="easing",
                label="EASE / CUTS",
                text="Near rates above far — strip prices cuts (easing) over this window.",
                confidence="high",
            )
        if bps is not None and bps >= 5:
            return _imply(
                bias="easing",
                label="MILD EASE",
                text="Slight downward strip — mild cut bias between legs.",
                confidence="medium",
            )
        if bps is not None and bps <= -15:
            return _imply(
                bias="tightening",
                label="HIKE / STEEPEN",
                text="Far rates above near — strip prices hikes / bull-steepener in rate space.",
                confidence="high",
            )
        if bps is not None and bps <= -5:
            return _imply(
                bias="steepener",
                label="MILD STEEPEN",
                text="Slight upward strip — mild hike / steepening bias.",
                confidence="medium",
            )
        return _imply(
            bias="neutral",
            label="—",
            text="Calendar near zero — no strong shape call.",
            confidence="low",
        )

    # ── Butterfly: wing − 2*body + wing in rate bps ──
    if kind == "fly":
        if abs_b < 3:
            return _imply(
                bias="flat",
                label="LINEAR",
                text="Fly ~0 — strip roughly linear; no strong hump/trough.",
                confidence="medium",
            )
        if bps is not None and bps > 3:
            return _imply(
                bias="humped",
                label="HUMP / PEAK",
                text="Positive rate fly — body rich (higher rates) vs wings; peak / sell-belly shape.",
                confidence="medium",
            )
        return _imply(
            bias="trough",
            label="TROUGH / U",
            text="Negative rate fly — body cheap (lower rates) vs wings; trough / buy-belly shape.",
            confidence="medium",
        )

    # ── Pack average or white−green ──
    if kind == "pack":
        if "−" in (name or "") or "-" in (name or ""):
            # White−Green style pack spread
            if bps is None or abs_b < 5:
                return _imply(
                    bias="flat",
                    label="PACKS FLAT",
                    text="White≈green pack — limited front-vs-back path tilt.",
                    confidence="medium",
                )
            if bps is not None and bps > 5:
                return _imply(
                    bias="easing",
                    label="WHITES > GREENS",
                    text="Near pack above green — easing priced from white into green.",
                    confidence="high",
                )
            return _imply(
                bias="tightening",
                label="GREENS > WHITES",
                text="Greens above white — later rates higher (hike/steepen vs front pack).",
                confidence="high",
            )
        # Pack average level alone — descriptive
        ir = extra.get("implied_rate")
        if ir is not None:
            return _imply(
                bias="neutral",
                label="PACK LEVEL",
                text=f"Average implied ~{float(ir):.2f}% — level context only, not a directional call.",
                confidence="low",
            )
        return _imply(
            bias="neutral",
            label="PACK",
            text="Pack average — descriptive strip block, not a standalone signal.",
            confidence="low",
        )

    # ── Inter: SR1−SR3 or SR−ZQ ──
    if kind == "inter":
        n = (name or "").upper()
        if "ZQ" in n or "FF" in n:
            if abs_b < 5:
                return _imply(
                    bias="flat",
                    label="SOFR≈FF",
                    text="SOFR vs Fed Funds futures aligned — basis quiet.",
                    confidence="medium",
                )
            if bps is not None and bps > 5:
                return _imply(
                    bias="tightening",
                    label="SOFR FIRM VS FF",
                    text="SOFR futures above FF — secured firm / basis widen; relative, not pure path.",
                    confidence="medium",
                )
            return _imply(
                bias="easing",
                label="SOFR SOFT VS FF",
                text="SOFR futures below FF — SOFR cheap to funds basis.",
                confidence="medium",
            )
        # 1s3s SOFR
        if abs_b < 3:
            return _imply(
                bias="flat",
                label="1s3s FLAT",
                text="1M vs 3M SOFR aligned for that month code.",
                confidence="medium",
            )
        if bps is not None and bps > 3:
            return _imply(
                bias="neutral",
                label="1M > 3M",
                text="1M SOFR above 3M — front tenors firmer; often technical, not a full policy call.",
                confidence="low",
            )
        return _imply(
            bias="neutral",
            label="1M < 3M",
            text="1M SOFR below 3M — mild term structure; weak standalone signal.",
            confidence="low",
        )

    return _imply(
        bias="neutral",
        label="—",
        text="No standard implication map for this structure.",
        confidence="low",
    )


def stir_path_analysis(sr3: list[dict], sofr: float | None) -> dict[str, Any]:
    """
    From live SOFR futures strip: path chart points + implied cuts vs current SOFR.
    implied_rate is already percent. No synthetic history.
    """
    live = [c for c in sr3 if c.get("implied_rate") is not None and c.get("source") == "live"]
    # also allow any with rate if no live (but label source)
    pts = []
    for c in sr3:
        if c.get("implied_rate") is None:
            continue
        vs = (
            round((c["implied_rate"] - sofr) * 100.0, 1)
            if sofr is not None and c.get("implied_rate") is not None
            else None
        )
        # Per-contract vs SOFR implication (skip path-read on final-settled history)
        if c.get("source") == "settled":
            c_imply = _imply(
                bias="neutral",
                label="SETTLED",
                text="Reference quarter complete — FRED SOFR compound final settlement (not a live futures quote).",
                confidence="high",
            )
        elif vs is None:
            c_imply = None
        elif abs(vs) < 8:
            c_imply = _imply(
                bias="flat",
                label="≈SPOT",
                text="Implied near cash SOFR — little ease/hike vs spot in this contract.",
                confidence="medium",
            )
        elif vs <= -15:
            c_imply = _imply(
                bias="easing",
                label="CUTS VS SPOT",
                text="Futures well below SOFR — cumulative easing priced vs today’s cash rate.",
                confidence="high",
            )
        elif vs < 0:
            c_imply = _imply(
                bias="easing",
                label="MILD EASE",
                text="Slightly below SOFR — mild cut bias vs spot.",
                confidence="medium",
            )
        elif vs >= 15:
            c_imply = _imply(
                bias="tightening",
                label="HIKES VS SPOT",
                text="Futures well above SOFR — tightening priced vs cash.",
                confidence="high",
            )
        else:
            c_imply = _imply(
                bias="tightening",
                label="MILD HIKE",
                text="Slightly above SOFR — mild firm bias vs spot.",
                confidence="medium",
            )
        pts.append(
            {
                "contract": c.get("contract"),
                "month": c.get("month"),
                "ticker": c.get("ticker"),
                "implied_rate": c.get("implied_rate"),
                "source": c.get("source"),
                "vs_sofr_bps": vs,
                "imply": c_imply,
            }
        )

    front = next((c for c in pts if c.get("source") == "live"), pts[0] if pts else None)
    back = next((c for c in reversed(pts) if c.get("source") == "live"), pts[-1] if pts else None)

    total_path_bps = None
    if front and back and front.get("implied_rate") is not None and back.get("implied_rate") is not None:
        total_path_bps = round((back["implied_rate"] - front["implied_rate"]) * 100.0, 1)

    # Approx number of 25bp cuts (negative path = cuts priced)
    cuts_25bp = None
    if total_path_bps is not None:
        cuts_25bp = round(total_path_bps / -25.0, 2)  # positive = cuts priced in

    vs_sofr_front = front.get("vs_sofr_bps") if front else None

    # Path-level implication
    if total_path_bps is None:
        path_imply = _imply(
            bias="neutral",
            label="—",
            text="Need live front and back contracts for a path read.",
            confidence="low",
        )
    elif abs(total_path_bps) < 10:
        path_imply = _imply(
            bias="flat",
            label="FLAT PATH",
            text="Front≈back of strip — market not pricing a big cumulative ease or hike.",
            confidence="high",
        )
    elif total_path_bps <= -25:
        path_imply = _imply(
            bias="easing",
            label="CUT PATH",
            text=(
                f"Strip falls ~{abs(total_path_bps):.0f} bps front→back "
                f"(≈{cuts_25bp:.1f}×25bp cuts). Classic easing / cut cycle priced."
            ),
            confidence="high",
        )
    elif total_path_bps < 0:
        path_imply = _imply(
            bias="easing",
            label="MILD CUTS",
            text=f"Modest downward path ({total_path_bps:.0f} bps) — mild easing bias.",
            confidence="medium",
        )
    elif total_path_bps >= 25:
        path_imply = _imply(
            bias="tightening",
            label="HIKE PATH",
            text=(
                f"Strip rises ~{total_path_bps:.0f} bps front→back "
                f"(≈{abs(cuts_25bp or 0):.1f}×25bp hikes). Tightening cycle priced."
            ),
            confidence="high",
        )
    else:
        path_imply = _imply(
            bias="tightening",
            label="MILD HIKES",
            text=f"Modest upward path (+{total_path_bps:.0f} bps) — mild hike bias.",
            confidence="medium",
        )

    if vs_sofr_front is None:
        front_imply = None
    elif vs_sofr_front <= -15:
        front_imply = _imply(
            bias="easing",
            label="FRONT EASE",
            text="Front contract well below cash SOFR — near-term cuts / ease vs spot.",
            confidence="high",
        )
    elif vs_sofr_front >= 15:
        front_imply = _imply(
            bias="tightening",
            label="FRONT FIRM",
            text="Front contract well above cash SOFR — near-term firmness vs spot.",
            confidence="high",
        )
    elif abs(vs_sofr_front) < 8:
        front_imply = _imply(
            bias="flat",
            label="FRONT ≈ SPOT",
            text="Front leg close to cash SOFR.",
            confidence="medium",
        )
    else:
        front_imply = _imply(
            bias="easing" if vs_sofr_front < 0 else "tightening",
            label="MILD VS SPOT",
            text="Small gap front vs SOFR — weak standalone signal.",
            confidence="low",
        )

    return {
        "points": pts,
        "live_count": len(live),
        "sofr": sofr,
        "front": front,
        "back": back,
        "path_change_bps": total_path_bps,
        "approx_25bp_cuts_priced": cuts_25bp,
        "front_vs_sofr_bps": vs_sofr_front,
        "imply": path_imply,
        "front_imply": front_imply,
        "note": (
            "Implied rate = 100 − futures price. Path change = last live − first live (bps). "
            "approx_25bp_cuts_priced = −path/25 (positive means cuts priced). "
            "Imply labels are general strip reads — not a FedWatch probability model."
        ),
    }


# CME month code order for calendar sequencing
_MONTH_CODE_ORDER = {c: i for i, c in enumerate("FGHJKMNQUVXZ")}


def _contract_sort_key(label: str) -> tuple[int, int]:
    """SR3M6 / SR1Z26 / SFRZ7 / SR3U4 → (year, month_ord).

    One-digit years use a 2020s/2030s pivot so Z0 (2030) sorts after U4 (2024):
      digit 4–9 → 2024–2029, digit 0–3 → 2030–2033.
    Two-digit years are 20xx (e.g. 26 → 2026).
    """
    if not label:
        return (99, 99)
    # strip product root
    rest = label
    for root in ("SR3", "SFR", "SR1", "SER", "ZQ", "FF"):
        if rest.upper().startswith(root):
            rest = rest[len(root) :]
            break
    rest = rest.upper()
    if not rest:
        return (99, 99)
    mcode = rest[0]
    year_s = rest[1:]
    try:
        y_raw = int(year_s)
        if len(year_s) == 1:
            # 4–9 → 2024–29; 0–3 → 2030–33 (covers U24…Z30 strip)
            y = (2020 + y_raw) if y_raw >= 4 else (2030 + y_raw)
        elif y_raw < 100:
            y = 2000 + y_raw
        else:
            y = y_raw
    except ValueError:
        y = 2099
    return (y, _MONTH_CODE_ORDER.get(mcode, 99))


def _rate_map(contracts: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for c in contracts:
        r = c.get("implied_rate")
        if r is None:
            continue
        label = str(c.get("contract") or "")
        out[label] = c
        # alias SR3M6 ↔ SFRM6
        if label.startswith("SR3"):
            out["SFR" + label[3:]] = c
        if label.startswith("SFR"):
            out["SR3" + label[3:]] = c
    return out


def _spread_row(
    name: str,
    kind: str,
    leg_a: str,
    leg_b: str | None,
    rate_a: float,
    rate_b: float | None,
    *,
    price_a: float | None = None,
    price_b: float | None = None,
    note: str = "",
    priority: int = 50,
    implied_rate: float | None = None,
    ratio: str | None = None,
) -> dict[str, Any]:
    """
    Spread in rate bps: (rate_a − rate_b) * 100.
    Price spread (futures pts): price_a − price_b when both prices known.
    Ratio is the CME-style leg ratio, resolved from the contract (never guessed).
    """
    bps = None
    if rate_b is not None:
        bps = round((rate_a - rate_b) * 100.0, 2)
    px = None
    if price_a is not None and price_b is not None:
        px = round(price_a - price_b, 4)
    # Default 1:1 for two-leg spreads; callers provide explicit ratios for flies/packs/four-legs.
    if ratio is None:
        if leg_b is None:
            ratio = "1"
        else:
            ratio = "1:1"
    imply = imply_for_spread(kind, name, bps, implied_rate=implied_rate)
    return {
        "name": name,
        "kind": kind,  # calendar | fly | pack | calendar-of-calendars | serff | derived-proxy | inter | cash
        "legs": [leg_a, leg_b] if leg_b else [leg_a],
        "ratio": ratio,
        "rate_bps": bps,
        "price_spread": px,
        "note": note,
        "priority": priority,
        "imply": imply,
    }


def stir_spreads(
    sr3: list[dict],
    sr1: list[dict] | None = None,
    zq: list[dict] | None = None,
    *,
    sofr: float | None = None,
    effr: float | None = None,
    iorb: float | None = None,
) -> dict[str, Any]:
    """
    Desk-standard SOFR / STIR spreads used by rates traders:

    Calendars (reds): SR3Z26−SR3Z27, SR3M26−SR3Z26, SR3Z26−SR3Z28, …
    Flies: wing − 2*body + wing on SR3 strip
    SERFF: CME same-delivery-month One-Month SOFR vs 30-Day Fed Funds ICS = SR1 − ZQ (1:1).
           Missing exact leg → SERFF Unavailable. Cash-EFFR differences are Derived Proxy rows,
           never listed/observed SERFF.
    Inter: SR1 − SR3 same month (1s3s SOFR), SR3 − ZQ (own intermarket family, not SERFF)
    Cash corridor: SOFR−EFFR, SOFR−IORB, EFFR−IORB
    """
    sr1 = sr1 or []
    zq = zq or []
    m3 = _rate_map(sr3)
    m1 = _rate_map(sr1)
    mz = _rate_map(zq)

    spreads: list[dict[str, Any]] = []

    # ── Cash overnight corridor (always if FRED live) ──
    if sofr is not None and effr is not None:
        spreads.append(
            _spread_row(
                "SOFR−EFFR",
                "cash",
                "SOFR",
                "EFFR",
                sofr,
                effr,
                note="Cash overnight secured vs unsecured (FRED). Classic corridor / RRP stress flag.",
                priority=1,
            )
        )
    if sofr is not None and iorb is not None:
        spreads.append(
            _spread_row(
                "SOFR−IORB",
                "cash",
                "SOFR",
                "IORB",
                sofr,
                iorb,
                note="Secured vs reserve floor. Rising toward 0 / + = tighter plumbing.",
                priority=2,
            )
        )
    if effr is not None and iorb is not None:
        spreads.append(
            _spread_row(
                "EFFR−IORB",
                "cash",
                "EFFR",
                "IORB",
                effr,
                iorb,
                note="Unsecured corridor width vs IORB floor.",
                priority=3,
            )
        )

    # Ordered live SR3 by expiry (skip FRED-settled history for calendar/fly flood)
    sr3_live = sorted(
        [
            c
            for c in sr3
            if c.get("implied_rate") is not None
            and c.get("source") in (None, "live", "fallback")
        ],
        key=lambda c: _contract_sort_key(str(c.get("contract") or "")),
    )
    labels3 = [str(c.get("contract")) for c in sr3_live]

    def _px(c: dict) -> float | None:
        p = c.get("last_price")
        if p is not None:
            return float(p)
        r = c.get("implied_rate")
        return round(100.0 - float(r), 4) if r is not None else None

    # ── Calendar spreads (most-traded reds / greens) ──
    # Explicit pro pairs first (user examples)
    calendar_pairs = [
        ("SR3Z6", "SR3Z7", "SR3Z26−SR3Z27", "1y red Dec26s/Dec27s calendar", 10),
        ("SR3M6", "SR3Z7", "SR3M26−SR3Z27", "Jun26 vs Dec27 curve steepener/flattener", 11),
        ("SR3Z6", "SR3Z8", "SR3Z26−SR3Z28", "2y red Dec26s/Dec28s calendar", 12),
        ("SR3M6", "SR3Z6", "SR3M26−SR3Z26", "Whites: Jun26 vs Dec26", 13),
        ("SR3U6", "SR3Z6", "SR3U26−SR3Z26", "Sep26 vs Dec26", 14),
        ("SR3H6", "SR3H7", "SR3H26−SR3H27", "Mar26/Mar27 calendar", 15),
        ("SR3M6", "SR3M7", "SR3M26−SR3M27", "Jun26/Jun27 calendar", 16),
        ("SR3U6", "SR3U7", "SR3U26−SR3U27", "Sep26/Sep27 calendar", 17),
        ("SR3Z7", "SR3Z8", "SR3Z27−SR3Z28", "Dec27/Dec28 green calendar", 18),
        ("SR3H7", "SR3H8", "SR3H27−SR3H28", "Mar27/Mar28 calendar", 19),
        ("SR3M7", "SR3Z7", "SR3M27−SR3Z27", "Jun27 vs Dec27", 20),
    ]
    for a, b, name, note, pri in calendar_pairs:
        ca, cb = m3.get(a), m3.get(b)
        if not ca or not cb:
            continue
        ra, rb = ca.get("implied_rate"), cb.get("implied_rate")
        if ra is None or rb is None:
            continue
        spreads.append(
            _spread_row(
                name,
                "calendar",
                a,
                b,
                float(ra),
                float(rb),
                price_a=_px(ca),
                price_b=_px(cb),
                note=note,
                priority=pri,
            )
        )

    # Adjacent strip calendars (fill gaps)
    for i in range(len(sr3_live) - 1):
        a, b = sr3_live[i], sr3_live[i + 1]
        la, lb = str(a.get("contract")), str(b.get("contract"))
        name = f"{la}−{lb}"
        if any(s["name"] == name or set(s.get("legs") or []) == {la, lb} for s in spreads if s["kind"] == "calendar"):
            continue
        ra, rb = a.get("implied_rate"), b.get("implied_rate")
        if ra is None or rb is None:
            continue
        spreads.append(
            _spread_row(
                name,
                "calendar",
                la,
                lb,
                float(ra),
                float(rb),
                price_a=_px(a),
                price_b=_px(b),
                note="Adjacent strip calendar",
                priority=40 + i,
            )
        )

    # ── Butterflies (most common curve shape) ──
    fly_defs = [
        ("SR3M6", "SR3Z6", "SR3M7", "SR3M6/Z6/M7 fly", 25),
        ("SR3Z6", "SR3H7", "SR3Z7", "SR3Z6/H7/Z7 fly", 26),
        ("SR3H7", "SR3M7", "SR3U7", "SR3H7/M7/U7 fly", 27),
        ("SR3Z6", "SR3Z7", "SR3Z8", "SR3Z6/Z7/Z8 fly (Decs)", 28),
    ]
    for w1, body, w2, name, pri in fly_defs:
        c1, cb, c2 = m3.get(w1), m3.get(body), m3.get(w2)
        if not c1 or not cb or not c2:
            continue
        r1, rb, r2 = c1.get("implied_rate"), cb.get("implied_rate"), c2.get("implied_rate")
        if None in (r1, rb, r2):
            continue
        # fly in rate bps: wing1 − 2*body + wing2
        fly_bps = round((float(r1) - 2 * float(rb) + float(r2)) * 100.0, 2)
        p1, pb, p2 = _px(c1), _px(cb), _px(c2)
        fly_px = None
        if p1 is not None and pb is not None and p2 is not None:
            fly_px = round(p1 - 2 * pb + p2, 4)
        spreads.append(
            {
                "name": name,
                "kind": "fly",
                "legs": [w1, body, w2],
                "ratio": "1:-2:1",
                "rate_bps": fly_bps,
                "price_spread": fly_px,
                "note": "Butterfly: +1/−2/+1. Positive rate fly = body rich vs wings.",
                "priority": pri,
                "imply": imply_for_spread("fly", name, fly_bps),
            }
        )
    # ── SERFF — CME inter-commodity spread: same-month One-Month SOFR (SR1) vs
    # 30-Day Federal Funds (ZQ), ratio 1:1. Exact legs only: if either leg is
    # absent the row is Unavailable (null bps) — never an SR3 or cash proxy
    # substitution.
    _serff_suffixes: list[str] = []
    for c in sr1:
        lab = str(c.get("contract") or "")
        if lab.startswith("SR1"):
            suf = lab[3:]
            if suf and suf not in _serff_suffixes:
                _serff_suffixes.append(suf)
    for cz in zq:
        labz = str(cz.get("contract") or "")
        suf = labz[2:] if labz.startswith("ZQ") else ""
        if suf and suf not in _serff_suffixes:
            _serff_suffixes.append(suf)
    for suf in sorted(_serff_suffixes, key=_contract_sort_key):
        c1 = m1.get("SR1" + suf)
        cz = mz.get("ZQ" + suf)
        legs_ok = (
            c1 is not None
            and cz is not None
            and c1.get("implied_rate") is not None
            and cz.get("implied_rate") is not None
        )
        missing = []
        if c1 is None or c1.get("implied_rate") is None:
            missing.append("SR1" + suf)
        if cz is None or cz.get("implied_rate") is None:
            missing.append("ZQ" + suf)
        if legs_ok:
            bps_serff = round((float(c1["implied_rate"]) - float(cz["implied_rate"])) * 100.0, 2)  # type: ignore[index]
            px1, pxz = _px(c1), _px(cz)  # type: ignore[arg-type]
            px_serff = round(px1 - pxz, 4) if px1 is not None and pxz is not None else None
            spreads.append(
                _spread_row(
                    f"SERFF{suf}",
                    "serff",
                    "SR1" + suf,
                    "ZQ" + suf,
                    float(c1["implied_rate"]),  # type: ignore[index]
                    float(cz["implied_rate"]),  # type: ignore[index]
                    price_a=px1,
                    price_b=pxz,
                    note=(
                        "CME SERFF inter-commodity spread: same-month SR1 − ZQ, ratio 1:1. "
                        "CME price-display convention: price = 100 − implied rate; "
                        "rate_bps = SR1 implied rate − ZQ implied rate (leg order as listed); "
                        "price_spread = SR1 price − ZQ price = −rate_bps/100 (opposite sign). "
                        "Positive rate_bps = SR1 rate above ZQ rate (secured firmer), "
                        "so SR1 price below ZQ price."
                    ),
                    priority=3,
                )
            )
            # keep price spread in the row (set by _spread_row)
        else:
            spreads.append(
                {
                    "name": f"SERFF{suf}",
                    "kind": "serff",
                    "legs": ["SR1" + suf, "ZQ" + suf],
                    "ratio": "1:1",
                    "rate_bps": None,
                    "price_spread": None,
                    "note": f"SERFF{suf} Unavailable — missing exact leg(s): {', '.join(missing)}. No proxy substitution.",
                    "priority": 3,
                    "imply": None,
                }
            )

    # ── Four-leg SR3 calendar-of-calendars (curve curvature tools; NOT SERFF) ──
    four_leg_defs = [
        # (legs, name, ratio, note, priority)
        (["SR3M6", "SR3U6", "SR3M7", "SR3U7"], "SR3 Cal-of-Cal (M6−U6)−(M7−U7)", "1:-1:-1:1", "Front Jun-Sep minus back Jun-Sep calendar (SOFR path curvature). Not SERFF.", 6),
        (["SR3Z6", "SR3H7", "SR3Z7", "SR3H8"], "SR3 Cal-of-Cal (Z6−H7)−(Z7−H8)", "1:-1:-1:1", "Dec-Mar calendar differential (curve curvature). Not SERFF.", 6),
    ]
    for legs4, name4, ratio4, note4, pri4 in four_leg_defs:
        cs = [m3.get(leg) for leg in legs4]
        if any(c is None or c.get("implied_rate") is None for c in cs):
            # Emit unavailable shape rather than hiding: preserves contract visibility with null bps
            spreads.append({
                "name": name4,
                "kind": "calendar-of-calendars",
                "legs": legs4,
                "ratio": ratio4,
                "rate_bps": None,
                "price_spread": None,
                "note": note4 + " — unavailable (missing live leg).",
                "priority": pri4,
                "imply": imply_for_spread("calendar-of-calendars", name4, None),
            })
            continue
        rs = [float(c["implied_rate"]) for c in cs]  # type: ignore[index]
        bps4 = round((rs[0] - rs[1] - rs[2] + rs[3]) * 100.0, 2)
        pxs = [_px(c) for c in cs]  # type: ignore[arg-type]
        px4 = round(pxs[0] - pxs[1] - pxs[2] + pxs[3], 4) if all(v is not None for v in pxs) else None  # type: ignore[operator]
        spreads.append({
            "name": name4,
            "kind": "calendar-of-calendars",
            "legs": legs4,
            "ratio": ratio4,
            "rate_bps": bps4,
            "price_spread": px4,
            "note": note4,
            "priority": pri4,
            "imply": imply_for_spread("calendar-of-calendars", name4, bps4),
        })

    # ── Packs (white / green / blue averages) ──
    packs = [
        ("White pack", ["SR3H6", "SR3M6", "SR3U6", "SR3Z6"], 30),
        ("Green pack", ["SR3H7", "SR3M7", "SR3U7", "SR3Z7"], 31),
        ("Blue pack", ["SR3H8", "SR3M8", "SR3U8", "SR3Z8"], 32),
    ]
    pack_avgs: dict[str, float] = {}
    for pname, legs, pri in packs:
        rates = []
        for leg in legs:
            c = m3.get(leg)
            if c and c.get("implied_rate") is not None:
                rates.append(float(c["implied_rate"]))
        if len(rates) >= 3:
            avg = sum(rates) / len(rates)
            pack_avgs[pname] = avg
            spreads.append(
                {
                    "name": pname,
                    "kind": "pack",
                    "legs": legs,
                    "ratio": "1:1:1:1",
                    "rate_bps": None,
                    "implied_rate": round(avg, 4),
                    "price_spread": round(100.0 - avg, 4),
                    "note": f"Avg implied of {len(rates)} live legs in pack.",
                    "priority": pri,
                    "imply": imply_for_spread("pack", pname, None, implied_rate=avg),
                }
            )
    if "White pack" in pack_avgs and "Green pack" in pack_avgs:
        spreads.append({
            "name": "White−Green pack",
            "kind": "pack",
            "legs": ["White", "Green"],
            "ratio": "1:-1",
            "rate_bps": round((pack_avgs["White pack"] - pack_avgs["Green pack"]) * 100.0, 2),
            "price_spread": round((100.0 - pack_avgs["White pack"]) - (100.0 - pack_avgs["Green pack"]), 4),
            "note": "Whites vs greens pack spread (curve).",
            "priority": 33,
            "imply": imply_for_spread("pack", "White−Green pack", round((pack_avgs["White pack"] - pack_avgs["Green pack"]) * 100.0, 2)),
        })

    # ── Derived Proxy: SOFR futures implied rate − cash EFFR (NOT SERFF) ──
    # Cash EFFR is not a listed futures leg; these are derived, non-executable
    # proxy rows kept in their own group and never labelled SERFF.
    if effr is not None:
        proxy_months = [
            ("SR3M6", "SR3M6−EFFR (proxy)", "Jun26 SR3 implied rate − cash EFFR"),
            ("SR3U6", "SR3U6−EFFR (proxy)", "Sep26 SR3 implied rate − cash EFFR"),
            ("SR3Z6", "SR3Z6−EFFR (proxy)", "Dec26 SR3 implied rate − cash EFFR"),
            ("SR3H7", "SR3H7−EFFR (proxy)", "Mar27 SR3 implied rate − cash EFFR"),
            ("SR3M7", "SR3M7−EFFR (proxy)", "Jun27 SR3 implied rate − cash EFFR"),
            ("SR3Z7", "SR3Z7−EFFR (proxy)", "Dec27 SR3 implied rate − cash EFFR"),
            ("SR3Z8", "SR3Z8−EFFR (proxy)", "Dec28 SR3 implied rate − cash EFFR"),
        ]
        for leg, name, note in proxy_months:
            c = m3.get(leg)
            if not c or c.get("implied_rate") is None:
                continue
            spreads.append(
                _spread_row(
                    name,
                    "derived-proxy",
                    leg,
                    "EFFR (cash)",
                    float(c["implied_rate"]),
                    float(effr),
                    price_a=_px(c),
                    note=note + ". Derived, non-listed, non-executable proxy — not SERFF.",
                    priority=7,
                )
            )
        # Monthly SR1 − cash EFFR proxies when available
        for c in sorted(sr1, key=lambda x: _contract_sort_key(str(x.get("contract") or ""))):
            if c.get("implied_rate") is None:
                continue
            lab = str(c.get("contract"))
            name = f"{lab}−EFFR (proxy)"
            spreads.append(
                _spread_row(
                    name,
                    "derived-proxy",
                    lab,
                    "EFFR (cash)",
                    float(c["implied_rate"]),
                    float(effr),
                    price_a=_px(c),
                    note="1M SOFR implied rate − cash EFFR. Derived, non-listed, non-executable proxy — not SERFF.",
                    priority=8,
                )
            )

    # ── Inter: SR1 − SR3 same quarter / SR3 − ZQ ──
    for c1 in sr1:
        lab1 = str(c1.get("contract") or "")
        if c1.get("implied_rate") is None:
            continue
        # match month code: SR1Z6 ↔ SR3Z6
        suffix = lab1[3:] if lab1.startswith("SR1") else ""
        c3 = m3.get("SR3" + suffix)
        if c3 and c3.get("implied_rate") is not None:
            spreads.append(
                _spread_row(
                    f"{lab1}−SR3{suffix}",
                    "inter",
                    lab1,
                    "SR3" + suffix,
                    float(c1["implied_rate"]),
                    float(c3["implied_rate"]),
                    price_a=_px(c1),
                    price_b=_px(c3),
                    note="1M vs 3M SOFR futures basis (same month code).",
                    priority=35,
                )
            )

    for cz in zq:
        labz = str(cz.get("contract") or "")
        if cz.get("implied_rate") is None:
            continue
        suffix = labz[2:] if labz.startswith("ZQ") else ""
        c3 = m3.get("SR3" + suffix)
        if c3 and c3.get("implied_rate") is not None:
            spreads.append(
                _spread_row(
                    f"SR3{suffix}−{labz}",
                    "inter",
                    "SR3" + suffix,
                    labz,
                    float(c3["implied_rate"]),
                    float(cz["implied_rate"]),
                    price_a=_px(c3),
                    price_b=_px(cz),
                    note="3M SOFR − Fed Funds futures intermarket. Own contract family (different legs/ratio from SERFF) — never label as SERFF.",
                    priority=4,
                )
            )

    spreads.sort(key=lambda s: (s.get("priority", 99), s.get("name") or ""))

    by_kind: dict[str, list] = {}
    for s in spreads:
        by_kind.setdefault(s["kind"], []).append(s)

    return {
        "spreads": spreads,
        "by_kind": by_kind,
        "counts": {k: len(v) for k, v in by_kind.items()},
        "note": (
            "Calendars/flies from SR3 strip (SFR). SERFF = CME same-month SR1 − ZQ inter-commodity "
            "spread (1:1); Unavailable when an exact leg is missing. SR1/SR3 implied − cash EFFR "
            "rows are Derived Proxies (non-listed, non-executable). rate_bps = (legA − legB)×100. "
            "price_spread = futures pts. imply = general trader read (cut/hike/steepen/flat/stress); "
            "neutral when the print does not force a view. Not a trade recommendation."
        ),
        "labels3": labels3,
    }
