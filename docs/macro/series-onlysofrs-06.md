# OnlySOFRs (6/9) — Bonds, futures & swaps

**Source:** Full public article · OnlySOFRs — *The Plumbing, The Basis, and The End of The World (Again)* · https://onlysofrs.substack.com/p/the-plumbing-the-basis-and-the-end · Jan 01, 2026

> Full source text preserved for education. Split only for reading length — not summarized away.

---

## Part 3: Bonds, Interest Rate Futures, and Interest Rate Swaps

**“If you are pricing swaps off the screen without adjusting for convexity, you are the yield.”**

Now we enter the OTC world. **Swaps**. This is where the plumbing meets the skyscraper. The Swap market is the largest derivative market in the world, and it is the primary venue for expressing views on interest rates, duration, and credit.

### 1. The Anatomy of a Swap

A “Plain Vanilla” Interest Rate Swap is an exchange of fixed cash flows for floating cash flows.

* **Payer:** Pays Fixed Rate (e.g., 4.50%), Receives Floating (SOFR).

* **Receiver:** Receives Fixed, Pays Floating.

**Valuation:**

The value of a swap is the present value of the difference between the fixed leg and the expected floating leg.

PV_Swap = PV_Fixed − PV_Floating

To value the floating leg, we must build a Forward Curve based on SOFR futures and forward starting swaps. We “bootstrap” the curve. This involves taking the liquid points (IMM Futures, 2y, 5y, 10y, 30y Swaps) and interpolating the rates in between to create a continuous yield curve.

### 2. Swap Spreads: The Credit/Liquidity Barometer

The Swap Spread is defined as:

Swap Spread = Swap Rate − Bond Yield

Historically, spreads were positive. The logic was based on a simple hierarchy of credit risk:

* **The Old Yardstick (LIBOR):** Swaps were priced off LIBOR (I miss you dearly), which contained unsecured bank credit risk (AA).

* **The Theory:** Banks are riskier than the US Government. Therefore, Swap Yield > Treasury Yield.

The transition from LIBOR to “risk-free” mirage SOFR fundamentally broke the old equation. Swaps no longer price in bank failure risk. They are now priced off SOFR. The “credit premium” that historically kept Swap rates *above* Treasuries has been mathematically erased. The floor dropped out from under the swap rate like Bill Hwang.

**Image:** https://substackcdn.com/image/fetch/$s_!b91_!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F388be3eb-405c-4892-abc3-684468d2ce56_429x405.png

**The Anomaly:** The New Normal In 2025, 30-year Swap Spreads are deeply negative. This is no longer about credit risk; it is about **Scarcity vs. Supply**. The market is being squeezed from two sides.

* *Why?* **Supply and Demand**.

* *The Gobblers*: Pension funds need duration. They receive fixed in 30y swaps to hedge liabilities. This buying pressure crushes the swap rate.

* *The Flood:* The US Government has unleashed unprecedented issuance to fund deficits. There is physically too much paper looking for a home. When supply overwhelms demand, prices drop and **yields rise**. This pushes the Treasury Yield *up* relative to the Swap (which has no physical supply constraint).

* *Dealer Constraints:* **The "Balance Sheet Tax" (SLR)** This is where the trap snaps shut. To bridge the gap between the **Flood of Issuance** and the **Pension Demand**, Dealers must step in and charge a premium for this balance sheet usage.

**The Trade:**

If Swap Spreads are historically tight (or negative), we put on a Spread Widener:

* Pay Fixed on the Swap.

* Buy the Treasury.

* *Thesis:* If a crisis hits, “flight to quality” drives Treasury yields down faster than Swap rates. Spreads widen. You profit.

* *Anti-Thesis*: 2020 would like to have a chat with you.

### 3. Convexity Bias: The Futures vs. Swap Disconnect

You can hedge a Swap with a SOFR Future. But they are not the same.

* **Futures:** Linear payoff. Margin is settled daily.

* **Swaps:** Convex payoff. No daily margin settlement (typically collateralized, but PV impact is non-linear).

Because futures holders get paid daily (if winning) and can reinvest that cash, futures are theoretically worth *more* than forward rates implied by swaps (which don’t pay out until the end).

* This difference is the **Convexity Bias** (as everything in Finance this formula is just an approximation).

  Forward Rate = Futures Rate − (0.5 × σ² × T²)

* *Implication:* As volatility rises, the bias increases. In 2025, with SOFR vol exploding , the gap between Futures-implied rates and Swap rates is widening. If you use raw futures prices to price swaps without adjustment, you are overestimating the rate. You are the sucker at the table.

---

---

*Series: **OnlySOFRs: plumbing primer** · Part 6 of 9*

[← Previous](/docs/macro/series-onlysofrs-05.md) · [Next →](/docs/macro/series-onlysofrs-07.md)
