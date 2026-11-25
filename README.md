# DerivBot Pro X — 100% FREE All-in-One Deriv Trading Platform

**TraderScheme × Expert Analysis Tool × ProCortex — combined, with ×10 features.**

🎉 **All features are free for personal use. No paid plans, no subscriptions, no paywalls, no locked features.** Every bot, signal, AI tool, auto-trader, copy-trading slot, backtest and course is unlocked from day one.

One workspace that connects to **your own Deriv account** and gives you live digit signals, AI predictions, 12 bots, a visual bot builder, a 96-indicator auto-trader, copy trading, a backtester, a risk manager, a trading journal, and a 30-chapter academy.

> ⚠️ Trading involves risk of loss. This is a third-party tool, not affiliated with Deriv Ltd. Past performance and displayed win rates do not guarantee future results. Never trade money you cannot afford to lose.

---

## What was combined

| Source | Features brought in |
|---|---|
| **TraderScheme** | Free bot library, Smart AI Recovery, Speedbot, Pro Charts (50+ indicators), visual Bot Builder, copy trader, 30-chapter course, Deriv login |
| **Expert Analysis Tool** | Live Over/Under, Even/Odd, Matches/Differs win-rate signals, Rise/Fall bias, Deriv OAuth, courses, copy trading |
| **ProCortex** | Live market monitor, probability distributions, digit transition analysis, 96-indicator auto-trader, in-browser AI prediction engine, copy trading (100 accounts), trading journal |

## ×10 additions (new in this build)

1. **Signal Scanner** — ranks every symbol by statistical edge
2. **Transition Matrix** — P(next digit | current digit) heatmap
3. **D-Circles** — visual digit frequency distribution
4. **Streak & Gap counters** — hot/cold digits, current streaks
5. **Backtester** — test any bot on 1,000 historical ticks with drawdown
6. **Risk Manager** — daily loss limit, max stake %, Kelly position sizing, equity curve
7. **AI Prediction Engine** — Markov + frequency model, runs in-browser, calibration log
8. **Speedbot mode** — reacts every tick with confidence gating
9. **Drawdown guard + Smart AI Recovery** — Martingale / D'Alembert / AI recovery modes
10. **Live ticker tape + alerts** — all symbols streaming, session P/L tracking

## Pricing

**$0 forever.** This build is for personal use — there are no paid plans, tiers, or locked features. The only cost is your own Deriv account (trading happens through your account via Deriv's official API).

---

## Run it

No build step, no dependencies. Any static server works:

```bash
# Python (included on most systems)
python3 -m http.server 8000
# then open http://localhost:8000

# or Node
npx serve .
```

The app works **immediately in demo mode** — a simulated Deriv feed streams live ticks so you can explore every feature with zero setup.

## Connect your Deriv account

1. Log in at [app.deriv.com](https://app.deriv.com)
2. Go to **API Token** and create a token (tick *Trade* + *Accounts read*)
3. Open the app → **Connect Deriv** → paste your App ID (default `1089`) and token → **Connect & Authorize**

Your token is stored only in your browser (`localStorage`) and sent only to Deriv's official WebSocket API (`wss://ws.derivws.com/websockets/v3`). We never see your password.

You can also use **Continue with Deriv (OAuth)** — the link on the Connect page opens Deriv's secure authorization flow.

## Views

- **Dashboard** — hero, live snapshot, top signals, session P/L, reviews
- **Market Monitor** — watchlist, candlestick/line/area chart, 50+ indicators
- **Digit Analysis** — frequency, Over/Under, Even/Odd, Matches/Differs, Rise/Fall, transitions, streaks, D-Circles, distribution
- **Live Signals** — scanner ranked by edge across all symbols
- **Manual Trade** — digit & Rise/Fall contracts, proposals, open contracts, portfolio
- **Bot Library** — 12 strategies (Apex, Speedbot, Over/Under Sniper, Martingale, D'Alembert, Boom/Crash, Step, RSI, D-Circles…)
- **Bot Builder** — click-to-add visual blocks → generates strategy logic
- **Auto-Trader** — confidence gating, TP/SL, recovery modes, full trade log with reasoning
- **Copy Trading** — follower tokens with per-token stake/symbol limits (up to 100, free)
- **AI Prediction** — next-digit distribution + auditable prediction log
- **Backtester** — win rate, P/L, max drawdown, equity curve
- **Risk Manager** — guards, Kelly calculator, equity curve
- **Journal** — settled contracts, CSV export
- **Academy** — 30 chapters with progress tracking
- **Connect Deriv** — API token, OAuth

## Files

```
index.html   — app shell & all views
style.css    — dark trading-terminal theme
app.js       — Deriv WebSocket client, mock feed, indicators, digit engine,
               signals, bots, auto-trader, AI, backtester, risk, journal
```

## Deploy

Push to GitHub and enable **GitHub Pages** (Settings → Pages → deploy from branch), or drop the 3 files on Netlify/Vercel/Cloudflare Pages. No build command needed.

## Deriv API notes

- Endpoint: `wss://ws.derivws.com/websockets/v3?app_id=1089`
- Public app_id `1089` works for the live feed; create your own app at [api.deriv.com](https://api.deriv.com) for production.
- Supported calls: `ticks` (subscribe), `active_symbols`, `authorize`, `proposal`, `buy`, `portfolio`.
