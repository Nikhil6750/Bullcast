from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from backend.journal import is_synthetic_trade, normalize_journal_trade


NONE_TAGS = {"", "none", "null", "undefined", "n/a", "na"}
STREAK_PULLBACK_SETUP = "streak_pullback_confirmation"
SIMULATED_MARKERS = (
    "simulated data",
    "not real trading history",
    "generated from ohlc",
    "streak pullback confirmation",
)


class HumanTradeTrainingEngine:
    """
    Builds an educational behavior profile from completed journal trades.

    This does not train a predictive model. It turns journal history, including
    explicitly labeled simulated training rows, into decision-support context.
    """

    def __init__(self, trades: list[dict[str, Any]] | None):
        normalized = [normalize_journal_trade(trade, index) for index, trade in enumerate(trades or [])]
        self.all_trades = normalized
        self.synthetic_trades = [trade for trade in normalized if is_synthetic_trade(trade)]
        self.simulated_training_trades = [trade for trade in normalized if _is_simulated_training_trade(trade)]
        self.real_trades = [
            trade
            for trade in normalized
            if trade not in self.synthetic_trades and trade not in self.simulated_training_trades
        ]
        self.trades = normalized

    def build_profile(self) -> dict[str, Any]:
        if not self.all_trades:
            return self._empty_profile("no_data", "No journal trades are available yet.")

        metrics = self._metrics()
        repeated_mistakes = self._repeated_mistakes()
        best_symbols = self._performance_by("symbol")
        best_setups = self._performance_by("setup_tag", skip_none=True)
        behavior = self._behavior_profile(
            metrics=metrics,
            repeated_mistakes=repeated_mistakes,
            best_symbols=best_symbols,
            best_setups=best_setups,
        )

        status = "ready" if len(self.trades) >= 5 else "insufficient_data"
        if self.real_trades and len(self.real_trades) < len(self.trades):
            status = "mixed_training_data" if len(self.trades) >= 5 else "insufficient_data"
        elif not self.real_trades and self.simulated_training_trades:
            status = "simulated_training_data" if len(self.trades) >= 5 else "insufficient_data"

        if len(self.trades) < 5:
            behavior["behavioral_warning"] = (
                "Journal sample is still small. Treat behavior findings as early signals, not stable patterns."
            )
            behavior["confidence_score"] = min(behavior["confidence_score"], 35)

        return {
            "status": status,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sample_size": len(self.trades),
            "total_journal_trades": len(self.all_trades),
            "excluded_synthetic_trades": 0,
            "synthetic_rows_observed": len(self.synthetic_trades),
            "simulated_training_rows_used": len(self.simulated_training_trades),
            "real_rows_used": len(self.real_trades),
            "data_origin": self._data_origin(),
            "metrics": metrics,
            "repeated_mistakes": repeated_mistakes,
            "symbol_history": best_symbols,
            "setup_history": best_setups,
            "best_symbols": best_symbols[:5],
            "best_setups": best_setups[:5],
            "behavior_profile": behavior,
        }

    def analyze_future_trade(self, candidate_trade: dict[str, Any] | None) -> dict[str, Any]:
        profile = self.build_profile()
        trade = normalize_journal_trade(candidate_trade or {}, 0)
        behavior = profile.get("behavior_profile", {})
        metrics = profile.get("metrics", {})
        risk_score = int(behavior.get("risk_score") or 50)
        confidence_score = int(behavior.get("confidence_score") or 0)
        reasons: list[str] = []

        if profile.get("status") not in {
            "ready",
            "insufficient_data",
            "mixed_training_data",
            "simulated_training_data",
        }:
            return {
                "risk_score": 50,
                "confidence_score": 0,
                "behavioral_warning": "No journal profile is available yet.",
                "setup_quality_assessment": "No setup history available.",
                "explanation": profile.get("message") or "Add real, paper, or simulated training trades before reviewing future trades against history.",
                "matched_history": {},
                "profile_status": profile.get("status", "no_data"),
                "reasoning_priority": "empty_state",
                "data_origin": profile.get("data_origin", {}),
            }

        setup_key = _setup_key(trade)
        symbol = str(trade.get("symbol") or "").strip().upper()
        direction = _direction_label(trade)
        setup_match = self._match_setup(setup_key)
        setup_symbol_match = self._match_setup(setup_key, symbol=symbol, direction=direction)
        symbol_match = self._match_group("symbol", symbol)

        if setup_match:
            setup_label = _display_tag(setup_match["key"])
            reasons.append(
                f"Historical {setup_label} setups: {setup_match['trades']} trades, "
                f"{setup_match['win_rate']}% win rate, average R:R {setup_match['average_rr']}, "
                f"average confidence {setup_match['average_confidence']}."
            )
            risk_score += _setup_risk_adjustment(setup_match)
            confidence_score += _setup_confidence_adjustment(setup_match)

        if setup_symbol_match:
            side_text = f" {direction.lower()}" if direction else ""
            if setup_key == STREAK_PULLBACK_SETUP:
                history_label = f"Historical {symbol}{side_text} streak setups"
            else:
                history_label = f"{symbol} history for{side_text} {_display_tag(setup_key)} setups"
            reasons.append(
                f"{history_label}: {setup_symbol_match['trades']} trades, "
                f"{setup_symbol_match['win_rate']}% win rate, average R:R {setup_symbol_match['average_rr']}."
            )
            risk_score += _setup_risk_adjustment(setup_symbol_match, symbol_specific=True)
            confidence_score += _setup_confidence_adjustment(setup_symbol_match)

        if symbol_match and not setup_symbol_match:
            reasons.append(
                f"{symbol_match['key'].upper()} symbol history: {symbol_match['trades']} trades, "
                f"{symbol_match['win_rate']}% win rate, net PnL {symbol_match['total_pnl']}."
            )
            if symbol_match["trades"] >= 3 and symbol_match["win_rate"] < 45:
                risk_score += 10
            elif symbol_match["trades"] >= 3 and symbol_match["win_rate"] >= 60 and symbol_match["total_pnl"] > 0:
                risk_score -= 6

        planned_rr = _planned_rr(trade)
        if planned_rr is not None and planned_rr < 1:
            risk_score += 14
            confidence_score -= 6
            reasons.append(f"Planned R:R is {planned_rr}, below 1.0.")

        repeated = setup_symbol_match.get("repeated_mistakes") if setup_symbol_match else []
        if not repeated and setup_match:
            repeated = setup_match.get("repeated_mistakes", [])
        if not repeated:
            repeated = profile.get("repeated_mistakes", [])

        if repeated:
            primary = repeated[0]
            risk_score += min(18, int(primary.get("count", 0)) * 3)
            reasons.append(
                f"Repeated {primary.get('tag')} behavior detected in journal history "
                f"({primary.get('count')} times, {primary.get('loss_rate')}% loss rate)."
            )

        context_flags = _candidate_context_flags(trade)
        if context_flags["weak_confirmation"]:
            risk_score += 12
            confidence_score -= 8
            reasons.append("Confidence score reduced because the candidate mentions weak confirmation.")
        if context_flags["high_volatility"]:
            risk_score += 10
            confidence_score -= 6
            reasons.append("Confidence score reduced because similar setups historically underperformed during high volatility or the candidate flags high volatility.")
        if (
            setup_symbol_match
            and direction == "bullish"
            and symbol == "NIFTY"
            and setup_symbol_match.get("win_rate", 0) < 45
        ):
            reasons.append("Historical NIFTY bullish streak setups show lower expectancy after weak confirmation candles.")

        if trade.get("confidence_score") and metrics.get("average_confidence"):
            trade_conf = float(trade["confidence_score"])
            avg_conf = float(metrics["average_confidence"])
            if trade_conf >= 4 and avg_conf >= 4 and metrics.get("win_rate", 0) < 50:
                risk_score += 10
                confidence_score -= 5
                reasons.append("High-confidence trades have not yet translated into a strong journal win rate.")

        setup_quality = _setup_quality_assessment(setup_symbol_match or setup_match)
        warning = self._candidate_warning(risk_score, behavior, repeated)
        risk_score = _bounded_int(risk_score)
        confidence_score = _bounded_int(confidence_score - max(0, risk_score - 50) // 3)

        if not reasons:
            reasons.append(str(behavior.get("explanation") or "No close symbol or setup history was found; use general journal behavior only."))

        if profile.get("data_origin", {}).get("simulated_only"):
            reasons.append(
                "This profile is based on simulated training rows, so treat it as coaching rehearsal rather than evidence of live trading performance."
            )

        return {
            "risk_score": risk_score,
            "confidence_score": confidence_score,
            "behavioral_warning": warning,
            "setup_quality_assessment": setup_quality,
            "explanation": " ".join(reason for reason in reasons if reason),
            "matched_history": {
                "setup": setup_match or {},
                "setup_symbol": setup_symbol_match or {},
                "symbol": symbol_match or {},
                "planned_rr": planned_rr,
                "repeated_mistakes": repeated[:5] if isinstance(repeated, list) else [],
                "confidence_distribution": (setup_symbol_match or setup_match or {}).get("confidence_distribution", {}),
            },
            "profile_status": profile.get("status"),
            "reasoning_priority": "trader_profile" if setup_match or symbol_match else "general_profile",
            "data_origin": profile.get("data_origin", {}),
        }

    def _metrics(self) -> dict[str, Any]:
        wins = [trade for trade in self.trades if _pnl(trade) > 0 or trade.get("result") == "WIN"]
        losses = [trade for trade in self.trades if _pnl(trade) < 0 or trade.get("result") == "LOSS"]
        total = len(self.trades)
        win_rate = round((len(wins) / total) * 100, 1) if total else 0.0
        loss_rate = round((len(losses) / total) * 100, 1) if total else 0.0
        pnl_values = [_pnl(trade) for trade in self.trades]
        win_pnls = [_pnl(trade) for trade in wins if _pnl(trade) > 0]
        loss_pnls = [_pnl(trade) for trade in losses if _pnl(trade) < 0]
        trade_rrs = [_trade_rr(trade) for trade in self.trades]
        trade_rrs = [value for value in trade_rrs if value is not None]
        realized_rr = _realized_rr(win_pnls, loss_pnls)
        average_rr = round(sum(trade_rrs) / len(trade_rrs), 2) if trade_rrs else realized_rr
        confidence_values = [
            float(trade["confidence_score"])
            for trade in self.trades
            if isinstance(trade.get("confidence_score"), int)
        ]
        rule_values = [trade.get("rule_followed") for trade in self.trades if trade.get("rule_followed") is not None]

        gross_profit = sum(win_pnls)
        gross_loss = abs(sum(loss_pnls))
        profit_factor = round(gross_profit / gross_loss, 2) if gross_loss else 0.0

        return {
            "total_trades": total,
            "total_wins": len(wins),
            "total_losses": len(losses),
            "win_rate": win_rate,
            "loss_rate": loss_rate,
            "net_pnl": round(sum(pnl_values), 2),
            "profit_factor": profit_factor,
            "average_rr": average_rr,
            "realized_rr": realized_rr,
            "average_confidence": round(sum(confidence_values) / len(confidence_values), 2) if confidence_values else None,
            "rule_follow_rate": round((sum(1 for value in rule_values if value is True) / len(rule_values)) * 100, 1)
            if rule_values
            else None,
            "confidence_coverage": round((len(confidence_values) / total) * 100, 1) if total else 0.0,
            "planned_rr_coverage": round((len([rr for rr in trade_rrs if rr is not None]) / total) * 100, 1) if total else 0.0,
            "confidence_distribution": _confidence_distribution(self.trades),
        }

    def _repeated_mistakes(self) -> list[dict[str, Any]]:
        rows = [trade for trade in self.trades if not _is_none_tag(trade.get("mistake_tag"))]
        return _mistake_rows(rows)

    def _performance_by(self, field: str, *, skip_none: bool = False) -> list[dict[str, Any]]:
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for trade in self.trades:
            key = _setup_key(trade) if field == "setup_tag" else _canonical_tag(trade.get(field))
            if skip_none and _is_none_tag(key):
                continue
            if not key:
                continue
            groups[key].append(trade)

        rows = [_group_performance(key, values) for key, values in groups.items()]
        return sorted(rows, key=lambda row: (row["total_pnl"], row["win_rate"], row["trades"]), reverse=True)

    def _match_group(self, field: str, value: Any) -> dict[str, Any] | None:
        key = _canonical_tag(value)
        if not key or _is_none_tag(key):
            return None
        values = [trade for trade in self.trades if _canonical_tag(trade.get(field)) == key]
        if not values:
            return None
        return _group_performance(key, values)

    def _match_setup(self, setup_key: str, *, symbol: str | None = None, direction: str | None = None) -> dict[str, Any] | None:
        key = _canonical_tag(setup_key)
        if not key or _is_none_tag(key):
            return None

        values = [trade for trade in self.trades if _setup_key(trade) == key]
        if symbol:
            symbol_key = str(symbol or "").strip().upper()
            values = [trade for trade in values if str(trade.get("symbol") or "").strip().upper() == symbol_key]
        if direction:
            values = [trade for trade in values if _direction_label(trade) == direction]
        if not values:
            return None
        return _group_performance(key, values)

    def _behavior_profile(
        self,
        *,
        metrics: dict[str, Any],
        repeated_mistakes: list[dict[str, Any]],
        best_symbols: list[dict[str, Any]],
        best_setups: list[dict[str, Any]],
    ) -> dict[str, Any]:
        risk_score = 25
        strengths: list[str] = []
        weaknesses: list[str] = []

        if metrics["loss_rate"] >= 55:
            risk_score += 18
            weaknesses.append("Loss rate is above 55%.")
        if metrics["average_rr"] and metrics["average_rr"] < 1:
            risk_score += 18
            weaknesses.append("Average R:R is below 1.0.")
        if metrics["profit_factor"] and metrics["profit_factor"] < 1:
            risk_score += 16
            weaknesses.append("Profit factor is below 1.0.")
        if repeated_mistakes:
            risk_score += min(24, repeated_mistakes[0]["count"] * 6)
            weaknesses.append(f"Most repeated mistake: {repeated_mistakes[0]['tag']}.")
        if metrics.get("rule_follow_rate") is not None and metrics["rule_follow_rate"] < 70:
            risk_score += 12
            weaknesses.append("Rule-following rate is below 70%.")
        if metrics.get("average_confidence") and metrics["average_confidence"] >= 4 and metrics["win_rate"] < 50:
            risk_score += 10
            weaknesses.append("Average confidence is high while win rate is below 50%.")

        if metrics["win_rate"] >= 55:
            strengths.append("Win rate is above 55%.")
            risk_score -= 8
        if metrics["average_rr"] and metrics["average_rr"] >= 1.5:
            strengths.append("Average R:R is at least 1.5.")
            risk_score -= 10
        if metrics["profit_factor"] >= 1.5:
            strengths.append("Profit factor is above 1.5.")
            risk_score -= 10
        if best_symbols:
            strengths.append(f"Strongest symbol by PnL: {best_symbols[0]['key']}.")
        if best_setups:
            strengths.append(f"Strongest setup by PnL: {best_setups[0]['key']}.")

        label = "Balanced but still developing"
        if repeated_mistakes and metrics["loss_rate"] >= 50:
            label = "Discipline-risk profile"
        elif metrics.get("average_confidence") and metrics["average_confidence"] >= 4 and metrics["win_rate"] < 50:
            label = "Overconfidence-risk profile"
        elif metrics["average_rr"] and metrics["average_rr"] < 1:
            label = "Risk/reward-compression profile"
        elif metrics["profit_factor"] >= 1.5 and metrics["win_rate"] >= 55:
            label = "Consistent-execution profile"

        risk_score = _bounded_int(risk_score)
        confidence_score = self._profile_confidence(metrics=metrics, risk_score=risk_score)
        warning = weaknesses[0] if weaknesses else "No dominant behavior warning detected from the current sample."
        explanation = self._profile_explanation(label, metrics, repeated_mistakes, best_symbols, best_setups)

        return {
            "label": label,
            "risk_score": risk_score,
            "confidence_score": confidence_score,
            "behavioral_warning": warning,
            "explanation": explanation,
            "strengths": strengths,
            "weaknesses": weaknesses,
        }

    def _profile_confidence(self, *, metrics: dict[str, Any], risk_score: int) -> int:
        sample = len(self.trades)
        score = min(45, sample * 4)
        score += int((metrics.get("confidence_coverage") or 0) * 0.15)
        score += int((metrics.get("planned_rr_coverage") or 0) * 0.15)
        if metrics.get("rule_follow_rate") is not None:
            score += 10
        if risk_score > 70 and sample < 10:
            score -= 8
        return _bounded_int(score)

    def _profile_explanation(
        self,
        label: str,
        metrics: dict[str, Any],
        repeated_mistakes: list[dict[str, Any]],
        best_symbols: list[dict[str, Any]],
        best_setups: list[dict[str, Any]],
    ) -> str:
        row_label = "journal training trades"
        if self.real_trades and not self.simulated_training_trades:
            row_label = "real or paper journal trades"
        elif self.simulated_training_trades and not self.real_trades:
            row_label = "simulated training trades"

        parts = [
            f"{label} based on {metrics['total_trades']} {row_label}.",
            f"Win rate {metrics['win_rate']}%, loss rate {metrics['loss_rate']}%, average R:R {metrics['average_rr']}.",
        ]
        if metrics.get("average_confidence") is not None:
            parts.append(f"Average confidence is {metrics['average_confidence']} out of 5.")
        if repeated_mistakes:
            parts.append(f"Repeated mistake to watch: {repeated_mistakes[0]['tag']} ({repeated_mistakes[0]['count']} times).")
        if best_symbols:
            parts.append(f"Best symbol so far: {best_symbols[0]['key']} with net PnL {best_symbols[0]['total_pnl']}.")
        if best_setups:
            parts.append(f"Best setup so far: {best_setups[0]['key']} with net PnL {best_setups[0]['total_pnl']}.")
        return " ".join(parts)

    def _candidate_warning(
        self,
        risk_score: int,
        behavior: dict[str, Any],
        repeated_mistakes: list[dict[str, Any]] | None = None,
    ) -> str:
        if repeated_mistakes:
            primary = repeated_mistakes[0]
            return (
                f"Behavioral warning: {primary.get('tag')} has repeated in similar history "
                f"with {primary.get('loss_rate')}% loss rate."
            )
        if risk_score >= 75:
            return "High behavior risk. Review repeated mistakes and planned R:R before acting."
        if risk_score >= 55:
            return str(behavior.get("behavioral_warning") or "Moderate behavior risk based on journal history.")
        return "No major behavior warning from journal history."

    def _data_origin(self) -> dict[str, Any]:
        total = len(self.all_trades)
        simulated = len(self.simulated_training_trades)
        real = len(self.real_trades)
        synthetic = len(self.synthetic_trades)
        return {
            "total_rows": total,
            "real_rows": real,
            "simulated_rows": simulated,
            "synthetic_rows": synthetic,
            "simulated_training_rows_used": simulated,
            "contains_simulated_data": simulated > 0,
            "contains_synthetic_data": synthetic > 0,
            "simulated_only": simulated > 0 and real == 0,
            "training_ratio_simulated": round(simulated / total, 4) if total else 0.0,
            "educational_only": True,
        }

    def _empty_profile(self, status: str, message: str) -> dict[str, Any]:
        return {
            "status": status,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sample_size": 0,
            "total_journal_trades": len(self.all_trades),
            "excluded_synthetic_trades": 0,
            "synthetic_rows_observed": len(self.synthetic_trades),
            "simulated_training_rows_used": len(self.simulated_training_trades),
            "real_rows_used": len(self.real_trades),
            "data_origin": self._data_origin(),
            "message": message,
            "metrics": {
                "total_trades": 0,
                "total_wins": 0,
                "total_losses": 0,
                "win_rate": 0.0,
                "loss_rate": 0.0,
                "net_pnl": 0.0,
                "profit_factor": 0.0,
                "average_rr": 0.0,
                "realized_rr": 0.0,
                "average_confidence": None,
                "rule_follow_rate": None,
                "confidence_coverage": 0.0,
                "planned_rr_coverage": 0.0,
                "confidence_distribution": {},
            },
            "repeated_mistakes": [],
            "symbol_history": [],
            "setup_history": [],
            "best_symbols": [],
            "best_setups": [],
            "behavior_profile": {
                "label": "No profile",
                "risk_score": 50,
                "confidence_score": 0,
                "behavioral_warning": message,
                "explanation": message,
                "strengths": [],
                "weaknesses": [],
            },
        }


def build_trader_profile(trades: list[dict[str, Any]] | None) -> dict[str, Any]:
    return HumanTradeTrainingEngine(trades).build_profile()


def _group_performance(key: str, trades: list[dict[str, Any]]) -> dict[str, Any]:
    wins = [trade for trade in trades if _pnl(trade) > 0 or trade.get("result") == "WIN"]
    losses = [trade for trade in trades if _pnl(trade) < 0 or trade.get("result") == "LOSS"]
    total = len(trades)
    total_pnl = round(sum(_pnl(trade) for trade in trades), 2)
    trade_rrs = [_trade_rr(trade) for trade in trades]
    trade_rrs = [value for value in trade_rrs if value is not None]
    return {
        "key": key,
        "label": _display_tag(key),
        "trades": total,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round((len(wins) / total) * 100, 1) if total else 0.0,
        "loss_rate": round((len(losses) / total) * 100, 1) if total else 0.0,
        "total_pnl": total_pnl,
        "avg_pnl": round(total_pnl / total, 2) if total else 0.0,
        "average_rr": round(sum(trade_rrs) / len(trade_rrs), 2) if trade_rrs else _realized_rr(
            [_pnl(trade) for trade in wins if _pnl(trade) > 0],
            [_pnl(trade) for trade in losses if _pnl(trade) < 0],
        ),
        "average_confidence": _average_confidence(trades),
        "confidence_distribution": _confidence_distribution(trades),
        "mistake_distribution": dict(Counter(_canonical_tag(trade.get("mistake_tag")) for trade in trades if not _is_none_tag(trade.get("mistake_tag")))),
        "repeated_mistakes": _mistake_rows([trade for trade in trades if not _is_none_tag(trade.get("mistake_tag"))]),
        "simulated_rows": sum(1 for trade in trades if _is_simulated_training_trade(trade)),
    }


def _planned_rr(trade: dict[str, Any]) -> float | None:
    risk = _to_float(trade.get("planned_risk"))
    reward = _to_float(trade.get("planned_reward"))
    if risk is None or reward is None or risk <= 0 or reward <= 0:
        return None
    return round(reward / risk, 2)


def _trade_rr(trade: dict[str, Any]) -> float | None:
    planned = _planned_rr(trade)
    if planned is not None:
        return planned

    notes = str(trade.get("notes") or "")
    match = re.search(r"(?:for|simulated_rr=)\s*([+-]?\d+(?:\.\d+)?)\s*R\b", notes, flags=re.IGNORECASE)
    if match:
        return _to_float(match.group(1))
    return None


def _realized_rr(wins: list[float], losses: list[float]) -> float:
    if not wins or not losses:
        return 0.0
    avg_win = sum(wins) / len(wins)
    avg_loss = abs(sum(losses) / len(losses))
    if avg_loss <= 0:
        return 0.0
    return round(avg_win / avg_loss, 2)


def _pnl(trade: dict[str, Any]) -> float:
    return _to_float(trade.get("pnl")) or 0.0


def _to_float(value: Any) -> float | None:
    try:
        if value in ("", None):
            return None
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in {float("inf"), float("-inf")}:
        return None
    return number


def _canonical_tag(value: Any) -> str:
    key = str(value or "").strip().lower()
    key = re.sub(r"[^a-z0-9]+", "_", key).strip("_")
    if key in {
        "streak_pullback",
        "streak_pullback_confirmation",
        "streak_pullback_confirmation_setup",
        "streak_pullback_confirmed",
    }:
        return STREAK_PULLBACK_SETUP
    return key


def _tag(value: Any) -> str:
    return _canonical_tag(value)


def _display_tag(value: Any) -> str:
    key = _canonical_tag(value)
    if key == STREAK_PULLBACK_SETUP:
        return "Streak Pullback Confirmation"
    return key.replace("_", " ").title() if key else "Unknown"


def _setup_key(trade: dict[str, Any]) -> str:
    key = _canonical_tag(trade.get("setup_tag") or trade.get("setup"))
    if key:
        return key
    notes = str(trade.get("notes") or "").lower()
    if "streak pullback confirmation" in notes or ("streak" in notes and "pullback" in notes and "confirmation" in notes):
        return STREAK_PULLBACK_SETUP
    if "pattern alert" in notes:
        return "pattern_alert"
    return ""


def _direction_label(trade: dict[str, Any]) -> str:
    side = str(trade.get("side") or trade.get("type") or "").strip().upper()
    notes = str(trade.get("notes") or "").lower()
    if side in {"LONG", "BUY"} or "bullish" in notes:
        return "bullish"
    if side in {"SHORT", "SELL"} or "bearish" in notes:
        return "bearish"
    return ""


def _is_none_tag(value: Any) -> bool:
    return _canonical_tag(value) in NONE_TAGS


def _bounded_int(value: int | float) -> int:
    return max(0, min(100, int(round(float(value)))))


def _is_simulated_training_trade(trade: dict[str, Any]) -> bool:
    source_type = str(trade.get("source_type") or "").strip().lower()
    if source_type in {"synthetic_dev", "simulated_training", "pattern_alert_simulation"}:
        return True
    if trade.get("synthetic_flag") is True:
        return True
    notes = str(trade.get("notes") or "").lower()
    return any(marker in notes for marker in SIMULATED_MARKERS)


def _mistake_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    counts = Counter(_canonical_tag(trade.get("mistake_tag")) for trade in rows)
    repeated = []
    for tag, count in counts.most_common():
        if count < 2:
            continue
        matching = [trade for trade in rows if _canonical_tag(trade.get("mistake_tag")) == tag]
        losses = [trade for trade in matching if _pnl(trade) < 0 or trade.get("result") == "LOSS"]
        repeated.append(
            {
                "tag": tag,
                "count": int(count),
                "loss_rate": round((len(losses) / len(matching)) * 100, 1) if matching else 0.0,
                "avg_pnl": round(sum(_pnl(trade) for trade in matching) / len(matching), 2) if matching else 0.0,
            }
        )
    return repeated


def _average_confidence(trades: list[dict[str, Any]]) -> float | None:
    values = [
        float(trade["confidence_score"])
        for trade in trades
        if isinstance(trade.get("confidence_score"), int)
    ]
    return round(sum(values) / len(values), 2) if values else None


def _confidence_distribution(trades: list[dict[str, Any]]) -> dict[str, int]:
    values = Counter(
        str(trade.get("confidence_score"))
        for trade in trades
        if isinstance(trade.get("confidence_score"), int)
    )
    return dict(sorted(values.items(), key=lambda item: item[0]))


def _setup_risk_adjustment(history: dict[str, Any], *, symbol_specific: bool = False) -> int:
    trades = int(history.get("trades", 0) or 0)
    win_rate = float(history.get("win_rate", 0) or 0)
    average_rr = float(history.get("average_rr", 0) or 0)
    adjustment = 0
    if trades >= 3 and win_rate < 45:
        adjustment += 14 if symbol_specific else 10
    elif trades >= 3 and win_rate >= 60 and average_rr >= 1:
        adjustment -= 8 if symbol_specific else 6
    if average_rr < 0:
        adjustment += 10
    elif average_rr and average_rr < 1:
        adjustment += 6
    return adjustment


def _setup_confidence_adjustment(history: dict[str, Any]) -> int:
    trades = int(history.get("trades", 0) or 0)
    win_rate = float(history.get("win_rate", 0) or 0)
    average_rr = float(history.get("average_rr", 0) or 0)
    if trades < 3:
        return -4
    if win_rate >= 60 and average_rr >= 1:
        return 8
    if win_rate < 45 or average_rr < 0:
        return -10
    return 0


def _candidate_context_flags(trade: dict[str, Any]) -> dict[str, bool]:
    text = " ".join(
        str(trade.get(key) or "")
        for key in ("notes", "entry_reason", "exit_reason", "scenario_context", "mistake_tag")
    ).lower()
    volatility = _extract_volatility(text)
    return {
        "weak_confirmation": "weak confirmation" in text,
        "high_volatility": "high volatility" in text or (volatility is not None and volatility >= 0.75),
    }


def _extract_volatility(text: str) -> float | None:
    match = re.search(r"volatility\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*%", text, flags=re.IGNORECASE)
    if not match:
        return None
    return _to_float(match.group(1))


def _setup_quality_assessment(history: dict[str, Any] | None) -> str:
    if not history:
        return "No matching setup history yet; use only general behavior profile context."

    trades = int(history.get("trades", 0) or 0)
    win_rate = float(history.get("win_rate", 0) or 0)
    average_rr = float(history.get("average_rr", 0) or 0)
    if trades < 3:
        return "Setup history exists but the sample is still too small for a stable quality read."
    if win_rate >= 60 and average_rr >= 1:
        return "Setup quality is historically favorable in this journal sample, but it is not a prediction."
    if win_rate < 45 or average_rr < 0:
        return "Setup quality is historically weak in this journal sample; weak confirmation should reduce confidence and require tighter risk control."
    return "Setup quality is mixed; compare confirmation strength, volatility, and mistake tags before acting."
