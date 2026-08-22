# OnlySOFRs (4/9) — Treasury basis (1/2)

**Source:** Full public article · OnlySOFRs — *The Plumbing, The Basis, and The End of The World (Again)* · https://onlysofrs.substack.com/p/the-plumbing-the-basis-and-the-end · Jan 01, 2026

> Full source text preserved for education. Split only for reading length — not summarized away.

---

## Part 2: The Treasury Basis (NOT AGAIN) – Arbitrage, Options, and Deliverables

**“Arbitrage is the art of picking up pennies in front of a steamroller. The Basis Trade is picking up nickels in front of a nuclear blast.”**

If Part 1 was about how you fund the trade, Part 2 is about the trade itself. The Treasury Cash-Futures Basis is the single most important arbitrage relationship in the world. It links the spot market (Cash Treasuries) to the forward market (Futures). It is the mechanism by which the massive US debt load is distributed to the world.

### 1. The Physics of the Basis

The **Basis** is simply the difference between the spot price of a bond and the price implied by the futures contract.

Basis = P_Cash − (P_Futures × Conversion Factor)

Why isn’t it zero? If markets were efficient and frictionless, you would expect the basis to be zero. But it’s not.

1. **Carry:** You hold the bond (earn coupon) and finance it (pay repo). The futures holder puts up no cash (except margin) and earns no coupon. The futures price must be lower to compensate for this “Negative Carry” (in a normal yield curve).

2. **Delivery Options:** The futures seller (“the short”) has the right to choose ***which*** bond to deliver (from a basket) and ***when*** to deliver it. These options have value. The short will only sell the futures contract at a price that compensates them for giving up these options.

Therefore:

Futures Price = Adjusted Spot Price − Value of Options

The Basis is essentially the sum of the **Cost of Carry** and the **Option Value**. If the basis is trading “rich” (high), it means the options are expensive or carry is positive. If the basis is “cheap” (low), it means the options are cheap or carry is negative.

### 2. The Conversion Factor & The CTD

The Chicago Board of Trade (CBOT) uses **Conversion Factors (CF)** to make different bonds “equal.” A CF of 1.0 means the bond approximates a 6% coupon bond.

* If yields are > 6%, long-duration (low coupon) bonds tend to be **Cheapest to Deliver (CTD)**.

* If yields are < 6%, short-duration (high coupon) bonds tend to be CTD.

**The CTD Switch:**

This is critical. If yields move significantly, the identity of the CTD bond can change.

* *Example:* Bond A is CTD. Yields rise. Bond B (higher duration) drops in price faster than Bond A. Bond B becomes the new CTD.

* The futures contract tracks the *new* CTD (Bond B).

* The short position gains (futures price drops more than the bond they held).

* This “Switch Option” acts like a put option on the market. It makes the futures contract convex. The “short” owns this convexity. The “long” is short this convexity.

### 3. The Basis Trade (The “Widowmaker”)

Hedge funds put on the **Long Basis** trade:

* **Long:** Cash Treasury (CTD).

* **Short:** Treasury Future.

* **Financing:** Repo the Cash Treasury.

**The Math:**

You buy the bond. You short the future. You lock in the spread. If held to delivery, the prices must converge. It looks like “risk-free” profit.

* *Profit:* (Basis at entry) − (Carry cost over holding period).

* *Leverage:* Since the spread is tiny (e.g., 5/32nds), you lever it 50x.

**The Risk (2025 Edition):**

The risk is Funding Liquidity.

* You own $50 billion of Treasuries. You need to roll the repo every night.

* Suddenly, Repo rates spike (Part 1). Your “carry cost” explodes.

* Simultaneously, Treasuries **RALLY**. You lose money on the Futures Short. You get a margin call from the exchange (CME). You need cash *today*. You try to repo your bonds to get cash. But the repo market is tight. Haircuts increase.

* You are forced to sell the Cash Treasuries to meet the Futures margin call. Selling drives Cash prices down. Futures prices stay sticky. The Basis **WIDENS** against you. You blow up.

---

*Series: **OnlySOFRs: plumbing primer** · Part 4 of 9*

[← Previous](/docs/macro/series-onlysofrs-03.md) · [Next →](/docs/macro/series-onlysofrs-05.md)
