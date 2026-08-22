# θ is not free money (2/2) — risk premium & ATM θ=γ

**Source:** Full thread · [@bennpeifert](https://x.com/bennpeifert) · [1572019785797603328](https://x.com/bennpeifert/status/1572019785797603328) · 2022-09-20

**Also:** Common VRP Discussions → https://www.qvradvisors.com/research

> Full source text preserved for education. Split only for reading length — not summarized away.

---

**9/** either you are continually locking these losses in via dynamic hedging, or you are just ignoring them and accumulating delta and vega risk in an adverse direction, effectively betting double or nothing that the adverse moves will revert

**10/** just selling a naked call and letting it ride is an example of the latter; if the stock spikes, you get short delta; if it falls back again, you feel smart, but if it keeps running, you lose money faster and faster

**11/** the market prices these factors at every point in time: gamma is more valuable when volatility is high, because the amount of positive pnl that a long option position earns from gamma is proportional to dx^2

**12/** the net pnl stream from selling an option for theta will depend on the magnitude of these countervailing factors. if the market is charging too much for gamma, vanna and volga, then theta on a short position will steadily exceed the realized losses on those exposures

**13/** most of the time you should expect a slight risk premium, but only a tiny fraction of overall theta

**14/** that fraction may or may not be smaller than your transaction costs in options markets as an individual

**15/** also don't forget to consider vol rolldown / rollup... a short OTM put position will usually have theta that far exceeds its realized decay rate, even with no underlying moves, because implied vol goes higher and higher for very short dated crash puts of the same strike

**16/** obviously i am hinting at other uses of this taylor expansion here :)

**Correction:** * "pit" is obviously "put" above in "your short downside put position..."

**Credentials media:** https://pbs.twimg.com/media/FdDxOE1agAAgmLl.jpg

**Follow-up:** and "i'll just get assigned, i wanted to buy the stock there anyway" does not get you out of any of this. a naive hold to maturity analysis of a short option position can give rise to sloppy, illogical conclusions. please read Common VRP Discussions, here

https://www.qvradvisors.com/research

### Related Benn note (ATM θ vs γ PnL)

**Post:** [2008965329561768420](https://x.com/bennpeifert/status/2008965329561768420) · 2026-01-07

for a roughly at-the-money option with no higher order convexity, theta decay is equal to the market's expectation of gamma PNL from moves in the underlying spot price, regardless of time to maturity

the actual logic behind this graph is different >>

---

---

*Series: **θ is not free money** · Part 2 of 2*

[← Previous](/docs/options/series-theta-not-income-01.md)
