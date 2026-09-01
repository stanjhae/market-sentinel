# Market Sentinel — Product & Technical Specification

Version: 1.0
Primary user: single trader / builder
Initial broker/data source: eToro Public API
Primary instruments: US30, US100, SPX500, Gold
Initial timeframes: 15m, 1h, 4h
Primary goal: continuously watch the market, identify high-quality trading opportunities, explain the setup, enforce risk/psychology rules, and build a high-quality dataset of the user's trading edge.

---

## 1. Product thesis

Market Sentinel is a personal market-intelligence and trading-discipline platform. It is not initially an autonomous trading bot.

The system should continuously ingest live and historical market data, maintain multi-timeframe market state, detect defined setup patterns, score opportunities, and notify the user when a market deserves attention.

The system must explicitly separate three concepts:

1. Market opportunity exists.
2. Entry confirmation exists.
3. Trade is allowed by risk and psychology rules.

A high setup score must never automatically mean "enter now".

The product should answer four questions at all times:

- Where is the market? — higher-timeframe regime and important levels.
- What is happening? — structure, volatility, breakout, sweep, trend, pullback, consolidation.
- Is there a valid entry? — lower-timeframe confirmation and reward/risk.
- Am I allowed to trade it? — risk budget, cooldowns, loss limits, event blackouts, psychology gate.

Long-term, Market Sentinel should become a personal trading research platform that can quantify exactly which conditions the user trades profitably.

---

## 2. Product principles

### 2.1 Deterministic before AI
All signals, indicators, scores, risk calculations, and order plans must be generated deterministically from code and market/account data.

An LLM may summarize or explain evidence, but must not be the source of truth for:

- indicator values
- support/resistance levels
- risk calculations
- position sizing
- signal state
- account balances
- stop-loss or target mathematics

### 2.2 Explain every signal
Every signal must include structured evidence showing exactly why it exists.

Example:

- 4H regime: bearish correction
- 1H structure: lower high + lower low
- 15m: support break and failed retest
- RSI(14): 43 and declining
- Distance from resistance: 0.18 ATR
- Available R:R to next support: 2.4R
- News blackout: clear

### 2.3 No live autonomous trading in MVP
The first production version is read-only with respect to live-money execution.

The application may:

- read live market data
- read account and portfolio data
- generate trade plans
- journal eToro trades
- optionally execute in eToro Demo mode in a later phase

Live-money order placement must remain disabled until explicitly implemented as a separate milestone with additional safety controls.

### 2.4 Capital protection beats signal frequency
The product should prefer missing a trade over generating noisy signals.

### 2.5 Auditability
Every market state, signal transition, alert, trade plan, and risk decision must be reconstructable from stored data and logs.

---

## 3. Target user and primary use case

The initial application is single-user and personal.

The user trades CFDs primarily on:

- US30 / DJ30
- US100 / NASDAQ 100
- SPX500 / S&P 500
- Gold

Typical workflow:

1. Market Sentinel runs continuously.
2. User does not need to stare at TradingView all day.
3. Sentinel detects a developing setup.
4. User receives a phone/desktop alert.
5. User opens the market-detail page.
6. System shows 4H / 1H / 15m context and evidence.
7. Signal remains WATCHING until entry confirmation occurs.
8. User opens the Trade Gate.
9. System calculates maximum loss and position constraints from current eToro balance.
10. User confirms the psychology and execution checklist.
11. User executes manually on eToro in MVP.
12. Market Sentinel detects/imports the position and begins tracking it.
13. Trade closes and is automatically journaled.
14. User records post-trade notes and emotional state.
15. Analytics update expectancy, setup performance, discipline metrics, MAE/MFE, and instrument/session statistics.

---

## 4. Current eToro integration assumptions

The implementation must use the current official eToro API specification rather than hard-coding undocumented routes.

Known integration facts as of this specification:

- REST base URL: `https://public-api.etoro.com/api/v1/`
- WebSocket endpoint: `wss://ws.etoro.com/ws`
- Authenticated REST requests use `x-api-key` and `x-user-key` headers.
- Use a unique `x-request-id` for every request.
- WebSocket authentication uses the user key and API key.
- Market data supports instrument discovery, current rates, candles, historical data, and real-time streaming.
- Real and Demo Trading APIs exist and share the same general shape.
- Portfolio/account APIs can provide account and position context.

### Mandatory Cursor/eToro MCP setup

Create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "etoro-public-api": {
      "url": "https://mcp.public-api.etoro.com"
    }
  }
}
```

Cursor must use the MCP tools `get-all-routes` and `get-route-spec` to resolve the live eToro route schemas before implementing any eToro endpoint.

Do not invent eToro routes or request/response fields from memory.

---

## 5. Scope

### Phase 1 — Market intelligence MVP

Must ship:

- eToro authentication and API health check
- instrument discovery and canonical mapping
- REST historical candle backfill
- WebSocket live price ingestion
- 15m / 1h / 4h candle state
- indicator engine
- support/resistance engine
- multi-timeframe regime engine
- four initial setup detectors
- signal lifecycle/state machine
- opportunity score
- dashboard
- market-detail page
- alerts
- read-only eToro account sync
- Trade Gate
- trade journal
- core analytics
- persistent audit log

### Phase 2 — Research and replay

- historical signal reconstruction
- strategy backtesting
- candle replay mode
- per-setup statistics
- parameter versioning
- MAE/MFE analytics
- walk-forward testing

### Phase 3 — Demo execution

- create orders only on eToro Demo
- order preview
- explicit user confirmation
- stop/target management
- reconciliation loop
- execution audit trail

### Phase 4 — Optional assisted live execution

Out of MVP scope.

If implemented later:

- disabled by default
- explicit settings unlock
- hard daily and per-trade limits enforced server-side
- confirmation step on every live order
- no martingale
- no automatic risk escalation
- no fully autonomous live trading initially

---

## 6. Non-goals for MVP

Do not build:

- social trading features
- copy trading
- public user accounts
- autonomous live-money trading
- machine-learning price prediction
- "AI predicts next candle" functionality
- options analytics
- crypto support
- arbitrary user-defined strategy scripting
- broker abstraction for multiple brokers
- automatic algorithmic trendlines
- a full TradingView clone

---

## 7. Core domain model

### 7.1 Instrument

Fields:

- id
- etoroInstrumentId
- canonicalSymbol
- displayName
- assetClass
- pricePrecision
- enabled
- metadataJson
- createdAt
- updatedAt

Never hard-code eToro instrument IDs. Resolve them from the official instrument-search API and persist the mapping.

### 7.2 Candle

Fields:

- instrumentId
- timeframe: `15m | 1h | 4h`
- openTimeUtc
- closeTimeUtc
- open
- high
- low
- close
- volume nullable
- source: `ETORO_REST | ETORO_STREAM_AGGREGATED`
- isFinal
- revision

Unique key: `(instrumentId, timeframe, openTimeUtc)`.

Store all timestamps UTC.

### 7.3 IndicatorSnapshot

- instrumentId
- timeframe
- candleOpenTime
- rsi14
- atr14
- ema20
- ema50
- ema200
- bbBasis20
- bbUpper20x2
- bbLower20x2
- bbWidth
- trueRange
- rollingVolatility
- createdAt

### 7.4 PriceZone

Represents horizontal support/resistance as a zone, not a single exact price.

- id
- instrumentId
- timeframe
- type: `SUPPORT | RESISTANCE | BOTH`
- source: `AUTO_PIVOT | USER_MANUAL | PRIOR_DAY | PRIOR_WEEK | PSYCHOLOGICAL`
- lowerBound
- upperBound
- midpoint
- strengthScore
- touchCount
- lastTouchedAt
- status: `ACTIVE | BROKEN | FLIPPED | EXPIRED`
- metadataJson

### 7.5 MarketRegime

- instrumentId
- timeframe
- timestamp
- trend: `STRONG_BULL | BULL | RANGE | BEAR | STRONG_BEAR`
- structure: `HH_HL | LH_LL | MIXED`
- volatility: `LOW | NORMAL | HIGH | EXTREME`
- location: `AT_SUPPORT | AT_RESISTANCE | MID_RANGE | EXTENDED_UP | EXTENDED_DOWN`
- confidence 0-100
- evidenceJson

### 7.6 Signal

- id
- instrumentId
- strategyKey
- strategyVersion
- direction: `LONG | SHORT | NEUTRAL`
- state
- detectedAt
- confirmedAt nullable
- invalidatedAt nullable
- expiredAt nullable
- score 0-100
- confidenceLabel
- entryZoneLow nullable
- entryZoneHigh nullable
- invalidationPrice nullable
- target1 nullable
- target2 nullable
- target3 nullable
- riskRewardToT1 nullable
- riskRewardToT2 nullable
- evidenceJson
- snapshotJson

Signal states:

`DETECTED -> WATCHING -> CONFIRMED -> TRADE_PLANNED -> ENTERED -> CLOSED`

Terminal alternatives:

`INVALIDATED | EXPIRED | DISMISSED`

No direct jump from DETECTED to ENTERED.

### 7.7 TradePlan

- id
- signalId
- accountSnapshotId
- direction
- entryType: `MARKET | LIMIT | STOP`
- plannedEntry
- stopLoss
- target1
- target2
- target3
- riskPct
- riskAmountUsd
- estimatedPositionSize
- expectedR
- gateStatus
- createdAt
- approvedAt nullable

### 7.8 BrokerTrade

Normalized read model for eToro trade/position history.

- id
- etoroPositionId/orderId where available
- instrumentId
- direction
- openedAt
- closedAt nullable
- openPrice
- closePrice nullable
- units
- investedAmount
- leverage nullable
- stopLoss nullable
- takeProfit nullable
- realizedPnl nullable
- fees nullable
- sourceAccount: `REAL | DEMO`
- rawBrokerPayloadJson

### 7.9 TradeJournalEntry

- id
- brokerTradeId nullable
- tradePlanId nullable
- signalId nullable
- setupKey nullable
- thesisText
- preTradeEmotion
- postTradeEmotion
- followedPlan boolean
- ruleBreaksJson
- maxAdverseExcursion
- maxFavorableExcursion
- resultR
- notes
- screenshotUrl nullable
- tagsJson

### 7.10 RiskProfile

Initial defaults:

- maxRiskPerTradePct: 1.0
- maxDailyLossPct: 3.0
- maxConsecutiveLosses: 2
- cooldownAfterLossMinutes: 15
- minimumRewardRisk: 2.0
- maxConcurrentCorrelatedPositions: 1
- prohibitRiskIncreaseAfterLoss: true
- prohibitMartingale: true

All risk rules must be enforced on the server, not merely displayed in the UI.

### 7.11 AccountSnapshot

- timestamp
- accountType: REAL | DEMO
- equity
- cash
- availableCash
- invested
- unrealizedPnl
- realizedDailyPnl
- openPositionCount
- rawPayloadJson

---

## 8. Market data ingestion

### 8.1 Instrument bootstrap

On first startup:

1. Query eToro instrument discovery via route resolved from MCP.
2. Search for configured symbols/names.
3. Persist canonical mapping.
4. Refuse to start signal generation if an enabled instrument cannot be resolved unambiguously.

Initial configuration:

```ts
const WATCHLIST = ["US30", "US100", "SPX500", "GOLD"];
```

Canonical application symbols may differ from eToro naming. The mapping layer handles this.

### 8.2 Historical backfill

For each enabled instrument:

- fetch enough historical candles to warm all indicators and market-structure calculations
- minimum desired history: 500 candles per timeframe
- backfill 15m, 1h, 4h independently if eToro exposes these intervals
- if a required interval is not directly supported, derive it from the nearest lower interval

Persist idempotently.

### 8.3 Live stream

Use the eToro WebSocket stream for instrument topics.

Requirements:

- authenticate after connect
- subscribe only to enabled instruments
- heartbeat/health state
- automatic exponential-backoff reconnect with jitter
- resubscribe after reconnect
- deduplicate events
- record last event timestamp per instrument
- detect stale stream

### 8.4 Candle builder

Aggregate tick/quote data into local in-progress candles.

Requirements:

- deterministic UTC bucket boundaries
- emit `CANDLE_UPDATED` events for partial candle updates
- emit `CANDLE_CLOSED` once per finalized candle
- reconcile finalized local candles against eToro REST periodically
- if material discrepancy occurs, prefer official REST final candle and increment revision

Never use a still-open candle as though it were finalized in backtests.

### 8.5 Event bus

Internal domain events:

- MARKET_TICK_RECEIVED
- CANDLE_UPDATED
- CANDLE_CLOSED
- INDICATORS_UPDATED
- REGIME_UPDATED
- ZONE_UPDATED
- SIGNAL_DETECTED
- SIGNAL_STATE_CHANGED
- ALERT_TRIGGERED
- ACCOUNT_SYNCED
- POSITION_OPENED
- POSITION_UPDATED
- POSITION_CLOSED
- RISK_LIMIT_HIT

Use BullMQ/Redis or an equivalent durable queue for asynchronous jobs.

---

## 9. Indicator engine

Implement indicators in a pure TypeScript package with no network/database dependencies.

Initial indicators:

- RSI 14 using Wilder smoothing
- ATR 14 using Wilder smoothing
- Bollinger Bands 20, 2 standard deviations
- EMA 20
- EMA 50
- EMA 200
- rolling high/low
- candle body size
- upper/lower wick ratio
- rolling average true range
- distance from EMA expressed in ATR
- distance from zone expressed in ATR

Indicator functions must be deterministic and unit tested against known fixture values.

---

## 10. Market structure engine

### 10.1 Pivot detection

Use confirmed swing pivots.

Configurable default:

- leftBars = 3
- rightBars = 3

A pivot is not confirmed until `rightBars` future candles exist. This avoids lookahead bias in live/backtest parity.

### 10.2 Structure classification

Using confirmed pivots, classify:

- Higher High
- Higher Low
- Lower High
- Lower Low
- Equal High / Equal Low within tolerance

Derive regime:

- HH + HL sequence => bullish structure
- LH + LL sequence => bearish structure
- conflicting sequence => mixed/range

### 10.3 Horizontal zone generation

Create zones from clusters of pivot highs/lows.

High-level algorithm:

1. gather recent confirmed pivot prices
2. cluster pivots if price difference <= configured ATR fraction
3. compute zone midpoint and width
4. strength increases with:
   - number of independent touches
   - touches across multiple timeframes
   - recency
   - reaction magnitude after touch
5. strength decreases after repeated weak touches or decisive break

A break requires close beyond zone plus minimum ATR penetration. A wick alone should not mark a zone broken.

### 10.4 Manual zones

User may create/edit horizontal zones from the UI.

Manual zones have higher priority than auto zones for alerting but must be labeled manual.

### 10.5 Trendline support

MVP: allow manual trendline metadata/notes but do not attempt automated trendline trading logic.

Later phase may add algorithmic trendlines.

---

## 11. Multi-timeframe regime logic

The engine runs independently on each timeframe and then combines them.

### 4H — context

Answer:

- primary trend
- major support/resistance
- whether price is extended
- volatility regime

### 1H — setup

Answer:

- continuation or reversal context
- breakout/breakdown
- pullback
- consolidation
- structure transition

### 15m — entry timing

Answer:

- rejection
- reclaim
- failed retest
- engulfing/impulse confirmation
- RSI reset/recovery
- Bollinger mean reclaim/loss

Create a combined `MultiTimeframeContext` object consumed by all strategies.

---

## 12. Initial strategy library

Each strategy is a versioned deterministic module implementing a common interface.

```ts
interface Strategy {
  key: string;
  version: string;
  evaluate(ctx: MultiTimeframeContext): StrategyEvaluation;
}
```

### Strategy A — Breakdown / breakout + retest

Short example:

Detection:

- important support zone exists
- 15m or 1H closes below zone with minimum ATR penetration
- directional structure is bearish or weakening

WATCHING state:

- price is below broken zone
- await retest

CONFIRMATION:

- price trades into/near old support
- closes back below / rejects it
- optional bearish candle confirmation
- R:R to next meaningful zone >= configured minimum

Invalidation:

- decisive reclaim above broken zone and tolerance

Long logic is mirrored.

### Strategy B — Liquidity sweep + reclaim

Long example:

Detection:

- price approaches strong support
- price trades below zone but does not decisively close beyond it OR quickly reclaims
- RSI or extension condition indicates stretched downside

WATCHING:

- wait for close/reclaim above zone midpoint or upper boundary

CONFIRMATION:

- support reclaimed
- bullish structure on 15m begins improving
- RSI turns upward from low level
- optionally price reclaims Bollinger lower band/basis depending on aggression profile

Invalidation:

- decisive close beneath sweep low or support zone

This strategy should have explicitly labeled `COUNTERTREND` risk when 1H/4H remain bearish.

### Strategy C — Trend pullback continuation

Long example:

- 4H bullish
- 1H bullish or constructive
- pullback reaches EMA/zone/value area
- 15m RSI resets
- 15m produces rejection + structure reclaim
- target has >=2R available

Mirror for short.

### Strategy D — Extreme extension / DO NOT CHASE

This is an advisory signal, not a trade signal.

Examples of conditions:

- RSI < 25 and price below lower Bollinger Band
- or RSI > 75 and price above upper Bollinger Band
- current move > configured ATR multiple
- price within short distance of strong opposing zone

Output:

- direction = NEUTRAL
- label = `DO_NOT_CHASE`
- alert message explains that momentum is strong but entry location is poor

The system should suppress lower-quality continuation signals while `DO_NOT_CHASE` is active unless a retest/reset occurs.

---

## 13. Opportunity scoring

Score is 0-100 and must be decomposable.

Initial weights:

- 4H alignment/context: 20
- 1H structure/setup quality: 15
- support/resistance confluence: 20
- 15m confirmation quality: 20
- momentum/volatility context: 10
- available reward/risk: 10
- event/risk cleanliness: 5

Score labels:

- 0-49: Ignore
- 50-59: Weak
- 60-69: Interesting
- 70-79: Watch
- 80-89: Strong
- 90-100: Exceptional

Hard filters override score:

- insufficient data
- stale market stream
- R:R below risk-profile minimum
- daily loss limit reached
- consecutive-loss limit reached
- cooldown active
- major event blackout active
- corrupted/reconciliation-failed data

The UI must show both:

- `Opportunity score: 84`
- `Entry status: WAITING FOR CONFIRMATION`

Never conflate these.

---

## 14. Risk engine and Trade Gate

### 14.1 Inputs

- current account equity/cash from eToro
- risk profile
- signal plan
- stop distance
- instrument price
- broker constraints returned by eToro where applicable
- existing correlated exposure
- daily realized/unrealized PnL

### 14.2 Outputs

- trade allowed: yes/no
- maximum allowed dollar loss
- maximum risk percent
- calculated position sizing guidance
- minimum target for configured R:R
- block reasons

### 14.3 Required hard rules

- risk per trade <= configured percentage
- two consecutive losses can block session by default
- daily loss budget enforced
- no automatic risk increase after loss
- no martingale logic
- cooldown after losing trade
- correlated positions count as shared risk

Initially treat US30, US100 and SPX500 as strongly correlated equity-index risk for concurrent-position limits.

Gold should be separate but may still correlate around macro events; do not assume independence for portfolio analytics.

### 14.4 Psychology checklist

Before approving a plan, require:

- I have a defined entry trigger.
- I have a defined stop before entry.
- At least minimum R:R exists.
- I am not trying to recover the previous loss.
- I am not chasing a move I missed.
- I know the higher-timeframe context.
- No blackout event is imminent.

Add the key prompt:

"If my previous trade did not exist, would I still take this trade?"

A rejected checklist must be stored as a decision event if the user chooses to log it.

---

## 15. Economic-event blackouts

Do not invent an eToro economic-calendar route unless MCP confirms one exists.

MVP options:

1. user enters high-impact events manually, or
2. integrate a dedicated calendar provider later.

Event schema:

- eventName
- currency
- impact
- scheduledAtUtc
- blackoutBeforeMinutes
- blackoutAfterMinutes

Default high-impact USD blackout:

- 10 minutes before
- 10 minutes after

Configurable by user.

The app should clearly show `NEWS BLACKOUT ACTIVE` and suppress trade approval if configured.

---

## 16. Alerts

### 16.1 Alert channels

MVP:

- in-app
- browser notification if permission granted
- Telegram bot preferred for mobile alerts

Later:

- email
- WhatsApp
- native push

### 16.2 Alert types

- WATCHLIST_OPPORTUNITY
- ENTRY_CONFIRMATION
- SIGNAL_INVALIDATED
- DO_NOT_CHASE
- MAJOR_LEVEL_APPROACHING
- PRICE_ZONE_BROKEN
- RETEST_DETECTED
- RISK_LIMIT_HIT
- STREAM_STALE
- POSITION_DETECTED
- POSITION_CLOSED

### 16.3 Alert throttling

Do not spam every candle.

Rules:

- emit on signal state transition
- emit if score crosses configured threshold by meaningful delta
- deduplicate same signal/state
- configurable per-market cooldown

Example:

`US30 — SHORT WATCH — 84/100`

`4H bearish correction. 1H support breakdown. Price is retesting 53,000-53,080 from below. Entry confirmation not complete. Invalidation above 53,150. Next support 52,800.`

---

## 17. User interface

Use a dark, professional finance-terminal aesthetic. Dense but readable. Desktop-first, responsive to mobile.

### 17.1 Global navigation

- Dashboard
- Markets
- Signals
- Trade Gate
- Journal
- Analytics
- Replay / Backtest (Phase 2)
- Settings

### 17.2 Dashboard

Top section:

- eToro connection status
- stream status
- account equity
- today's realized P/L
- today's risk remaining
- consecutive losses
- trading status: `ACTIVE | COOLDOWN | SESSION BLOCKED | NEWS BLACKOUT`

Market cards for all four instruments:

- live bid/ask or last price
- daily % change
- 4H regime
- 1H structure
- 15m momentum
- closest support/resistance
- opportunity score
- signal status
- one-line explanation

Sort markets by opportunity score by default.

### 17.3 Market detail page

Header:

- symbol
- live price
- spread
- session state
- current opportunity score

Chart:

Use TradingView Lightweight Charts or another high-quality candlestick chart library.

Overlay:

- auto support/resistance zones
- manual levels
- EMA20/50 optional
- Bollinger bands optional
- signal entry/invalidation/targets

Timeframe tabs:

- 15m
- 1h
- 4h

Context panel:

- 4H regime
- 1H structure
- 15m entry state
- RSI
- ATR
- Bollinger state
- distance to key levels

Signal timeline:

- DETECTED at X
- WATCHING at Y
- CONFIRMED at Z
- etc.

### 17.4 Signals page

Filters:

- active/history
- instrument
- strategy
- direction
- score
- state
- timeframe

Columns/cards:

- time
- market
- setup
- direction
- score
- state
- entry zone
- invalidation
- next target
- outcome if historical

### 17.5 Trade Gate page

Pre-populate from signal.

Show:

- account balance/equity
- maximum allowed risk
- proposed stop distance
- position-size guidance
- R:R to targets
- setup evidence
- psychology checklist
- block reasons

No "approve" button if hard risk rule fails.

### 17.6 Journal

Trade row:

- date/time
- instrument
- direction
- setup
- P/L dollars
- P/L R
- followed plan
- MAE
- MFE
- screenshot
- emotion tags

Detail:

- pre-trade setup snapshot
- signal evidence
- plan
- eToro trade facts
- post-trade notes
- rule breaks

### 17.7 Analytics

Must include:

- net P/L
- win rate
- average win
- average loss
- payoff ratio
- expectancy in R
- profit factor
- max drawdown
- average MAE
- average MFE
- rule adherence rate
- P/L when rules followed vs broken
- win rate by setup
- expectancy by setup
- expectancy by instrument
- performance by time of day
- long vs short performance
- countertrend vs trend-aligned performance
- performance after previous win/loss
- fees as percentage of gross trading P/L

This page is a core differentiator.

---

## 18. Account and portfolio sync

Initially read-only.

Sync:

- account balance/equity
- cash/available cash
- open positions
- orders where available
- closed trade history
- realized/unrealized P/L

Polling/event model:

- sync on app startup
- sync periodically at conservative interval consistent with rate limits
- sync immediately after detecting meaningful position changes if API supports suitable events

Reconciliation:

- store raw broker payload
- map to normalized domain model
- idempotent upsert
- do not silently overwrite conflicting records
- write reconciliation error to audit log

---

## 19. Trade matching and automatic journal creation

When a new eToro position appears:

1. match instrument/direction/open time against recently approved TradePlans
2. if exact/high-confidence match, link automatically
3. if ambiguous, mark `UNMATCHED` and ask user to link it
4. start tracking MAE/MFE from live prices
5. on close, calculate resultR and outcome statistics

If user executes a trade that had no TradePlan, journal it as `UNGATED_TRADE`.

That distinction is important for psychology analytics.

---

## 20. Backtesting engine — Phase 2

The same strategy code used live must be reusable in backtests.

Requirements:

- event-driven candle iteration
- no future data access
- pivots only become available after confirmation bars
- use finalized candles only
- indicator warm-up respected
- configurable spread/slippage assumptions
- fees configurable
- no silent fill at impossible prices

Outputs:

- trades
- win rate
- expectancy
- profit factor
- max drawdown
- average R
- MAE/MFE
- setup count
- time in market
- consecutive wins/losses

### Walk-forward validation

Support:

- in-sample range
- out-of-sample range
- rolling windows

Do not optimize strategy parameters solely against all available history.

---

## 21. Replay mode — Phase 2

Allow user to replay historical candles without seeing future data.

Features:

- choose instrument/date
- play/pause/step candle
- switch timeframe
- show what Sentinel knew at that moment
- display signals as they would have fired
- user may paper-trade the replay

This doubles as strategy training and debugging.

---

## 22. AI analyst layer

Optional after deterministic MVP is stable.

Inputs to LLM must be structured facts, not raw screenshots as primary data.

Example payload:

```json
{
  "instrument": "US30",
  "price": 53120,
  "regime4h": "BEAR",
  "structure1h": "LH_LL",
  "signal": "BREAKDOWN_RETEST_SHORT",
  "score": 84,
  "entryState": "WATCHING",
  "rsi15m": 44,
  "nearestResistance": [53180, 53230],
  "nearestSupport": [53000, 52890],
  "riskRewardToTarget2": 2.4
}
```

LLM responsibilities:

- explain setup in plain language
- explain what would invalidate it
- summarize conflicting evidence
- generate journal summaries
- identify behavioral patterns from structured journal data

LLM must not:

- fabricate prices
- override hard risk blocks
- place live orders
- invent unavailable market data

---

## 23. Recommended technical architecture

Use a TypeScript monorepo.

### Stack

- package manager: pnpm
- monorepo: Turborepo
- frontend: Next.js + React + TypeScript
- UI: Tailwind CSS + shadcn/ui
- charting: TradingView Lightweight Charts
- API: Fastify + TypeScript
- validation: Zod
- API docs: OpenAPI generated from typed schemas
- worker: Node.js TypeScript
- jobs: BullMQ
- cache/queue: Redis
- database: PostgreSQL
- ORM: Drizzle ORM preferred
- tests: Vitest
- browser tests: Playwright
- logging: Pino structured JSON
- observability: OpenTelemetry-compatible instrumentation
- deployment: Docker containers

Why separate API and worker from Next.js:

- persistent WebSocket connection
- long-running market-data process
- queue workers
- broker reconciliation
- backtests/replay jobs
- avoids serverless lifecycle constraints

### Monorepo layout

```text
market-sentinel/
  apps/
    web/
    api/
    worker/
  packages/
    domain/
    etoro-client/
    indicators/
    market-structure/
    strategies/
    risk-engine/
    contracts/
    db/
    config/
    observability/
    test-fixtures/
  infra/
    docker/
  docs/
    architecture/
    adr/
  .cursor/
    mcp.json
    rules/
  docker-compose.yml
  pnpm-workspace.yaml
  turbo.json
  README.md
  SPEC.md
```

---

## 24. Package boundaries

### `packages/etoro-client`

Responsibilities:

- REST auth headers
- request IDs
- route clients generated/written from current MCP specs
- WebSocket connection
- reconnect/resubscribe
- raw response types
- retry policy
- rate-limit handling

No trading strategy logic here.

### `packages/indicators`

Pure mathematical functions only.

### `packages/market-structure`

- pivots
- swings
- zones
- regimes
- multi-timeframe context

### `packages/strategies`

Pure strategy evaluation.

No direct database or HTTP calls.

### `packages/risk-engine`

Pure decision engine where possible.

Inputs: account, signal, profile, open exposure.
Outputs: allowed/blocked + reasons + sizing guidance.

### `packages/domain`

Enums, entities, value objects, domain events.

### `apps/worker`

- market stream
- candle aggregation
- signal evaluation
- alerts
- account reconciliation
- MAE/MFE tracking

### `apps/api`

- web app API
- settings
- user actions
- signal query
- journal query/update
- Trade Gate

---

## 25. Internal API surface

Exact route naming may vary, but build these capabilities.

### Markets

- `GET /markets`
- `GET /markets/:symbol`
- `GET /markets/:symbol/candles?timeframe=15m&from=&to=`
- `GET /markets/:symbol/context`
- `GET /markets/:symbol/zones`
- `POST /markets/:symbol/zones` manual zone

### Signals

- `GET /signals`
- `GET /signals/:id`
- `POST /signals/:id/dismiss`
- `POST /signals/:id/create-plan`

### Risk

- `GET /risk/status`
- `POST /risk/evaluate-plan`
- `POST /risk/cooldown`

### Account

- `GET /account`
- `GET /account/positions`
- `GET /account/history`
- `POST /account/sync`

### Journal

- `GET /journal`
- `GET /journal/:id`
- `PATCH /journal/:id`
- `POST /journal/:id/screenshot`

### Analytics

- `GET /analytics/summary`
- `GET /analytics/setups`
- `GET /analytics/instruments`
- `GET /analytics/psychology`

### Settings

- `GET /settings`
- `PATCH /settings/risk`
- `PATCH /settings/alerts`
- `PATCH /settings/markets`

### Streaming to frontend

Use Server-Sent Events or application WebSocket for:

- live prices
- signal state transitions
- account updates
- risk state changes

Do not expose eToro API credentials to the browser.

---

## 26. Security

### Secrets

Server-side environment variables only:

- `ETORO_API_KEY`
- `ETORO_USER_KEY`

Never put them in `NEXT_PUBLIC_*` variables.

Never log them.

`.env*` must be ignored by git.

Provide `.env.example` with placeholders.

### Request safety

- unique request ID per eToro request
- timeouts
- bounded retries only for safe/idempotent reads
- circuit breaker for repeated provider failures
- never blindly retry money-moving POST requests

### Single-user auth

For local MVP, a private deployment may use a strong app password/session.

For internet deployment, use Auth.js/Clerk or equivalent.

### Multi-user future

If product becomes public, replace personal user keys with registered eToro app/OAuth flows according to official eToro application-registration requirements.

---

## 27. Reliability requirements

### Data freshness

Display:

- live / delayed/stale state
- last quote timestamp
- last finalized candle timestamp

Signal generation stops if market data is stale beyond configured threshold.

### Idempotency

All workers must be safe against duplicate queue delivery.

### Reconciliation

Every minute or configured interval:

- verify live positions against eToro
- verify account snapshot
- resolve missing/closed positions

### Persistence

A restart must not lose:

- historical candles
- current signals
- journal
- manual zones
- risk state for the session
- strategy versions

---

## 28. Observability

Structured logs include:

- requestId
- instrumentId/symbol
- signalId
- strategyKey/version
- tradePlanId
- broker position/order ID where available

Metrics:

- eToro REST latency/error rate
- WebSocket reconnect count
- last tick age
- candles finalized
- signals generated by strategy
- alerts sent
- reconciliation mismatches
- queue depth
- worker lag

Health endpoints:

- `/health/live`
- `/health/ready`

Readiness should fail if critical market-data dependencies are unhealthy.

---

## 29. Testing strategy

### Unit tests

Required for:

- RSI
- ATR
- Bollinger Bands
- EMA
- candle aggregation
- pivot confirmation
- zone clustering
- market structure classification
- every strategy
- signal state machine
- opportunity score
- risk calculations

### Property/invariant tests

Examples:

- riskAmount never exceeds configured maximum
- blocked trade never receives approved state
- signal cannot become ENTERED before TRADE_PLANNED
- finalized candle cannot have high < open/close or low > open/close
- duplicate market event does not create duplicate candle/signal

### Integration tests

- mocked eToro REST
- mocked WebSocket
- disconnect/reconnect
- historical backfill
- account reconciliation
- trade matching

### Demo API contract tests

Where eToro allows:

- authenticate
- read demo portfolio
- read market data
- later open/close tiny demo positions only in execution milestone

### Replay fixtures

Create fixed historical sequences for:

- breakdown + retest
- false breakdown
- support sweep + reclaim
- trend pullback
- DO_NOT_CHASE extension

Tests must assert the expected signal state transitions candle by candle.

---

## 30. Strategy versioning

Every signal stores:

- strategy key
- semantic strategy version
- full parameter snapshot

Never mutate historical signal meaning when strategy logic changes.

Example:

- `breakdown-retest@1.0.0`
- `sweep-reclaim@1.1.0`

Backtests must identify exact strategy version.

---

## 31. Analytics formulas

### Win rate

`winning trades / closed trades`

### Payoff ratio

`average winning trade / absolute average losing trade`

### Expectancy in R

`P(win) * AvgWinR - P(loss) * AvgLossR`

### Profit factor

`gross profit / absolute gross loss`

### MAE

Worst unrealized movement against the trade between entry and exit.

### MFE

Best unrealized movement in favor between entry and exit.

### Discipline score

Initial simple model:

- start 100 per trade
- deduct defined points for each rule break
- show performance when discipline >= threshold vs below threshold

Do not make discipline score gamified in a way that encourages more trades.

---

## 32. Fintech-quality behaviors to demonstrate in the portfolio

The repository should visibly demonstrate:

- real-time WebSocket market-data processing
- REST/WebSocket reconciliation
- financial decimal precision
- idempotent event processing
- broker API authentication
- typed external API adapters
- strategy versioning
- deterministic calculations
- risk controls
- audit logs
- historical backtesting without lookahead
- data freshness and circuit breakers
- demo/live environment separation
- observability
- security-conscious handling of financial credentials

Use `decimal.js` or equivalent for money and critical price calculations where floating-point error could be material.

---

## 33. Repository quality

README must include:

- what Market Sentinel is
- screenshots/GIF when ready
- architecture diagram
- tech stack
- setup instructions
- eToro API/MCP setup
- environment variables
- strategy explanations
- safety statement
- demo video link later
- roadmap

Add Architecture Decision Records in `docs/adr/` for meaningful choices, for example:

- ADR-001: deterministic strategy engine vs LLM signal generation
- ADR-002: WebSocket + REST reconciliation
- ADR-003: separate worker process
- ADR-004: no autonomous live execution in MVP
- ADR-005: UTC candle boundaries

---

## 34. Development phases and acceptance criteria

### Milestone 0 — Repo foundation

Deliverables:

- pnpm/turbo monorepo
- lint/format/test/typecheck
- Docker Compose Postgres + Redis
- environment schema
- eToro MCP config
- CI pipeline

Acceptance:

- `pnpm install`
- `pnpm dev`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
all work.

### Milestone 1 — eToro connectivity

Deliverables:

- typed eToro client
- health check
- instrument discovery
- rates endpoint
- WebSocket connect/auth/subscribe/reconnect
- account read endpoint

Acceptance:

- dashboard shows live prices for all resolved configured instruments
- disconnecting network triggers safe reconnect
- secrets never reach frontend

### Milestone 2 — Candles and indicators

Deliverables:

- historical backfill
- candle builder
- 15m/1h/4h storage
- indicators
- chart display

Acceptance:

- after restart, historical candles remain
- current candle updates live
- finalized candles are immutable except explicit reconciliation revision

### Milestone 3 — Structure and zones

Deliverables:

- pivots
- HH/HL/LH/LL
- auto horizontal zones
- manual zones
- regime classifier

Acceptance:

- UI can explain why a zone exists
- no lookahead pivot errors in replay fixture tests

### Milestone 4 — Signals

Deliverables:

- four strategies
- state machine
- score
- evidence
- Signals page

Acceptance:

- signal transitions are deterministic and reproducible from candle history
- DO_NOT_CHASE advisory works

### Milestone 5 — Alerts

Deliverables:

- in-app alerts
- Telegram
- dedupe/throttling

Acceptance:

- one alert per meaningful state transition
- reconnect/restart does not resend entire historical signal set

### Milestone 6 — Account/risk/Trade Gate

Deliverables:

- account snapshots
- positions sync
- risk engine
- cooldown/session block
- Trade Gate

Acceptance:

- server refuses plans that violate risk rules
- daily and consecutive loss state survives browser refresh

### Milestone 7 — Journal and analytics

Deliverables:

- broker trade import
- plan matching
- MAE/MFE tracking
- journal UI
- analytics

Acceptance:

- manually executed eToro trades appear in the journal
- ungated trades are identifiable
- analytics can compare gated vs ungated performance

### Milestone 8 — Backtest/replay

Deliverables:

- historical event loop
- strategy replay
- backtest metrics
- replay UI

Acceptance:

- same fixture produces same live-simulation and backtest signal sequence

### Milestone 9 — Demo execution

Only after all prior milestones are stable.

Deliverables:

- eToro Demo order adapter
- order preview
- explicit confirmation
- order/position reconciliation

Acceptance:

- impossible to route Demo execution to Real account by configuration accident
- all order actions have audit events

---

## 35. MVP definition of done

MVP is complete when:

1. Application runs continuously and watches the four configured instruments.
2. eToro live market data is visible and freshness is monitored.
3. 15m, 1h and 4h context is maintained.
4. Support/resistance and structure are generated automatically.
5. Four strategies generate versioned signals.
6. Signals transition through WATCHING/CONFIRMED/INVALIDATED states correctly.
7. User receives useful, non-spammy alerts.
8. Trade Gate enforces risk and psychology constraints.
9. Real eToro portfolio/history can be synced read-only.
10. Closed trades become journal entries.
11. Analytics show whether the user actually has an edge by setup, market and behavior.
12. No live-money order can be submitted by the application.
13. Test suite covers all financial/risk-critical logic.
14. Repo is presentable as a serious fintech engineering project.

---

## 36. Cursor implementation instructions

Place this document at the repository root as `SPEC.md`.

Then give Cursor the following master instruction:

> You are the lead engineer for Market Sentinel. Treat `SPEC.md` as the product contract. Build the project incrementally by milestone. Do not skip milestones or silently change architecture. Before implementing any eToro endpoint, use the configured `etoro-public-api` MCP server and call the documentation tools to retrieve the current route and schema. Never guess an eToro endpoint. Never expose eToro credentials to browser code. Live-money execution is explicitly out of scope until a later milestone. Keep domain logic pure and testable, especially indicators, structure, strategy, state-machine, and risk logic. Use UTC internally. Avoid lookahead bias. Use decimal-safe arithmetic for financial values. For every milestone: first propose a short implementation plan and files to change; then implement; then run typecheck, lint and tests; then summarize deviations from SPEC.md. If a requirement is ambiguous, choose the safest deterministic behavior and document it in an ADR rather than hiding the decision.

Suggested first Cursor task:

> Read `SPEC.md` completely. Do not write product features yet. Create Milestone 0 only: the pnpm/Turborepo monorepo, apps/packages skeleton, Docker Compose with Postgres and Redis, TypeScript shared configs, linting, formatting, Vitest, Playwright placeholder configuration, environment validation, structured logging package, CI workflow, `.cursor/mcp.json` for eToro's hosted MCP server, `.env.example`, and a production-quality README skeleton. Then run all validation commands and show me the resulting repository tree.

---

## 37. Future commercial direction

If Market Sentinel becomes useful enough for the user personally, it can evolve into a fintech product rather than remaining a private bot.

Potential future product wedges:

- explainable trade-opportunity scanner
- broker-connected trading journal
- psychology/risk enforcement platform
- strategy research/replay platform
- trading copilot with deterministic evidence
- eToro App Store application if program requirements permit

Before becoming multi-user, add:

- registered eToro app/OAuth authentication
- tenant isolation
- encrypted token storage
- permission/scopes model
- regulatory/legal review
- stronger compliance and suitability boundaries
- explicit user-facing financial-risk disclosures

The personal single-user product should be built so this transition is possible, but MVP complexity should not be driven by hypothetical scale.

---

## 38. Product success criteria

The most important success metric is not number of alerts or trades.

Market Sentinel is succeeding if, over time:

- fewer impulsive trades are taken
- the user can identify why every trade existed
- average loss remains controlled
- rule-break frequency decreases
- signals are sufficiently selective that alerts remain trusted
- the application can statistically identify profitable and unprofitable setup families
- realized performance when rules are followed is measurable against performance when rules are broken
- the user spends less time staring at charts while missing fewer high-quality setups

The ultimate product question is:

**Under exactly which market conditions, strategies, instruments, sessions, and psychological states does this trader have positive expectancy?**

Everything in the system should help answer that question with progressively better evidence.
