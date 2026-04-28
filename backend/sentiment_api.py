from fastapi import APIRouter
from pydantic import BaseModel
import feedparser
import requests
import urllib.parse
from datetime import datetime, timedelta
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

router = APIRouter()
analyzer = SentimentIntensityAnalyzer()

class SentimentRequest(BaseModel):
    stock: str

def fetch_sentiment_for_stock(stock: str):
    query = f"{stock} stock"
    encoded_query = urllib.parse.quote(query)
    rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=en-IN&gl=IN&ceid=IN:en"
    
    feed = feedparser.parse(rss_url)
    
    headlines = []
    compound_scores = []
    
    for entry in feed.entries[:10]:
        title = entry.title
        link = entry.link
        
        score = analyzer.polarity_scores(title)
        compound = score["compound"]
        
        headlines.append({"title": title, "url": link})
        compound_scores.append(compound)
        
    if not compound_scores:
        return {
            "stock": stock,
            "sentiment": "NEUTRAL",
            "score": 50,
            "positive_pct": 0,
            "negative_pct": 0,
            "neutral_pct": 100,
            "headlines": [],
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M")
        }
        
    avg_compound = sum(compound_scores) / len(compound_scores)
    
    if avg_compound > 0.2:
        sentiment = "BULLISH"
    elif avg_compound < -0.2:
        sentiment = "BEARISH"
    else:
        sentiment = "NEUTRAL"
        
    # Scale compound (-1 to 1) to a 0-100 score
    score_out_of_100 = int((avg_compound + 1) / 2 * 100)
    
    positive_count = sum(1 for c in compound_scores if c > 0.2)
    negative_count = sum(1 for c in compound_scores if c < -0.2)
    neutral_count = len(compound_scores) - positive_count - negative_count
    
    total = len(compound_scores)
    
    return {
        "stock": stock,
        "sentiment": sentiment,
        "score": score_out_of_100,
        "positive_pct": int((positive_count / total) * 100),
        "negative_pct": int((negative_count / total) * 100),
        "neutral_pct": int((neutral_count / total) * 100),
        "headlines": headlines,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M")
    }

@router.post("/api/sentiment")
def get_sentiment(request: SentimentRequest):
    return fetch_sentiment_for_stock(request.stock)

# Cache for watchlist
WATCHLIST_STOCKS = [
    "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN", "WIPRO", "BAJFINANCE",
    "AXISBANK", "KOTAKBANK", "HINDUNILVR", "MARUTI", "TATAMOTORS", "SUNPHARMA",
    "ONGC", "NTPC", "POWERGRID", "ULTRACEMCO", "TITAN", "ADANIENT"
]

watchlist_cache = {
    "data": None,
    "last_fetched": None
}

@router.get("/api/watchlist")
def get_watchlist():
    now = datetime.now()
    if watchlist_cache["data"] and watchlist_cache["last_fetched"]:
        if now - watchlist_cache["last_fetched"] < timedelta(minutes=30):
            return watchlist_cache["data"]
            
    results = []
    for stock in WATCHLIST_STOCKS:
        results.append(fetch_sentiment_for_stock(stock))
        
    watchlist_cache["data"] = results
    watchlist_cache["last_fetched"] = now
    
    return results
