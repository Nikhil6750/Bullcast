import pandas as pd
import numpy as np
from .signals import calculate_sma, calculate_rsi, calculate_macd, calculate_bollinger_bands

def apply_strategy(df: pd.DataFrame, strategy_name: str) -> pd.DataFrame:
    df = df.copy()
    df["signal"] = 0
    
    if len(df) < 50:
        return df

    if strategy_name == "sma_cross":
        df["sma_short"] = calculate_sma(df["close"], 20)
        df["sma_long"] = calculate_sma(df["close"], 50)
        
        # 1 if short > long, -1 if short < long
        df["signal"] = np.where(df["sma_short"] > df["sma_long"], 1, np.where(df["sma_short"] < df["sma_long"], -1, 0))
        
    elif strategy_name == "rsi":
        df["rsi"] = calculate_rsi(df["close"], 14)
        # 1 if rsi < 30, -1 if rsi > 70
        df["signal"] = np.where(df["rsi"] < 30, 1, np.where(df["rsi"] > 70, -1, 0))
        
    elif strategy_name == "macd":
        macd_line, signal_line, hist = calculate_macd(df["close"])
        df["macd"] = macd_line
        df["macd_signal"] = signal_line
        df["macd_hist"] = hist
        
        # 1 if macd > signal, -1 if macd < signal
        df["signal"] = np.where(df["macd"] > df["macd_signal"], 1, np.where(df["macd"] < df["macd_signal"], -1, 0))
        
    elif strategy_name == "bollinger":
        upper, sma, lower = calculate_bollinger_bands(df["close"])
        df["bb_upper"] = upper
        df["bb_middle"] = sma
        df["bb_lower"] = lower
        
        # 1 if close < lower (oversold), -1 if close > upper (overbought)
        df["signal"] = np.where(df["close"] < df["bb_lower"], 1, np.where(df["close"] > df["bb_upper"], -1, 0))
        
    elif strategy_name == "sentiment_sma":
        df["sma"] = calculate_sma(df["close"], 20)
        # Simplified momentum logic to represent sentiment overlay
        df["signal"] = np.where(df["close"] > df["sma"], 1, -1)
        
    # Shift signal by 1 so we trade on the next open to avoid look-ahead bias
    df["target_position"] = df["signal"].shift(1).fillna(0)
    
    return df
