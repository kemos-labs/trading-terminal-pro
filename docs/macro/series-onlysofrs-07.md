# OnlySOFRs (7/9) — Relative value on the curve

**Source:** Full public article · OnlySOFRs — *The Plumbing, The Basis, and The End of The World (Again)* · https://onlysofrs.substack.com/p/the-plumbing-the-basis-and-the-end · Jan 01, 2026

> Full source text preserved for education. Split only for reading length — not summarized away.

---

## Part 4: Relative Value: Curves, Butterflies, Basis Swaps, Asset Swaps

**“God gave you a curve. You are supposed to trade the kinks.”**

This is the bread and butter of the rates semi-gods. Relative Value (RV). We don’t care if rates go to 10% or 0%. We care if the 5-year note is trading 2 basis points too cheap relative to the 2-year and 10-year notes.

### 1. PCA: Decomposing the Curve

The yield curve is 98% correlated (I made that figure up, was too lazy to actually check it, but you get the point). If the 2-year moves, the 10-year moves. We use **Principal Component Analysis (PCA)** to find the independent drivers.

* **PC1 (Level):** The whole curve moves up/down. This explains ~90% of the variance. It is driven by Fed Policy shocks and inflation data.

* **PC2 (Slope):** The curve twists (steepens or flattens). This explains ~8% of the variance. It reflects Recession fears (flattening/inversion) vs. Growth expectations (steepening).

* **PC3 (Curvature):** The belly moves vs. the wings. This explains ~2% of the variance. It is driven by Supply/Demand indigestion (e.g., massive 5-year auctions).

**The Alpha is in the Residuals:**

We model the curve using PC1, PC2, PC3. If the actual 5-year yield is 10bps higher than the model predicts, it is “cheap” on a PCA basis.

* *Trade:* Buy the 5-year. Hedge the Level (PC1) and Slope (PC2) risk using 2s and 10s. You are betting the residual collapses.

### 2. The Butterfly Trade

The butterfly exploits **Curvature** (PC3).

* **Long Body (5y), Short Wings (2y, 10y).**

* This trade is “Market Neutral” (duration zero) and “Slope Neutral” (if weighted correctly).

* It profits if the curve becomes “more humped” or “less humped.”

**2025 Regime:**

* Short-end is pinned by Fed cuts.

* Long-end is loose due to fiscal deficits.

* Belly (5y-7y) is where the supply hits.

* *Trade:* If Treasury auctions heavily in the belly, 5s cheapen relative to the interpolation of 2s and 10s. We put on a “Fly” (Long 5s, Short 2s/10s) to capture the richening after the auction digests.

### 3. Mean Reversion & First Passage Time

When does a trade pay off? We don’t guess. We model the spread as an Ornstein-Uhlenbeck (OU) process (NEEEERD):

dx_t = θ (μ − x_t) dt + σ dW_t

We calculate the **First Passage Time Density**. This tells us: “There is a 65% probability this spread reverts to mean within 14 days.” If the carry cost of holding the trade for 14 days is less than the expected profit, we execute. If not, we pass. We view the world through **Expected Value (EV)**.

### 4. Basis Swaps: The building blocks

Basis swaps trade one floating index for another (e.g., 3m SOFR vs. 1m SOFR, or SOFR vs. Fed Funds).

* These swaps tell us about the plumbing stress.

* If SOFR/FedFunds basis (SERFF) tightens, it means secured funding is expensive relative to unsecured.

* We monitor these to time our entries into broader curve trades.

---

---

*Series: **OnlySOFRs: plumbing primer** · Part 7 of 9*

[← Previous](/docs/macro/series-onlysofrs-06.md) · [Next →](/docs/macro/series-onlysofrs-08.md)
