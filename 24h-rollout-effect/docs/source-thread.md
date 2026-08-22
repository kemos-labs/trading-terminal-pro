# Source thread archive

The hypothesis tested in this repository was published as a thread by
Robot James (@therobotjames). The text is reproduced below for research
documentation, since threads get deleted and links rot; copyright remains
with the author.

- Author: [Robot James (@therobotjames)](https://x.com/therobotjames)
- Thread root: https://x.com/therobotjames/status/2080281157246259663
- Published: 2026-07-23 13:17 UTC
- Companion article (paywalled beyond the introduction):
  https://robotjames.substack.com/p/a-truly-idiotic-crypto-trade
- Retrieved 2026-07-23 via threadreaderapp.com and api.fxtwitter.com

The refined strategy referenced in the final tweet (607 trades, over 900%)
is behind the article paywall and its rules are not public. Section 5 of
the [README](../README.md) covers what can and cannot be concluded about it.

---

## Thread (22 tweets, verbatim)

1. idiot edge. sometimes edges appear due to other trader's stupidity. i'll show you a crypto trade that is so silly you might not believe it. but i promise you it's real.

2. it's best to read the article here: [robotjames.substack.com/p/a-truly-idiotic-crypto-trade]. i'll first give you some background and general examples. then i'll get onto the crypto trade.

3. trading edge usually comes from doing things other people don't want to do. or taking advantage of forced trading. sometimes, tho, it comes from people being dumb.

4. before twitter's ipo, people wanting to buy twitter accidentally bought shares in tweeter home entertainment (TWTRQ), a bankrupt electronics retailer. whoops. it went up 700%

5. when elon tweeted "use signal", people wanting to buy signal shares bought shares in signal advance (SIGL), a medical device manufacturer. whoops. it went up over 6000%

6. you probably couldn't have anticipated this. but, if you see a sudden rise in an unrelated company whose name or ticker resembles something in the news, there's a potential short bet there.

7. similarly, when a celebrity or politician says something interesting, someone often creates a memecoin with a related name. traders often pile into it, maybe assuming an official connection.

8. it goes up a lot, then the creators and early holders dump on new buyers. it's historically been possible to trade this short-lived attention cycle. but you need to get in early and get out early.

9. pros sometimes do dumb things too. especially when liquidity is thin. a junior trader might quote overnight markets with an obviously bad fit. or a market maker might mismodel an index change or acquisition.

10. you have to be good to detect this tho. i want to show you trades that you don't have to be good to do. things you could trade with a potato. crypto is (still) full of these. here's an example...

11. most crypto exchanges display the change in price of an asset over the last 24h *everywhere*. changes in this number drive predictable (irrational) trader behaviour. and changes in this number are *predictable*.

12. because we know what happened in the last 24 hours. lemme explain. that number is calculated as the % difference in the price right now vs the price 24 hours ago.

13. there are two things that drive changes in that: 1. what price is going to do in the future (we can't predict this) 2. what price did in the past (we *know* this)

14. as i'm writing this, BNB is showing -0.25% 24h return. that calculation is represented by the yellow arrow on the chart here [image: BNB chart with yellow arrow spanning the 24h window]

15. as time passes, that yellow line is gonna shift to the right. the market went up from the starting point of our arrow. so we know that, all things being equal, the 24h return is going to look worse over time.

16. the opposite is true when we know the price went down. our starting price gets more attractive (from the point of view of the 24h return calculation) so, all things being equal, the 24h return is going to look better over time.

17. if price went up from its price exactly 24 hours ago, we know the 24h return is likely to decrease, making the asset look less attractive to crypto idiots. if price went down, we know the 24h return is likely to increase, making the asset more attractive to said morons.

18. > do people *really* trade irrationally based on highly predictable changes in that number? yeah. they really do. here's a simple costless "backtest" to show it.

19. for each non-stablecoin usdt-perp on binance we: - look at last 24 1h candles - find the biggest green candle, and short the thing 24 hours later, closing after an hour - find the biggest red candle, and long the thing 24h later, closing after an hour

20. it's a real effect. people really are that dumb. but the average daily return of that is 0.08% and trading like that would have you turning over every hour. so there's no way you could trade that. you would [lose] massive amounts of money on trading costs.

21. to make a real trading strategy we need to do one or some or all of the following: - take better trades (or skip the bad ones) - reduce the turnover of the strategy (hold longer, stop flipping) - restrict the tradeable universe - and design something you can actually manage.

22. in the article i show you how to do this. and show you a simple strategy that you can trade with any simple screener and your mouse. it would have traded 607 times over the last 4 years and made over 900% return on initial capital if you bet full stack on each bet.
