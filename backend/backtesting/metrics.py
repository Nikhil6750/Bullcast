import numpy as np
import pandas as pd

def calculate_metrics(trades: list[dict], equity_curve: list[dict], initial_capital: float) -> dict:
    if not trades or not equity_curve:
        return {
            "total_trades": 0, "winning_trades": 0, "losing_trades": 0, "win_rate": 0.0,
            "total_pnl": 0.0, "return_pct": 0.0, "final_capital": initial_capital,
            "initial_capital": initial_capital, "avg_win": 0.0, "avg_loss": 0.0,
            "profit_factor": 0.0, "max_drawdown": 0.0, "sharpe_ratio": 0.0,
            "sortino_ratio": 0.0, "calmar_ratio": 0.0
        }
        
    total_trades = len(trades)
    winning_trades = sum(1 for t in trades if t["pnl"] > 0)
    losing_trades = sum(1 for t in trades if t["pnl"] <= 0)
    win_rate = (winning_trades / total_trades) * 100 if total_trades > 0 else 0.0
    
    total_pnl = sum(t["pnl"] for t in trades)
    final_capital = equity_curve[-1]["equity"]
    return_pct = ((final_capital - initial_capital) / initial_capital) * 100
    
    wins = [t["pnl"] for t in trades if t["pnl"] > 0]
    losses = [t["pnl"] for t in trades if t["pnl"] <= 0]
    
    avg_win = sum(wins) / len(wins) if wins else 0.0
    avg_loss = sum(losses) / len(losses) if losses else 0.0
    
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = gross_profit / gross_loss if gross_loss != 0 else float('inf') if gross_profit > 0 else 0.0
    
    # Calculate drawdown
    eq_df = pd.DataFrame(equity_curve)
    eq_df["peak"] = eq_df["equity"].cummax()
    eq_df["drawdown"] = (eq_df["peak"] - eq_df["equity"]) / eq_df["peak"] * 100
    max_drawdown = eq_df["drawdown"].max()
    
    # Calculate ratios
    eq_df["returns"] = eq_df["equity"].pct_change().fillna(0)
    daily_rf = 0.02 / 252 # Assumed 2% risk free rate
    
    mean_ret = eq_df["returns"].mean()
    std_ret = eq_df["returns"].std()
    
    # Annualized Sharpe (assuming daily data, 252 days)
    if std_ret > 0:
        sharpe_ratio = ((mean_ret - daily_rf) / std_ret) * np.sqrt(252)
    else:
        sharpe_ratio = 0.0
        
    # Sortino
    downside_returns = eq_df[eq_df["returns"] < 0]["returns"]
    downside_std = downside_returns.std()
    if pd.isna(downside_std) or downside_std == 0:
        sortino_ratio = 0.0
    else:
        sortino_ratio = ((mean_ret - daily_rf) / downside_std) * np.sqrt(252)
        
    # Calmar (Annualized Return / Max Drawdown)
    days = len(eq_df)
    if days > 0 and max_drawdown > 0:
        ann_return = ((final_capital / initial_capital) ** (252 / days)) - 1
        calmar_ratio = (ann_return * 100) / max_drawdown
    else:
        calmar_ratio = 0.0
        
    return {
        "total_trades": total_trades,
        "winning_trades": winning_trades,
        "losing_trades": losing_trades,
        "win_rate": round(win_rate, 2),
        "total_pnl": round(total_pnl, 2),
        "return_pct": round(return_pct, 2),
        "final_capital": round(final_capital, 2),
        "initial_capital": initial_capital,
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "profit_factor": round(profit_factor, 2) if profit_factor != float('inf') else 999.9,
        "max_drawdown": round(max_drawdown, 2),
        "sharpe_ratio": round(sharpe_ratio, 2),
        "sortino_ratio": round(sortino_ratio, 2),
        "calmar_ratio": round(calmar_ratio, 2)
    }
