# θ is not free money (1/2) — convexity & Taylor

**Source:** Full thread · [@bennpeifert](https://x.com/bennpeifert) · [1572019785797603328](https://x.com/bennpeifert/status/1572019785797603328) · 2022-09-20

> Full source text preserved for education. Split only for reading length — not summarized away.

---

**1/** ok. as requested.

an option's theta (theoretical rate of decay over time) is not just "income" to an investor holding a short position.

it is compensation for the risk of loss that investor faces from negatively asymmetric exposure to moves in the underlying asset.

**2/** Theta Gang and option guru charlatans would have you believe that theta is a form of alpha, or free money for true believers.

but options are convex instruments with asymmetric payoffs - buyers can make a lot more than they are risking to lose, and vice versa.

**3/** when you hold a negatively asymmetric position, any large move causes a loss. if the underlying moves in a favorable direction, you benefit less and less from it; if it moves against you, you lose more and more, fast

**4/** we can write the value of an option as:

V(x, t, v)

where x is the price of the underlying, t is time, v is implied volatility, and V(.) is a standard option pricing method (eg Black-Scholes or a lattice/trinomial tree)

**5/** its change over one unit of time via a second order Taylor expansion as

dV(x, t, v) = dV/dt  
+ dV/dx * dx  
+ dV/dv * dv  
+ 0.5 * d2V/dx^2 * dx^2  
+ 0.5 * d2V/dv^2 * dv^2  
+ dv2/dvdx * dvdx

**6/** = theta  
+ delta * dx  
+ vega * dv  
+ 0.5 * gamma * dx^2  
+ 0.5 * volga * dv^2  
+ vanna * dx * dv

if you are short this option, you will earn the theta decay over time, but you are paying the piper on the other side: every time the stock moves materially you lose money on gamma

**7/** if the option is away from the money, it will have meaningful volga (volatility gamma), and every time implied volatility moves significantly, you lose to that too

**8/** it may similarly have vanna (or skew) exposure; your short downside put position may lose money as a result of spot falling and implied volatility rising, for example

---

*Series: **θ is not free money** · Part 1 of 2*

[Next →](/docs/options/series-theta-not-income-02.md)
