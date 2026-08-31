"""
SEC EDGAR company context — CIK map + recent filings (8-K / 10-Q / 10-K).

No API key. Requires a descriptive User-Agent per SEC fair-access policy.
Fail-closed: empty on error; never invent filing dates.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx

TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
USER_AGENT = "TradingTerminalPro research desk contact@localhost"

# Simple in-process ticker→CIK cache (process lifetime)
_cik_map: dict[str, str] | None = None


async def _load_cik_map(client: httpx.AsyncClient) -> dict[str, str]:
    global _cik_map
    if _cik_map is not None:
        return _cik_map
    res = await client.get(TICKERS_URL, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    res.raise_for_status()
    payload = res.json()
    out: dict[str, str] = {}
    if isinstance(payload, dict):
        for row in payload.values():
            if not isinstance(row, dict):
                continue
            t = str(row.get("ticker") or "").upper().strip()
            cik = row.get("cik_str")
            if t and cik is not None:
                out[t] = str(int(cik)).zfill(10)
    _cik_map = out
    return out


async def build_sec_context(symbol: str, limit: int = 8) -> dict[str, Any]:
    """Recent material filings for an equity ticker via SEC submissions JSON."""
    sym = (symbol or "").upper().strip()
    if not sym or not sym.replace(".", "").replace("-", "").isalnum():
        return {
            "symbol": sym,
            "filings": [],
            "error": "invalid_symbol",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "SEC EDGAR",
            "note": "Invalid symbol.",
        }

    # Crypto / non-EDGAR underliers
    if sym in ("BTC", "ETH", "BITO", "IBIT") or "-USD" in sym:
        return {
            "symbol": sym,
            "filings": [],
            "error": "not_equity",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "SEC EDGAR",
            "note": "SEC EDGAR applies to U.S. equity issuers only.",
        }

    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            cmap = await _load_cik_map(client)
            cik = cmap.get(sym)
            if not cik:
                return {
                    "symbol": sym,
                    "cik": None,
                    "filings": [],
                    "error": "cik_not_found",
                    "as_of": datetime.now(timezone.utc).isoformat(),
                    "source": "SEC EDGAR",
                    "note": f"No CIK mapping for {sym}.",
                }
            res = await client.get(
                SUBMISSIONS_URL.format(cik=cik),
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            res.raise_for_status()
            data = res.json()
    except Exception as e:
        return {
            "symbol": sym,
            "filings": [],
            "error": f"{type(e).__name__}: {e}",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "source": "SEC EDGAR",
            "note": "Failed to fetch SEC submissions. No synthetic filings.",
        }

    name = data.get("name") or data.get("entityType")
    recent = (data.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    acc = recent.get("accessionNumber") or []
    primary = recent.get("primaryDocument") or []
    descriptions = recent.get("primaryDocDescription") or []

    want = {"8-K", "8-K/A", "10-Q", "10-Q/A", "10-K", "10-K/A", "6-K", "20-F", "S-1", "424B2"}
    filings: list[dict[str, Any]] = []
    n = min(len(forms), len(dates))
    for i in range(n):
        form = str(forms[i] or "")
        if form not in want and not form.startswith("8-K"):
            continue
        accession = str(acc[i]).replace("-", "") if i < len(acc) else ""
        doc = primary[i] if i < len(primary) else ""
        url = None
        if accession and doc:
            url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession}/{doc}"
        filings.append(
            {
                "form": form,
                "filing_date": dates[i],
                "description": descriptions[i] if i < len(descriptions) else None,
                "url": url,
            }
        )
        if len(filings) >= limit:
            break

    return {
        "symbol": sym,
        "cik": cik,
        "name": name,
        "filings": filings,
        "latest": filings[0] if filings else None,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "source": "SEC EDGAR",
        "note": "Material filings (8-K / 10-Q / 10-K …). Not an earnings calendar — use Finnhub for next report date.",
        "error": None if filings else "no_recent_filings",
    }
