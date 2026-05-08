from __future__ import annotations

import csv
from pathlib import Path

from backend.intelligence.training import HumanTradeTrainingEngine
from backend.intelligence.prompts import build_fallback_response, build_question_prompt


def _trade(
    trade_id: str,
    symbol: str,
    pnl: float,
    *,
    setup_tag: str = "breakout",
    mistake_tag: str = "none",
    confidence_score: int = 3,
    planned_risk: float = 100,
    planned_reward: float = 200,
    rule_followed: bool = True,
) -> dict:
    return {
        "id": trade_id,
        "date": "2026-01-01",
        "symbol": symbol,
        "type": "LONG",
        "entry_price": 100,
        "exit_price": 102 if pnl > 0 else 98,
        "quantity": abs(pnl) / 2,
        "pnl": pnl,
        "result": "WIN" if pnl > 0 else "LOSS",
        "setup_tag": setup_tag,
        "mistake_tag": mistake_tag,
        "confidence_score": confidence_score,
        "planned_risk": planned_risk,
        "planned_reward": planned_reward,
        "rule_followed": rule_followed,
    }


def test_training_engine_builds_behavior_profile_from_real_trades():
    trades = [
        _trade("1", "AAPL", 200, setup_tag="breakout"),
        _trade("2", "AAPL", 150, setup_tag="breakout"),
        _trade("3", "TSLA", -120, setup_tag="reversal", mistake_tag="late_entry", confidence_score=5, rule_followed=False),
        _trade("4", "TSLA", -80, setup_tag="reversal", mistake_tag="late_entry", confidence_score=4, rule_followed=False),
        _trade("SYN-5", "MSFT", 999, setup_tag="breakout", mistake_tag="none", confidence_score=5),
    ]

    profile = HumanTradeTrainingEngine(trades).build_profile()

    assert profile["sample_size"] == 5
    assert profile["synthetic_rows_observed"] == 1
    assert profile["excluded_synthetic_trades"] == 0
    assert profile["metrics"]["win_rate"] == 60.0
    assert profile["metrics"]["loss_rate"] == 40.0
    assert profile["metrics"]["average_rr"] == 2.0
    assert profile["metrics"]["average_confidence"] == 4.0
    assert profile["repeated_mistakes"][0]["tag"] == "late_entry"
    assert profile["best_symbols"][0]["key"] == "msft"
    assert profile["best_setups"][0]["key"] == "breakout"
    assert "risk_score" in profile["behavior_profile"]
    assert "behavioral_warning" in profile["behavior_profile"]


def test_future_trade_analysis_uses_profile_history():
    trades = [
        _trade("1", "TSLA", -120, setup_tag="reversal", mistake_tag="late_entry", confidence_score=5, rule_followed=False),
        _trade("2", "TSLA", -80, setup_tag="reversal", mistake_tag="late_entry", confidence_score=4, rule_followed=False),
        _trade("3", "AAPL", 200, setup_tag="breakout"),
    ]
    candidate = _trade(
        "candidate",
        "TSLA",
        0,
        setup_tag="reversal",
        confidence_score=5,
        planned_risk=100,
        planned_reward=80,
    )

    assessment = HumanTradeTrainingEngine(trades).analyze_future_trade(candidate)

    assert assessment["risk_score"] >= 50
    assert assessment["confidence_score"] >= 0
    assert assessment["behavioral_warning"]
    assert "tsla history" in assessment["explanation"].lower()
    assert assessment["profile_status"] in {"ready", "insufficient_data"}


def _streak_trade(
    trade_id: str,
    symbol: str = "NIFTY",
    side: str = "BUY",
    result: str = "LOSS",
    rr: float = -1.0,
    confidence: int = 3,
    mistake: str = "none",
    weak_confirmation: bool = False,
) -> dict:
    entry = 100.0
    exit_price = 99.0 if result == "LOSS" else 102.0
    note_bits = [
        "SIMULATED DATA - not real trading history.",
        "bullish 5-candle streak followed by clean 2-candle pullback without midpoint touch.",
        "Confirmation candle aligned with original trend.",
        f"Trade {'hit stop loss first' if result == 'LOSS' else 'exited at configured target'} for {rr:.2f}R.",
        f"Confidence={confidence}/5.",
        "Volatility=0.8500%.",
    ]
    if weak_confirmation:
        note_bits.append("weak confirmation behavior simulated based on setup quality.")
    return {
        "id": trade_id,
        "date": "2026-01-01",
        "symbol": symbol,
        "side": side,
        "entry": entry,
        "exit": exit_price,
        "quantity": 10,
        "setup": "Streak Pullback Confirmation",
        "confidence": confidence,
        "mistake": mistake,
        "notes": " ".join(note_bits),
        "source_type": "synthetic_dev",
    }


def test_setup_aware_retrieval_uses_streak_pullback_history():
    trades = [
        _streak_trade("SYN-1", result="LOSS", rr=-1.0, confidence=3, mistake="revenge trade"),
        _streak_trade("SYN-2", result="LOSS", rr=-1.0, confidence=3, mistake="revenge trade"),
        _streak_trade("SYN-3", result="WIN", rr=2.0, confidence=4),
        _streak_trade("SYN-4", result="LOSS", rr=-1.0, confidence=2, mistake="weak confirmation", weak_confirmation=True),
    ]
    candidate = {
        "symbol": "NIFTY",
        "side": "BUY",
        "setup": "Streak Pullback Confirmation",
        "confidence": 4,
        "notes": "future bullish setup with weak confirmation and high volatility",
    }

    assessment = HumanTradeTrainingEngine(trades).analyze_future_trade(candidate)

    assert assessment["reasoning_priority"] == "trader_profile"
    assert assessment["matched_history"]["setup"]["key"] == "streak_pullback_confirmation"
    assert assessment["matched_history"]["setup_symbol"]["trades"] == 4
    assert assessment["matched_history"]["confidence_distribution"] == {"2": 1, "3": 2, "4": 1}
    assert "historical nifty bullish streak setups" in assessment["explanation"].lower()
    assert "weak confirmation" in assessment["setup_quality_assessment"].lower()


def test_simulated_training_rows_build_profile_with_data_origin():
    profile = HumanTradeTrainingEngine([
        _streak_trade("SYN-1", result="LOSS", mistake="revenge trade"),
        _streak_trade("SYN-2", result="LOSS", mistake="revenge trade"),
        _streak_trade("SYN-3", result="WIN", rr=2.0, confidence=4),
        _streak_trade("SYN-4", result="LOSS", mistake="weak confirmation", weak_confirmation=True),
        _streak_trade("SYN-5", result="WIN", rr=2.0, confidence=5),
    ]).build_profile()

    assert profile["status"] == "simulated_training_data"
    assert profile["data_origin"]["simulated_only"] is True
    assert profile["simulated_training_rows_used"] == 5
    assert profile["best_setups"][0]["key"] == "streak_pullback_confirmation"
    assert "simulated training trades" in profile["behavior_profile"]["explanation"]


def test_repeated_mistakes_are_injected_into_future_trade_warning():
    trades = [
        _streak_trade("SYN-1", result="LOSS", mistake="revenge trade"),
        _streak_trade("SYN-2", result="LOSS", mistake="revenge trade"),
        _streak_trade("SYN-3", result="WIN", rr=2.0),
    ]

    assessment = HumanTradeTrainingEngine(trades).analyze_future_trade({
        "symbol": "NIFTY",
        "side": "BUY",
        "setup": "Streak Pullback Confirmation",
    })

    assert "revenge_trade" in assessment["behavioral_warning"]
    assert "repeated revenge_trade behavior detected" in assessment["explanation"].lower()
    assert assessment["matched_history"]["repeated_mistakes"][0]["tag"] == "revenge_trade"


def test_profile_prompt_includes_trader_profile_context():
    profile = HumanTradeTrainingEngine([
        _streak_trade("SYN-1", result="LOSS", mistake="revenge trade"),
        _streak_trade("SYN-2", result="WIN", rr=2.0),
    ]).build_profile()

    prompt = build_question_prompt(
        "Analyze a future Streak Pullback Confirmation setup",
        [],
        {"basic_stats": {"win_rate": 50, "total_pnl": 0, "avg_win": 20, "avg_loss": -20, "risk_reward_ratio": 1}},
        2,
        trader_profile=profile,
    )

    assert "Trader behavior profile" in prompt
    assert "Risk score" in prompt
    assert "streak_pullback_confirmation" in prompt


def test_future_trade_fallback_response_is_not_generic_sentiment_message():
    profile = HumanTradeTrainingEngine([
        _streak_trade("SYN-1", result="LOSS", mistake="revenge trade"),
        _streak_trade("SYN-2", result="LOSS", mistake="revenge trade"),
        _streak_trade("SYN-3", result="WIN", rr=2.0),
        _streak_trade("SYN-4", result="LOSS", mistake="weak confirmation", weak_confirmation=True),
    ]).build_profile()
    answer = build_fallback_response(
        "Analyze a future bullish Streak Pullback Confirmation setup on NIFTY",
        [],
        {
            "basic_stats": {"total_trades": 4, "total_wins": 1, "total_losses": 3, "win_rate": 25, "total_pnl": -10},
            "trader_profile": profile,
            "context_summary": {"sentiment_coverage": 0, "market_coverage": 0},
            "sentiment_alignment": {},
            "by_symbol": [],
        },
    )

    assert "Sentiment context is not available" not in answer
    assert "Use trader-profile context first" in answer
    assert "Streak Pullback Confirmation" in answer
    assert "risk score" in answer.lower()


def test_explicit_setup_field_overrides_unrelated_ranked_setup():
    generated_path = Path("trading-ui/public/generated-journal-trades.csv")
    with generated_path.open(newline="", encoding="utf-8") as handle:
        generated_rows = list(csv.DictReader(handle))

    higher_ranked_news_event = _trade(
        "NEWS-1",
        "NIFTY",
        500000,
        setup_tag="news_event",
        mistake_tag="none",
        confidence_score=5,
    )
    profile = HumanTradeTrainingEngine([higher_ranked_news_event, *generated_rows]).build_profile()

    assert profile["best_setups"][0]["key"] == "news_event"

    answer = build_fallback_response(
        (
            "Analyze this future trade: Symbol: NIFTY Side: BUY "
            "Setup: Streak Pullback Confirmation Notes: weak confirmation after high volatility"
        ),
        [],
        {
            "basic_stats": {
                "total_trades": profile["sample_size"],
                "total_wins": profile["metrics"]["total_wins"],
                "total_losses": profile["metrics"]["total_losses"],
                "win_rate": profile["metrics"]["win_rate"],
                "total_pnl": profile["metrics"]["net_pnl"],
            },
            "trader_profile": profile,
            "context_summary": {"sentiment_coverage": 0, "market_coverage": 0},
            "sentiment_alignment": {},
            "by_symbol": [],
        },
    )

    assert "News Event has 1 historical training trades" not in answer
    assert "Streak Pullback Confirmation has 1781 historical training trades" in answer
    assert "NIFTY symbol history" in answer
    assert "Repeated" in answer and "behavior" in answer


def test_future_trade_matches_rows_with_setup_field_alias():
    trades = [
        {
            "id": "ALIAS-1",
            "date": "2026-01-01",
            "symbol": "NIFTY",
            "side": "BUY",
            "entry": 100,
            "exit": 99,
            "quantity": 10,
            "setup": "Streak Pullback Confirmation",
            "confidence": 3,
            "mistake": "revenge trade",
            "notes": "SIMULATED DATA - not real trading history.",
        },
        {
            "id": "ALIAS-2",
            "date": "2026-01-02",
            "symbol": "NIFTY",
            "side": "BUY",
            "entry": 100,
            "exit": 102,
            "quantity": 10,
            "setup": "Streak Pullback Confirmation",
            "confidence": 4,
            "mistake": "revenge trade",
            "notes": "SIMULATED DATA - not real trading history.",
        },
    ]

    assessment = HumanTradeTrainingEngine(trades).analyze_future_trade({
        "symbol": "NIFTY",
        "side": "BUY",
        "setup": "Streak Pullback Confirmation",
    })

    assert assessment["matched_history"]["setup"]["trades"] == 2
    assert assessment["matched_history"]["setup"]["label"] == "Streak Pullback Confirmation"
    assert "Historical Streak Pullback Confirmation setups" in assessment["explanation"]


def test_profile_backfills_old_blank_setup_rows_from_generated_notes():
    old_imported_rows = [
        {
            "id": "OLD-1",
            "date": "2026-01-01",
            "symbol": "NIFTY",
            "type": "LONG",
            "entry_price": 100,
            "exit_price": 99,
            "quantity": 10,
            "setup_tag": "",
            "mistake_tag": "revenge_trade",
            "notes": "SIMULATED DATA - not real trading history. bullish 5-candle streak followed by clean 2-candle pullback. Confirmation candle aligned with original trend.",
        },
        {
            "id": "OLD-2",
            "date": "2026-01-02",
            "symbol": "NIFTY",
            "type": "LONG",
            "entry_price": 100,
            "exit_price": 102,
            "quantity": 10,
            "setup_tag": "",
            "mistake_tag": "revenge_trade",
            "notes": "SIMULATED DATA - not real trading history. bullish 4-candle streak followed by clean 1-candle pullback. Confirmation candle aligned with original trend.",
        },
    ]

    profile = HumanTradeTrainingEngine(old_imported_rows).build_profile()
    answer = build_fallback_response(
        "Analyze this future trade: Symbol: NIFTY Side: BUY Setup: Streak Pullback Confirmation",
        [],
        {
            "basic_stats": {
                "total_trades": profile["sample_size"],
                "total_wins": profile["metrics"]["total_wins"],
                "total_losses": profile["metrics"]["total_losses"],
                "win_rate": profile["metrics"]["win_rate"],
                "total_pnl": profile["metrics"]["net_pnl"],
            },
            "trader_profile": profile,
            "context_summary": {"sentiment_coverage": 0, "market_coverage": 0},
            "sentiment_alignment": {},
            "by_symbol": [],
        },
    )

    assert profile["setup_history"][0]["key"] == "streak_pullback_confirmation"
    assert profile["setup_history"][0]["trades"] == 2
    assert "Streak Pullback Confirmation has 2 historical training trades" in answer
