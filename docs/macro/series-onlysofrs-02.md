# OnlySOFRs (2/9) — Money markets & repo (1/2)

**Source:** Full public article · OnlySOFRs — *The Plumbing, The Basis, and The End of The World (Again)* · https://onlysofrs.substack.com/p/the-plumbing-the-basis-and-the-end · Jan 01, 2026

> Full source text preserved for education. Split only for reading length — not summarized away.

---

## Part 1: Money Markets, Repo, Central Banks, and Leverage Dynamics

**“If you don’t understand the plumbing, you will eventually flush your P&L.”**

The first primer will be a violent awakening for those who think the “Fed Funds Rate” is the only number that matters. We are going to strip the engine block of the financial system down to its pistons: the **Repo Market**. It is the lifeblood of the system, determining the cost of leverage for every asset class from Treasuries to Equities.

### 1. The Hierarchy of Rates: Why “Risk-Free” Isn’t Free

In the textbook world of neoclassical finance, there is a single “risk-free rate” that anchors all asset pricing models. In the real world, the “risk-free” rate is a theoretical abstraction. In the trenches, we deal with a hierarchy of rates determined by credit quality, collateral eligibility, and, most importantly, **regulatory constraints**.

#### The Federal Funds Rate (EFFR)

This is the unsecured overnight rate at which depository institutions (banks) lend reserves to each other. Historically, this was the heartbeat of the system. Today, it is a vestigial organ. The volume in the Fed Funds market has collapsed since 2008 because the banking system is awash in excess reserves (Quantitative Easing). No bank *needs* to borrow fed funds to meet reserve requirements anymore. The market is now dominated by “arbitrage trades” where Federal Home Loan Banks (FHLBs)—who cannot earn interest on reserves at the Fed—lend to foreign banks who *can*. The foreign banks pocket the spread (Interest on Reserve Balances (IORB) minus EFFR). It is a regulatory arbitrage, not a market signal.

#### The Secured Overnight Financing Rate (SOFR)

This is the *real* rate. SOFR is the cost of borrowing cash overnight collateralized by Treasuries. It is a broad measure of the repo market. Unlike EFFR, which is unsecured, SOFR is secured.

* **Theory:** Secured rates (SOFR) should trade *below* unsecured rates (EFFR) because they are safer. If I lend you money and take a Treasury bond as collateral, I have less risk than if I lend to you unsecured.

* **Reality (2025):** SOFR frequently trades *above* EFFR.

* **Why?** **Balance Sheet Constraints.** Lending cash in the repo market requires a bank to expand its balance sheet. Under Basel III leverage ratio rules (SLR), expanding the balance sheet is expensive. Banks demand a premium (higher rate) to rent out their balance sheet.

**The Spread (SOFR - EFFR):** This spread is the single most important barometer of dealer capacity in the modern financial system.

* *Negative Spread:* Cash is abundant, collateral is scarce. This was the regime of 2021-2023, where the Reverse Repo Facility (RRP) balances hit $2.5 trillion because there was nowhere else for cash to go.

* *Positive Spread:* Cash is scarce, collateral is abundant. This is the 2025 regime. In mid-September 2025, we saw SOFR spike to 5.25%, well above the Fed’s target range and the EFFR. This was a “collateral indigestion” event—dealers simply could not absorb the tsunami of Treasury issuance required to fund the deficit.

**Chart image:** https://substackcdn.com/image/fetch/$s_!IRey!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F78732838-be09-49c1-bda9-89d250efbeb8_1662x691.png

### 2. The Repo Machine: Mechanics & Math

Let’s get technical. A Repo (Repurchase Agreement) is a sale of securities coupled with an agreement to repurchase them at a higher price on a future date. The difference in price is the interest.

The Formula:

Repurchase Price = Sale Price × (1 + Repo Rate × Days / 360)

To the dealer, the repo market is a **matched-book** game. They are not in the business of betting on the direction of repo rates; they are in the business of earning the bid-ask spread on liquidity.

1. **The Repo Side:** Dealer borrows cash from a Money Market Fund (MMF) and pledges Treasuries as collateral. (Dealer pays Repo Rate).

2. **The Reverse Side:** Dealer lends that cash to a Hedge Fund and receives Treasuries as collateral. (Dealer receives Reverse Repo Rate).

**The Profit:** The spread between the Reverse Rate (received) and the Repo Rate (paid).

* *Example:* Dealer borrows from MMF at 4.50%. Dealer lends to Hedge Fund at 4.60%. Dealer pockets 10bps.

---

*Series: **OnlySOFRs: plumbing primer** · Part 2 of 9*

[← Previous](/docs/macro/series-onlysofrs-01.md) · [Next →](/docs/macro/series-onlysofrs-03.md)
