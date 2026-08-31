"""
U.S. Treasury upcoming auctions via FiscalData (no API key).

Fail-closed: empty list on failure — never invent auction sizes/dates.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import httpx

FISCAL_BASE = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service"
UPCOMING = f"{FISCAL_BASE}/v1/accounting/od/upcoming_auctions"


def _parse_float(raw: Any) -> float | None:
    if raw is None or raw == "" or raw == "null":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _fmt_offer_bn(amt: float | None) -> str | None:
    if amt is None:
        return None
    bn = amt / 1e9
    if bn >= 1:
        return f"${bn:.0f}bn" if bn >= 10 else f"${bn:.1f}bn"
    mn = amt / 1e6
    return f"${mn:.0f}mm"


async def build_upcoming_auctions(*, limit: int = 20) -> dict[str, Any]:
    """Next Treasury auctions with auction_date >= today (UTC)."""
    today = date.today().isoformat()
    params = {
        "filter": f"auction_date:gte:{today}",
        "sort": "auction_date",
        "page[size]": str(min(max(limit, 1), 50)),
    }
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            res = await client.get(
                UPCOMING,
                params=params,
                headers={"Accept": "application/json"},
            )
            res.raise_for_status()
            payload = res.json()
    except Exception as e:
        return {
            "auctions": [],
            "error": f"{type(e).__name__}: {e}",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "U.S. Treasury FiscalData",
            "note": "Failed to fetch upcoming auctions. No synthetic calendar.",
        }

    rows = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return {
            "auctions": [],
            "error": "empty_payload",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "U.S. Treasury FiscalData",
            "note": "FiscalData returned no auction rows. No synthetic calendar.",
        }

    auctions: list[dict[str, Any]] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        offer = _parse_float(r.get("offering_amt"))
        auctions.append({
            "auction_date": r.get("auction_date"),
            "issue_date": r.get("issue_date"),
            "announce_date": r.get("announcemt_date") or r.get("announcement_date"),
            "security_type": r.get("security_type"),
            "security_term": r.get("security_term"),
            "cusip": r.get("cusip"),
            "reopening": r.get("reopening"),
            "offering_amt": offer,
            "offering_label": _fmt_offer_bn(offer),
        })

    # Prefer notes/bonds first in summary, keep full list chronological
    notes_bonds = [
        a for a in auctions
        if str(a.get("security_type") or "").lower() in ("note", "bond", "tips", "frn")
    ]
    next_coupon = notes_bonds[0] if notes_bonds else (auctions[0] if auctions else None)

    total_offer = sum(a["offering_amt"] for a in auctions if a.get("offering_amt") is not None)
    meta = payload.get("meta") if isinstance(payload, dict) else {}
    total_count = meta.get("total-count") if isinstance(meta, dict) else len(auctions)

    return {
        "auctions": auctions,
        "next": auctions[0] if auctions else None,
        "next_coupon": next_coupon,
        "count": len(auctions),
        "total_count": total_count,
        "total_offering_usd": total_offer if total_offer else None,
        "total_offering_label": _fmt_offer_bn(total_offer) if total_offer else None,
        "filter_from": today,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "U.S. Treasury FiscalData · upcoming_auctions",
        "note": (
            "Official Treasury auction calendar. Offering amounts may be null until announced. "
            "Supply narrative next to the UST curve — not a pricing model."
        ),
    }
