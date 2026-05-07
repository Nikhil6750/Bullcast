import pandas as pd
import numpy as np


class TradeAnalyzer:

    def __init__(self, trades: list[dict], context: dict | None = None):
        """
        Initialize with list of trade dicts.
        Converts to DataFrame immediately.
        Handles empty list gracefully.
        """
        self.context = context or {}
        self.trade_contexts = self.context.get("trades", [])

        if not trades:
            self.df = pd.DataFrame()
            self.empty = True
            return

        self.df = pd.DataFrame(trades)
        self.df['date'] = pd.to_datetime(self.df['date'])
        self.df['day_of_week'] = self.df['date'].dt.day_name()
        self.df['month'] = self.df['date'].dt.month_name()
        self.df['is_win'] = self.df['result'] == 'WIN'
        self.empty = len(self.df) == 0

    def get_basic_stats(self) -> dict:
        """
        Returns fundamental performance stats.
        Always returns a complete dict even if data sparse.
        """
        if self.empty:
            return self._empty_stats()

        wins = self.df[self.df['is_win']]
        losses = self.df[~self.df['is_win']]

        return {
            "total_trades": len(self.df),
            "total_wins": len(wins),
            "total_losses": len(losses),
            "win_rate": round(
                len(wins) / len(self.df) * 100, 1),
            "total_pnl": round(
                self.df['pnl'].sum(), 2),
            "avg_win": round(
                wins['pnl'].mean(), 2) if len(wins)
                else 0,
            "avg_loss": round(
                losses['pnl'].mean(), 2) if len(losses)
                else 0,
            "best_trade": round(
                self.df['pnl'].max(), 2),
            "worst_trade": round(
                self.df['pnl'].min(), 2),
            "profit_factor": round(
                wins['pnl'].sum() / abs(losses['pnl'].sum()),
                2) if len(losses) and losses['pnl'].sum() != 0
                else 0,
            "risk_reward_ratio": round(
                abs(wins['pnl'].mean() / losses['pnl'].mean()),
                2) if len(wins) and len(losses) else 0,
            "avg_pnl_per_trade": round(
                self.df['pnl'].mean(), 2),
        }

    def get_win_rate_by_day(self) -> dict:
        """
        Win rate for each day of the week.
        Only includes days with at least 1 trade.
        """
        if self.empty or len(self.df) < 3:
            return {}

        days_order = ['Monday','Tuesday','Wednesday',
                      'Thursday','Friday','Saturday','Sunday']
        result = {}

        for day in days_order:
            day_trades = self.df[
                self.df['day_of_week'] == day]
            if len(day_trades) > 0:
                result[day] = {
                    "trades": len(day_trades),
                    "win_rate": round(
                        day_trades['is_win'].mean() * 100, 1),
                    "avg_pnl": round(
                        day_trades['pnl'].mean(), 2)
                }
        return result

    def get_win_rate_by_symbol(self) -> list:
        """
        Per-symbol performance sorted by trade count.
        Returns list of dicts sorted by total_trades desc.
        """
        if self.empty:
            return []

        result = []
        for symbol, group in self.df.groupby('symbol'):
            wins = group[group['is_win']]
            result.append({
                "symbol": symbol,
                "trades": len(group),
                "win_rate": round(
                    group['is_win'].mean() * 100, 1),
                "total_pnl": round(group['pnl'].sum(), 2),
                "avg_pnl": round(group['pnl'].mean(), 2)
            })

        return sorted(result,
                      key=lambda x: x['trades'],
                      reverse=True)

    def get_win_rate_by_type(self) -> dict:
        """
        LONG vs SHORT performance comparison.
        """
        if self.empty:
            return {}

        result = {}
        for trade_type in ['LONG', 'SHORT']:
            group = self.df[self.df['type'] == trade_type]
            if len(group) > 0:
                result[trade_type] = {
                    "trades": len(group),
                    "win_rate": round(
                        group['is_win'].mean() * 100, 1),
                    "avg_pnl": round(group['pnl'].mean(), 2),
                    "total_pnl": round(group['pnl'].sum(), 2)
                }
        return result

    def get_streak_analysis(self) -> dict:
        """
        Detects win/loss streaks.
        Current streak, longest win streak,
        longest loss streak.
        """
        if self.empty or len(self.df) < 2:
            return {}

        sorted_df = self.df.sort_values('date')
        results = sorted_df['is_win'].tolist()

        max_win_streak = 0
        max_loss_streak = 0
        current_streak = 0
        current_type = None
        streak_type = None

        for r in results:
            if r == current_type:
                current_streak += 1
            else:
                current_type = r
                current_streak = 1

            if r and current_streak > max_win_streak:
                max_win_streak = current_streak
            elif not r and current_streak > max_loss_streak:
                max_loss_streak = current_streak

        last_result = results[-1]
        streak_type = "WIN" if last_result else "LOSS"
        current_ongoing = 0
        for r in reversed(results):
            if r == last_result:
                current_ongoing += 1
            else:
                break

        return {
            "max_win_streak": max_win_streak,
            "max_loss_streak": max_loss_streak,
            "current_streak": current_ongoing,
            "current_streak_type": streak_type
        }

    def get_pnl_distribution(self) -> dict:
        """
        Breaks PnL into buckets for visualization.
        """
        if self.empty:
            return {}

        pnls = self.df['pnl'].tolist()
        return {
            "values": [round(p, 2) for p in pnls],
            "dates": self.df['date'].dt.strftime(
                '%Y-%m-%d').tolist(),
            "symbols": self.df['symbol'].tolist(),
            "results": self.df['result'].tolist()
        }

    def get_sentiment_alignment(self) -> dict:
        """
        Compares stock trade direction against available
        sentiment context. Returns an empty dict when
        coverage is too low.
        """
        if self.empty or not self.trade_contexts:
            return {}

        rows = []
        for idx, trade in enumerate(self.df.to_dict("records")):
            ctx = self.trade_contexts[idx] if idx < len(self.trade_contexts) else {}
            if not ctx.get("sentiment_available"):
                continue

            label = str(ctx.get("sentiment_label") or "").upper()
            if label not in {"BULLISH", "BEARISH", "NEUTRAL"}:
                continue

            trade_type = str(trade.get("type", "LONG")).upper()
            alignment = "neutral"
            if trade_type == "LONG":
                if label == "BULLISH":
                    alignment = "aligned"
                elif label == "BEARISH":
                    alignment = "misaligned"
            elif trade_type == "SHORT":
                if label == "BEARISH":
                    alignment = "aligned"
                elif label == "BULLISH":
                    alignment = "misaligned"

            rows.append({
                "alignment": alignment,
                "sentiment_label": label,
                "is_win": bool(trade.get("is_win")),
                "pnl": float(trade.get("pnl", 0) or 0),
                "symbol": trade.get("symbol"),
                "type": trade_type,
            })

        if len(rows) < 3:
            return {}

        aligned = [row for row in rows if row["alignment"] == "aligned"]
        misaligned = [row for row in rows if row["alignment"] == "misaligned"]
        if len(aligned) + len(misaligned) < 2:
            return {}

        return {
            "trades_with_sentiment": len(rows),
            "coverage": round(len(rows) / len(self.df) * 100, 1),
            "aligned": self._alignment_bucket(aligned),
            "misaligned": self._alignment_bucket(misaligned),
            "neutral": self._alignment_bucket(
                [row for row in rows if row["alignment"] == "neutral"]
            ),
            "by_sentiment": {
                label: self._alignment_bucket(
                    [row for row in rows if row["sentiment_label"] == label]
                )
                for label in ["BULLISH", "BEARISH", "NEUTRAL"]
            },
        }

    def get_context_insights(self) -> list[dict]:
        alignment = self.get_sentiment_alignment()
        if not alignment:
            return []

        aligned = alignment.get("aligned", {})
        misaligned = alignment.get("misaligned", {})
        if aligned.get("trades", 0) < 1 or misaligned.get("trades", 0) < 1:
            return []

        return [{
            "type": "sentiment_alignment",
            "title": "Sentiment Alignment Pattern",
            "finding": (
                "Your sentiment-aligned trades have a "
                f"{aligned.get('win_rate', 0)}% win rate versus "
                f"{misaligned.get('win_rate', 0)}% for misaligned trades."
            ),
            "recommendation": (
                "For the next 10 trades, record whether the trade direction "
                "agrees with market sentiment before entry."
            ),
            "severity": "info",
            "data": alignment,
        }]

    def generate_insights(self) -> list[dict]:
        """
        Generates structured insight objects.
        Each insight has: type, title, finding,
        recommendation, severity, data.
        severity: "positive" | "warning" | "critical" | "info"
        """
        if self.empty or len(self.df) < 3:
            return [{
                "type": "insufficient_data",
                "title": "Not enough trades yet",
                "finding": f"You have {len(self.df)} trade(s) logged. Add at least 3 trades to see patterns.",
                "recommendation": "Keep logging your trades. Patterns become visible after 10+ trades.",
                "severity": "info",
                "data": {}
            }]

        insights = []
        stats = self.get_basic_stats()

        rr = stats.get('risk_reward_ratio', 0)
        win_rate = stats.get('win_rate', 0)
        if rr < 1.0 and rr > 0:
            breakeven_wr = round(
                100 / (1 + rr), 1)
            insights.append({
                "type": "risk_reward",
                "title": "Risk/Reward Imbalance",
                "finding": f"Your avg win (₹{stats['avg_win']:,.0f}) vs avg loss (₹{abs(stats['avg_loss']):,.0f}) gives a {rr:.2f} R/R ratio.",
                "recommendation": f"You need {breakeven_wr}%+ win rate to break even at this ratio. Your current rate is {win_rate}%.",
                "severity": "critical" if win_rate < breakeven_wr else "warning",
                "data": {
                    "avg_win": stats['avg_win'],
                    "avg_loss": stats['avg_loss'],
                    "ratio": rr,
                    "breakeven_win_rate": breakeven_wr,
                    "current_win_rate": win_rate
                }
            })

        day_data = self.get_win_rate_by_day()
        if len(day_data) >= 3:
            best_day = max(day_data.items(),
                          key=lambda x: x[1]['win_rate'])
            worst_day = min(day_data.items(),
                           key=lambda x: x[1]['win_rate'])
            if best_day[1]['win_rate'] - \
               worst_day[1]['win_rate'] > 20:
                insights.append({
                    "type": "day_of_week",
                    "title": "Day-of-Week Pattern Detected",
                    "finding": f"Best: {best_day[0]} ({best_day[1]['win_rate']}% win rate). Worst: {worst_day[0]} ({worst_day[1]['win_rate']}% win rate).",
                    "recommendation": f"Consider avoiding trades on {worst_day[0]}. Your data suggests {best_day[0]} is your strongest trading day.",
                    "severity": "warning",
                    "data": day_data
                })

        symbol_data = self.get_win_rate_by_symbol()
        if symbol_data:
            worst_symbol = min(symbol_data,
                key=lambda x: x['avg_pnl']
                if x['trades'] >= 2 else 0)
            best_symbol = max(symbol_data,
                key=lambda x: x['win_rate']
                if x['trades'] >= 2 else 0)
            if worst_symbol['avg_pnl'] < -500:
                insights.append({
                    "type": "symbol_performance",
                    "title": f"Consistent Losses on {worst_symbol['symbol']}",
                    "finding": f"{worst_symbol['symbol']}: {worst_symbol['trades']} trades, {worst_symbol['win_rate']}% win rate, avg ₹{worst_symbol['avg_pnl']:,.0f} per trade.",
                    "recommendation": f"Review your entry criteria for {worst_symbol['symbol']}. Consider paper trading it before going live.",
                    "severity": "warning",
                    "data": {"worst": worst_symbol, "best": best_symbol}
                })

        streak = self.get_streak_analysis()
        if streak:
            if streak.get('current_streak', 0) >= 3 and \
               streak.get('current_streak_type') == 'LOSS':
                insights.append({
                    "type": "loss_streak",
                    "title": f"{streak['current_streak']}-Trade Loss Streak",
                    "finding": f"You are currently on a {streak['current_streak']}-trade losing streak.",
                    "recommendation": "Consider reducing position size or pausing trading. Loss streaks can lead to revenge trading which makes things worse.",
                    "severity": "critical",
                    "data": streak
                })
            elif streak.get('current_streak', 0) >= 4 and \
                 streak.get('current_streak_type') == 'WIN':
                insights.append({
                    "type": "win_streak",
                    "title": f"{streak['current_streak']}-Trade Win Streak",
                    "finding": f"You are on a {streak['current_streak']}-trade winning streak.",
                    "recommendation": "Good momentum. Stick to your current strategy and avoid increasing size too aggressively.",
                    "severity": "positive",
                    "data": streak
                })

        total_pnl = stats.get('total_pnl', 0)
        total_trades = stats.get('total_trades', 0)
        if total_trades >= 5:
            verdict_severity = "positive" if total_pnl > 0 \
                               else "critical"
            insights.append({
                "type": "overall_verdict",
                "title": "Overall Performance",
                "finding": f"Across {total_trades} trades: net ₹{total_pnl:+,.2f}, {win_rate}% win rate, profit factor {stats.get('profit_factor', 0):.2f}.",
                "recommendation": "A profit factor above 1.5 is considered good. Above 2.0 is strong." if stats.get('profit_factor', 0) > 0 else "Focus on consistency before increasing trade size.",
                "severity": verdict_severity,
                "data": stats
            })

        insights.extend(self.get_context_insights())
        return insights

    def get_all_analysis(self) -> dict:
        """
        Master method — returns everything at once.
        Used by the /api/intelligence/analyze endpoint.
        """
        return {
            "basic_stats": self.get_basic_stats(),
            "by_day": self.get_win_rate_by_day(),
            "by_symbol": self.get_win_rate_by_symbol(),
            "by_type": self.get_win_rate_by_type(),
            "streaks": self.get_streak_analysis(),
            "pnl_distribution": self.get_pnl_distribution(),
            "sentiment_alignment": self.get_sentiment_alignment(),
            "insights": self.generate_insights(),
            "trade_count": len(self.df) if not self.empty else 0
        }

    def _empty_stats(self) -> dict:
        return {
            "total_trades": 0, "total_wins": 0,
            "total_losses": 0, "win_rate": 0,
            "total_pnl": 0, "avg_win": 0,
            "avg_loss": 0, "best_trade": 0,
            "worst_trade": 0, "profit_factor": 0,
            "risk_reward_ratio": 0, "avg_pnl_per_trade": 0
        }

    def _alignment_bucket(self, rows: list[dict]) -> dict:
        if not rows:
            return {"trades": 0, "win_rate": 0, "avg_pnl": 0, "total_pnl": 0}

        pnl_values = [row["pnl"] for row in rows]
        wins = [row for row in rows if row["is_win"]]
        return {
            "trades": len(rows),
            "win_rate": round(len(wins) / len(rows) * 100, 1),
            "avg_pnl": round(sum(pnl_values) / len(rows), 2),
            "total_pnl": round(sum(pnl_values), 2),
        }
