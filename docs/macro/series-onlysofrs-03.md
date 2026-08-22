# OnlySOFRs (3/9) — Money markets & repo (2/2)

**Source:** Full public article · OnlySOFRs — *The Plumbing, The Basis, and The End of The World (Again)* · https://onlysofrs.substack.com/p/the-plumbing-the-basis-and-the-end · Jan 01, 2026

> Full source text preserved for education. Split only for reading length — not summarized away.

---

* *The Catch:* The dealer is now expanding their balance sheet. If the dealer does $1 billion of repo and $1 billion of reverse repo, their balance sheet grows by $1 billion (gross). Under the Supplementary Leverage Ratio (SLR), they must hold capital against this $1 billion. If the spread is only 10bps, the Return on Equity (ROE) might be too low to justify the trade.

* *The Solution:* **Netting**. If the repo and reverse are with the same counterparty or cleared through the same Central Counterparty (CCP) like the Fixed Income Clearing Corporation (FICC), they can net the positions down. This reduces capital usage and boosts ROE. This is why **Sponsored Repo** (where Money Funds trade directly with FICC) has exploded in volume—it allows dealers to intermediate massive flows without blowing up their leverage ratios.

### The “Special” Market: When Collateral is King

Not all collateral is created equal. Some bonds are “On-the-Run” (newly issued, liquid). Everyone wants them. If a specific bond is in high demand (usually to cover short positions), the repo rate on *that specific bond* drops. This is called trading “Special”.

* **General Collateral (GC):** Repo rate for “any old Treasury.” This is what SOFR *TRIES* to measure.

* **Special Rate:** Repo rate for a specific, scarce bond.

* **Specialness:** GC Rate - Special Rate.

When a bond trades deeply special (e.g., 0.05% repo rate when GC is 4.50%), it means the “street” is massively short that bond. This is a squeeze indicator. If you own that bond, you can finance it for free (or close to it). More importantly, the high “specialness” signals that the bond is “rich” relative to the curve, but shorting it is dangerous because the cost of borrowing it (the repo rate) is so high (you receive 0.05% on your cash instead of 4.50%).

### 3. Leverage Dynamics: The Tail that Wags the Dog

Dealers and levered investors (hedge funds) run **Mismatched Books** to generate excess carry. This introduces “Tail” risk. This is the silent killer of leveraged strategies.

**The Trade:**

* Buy a 90-day Treasury Bill yielding 4.00%.

* Finance it with a 30-day Repo at 3.75%.

* **Carry:** Positive 25bps (for the first 30 days).

* **The Risk:** In 30 days, you must roll the repo. You are “short the tail”—specifically, the future 60-day repo rate starting 30 days from now.

* **The Blowup:** If 30 days from now, repo rates spike to 4.50% (because of a tax date, or G-SIB surcharge constraints at year-end ), your positive carry turns into negative carry. You are bleeding.

### 4. Central Bank Tools: The Plumber’s Wrench

The Federal Reserve has evolved from a rate-setter to a collateral-manager. It essentially runs a massive repo desk.

* **RRP (Reverse Repo Facility):** The Floor. The Fed borrows cash from MMFs. In 2023/24, this facility held $2.5 trillion. In 2025, balances have drained as MMFs moved money back into private repo markets to chase higher yields (since SOFR > RRP). This “drain” provided liquidity to the market. But now, the RRP is nearly empty. The liquidity buffer is gone.

* **SRF (Standing Repo Facility):** The Ceiling. The Fed lends cash against Treasuries. This is the “bailout” mechanism for the repo market. It prevents rates from spiking too high, but it also creates moral hazard.

* **Basel III Endgame:** The Villain. The new capital rules increase the risk-weighting for trading assets and operational risk. This forces banks to hoard capital rather than lend it in repo. The result? **Volatility.** Liquidity becomes thinner, bid-ask spreads widen , and the probability of a “flash crash” increases.

---

---

*Series: **OnlySOFRs: plumbing primer** · Part 3 of 9*

[← Previous](/docs/macro/series-onlysofrs-02.md) · [Next →](/docs/macro/series-onlysofrs-04.md)
