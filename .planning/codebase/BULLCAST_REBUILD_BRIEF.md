PROJECT REBUILD BRIEF — BULLCAST (formerly AlgoTradeX)

=== OVERVIEW ===

Rebuild the existing AlgoTradeX project into a new product called Bullcast.
Bullcast is a free, public-facing stock sentiment tracker with a backtesting 
engine inside. The primary goal is daily usage by traders and shareability.

The product has two layers:
1. PUBLIC LAYER — Free sentiment tracker, no login required
2. INNER LAYER — Full backtesting engine (existing AlgoTradeX features)

=== TECH STACK (keep existing) ===

Frontend: React + Vite + Tailwind CSS + Axios + Recharts
Backend: Python + FastAPI + Uvicorn + Pandas + NumPy + VADER + FinBERT
Keep all existing dependencies. Only add what is listed below.

New backend dependency to add:
- feedparser (for Google News RSS)
- requests

=== PAGE STRUCTURE ===

Replace existing routing with these pages:

/ → Home (Landing page)
/sentiment → Public Sentiment Tracker (NO LOGIN)
/watchlist → Market Watchlist with daily sentiment
/backtest → Strategy Lab (existing AlgoTradeX backtesting, moved here)
/journal → Trade Journal (new)

=== PAGE 1: LANDING PAGE ( / ) ===

Clean dark-themed landing page.

Header:
- Logo: Bullcast
- Tagline: "Know the market mood before you trade"
- Two CTA buttons: "Check Sentiment Now" → /sentiment | "Run a Backtest" → /backtest

Hero section:
- Large headline: "Trade with sentiment, not just charts"
- Subheadline: "Real-time news sentiment for any stock. Free. No signup needed."
- One search bar in the center: placeholder "Enter stock symbol e.g. RELIANCE, TCS"
- When user types and presses Enter, redirect to /sentiment?stock=SYMBOL

Features section (3 cards):
- Card 1: "Instant Sentiment" — Paste any stock, get bullish/bearish/neutral in seconds
- Card 2: "Daily Watchlist" — Track 20 top stocks sentiment every morning
- Card 3: "Backtest Engine" — Test strategies on historical data with charts

Footer: Built by [your name] · GitHub link · Product Hunt badge placeholder

=== PAGE 2: PUBLIC SENTIMENT TRACKER ( /sentiment ) ===

This is the most important page. Must work with zero login.

Layout:
- Search bar at top: "Enter stock name or symbol"
- When searched, show result card below

Result Card design:
- Stock name + symbol (large)
- Sentiment badge: BULLISH (green) / BEARISH (red) / NEUTRAL (grey)
- Sentiment score bar (0 to 100)
- Breakdown: Positive % | Negative % | Neutral %
- Last 5 news headlines that were analyzed (show title only, link to source)
- Timestamp: "Last updated: [time]"
- Share button: generates a sharable text:
  "RELIANCE is BULLISH today (Score: 78/100) — checked on Bullcast 🚀 bullcast.app"
  Copy to clipboard on click.

Backend API required:
POST /api/sentiment
Input: { "stock": "RELIANCE" }

Backend logic:
1. Take stock name
2. Fetch headlines from Google News RSS:
   URL: https://news.google.com/rss/search?q={stock}+stock&hl=en-IN&gl=IN&ceid=IN:en
   Use feedparser to parse RSS feed
   Extract last 10 headlines
3. Run each headline through VADER
4. Average the compound scores
5. Classify:
   compound > 0.2 → BULLISH
   compound < -0.2 → BEARISH
   else → NEUTRAL
6. Return:
{
  "stock": "RELIANCE",
  "sentiment": "BULLISH",
  "score": 78,
  "positive_pct": 60,
  "negative_pct": 15,
  "neutral_pct": 25,
  "headlines": [
    {"title": "Reliance posts record profit", "url": "..."},
    ...
  ],
  "timestamp": "2024-01-10 09:30"
}

=== PAGE 3: WATCHLIST PAGE ( /watchlist ) ===

Shows sentiment for 20 hardcoded popular Indian stocks.
No login required.

Stocks to include (hardcode this list):
RELIANCE, TCS, INFY, HDFCBANK, ICICIBANK, SBIN, WIPRO, BAJFINANCE,
AXISBANK, KOTAKBANK, HINDUNILVR, MARUTI, TATAMOTORS, SUNPHARMA,
ONGC, NTPC, POWERGRID, ULTRACEMCO, TITAN, ADANIENT

Layout:
- Page title: "Market Mood Board — Updated Daily"
- Subtitle: "Sentiment snapshot of top 20 Indian stocks based on today's news"
- Grid of 20 cards (4 columns on desktop, 2 on mobile)

Each card shows:
- Stock name
- Symbol
- Sentiment badge: BULLISH / BEARISH / NEUTRAL with color
- Score out of 100
- Small bar showing positive vs negative ratio

At top right: "Last refreshed: [timestamp]" + Refresh button

Backend API required:
GET /api/watchlist

Backend logic:
Loop through all 20 stocks, call sentiment logic for each,
return array of results.
Cache results for 30 minutes to avoid hammering news API.

=== PAGE 4: BACKTEST PAGE ( /backtest ) ===

This is the existing AlgoTradeX Strategy Lab. Move it here exactly as is.

Changes to make:
- Update visual design to match new dark theme
- Add page title: "Strategy Backtesting Engine"
- Add subtitle: "Upload historical CSV data and test your trading strategy"
- Keep all existing functionality unchanged:
  CSV upload, strategy selection, run backtest button,
  buy/sell signals, performance metrics, charts

No logic changes needed here. Only visual theme update.

=== PAGE 5: TRADE JOURNAL ( /journal ) ===

Simple trade logging page. No backend needed — use localStorage.

Layout:
- Page title: "My Trade Journal"
- Add Trade button → opens a form

Form fields:
- Date (date picker)
- Stock symbol (text)
- Action: BUY or SELL (toggle)
- Entry Price (number)
- Exit Price (number)
- Quantity (number)
- Notes (textarea, optional)
- Save button

After saving, show trade in a table below with columns:
Date | Stock | Action | Entry | Exit | Qty | P&L | Result

Auto-calculate:
P&L = (Exit Price - Entry Price) × Quantity
Result = PROFIT (green) if P&L > 0, LOSS (red) if P&L < 0

Summary bar at top of journal:
- Total Trades
- Win Rate %
- Total P&L (green or red)
- Best Trade
- Worst Trade

All data stored in localStorage. No backend needed.

=== NAVIGATION BAR ===

Fixed top navbar on all pages.

Left: Bullcast logo (text logo, bold)
Right links: Sentiment | Watchlist | Backtest | Journal

Active link highlighted.
Mobile: hamburger menu.

=== VISUAL DESIGN SYSTEM ===

Theme: Dark mode only
Background: #0a0a0f
Card background: #12121a
Border: #1e1e2e
Primary accent: #6c63ff (purple)
Bullish color: #00d26a (green)
Bearish color: #ff4d4d (red)
Neutral color: #888899 (grey)
Text primary: #ffffff
Text secondary: #888899
Font: Inter (import from Google Fonts)

All cards should have:
border-radius: 12px
padding: 24px
border: 1px solid #1e1e2e
subtle box-shadow

Buttons:
Primary: purple background, white text, rounded
Secondary: transparent with purple border

=== SHARE CARD FEATURE (important for virality) ===

On the sentiment result page, when user clicks Share:

Generate this text and copy to clipboard:
"[STOCK] is [SENTIMENT] today 📊
Sentiment Score: [SCORE]/100
Positive: [X]% | Negative: [Y]% | Neutral: [Z]%

Checked on Bullcast — free stock sentiment tracker
🔗 [your-url]"

Show a toast notification: "Copied! Share it anywhere 🚀"

=== BACKEND FILE STRUCTURE ===

Keep existing server.py
Add new routes:

POST /api/sentiment → sentiment analysis for one stock
GET /api/watchlist → sentiment for all 20 watchlist stocks
POST /backtest → existing backtest endpoint (keep as is)
POST /api/sentiment-text → existing VADER/FinBERT text analysis (keep as is)

=== NEW BACKEND DEPENDENCIES ===

Add to requirements.txt:
feedparser==6.0.10
requests==2.31.0

=== FRONTEND FILE STRUCTURE ===

src/
  pages/
    Home.jsx
    Sentiment.jsx
    Watchlist.jsx
    Backtest.jsx  ← move existing Strategy Lab here
    Journal.jsx
  components/
    Navbar.jsx
    SentimentCard.jsx
    WatchlistCard.jsx
    ShareButton.jsx
    TradeForm.jsx
    TradeTable.jsx
    MetricsSummary.jsx
  App.jsx  ← update routes
  main.jsx

=== LOADING STATES ===

Every API call must show a loading state.
Use a pulsing skeleton loader on cards while data loads.
Show "Analyzing news sentiment..." text during sentiment fetch.

=== ERROR HANDLING ===

If news fetch fails: show "Could not fetch news for this stock. Try another symbol."
If stock not found: show "No recent news found for [SYMBOL]"
If backend is down: show "Service temporarily unavailable. Please try again."

=== WHAT NOT TO CHANGE ===

- All existing backtesting logic in backend
- CSV processing and validation
- Signal generation algorithm
- Performance metrics calculation
- All existing chart components

=== FINAL CHECKLIST ===

[ ] Landing page with working search redirecting to /sentiment
[ ] Sentiment page working with real Google News RSS data
[ ] Watchlist page showing 20 stocks with sentiment
[ ] Backtest page with existing functionality and new theme
[ ] Journal page with localStorage trade logging
[ ] Share button copying formatted text to clipboard
[ ] Dark theme applied consistently across all pages
[ ] Mobile responsive on all pages
[ ] Loading states on all API calls
[ ] Error messages on all failure cases