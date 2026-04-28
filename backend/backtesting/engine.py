import pandas as pd
import numpy as np
from .strategies import apply_strategy

def run_backtest(df_records: list[dict], strategy: str, initial_capital: float = 100000.0, commission: float = 0.001, slippage: float = 0.0005):
    if not df_records:
        return {"trades": [], "metrics": {}, "equity_curve": [], "chart_data": []}
        
    df = pd.DataFrame(df_records)
    # Ensure time is sorted
    if "time" in df.columns:
        df = df.sort_values(by="time").reset_index(drop=True)
    
    df = apply_strategy(df, strategy)
    
    capital = initial_capital
    position = 0
    entry_price = 0.0
    
    trades = []
    equity_curve = []
    
    # Iterate row by row for execution
    for i, row in df.iterrows():
        current_price = row["open"] # Execute at open of next candle based on shifted signal
        close_price = row["close"]
        time_ms = row.get("time", i)
        
        target_position = row.get("target_position", 0)
        
        # Calculate current equity before any new trades
        current_equity = capital + (position * close_price)
        
        if target_position != 0 and position == 0:
            # Entry
            qty = (capital * 0.95) / current_price # Use 95% of capital
            
            # Apply slippage
            exec_price = current_price * (1 + slippage) if target_position > 0 else current_price * (1 - slippage)
            cost = (qty * exec_price) * commission
            
            if capital >= (qty * exec_price) + cost:
                position = qty if target_position > 0 else -qty
                entry_price = exec_price
                capital -= (qty * exec_price) + cost
                
        elif target_position == 0 and position != 0:
            # Exit
            exec_price = current_price * (1 - slippage) if position > 0 else current_price * (1 + slippage)
            cost = abs(position * exec_price) * commission
            
            capital += (position * exec_price) - cost
            
            pnl = (exec_price - entry_price) * abs(position) if position > 0 else (entry_price - exec_price) * abs(position)
            pnl -= cost
            
            trades.append({
                "entry_time": time_ms,
                "exit_time": time_ms,
                "type": "LONG" if position > 0 else "SHORT",
                "entry_price": entry_price,
                "exit_price": exec_price,
                "pnl": pnl,
                "return_pct": pnl / (abs(position) * entry_price) * 100
            })
            
            position = 0
            entry_price = 0.0
            
        elif target_position != 0 and position != 0 and (
            (target_position > 0 and position < 0) or (target_position < 0 and position > 0)
        ):
            # Reverse position
            exec_price = current_price * (1 - slippage) if position > 0 else current_price * (1 + slippage)
            cost = abs(position * exec_price) * commission
            
            capital += (position * exec_price) - cost
            
            pnl = (exec_price - entry_price) * abs(position) if position > 0 else (entry_price - exec_price) * abs(position)
            pnl -= cost
            
            trades.append({
                "entry_time": time_ms,
                "exit_time": time_ms,
                "type": "LONG" if position > 0 else "SHORT",
                "entry_price": entry_price,
                "exit_price": exec_price,
                "pnl": pnl,
                "return_pct": pnl / (abs(position) * entry_price) * 100
            })
            
            position = 0
            
            # Re-enter
            qty = (capital * 0.95) / current_price
            exec_price2 = current_price * (1 + slippage) if target_position > 0 else current_price * (1 - slippage)
            cost2 = (qty * exec_price2) * commission
            
            if capital >= (qty * exec_price2) + cost2:
                position = qty if target_position > 0 else -qty
                entry_price = exec_price2
                capital -= (qty * exec_price2) + cost2
                
        # Final equity calculation for this step using close price
        step_equity = capital + (position * close_price)
        equity_curve.append({
            "time": time_ms,
            "equity": step_equity
        })
        
    # Close any open positions at the end
    if position != 0:
        exec_price = df.iloc[-1]["close"]
        cost = abs(position * exec_price) * commission
        capital += (position * exec_price) - cost
        pnl = (exec_price - entry_price) * abs(position) if position > 0 else (entry_price - exec_price) * abs(position)
        pnl -= cost
        trades.append({
            "entry_time": df.iloc[-1].get("time", len(df)),
            "exit_time": df.iloc[-1].get("time", len(df)),
            "type": "LONG" if position > 0 else "SHORT",
            "entry_price": entry_price,
            "exit_price": exec_price,
            "pnl": pnl,
            "return_pct": pnl / (abs(position) * entry_price) * 100
        })
        equity_curve[-1]["equity"] = capital

    from .metrics import calculate_metrics
    metrics = calculate_metrics(trades, equity_curve, initial_capital)
    
    # Replace nan with None for JSON serialization
    df = df.replace({np.nan: None})
    chart_data = df.to_dict(orient="records")
    
    # Only return specific signal series to avoid huge response payload
    signals = []
    if "signal" in df.columns:
        signals = df[["time", "signal"]].to_dict(orient="records")
    
    return {
        "trades": trades,
        "metrics": metrics,
        "equity_curve": equity_curve,
        "chart_data": chart_data,
        "signals": signals
    }
