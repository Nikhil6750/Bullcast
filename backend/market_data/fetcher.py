import yfinance as yf
from fastapi import HTTPException
from backend.market_data.symbols import MASTER_SYMBOLS

def _is_valid_symbol(symbol: str) -> bool:
    for asset in MASTER_SYMBOLS:
        if asset["symbol"] == symbol:
            return True
    return False

def fetch_ohlcv(symbol: str, period: str = "1y", interval: str = "1d") -> list[dict]:
    if not _is_valid_symbol(symbol):
        raise HTTPException(400, "Invalid or unsupported symbol")
        
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=interval)
        
        if df.empty:
            raise HTTPException(404, f"No historical data found for {symbol}")
            
        records = []
        for index, row in df.iterrows():
            # Convert timestamp to milliseconds if possible
            timestamp = int(index.timestamp() * 1000) if hasattr(index, 'timestamp') else str(index)
            records.append({
                "time": timestamp,
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": float(row["Volume"]) if "Volume" in df.columns else 0.0,
            })
        return records
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Error fetching market data: {str(exc)}")

def fetch_quote(symbol: str) -> dict:
    if not _is_valid_symbol(symbol):
        raise HTTPException(400, "Invalid or unsupported symbol")
        
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        
        price = info.get("currentPrice") or info.get("regularMarketPrice")
        if price is None:
            # Fallback to history for recent price
            df = ticker.history(period="1d")
            if df.empty:
                raise HTTPException(404, f"No quote data found for {symbol}")
            price = df["Close"].iloc[-1]
            return {
                "symbol": symbol,
                "price": float(price),
                "volume": float(df["Volume"].iloc[-1]) if "Volume" in df.columns else 0.0
            }
            
        return {
            "symbol": symbol,
            "price": float(price),
            "open": float(info.get("regularMarketOpen", info.get("open", 0))),
            "high": float(info.get("regularMarketDayHigh", info.get("dayHigh", 0))),
            "low": float(info.get("regularMarketDayLow", info.get("dayLow", 0))),
            "volume": float(info.get("regularMarketVolume", info.get("volume", 0))),
            "previous_close": float(info.get("regularMarketPreviousClose", info.get("previousClose", 0))),
            "name": info.get("shortName", info.get("longName"))
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Error fetching quote: {str(exc)}")
