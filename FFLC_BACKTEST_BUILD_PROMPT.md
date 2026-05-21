# FFLC Strategy Backtester — Full Build Prompt
## Bullcast Backend (FastAPI/Python) + Frontend (React/JSX)

---

## CONTEXT & STACK

You are building a new **Backtesting** feature inside an existing project called **Bullcast**.

- **Backend**: Python, FastAPI — located in `backend/`. Entry point is `backend/server.py`.
- **Frontend**: React (JSX), Vite — located in `trading-ui/src/`. Pages in `trading-ui/src/pages/`, components in `trading-ui/src/components/`, API calls in `trading-ui/src/services/api.js`.
- **Live candle data source**: ForexFactory MDS API — `https://mds-api.forexfactory.com/bars?to=0&interval=M5&instrument={PAIR}&per_page=500`
  - Response: `{ data: [ { timestamp, open, high, low, close }, ... ] }` — reverse it to get chronological order (oldest first).
  - Pairs format for API: `EUR/USD` (slash-separated). Convert `EURUSD` → `EUR/USD`.

---

## THE STRATEGY: FFLC (5-Candle Setup)

### Pattern Structure
The system scans M5 (5-minute) candles for this exact sequence:

**SELL Setup** (direction = `DOWN`):
- C1, C2, C3 → 3 consecutive **Bullish** candles (close > open)
- C4, C5 → 1 OR 2 consecutive **Bearish** pullback candles (close < open)
- The pullback candles must NOT close below the **open of C1**. If they do → pattern is invalid.

**BUY Setup** (direction = `UP`):
- C1, C2, C3 → 3 consecutive **Bearish** candles (close < open)
- C4, C5 → 1 OR 2 consecutive **Bullish** pullback candles (close > open)
- The pullback candles must NOT close above the **open of C1**. If they do → pattern is invalid.

A **doji** (close == open) in any position also invalidates the pattern.

---

## PRICE TARGET CALCULATION (The Core Logic)

### Step 1 — C3 Midpoint
```
SELL: midpoint = C3_low + ((C3_high - C3_low) / 2)
BUY:  midpoint = C3_high - ((C3_high - C3_low) / 2)
```
These are identical mathematically — just the 50% midpoint of C3's full range.

### Step 2 — Pullback Strength Check
Check if ANY pullback candle (C4, and C5 if exists) **crossed** the midpoint:

- **SELL**: Did any pullback candle's **low** go below the midpoint?
- **BUY**: Did any pullback candle's **high** go above the midpoint?

Result:
- `YES` → **Strong Pullback**
- `NO` → **Weak Pullback**

### Step 3 — Standard Target Assignment
```
Strong Pullback → target = midpoint of C3
Weak Pullback   → target = open price of C1
```

### Step 4 — News Intercept Override (ONLY for Weak Pullback)

This override only applies when pullback is **Weak**. Skip entirely for Strong Pullback.

**4a. News Check:**
Query the `economic_events` table. Is there any event with `impact >= 2` scheduled within the next **10 minutes** from the pattern detection time (use IST / Asia/Kolkata timezone strictly)?

**4b. If news found — Average Candle Size:**
```
avg_size = ((C1_high - C1_low) + (C2_high - C2_low) + (C3_high - C3_low)) / 3
```

**4c. C3 Extreme Wick Calculation:**
```
SELL → upper_wick = C3_high - max(C3_open, C3_close)
BUY  → lower_wick = min(C3_open, C3_close) - C3_low
```

**4d. Prominence Check:**
```
is_prominent = wick > (avg_size * 0.15)
```

**4e. Target Override:**
```
If is_prominent:
  SELL → target = C3_high
  BUY  → target = C3_low

If NOT is_prominent:
  SELL → target = max(C2_high, C3_high)
  BUY  → target = min(C2_low, C3_low)
```

### Step 5 — Tolerance Zone
The target is NOT a single price. Define a zone:
```
zone_upper = target + (target * 0.0005)
zone_lower = target - (target * 0.0005)
```
A trade is "near the zone" when: `zone_lower <= current_price <= zone_upper`

---

## TRADE OUTCOME EVALUATION LOGIC

This logic evaluates whether a detected setup resulted in a win, loss, or invalid formation.
It replicates the exact PHP evaluator logic from the original system.

**Inputs**: candles list (chronological), direction (`UP`/`DOWN`), target price, alert_candle_index, session_end_timestamp

**Algorithm**:
```
consecutiveRed = 0
consecutiveGreen = 0

for i in range(len(candles)):
    c = candles[i]

    if c.close < c.open:   # red candle
        consecutiveRed += 1
        consecutiveGreen = 0
    elif c.close > c.open: # green candle
        consecutiveGreen += 1
        consecutiveRed = 0
    else:                  # doji
        consecutiveRed = 0
        consecutiveGreen = 0

    if i >= alert_candle_index:
        if c.time > session_end_timestamp:
            break

        wave_length = i - alert_candle_index + 1

        # --- UP direction (BUY trade) ---
        if direction == 'UP' and c.close < target:
            if wave_length < 6:
                return 'setup_not_formed', 'Too fast'
            if consecutiveRed >= 3:
                c1 = candles[i+1] if i+1 < len(candles) else None
                c2 = candles[i+2] if i+2 < len(candles) else None
                if not c1: return 'pending', 'Waiting for C1'
                if c1.close > c1.open: return 'win', 'Direct Win'
                if not c2: return 'pending', 'Waiting for C2'
                if c2.close > c2.open: return 'win', 'MTG1 Win'
                return 'loss', 'Failed'
            return 'setup_not_formed', 'Invalid streak'

        # --- DOWN direction (SELL trade) ---
        if direction == 'DOWN' and c.close > target:
            if wave_length < 6:
                return 'setup_not_formed', 'Too fast'
            if consecutiveGreen >= 3:
                c1 = candles[i+1] if i+1 < len(candles) else None
                c2 = candles[i+2] if i+2 < len(candles) else None
                if not c1: return 'pending', 'Waiting for C1'
                if c1.close < c1.open: return 'win', 'Direct Win'
                if not c2: return 'pending', 'Waiting for C2'
                if c2.close < c2.open: return 'win', 'MTG1 Win'
                return 'loss', 'Failed'
            return 'setup_not_formed', 'Invalid streak'

return 'pending', 'Target not broken'
```

---

## SESSION RULES

- Valid trading window: **12:30 PM IST to 9:30 PM IST** (London + New York sessions)
- **No Monday trading** — skip all patterns detected on Mondays
- All timestamp comparisons must use **IST (Asia/Kolkata)** timezone

---

## WHAT TO BUILD

### 1. Backend — New module: `backend/fflc/`

Create the following files:

#### `backend/fflc/__init__.py` — empty

#### `backend/fflc/candles.py`
- `fetch_candles(pair: str, limit: int = 500) -> list[dict]`
  - Calls ForexFactory MDS API
  - Converts pair format: `EURUSD` → `EUR%2FUSD` for URL encoding
  - Returns list of dicts: `{time, open, high, low, close}` in chronological order (oldest first)
  - Each `time` is a Unix timestamp (int)

#### `backend/fflc/detector.py`
- `detect_patterns(candles: list[dict], pair: str) -> list[dict]`
  - Scans candles for FFLC 5-candle setups
  - Validates C1 open boundary rule for pullback candles
  - Returns list of detected patterns, each containing:
    ```python
    {
        'pair': str,
        'direction': 'UP' | 'DOWN',
        'c1': dict, 'c2': dict, 'c3': dict,
        'pullback_candles': list[dict],   # C4 and optionally C5
        'alert_candle_index': int,
        'alert_timestamp': int,           # Unix timestamp of pattern detection
        'pullback_type': 'strong' | 'weak',
        'target': float,
        'zone_upper': float,
        'zone_lower': float,
        'win_count': int (from evaluation),
        'result': str,
        'reason': str,
    }
    ```

#### `backend/fflc/target.py`
- `calculate_target(c1, c2, c3, pullback_candles, direction, news_events=None) -> dict`
  - Implements the full price target calculation:
    - Strong/weak pullback determination
    - Standard target (midpoint or C1 open)
    - News intercept + wick override for weak pullbacks
    - Tolerance zone calculation
  - Returns: `{ target, zone_upper, zone_lower, pullback_type, target_method }`
  - `target_method` is one of: `'strong_midpoint'`, `'weak_c1_open'`, `'news_wick_prominent'`, `'news_wick_not_prominent'`

#### `backend/fflc/evaluator.py`
- `evaluate_trade(candles, direction, target, alert_candle_index, session_end_ts) -> dict`
  - Exact Python port of the PHP evaluator algorithm above
  - Returns: `{ result, reason }` where result ∈ `{win, loss, pending, setup_not_formed}`

#### `backend/fflc/backtest.py`
- `run_backtest(pair: str, date_str: str = None) -> dict`
  - Fetches 500 candles for the pair
  - Filters to valid session window (12:30–21:30 IST)
  - Skips Mondays
  - Runs detector on all candles
  - Evaluates each detected pattern
  - Returns full result:
    ```python
    {
        'pair': str,
        'date': str,
        'total_setups': int,
        'wins': int,
        'losses': int,
        'setup_not_formed': int,
        'pending': int,
        'win_rate': float,           # wins / (wins + losses) * 100
        'patterns': list[dict],      # full detail of each detected pattern
    }
    ```

#### `backend/fflc/multi_backtest.py`
- `run_multi_backtest(pairs: list[str], date_str: str = None) -> dict`
  - Runs `run_backtest()` for each pair concurrently using `asyncio` or `ThreadPoolExecutor`
  - Aggregates results across all pairs
  - Returns combined stats + per-pair breakdown

---

### 2. Backend — New API Routes in `backend/server.py`

Add these endpoints (register them the same way as existing routes):

```
GET  /api/backtest/run?pair=EURUSD&date=2025-08-11
POST /api/backtest/run-multi   body: { pairs: ["EURUSD", "GBPUSD", ...], date: "2025-08-11" }
GET  /api/backtest/pairs       → returns list of supported pairs
GET  /api/backtest/candles?pair=EURUSD  → returns raw M5 candles for inspection
```

**Supported pairs** (hardcoded list — same pairs from the historical DB):
```
EURUSD, GBPUSD, USDJPY, USDCHF, USDCAD, AUDUSD,
EURJPY, GBPJPY, CHFJPY, CADJPY, AUDJPY, EURAUD,
GBPAUD, EURGBP, EURCAD, GBPCAD, GBPCHF, EURCHF,
AUDCHF, AUDCAD, EURJPY
```

---

### 3. Frontend — New Page: `trading-ui/src/pages/Backtest.jsx`

Build a full backtesting dashboard page. Style it consistently with the existing dark theme used across Bullcast (dark background, green/red candle colors `#00C9A7` / `#FF5370`, orange accent for target line `#FFB84D`, monospace font for numbers).

#### Layout (top to bottom):

**Section 1 — Controls Bar**
- Pair selector (dropdown or searchable select) — all supported pairs
- Date picker — defaults to today
- "Run Backtest" button — single pair
- "Run All Pairs" button — scans all pairs for that date
- Loading spinner during fetch

**Section 2 — Summary Stats Row** (shown after results load)
Stat cards showing:
- Total Setups Detected
- Wins (green)
- Losses (red)
- Setup Not Formed (neutral)
- Win Rate % (large, prominent)

**Section 3 — Pattern Results Table**
Each detected pattern is a row with:
- Time (IST formatted)
- Pair
- Direction (UP 🟢 / DOWN 🔴 badge)
- Target Price
- Pullback Type (Strong / Weak badge)
- Target Method (how target was calculated)
- Result badge (WIN ✅ / LOSS ❌ / SETUP NOT FORMED ⚠️ / PENDING ⏳)
- Reason text

Clicking a row → expands to show the **5-candle chart** for that pattern.

**Section 4 — 5-Candle Pattern Chart** (shown on row expand OR as a modal)

Render a candlestick chart using **recharts** or plain SVG. Requirements:
- Show exactly 5 candles: C1, C2, C3 + pullback candles (C4, C5)
- Candles: body is open→close, wicks are high→low
- Bullish candles: `#00C9A7` (green/teal)
- Bearish candles: `#FF5370` (red)
- Draw a **horizontal orange line** at the target price: color `#FFB84D`, labeled `TARGET LEVEL: {price}`
- Show at the top: `ID: {id} | Pair: {pair} | Time: {time IST}`
- Y-axis shows price with 5 decimal places
- This matches exactly the screenshot provided — clean dark chart with orange target line

---

### 4. Frontend — Wire Up Routes

In `trading-ui/src/main.jsx`:
- Add lazy import: `const Backtest = lazy(() => import('./pages/Backtest'))`
- Add route: `<Route path="/backtest" element={<Suspense fallback={<Fallback />}><Backtest /></Suspense>} />`

In `trading-ui/src/components/AppShell.jsx`:
- Add to `NAV_LINKS`: `{ path: '/backtest', label: 'Backtest' }`

In `trading-ui/src/components/Navbar.jsx`:
- Add: `<Link to="/backtest" ...>Backtest</Link>`

In `trading-ui/src/services/api.js`:
- Add:
```js
export const runBacktest = (pair, date) =>
  _request(`/api/backtest/run?pair=${pair}&date=${date}`)

export const runMultiBacktest = (pairs, date) =>
  _request('/api/backtest/run-multi', {
    method: 'POST',
    body: JSON.stringify({ pairs, date })
  })

export const getBacktestPairs = () =>
  _request('/api/backtest/pairs')
```

---

## CHART VISUAL REFERENCE

From the provided screenshots, the 5-candle setup chart looks exactly like this:
- **Dark background** (`#0d0d1a` or similar)
- **5 candles** rendered with proper bodies and wicks
- **Orange horizontal line** across the full chart width at target price
- **Label on the orange line** on the left: `TARGET LEVEL: 1.37448` in orange text
- **Header text** top-left: `ID: 7755 | Pair: USDCAD | Time: 18-May-2026 01:30 PM`
- Y-axis labels on the left at key price levels
- No X-axis labels needed — candle positions speak for themselves
- The target line sits exactly at the calculated target price level visually

---

## IMPORTANT IMPLEMENTATION RULES

1. **All timestamps must use IST (Asia/Kolkata)** — never raw UTC for session checks
2. **Floating point comparisons** use epsilon tolerance (`abs(a - b) < 1e-9`) not `==`
3. **Pair conversion for API**: `EURUSD` → `EUR/USD` → URL encode as `EUR%2FUSD`
4. **Session filter**: only evaluate candles between 12:30 PM and 9:30 PM IST
5. **Monday skip**: `datetime.weekday() == 0` → skip entire day
6. **No high/low data in PHP evaluator** — the outcome evaluator only uses open/close. But the pattern detector and target calculator DO need high/low from the candle data.
7. **Pullback boundary check**: pullback candles must not breach C1's open. For SELL (bullish streak), pullback red candles must not close below C1_open. For BUY (bearish streak), pullback green candles must not close above C1_open.
8. **wave_length minimum of 6** before a breakout is valid — this counts from the alert candle (C5, the last pullback candle) to the breaking candle.
9. **MTG1** = one candle of patience after the breaking candle — if C1 doesn't reverse, check C2.
10. The `economic_events` table may not exist in the new system yet — **if it doesn't exist or news check fails, default to standard target (no override)**. Do not crash.

---

## FILE STRUCTURE SUMMARY

```
backend/
  fflc/
    __init__.py
    candles.py       ← ForexFactory API fetcher
    detector.py      ← 5-candle pattern scanner
    target.py        ← Price target calculator
    evaluator.py     ← Win/loss outcome evaluator
    backtest.py      ← Single-pair backtest runner
    multi_backtest.py ← Multi-pair backtest runner
  server.py          ← Add 4 new /api/backtest/* routes

trading-ui/src/
  pages/
    Backtest.jsx     ← Full backtesting dashboard page
  services/
    api.js           ← Add runBacktest, runMultiBacktest, getBacktestPairs
  components/
    AppShell.jsx     ← Add Backtest nav link
    Navbar.jsx       ← Add Backtest nav link
  main.jsx           ← Add /backtest route
```

---

## SUCCESS CRITERIA

When complete, a user must be able to:
1. Open Bullcast → click "Backtest" in the navbar
2. Select a forex pair and a date
3. Click "Run Backtest"
4. See the summary stats: how many setups detected, wins, losses, win rate
5. See each detected pattern in a table with direction, target, result
6. Click any pattern row and see the 5-candle candlestick chart with the orange target level line — exactly matching the reference screenshots
7. Click "Run All Pairs" and see a combined result across all 21 pairs for that date

Build this completely, correctly, and with no placeholder code. Every function must be fully implemented.
