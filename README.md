> **Current production policy:** The interface does not generate mock ticks or simulated orders. Connect Deriv for market data and account quotes. Backtesting, simulation journal, copy trading and placeholder academy are unavailable in the interface. The simulator and replay code remain for isolated tests only. Market indicators and predictions are calculations, not verified forecasts; charts group ticks, not time candles. Real-account manual trading and demo-account automation remain experimental and have not been tested against Deriv. The descriptions below may refer to the retained test engine rather than available UI features.

# DerivBot Pro X — experimental simulator

> **Safety review:** Experimental bot execution is available on verified Deriv demo accounts after explicit confirmation. Real-account bot execution remains unavailable. Manual account orders require quote confirmation. Neither account path has been tested against Deriv; local bot limits only cover the current browser session, not the whole account. Credential sync links and follower-token entry remain disabled. See [AUDIT.md](./AUDIT.md). Revoke tokens exposed through old sync links.

The descriptions below are legacy feature claims and should not be treated as verified functionality.

**TraderScheme × Expert Analysis Tool × ProCortex — combined, with ×10 features.**

🎉 **All features are free for personal use. No paid plans, no subscriptions, no paywalls, no locked features.** Some features are experimental or incomplete; copy trading is not implemented and academy lessons are placeholders.

One workspace that connects to **your own Deriv account** and gives you live digit signals, AI predictions, experimental bots, a visual bot builder, a demo-account auto-trader, a backtester, a risk manager, a trading journal, and a 30-chapter academy.

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
5. **Backtester** — replay supported strategies on available local ticks, with illustrative payout and drawdown
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

Your token is kept in page memory by default. To reconnect after a refresh, opt into “Reconnect after refresh in this tab”; an authorized token is stored in browser session storage until disconnect or the browser ends the tab session. Browser session restore or tab duplication may preserve or copy session storage. Scripts and extensions with access to the origin can read it. Disconnect clears the token where storage is available. The app may send it to Deriv's account REST API or to its WebSocket authorization endpoint. Browser extensions and scripts running in the page can still access in-memory credentials. Previously saved `dbx_token` values are removed on initialization where browser storage is available.

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

**Render (recommended):** See [DEPLOY.md](./DEPLOY.md) — Blueprint (`render.yaml`) deploys this static site in ~2 minutes on Render's free tier. No build command needed.

Alternatives: GitHub Pages (Settings → Pages → deploy from branch), Netlify, Vercel, or Cloudflare Pages — just serve the 3 files.

## Deriv API notes

- Endpoint: `wss://ws.derivws.com/websockets/v3?app_id=1089`
- Public app_id `1089` works for the live feed; create your own app at [api.deriv.com](https://api.deriv.com) for production.
- Supported calls: `ticks` (subscribe), `active_symbols`, `authorize`, `proposal`, `buy`, `portfolio`.

## Tests

Run `node tests/safety.test.cjs`, `node tests/websocket.test.cjs` and `node tests/credentials.test.cjs` and `node tests/storage.test.cjs`, and `node tests/markets.test.cjs` for mocked safety, bot, market-data and WebSocket lifecycle checks. These tests do not connect to Deriv or certify account trading.

## Bot simulator updates

MACD crossover, Bollinger squeeze, cold-digit Differs, Over 1/Under 8 and parity-streak reversal use distinct experimental decision rules. The builder applies its RSI, Martingale and three-loss-stop blocks in simulation and replay. Presets that share a scan are labeled; unfinished strategies cannot silently execute another strategy. Scores and simulated payouts are not evidence of profitability. Real-account automated trading remains unavailable; verified demo accounts can use the experimental bot flow after confirmation.

Fibonacci, Oscar-style cycle and three-win Paroli sizing are available in the simulator and replay. Each uses the frequency-scan entry signal; the sizing policies do not guarantee recovery. Replay shows the first 30 simulated trades and why it stopped. An optional chronological comparison independently replays each half with its own 100-tick warm-up and fresh balance; it does not tune parameters or prove an edge.

The experimental Digit Transition Ensemble blends recent digit parity with transitions and uses RSI as a filter. One-Tick Momentum uses one-tick simulated contracts and defaults to the Volatility 100 (1s) symbol. Replay respects each strategy’s duration. The local mock feed is not a real-time 1-second feed, model scores are not calibrated probabilities, and neither strategy has been validated for trading.

## Prediction evaluation

The experimental digit model logs at most one prediction per observed symbol tick and resolves it on the next accepted tick for that symbol. Pending predictions expire across feed changes or reloads. The evaluation view separates simulated and Deriv data and reports hit rate and multiclass Brier score for up to 200 recent log entries. Scores are uncalibrated model outputs, not guarantees; live tick ordering has not been integration-tested.

The experimental multi-market scanner compares observed Over 1 and Under 8 frequencies across the simulator’s markets. Replay requires aligned mock buffers and does not support multi-market live-feed history. Frequency rankings do not account for contract prices and are not evidence of an edge.

The Half-Kelly Simulator uses half of the Kelly fraction from an uncalibrated historical strategy score and the simulator’s fixed hypothetical payout. The base stake is a cap and other simulation guards still apply. It is not based on Deriv quotes, does not establish a positive expected return, and is not suitable for account trading.

## Experimental Deriv demo bot

Connect a verified Deriv demo account, select a supported strategy and review the confirmation before starting. The bot requests a quote, places at most one account contract at a time, and waits for settlement. Stop cannot cancel a submitted or open contract. Session limits do not include activity outside this browser; multi-market and half-Kelly modes are simulator-only. This path has only mocked tests and has not been tested against Deriv. Check the official account history.

Bot settings can be exported and imported as JSON on the Connect page. The export deliberately excludes token and order fields; review configuration names and contents before sharing. Old credential-bearing sync links should be treated as compromised.

### Public Deriv connectivity smoke test

With Node.js 22 or later and network access to Deriv, run `node scripts/check-deriv-public.cjs`. Set `DERIV_APP_ID` and optionally `DERIV_SYMBOL` as environment variables if needed. The test subscribes to one public tick, reports its quote and precision metadata, and sends no credentials or orders. It does **not** test authorization, buying, settlement, or the app's full integration. The sandbox used for development could not connect to Deriv, so a successful live run remains outstanding.

When connected, the app requests Deriv’s active-symbol list and lists supported symbol codes returned by the service and subscribes to additional markets when selected. Charts group observed live ticks and are not Deriv time-based candle charts. Signals are local calculations, not official Deriv signals. A failed discovery blocks account quotes and can be retried by reconnecting. Subscription failures remove the affected market for that session; reconnect to retry. API behavior still requires live verification.

The next-digit model uses a smoothed recent-frequency prior and past observed transitions. Its score is an uncalibrated model estimate, not a Deriv quote or reliable probability. The evaluation separates model versions and compares Brier score with a uniform baseline; small samples are unreliable and past results do not establish future performance.

Manual account orders recheck the current local balance, stake cap, account and market after quote confirmation; quotes held longer than 30 seconds require a new request. These browser-side checks do not account for activity on other devices and cannot guarantee loss protection.

The manual trade page can request a read-only snapshot of Deriv open positions. It is not a live subscription, complete account history or settlement reconciliation; refresh it and verify in Deriv. An empty snapshot never clears an uncertain-buy warning.

Demo bot sessions show win rate and profit factor from their locally tracked settlements. A minimum quoted win profit can reject small-payout quotes; it does not establish an edge or cap losses. Some presets share strategies; the simulator-only Kelly and multi-market presets cannot run in real-data mode. All bot execution and profitability remain unverified against Deriv.

Bot strategy fixtures test preset wiring and deterministic signal behavior; they do not establish profitability. Direction scores include flat observed ticks and are not five-tick win-rate estimates. Builder flows require exactly one buy action.

The trade screen can request read-only pages of up to 100 account transactions each and show matches to locally tracked contract IDs. It does not reconcile settlements or clear uncertain orders; check full history in Deriv. Demo bot session statistics include average win, loss and result per locally tracked settlement, not a future-return prediction.

Statement pages share an end-time cutoff, but offsets may still shift as account history changes. Corrupted local order or contract records raise a warning and block new orders until verified and acknowledged.

Demo Over/Under Sniper has an opt-in quote search for a user-set positive minimum potential profit. It checks up to 18 candidates meeting the strategy score filter, in observed-frequency order and may buy the first quote meeting the minimum; it stops if none qualifies. Observed scores are not forecasts, and this does not establish that expected returns or win rates improve. A six-candidate search was tried on a demo account; the expanded search has not been verified live. Searches may stop on errors, stale data or after 10 seconds.

An opt-in automatic demo start can arm the current settings for one session in the current tab, for up to eight hours. It waits for the matching demo account and verified live ticks; consent is consumed before starting. It does not automatically start a second session after a stop or disconnect. Tab duplication/session restoration can copy sessionStorage, so avoid duplicating an armed tab. The tab must remain open, controls are local and broker integration remains experimental.

Expanded quote-search behavior invalidates any previously armed demo auto-start consent; arm again after reviewing the new limit.
