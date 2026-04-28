from __future__ import annotations

import ast
import math
import re
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd


BUY_COLOR = "#22c55e"
SELL_COLOR = "#ef4444"
OVERLAY_COLORS = ("#d4d4d4", "#a3a3a3", "#737373", "#525252")
DEFAULT_LOOKBACK_WINDOW = 18
BUY_NAME_CANDIDATES = ("buy", "long", "longcondition", "longsignal")
SELL_NAME_CANDIDATES = ("sell", "short", "shortcondition", "shortsignal")
DEFAULT_PINE_SCRIPT = """//@version=5
fast = ta.ema(close, 12)
slow = ta.ema(close, 26)
buy = ta.crossover(fast, slow)
sell = ta.crossunder(fast, slow)
"""


class StrategyLabError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class StrategyContext:
    frame: pd.DataFrame
    parameters: dict[str, Any]
    strategy_type: str
    pine_script: str


def run_strategy_lab(
    candles: list[dict],
    *,
    strategy_type: str,
    parameters: dict[str, Any] | None = None,
    pine_script: str = "",
) -> dict[str, Any]:
    if not candles:
        return {
            "candles": [],
            "signals": [],
            "overlays": [],
            "setups": [],
            "trades": [],
            "metrics": _empty_metrics(),
            "strategy": {"type": _normalize_strategy_type(strategy_type), "parameters": {}},
        }

    frame = _candles_to_frame(candles)
    ctx = StrategyContext(
        frame=frame,
        parameters=dict(parameters or {}),
        strategy_type=_normalize_strategy_type(strategy_type),
        pine_script=str(pine_script or ""),
    )

    if ctx.strategy_type == "moving_average":
        buy_mask, sell_mask, overlays, normalized = _evaluate_moving_average(ctx)
    elif ctx.strategy_type == "rsi":
        buy_mask, sell_mask, overlays, normalized = _evaluate_rsi(ctx)
    elif ctx.strategy_type == "breakout":
        buy_mask, sell_mask, overlays, normalized = _evaluate_breakout(ctx)
    elif ctx.strategy_type == "pine_script":
        buy_mask, sell_mask, overlays, normalized = _evaluate_pine_script(ctx)
    else:
        raise StrategyLabError(f"Unsupported strategy type '{ctx.strategy_type}'.")

    signals = _build_signal_events(
        frame=frame,
        buy_mask=buy_mask,
        sell_mask=sell_mask,
        strategy_type=ctx.strategy_type,
        parameters=normalized,
    )
    trades = _build_trades(frame=frame, signals=signals)
    setups = _build_setups(frame=frame, trades=trades)
    metrics = _compute_metrics(trades=trades, signal_count=len(signals))

    return {
        "candles": candles,
        "signals": signals,
        "overlays": overlays,
        "setups": setups,
        "trades": trades,
        "metrics": metrics,
        "strategy": {"type": ctx.strategy_type, "parameters": normalized},
    }


def _normalize_strategy_type(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    aliases = {
        "moving_average": "moving_average",
        "moving-average": "moving_average",
        "moving average": "moving_average",
        "moving average strategy": "moving_average",
        "rsi": "rsi",
        "rsi strategy": "rsi",
        "breakout": "breakout",
        "breakout strategy": "breakout",
        "pine": "pine_script",
        "pine_script": "pine_script",
        "pine-script": "pine_script",
        "pine script": "pine_script",
    }
    return aliases.get(raw, raw)


def _candles_to_frame(candles: list[dict]) -> pd.DataFrame:
    frame = pd.DataFrame(candles).copy()
    if frame.empty:
        return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

    required = ("time", "open", "high", "low", "close")
    missing = [col for col in required if col not in frame.columns]
    if missing:
        raise StrategyLabError(f"Missing candle fields: {missing}")

    for col in required:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")

    if frame[list(required)].isna().any().any():
        raise StrategyLabError("Candles contain non-numeric OHLC data.")

    if "volume" not in frame.columns:
        frame["volume"] = 0.0
    else:
        frame["volume"] = pd.to_numeric(frame["volume"], errors="coerce").fillna(0.0)

    frame = frame.sort_values("time").drop_duplicates(subset=["time"], keep="last").reset_index(drop=True)
    return frame


def _evaluate_moving_average(
    ctx: StrategyContext,
) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]], dict[str, Any]]:
    fast_period = _get_int_param(ctx.parameters, "fast_ma_period", default=12, minimum=1)
    slow_period = _get_int_param(ctx.parameters, "slow_ma_period", default=26, minimum=2)
    if fast_period >= slow_period:
        raise StrategyLabError("Fast MA Period must be smaller than Slow MA Period.")

    ma_type = str(ctx.parameters.get("ma_type", "EMA") or "EMA").strip().upper()
    if ma_type not in {"EMA", "SMA"}:
        raise StrategyLabError("MA Type must be either EMA or SMA.")

    close = ctx.frame["close"]
    ma_func = _ema if ma_type == "EMA" else _sma
    fast = ma_func(close, fast_period)
    slow = ma_func(close, slow_period)

    buy_mask = _crossover(fast, slow)
    sell_mask = _crossunder(fast, slow)
    overlays = [
        _line_overlay(
            overlay_id="fast-ma",
            label=f"Fast {ma_type} {fast_period}",
            values=fast,
            times=ctx.frame["time"],
            color=OVERLAY_COLORS[0],
        ),
        _line_overlay(
            overlay_id="slow-ma",
            label=f"Slow {ma_type} {slow_period}",
            values=slow,
            times=ctx.frame["time"],
            color=OVERLAY_COLORS[2],
        ),
    ]
    params = {
        "fast_ma_period": fast_period,
        "slow_ma_period": slow_period,
        "ma_type": ma_type,
    }
    return buy_mask, sell_mask, overlays, params


def _evaluate_rsi(
    ctx: StrategyContext,
) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]], dict[str, Any]]:
    length = _get_int_param(ctx.parameters, "rsi_length", default=14, minimum=2)
    overbought = _get_float_param(ctx.parameters, "overbought", default=70.0, minimum=1.0, maximum=100.0)
    oversold = _get_float_param(ctx.parameters, "oversold", default=30.0, minimum=0.0, maximum=99.0)
    if oversold >= overbought:
        raise StrategyLabError("Oversold must be smaller than Overbought.")

    rsi = _rsi(ctx.frame["close"], length)
    buy_mask = _crossover(rsi, oversold)
    sell_mask = _crossunder(rsi, overbought)

    params = {
        "rsi_length": length,
        "overbought": overbought,
        "oversold": oversold,
    }
    return buy_mask, sell_mask, [], params


def _evaluate_breakout(
    ctx: StrategyContext,
) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]], dict[str, Any]]:
    lookback = _get_int_param(ctx.parameters, "lookback_period", default=20, minimum=2)
    threshold = _get_float_param(ctx.parameters, "breakout_threshold", default=0.5, minimum=0.0, maximum=100.0)

    upper = ctx.frame["high"].rolling(window=lookback, min_periods=lookback).max().shift(1)
    lower = ctx.frame["low"].rolling(window=lookback, min_periods=lookback).min().shift(1)
    threshold_ratio = threshold / 100.0
    close = ctx.frame["close"]

    buy_mask = (close > upper * (1.0 + threshold_ratio)).fillna(False).to_numpy(dtype=bool)
    sell_mask = (close < lower * (1.0 - threshold_ratio)).fillna(False).to_numpy(dtype=bool)
    buy_mask = _suppress_duplicate_directions(buy_mask, sell_mask)
    sell_mask = _suppress_duplicate_directions(sell_mask, buy_mask)

    overlays = [
        _line_overlay(
            overlay_id="breakout-upper",
            label=f"Upper Breakout {lookback}",
            values=upper,
            times=ctx.frame["time"],
            color=OVERLAY_COLORS[1],
        ),
        _line_overlay(
            overlay_id="breakout-lower",
            label=f"Lower Breakout {lookback}",
            values=lower,
            times=ctx.frame["time"],
            color=OVERLAY_COLORS[3],
        ),
    ]
    params = {
        "lookback_period": lookback,
        "breakout_threshold": threshold,
    }
    return buy_mask, sell_mask, overlays, params


def _evaluate_pine_script(
    ctx: StrategyContext,
) -> tuple[np.ndarray, np.ndarray, list[dict[str, Any]], dict[str, Any]]:
    script = str(ctx.pine_script or "").strip()
    if not script:
        raise StrategyLabError("Pine Script cannot be empty.")

    time = ctx.frame["time"].to_numpy(dtype=np.int64)
    base_context: dict[str, Any] = {
        "open": ctx.frame["open"].to_numpy(dtype=float),
        "high": ctx.frame["high"].to_numpy(dtype=float),
        "low": ctx.frame["low"].to_numpy(dtype=float),
        "close": ctx.frame["close"].to_numpy(dtype=float),
        "volume": ctx.frame["volume"].to_numpy(dtype=float),
    }

    assigned: list[str] = []
    for raw_line in script.splitlines():
        line = raw_line.split("//", 1)[0].strip()
        if not line:
            continue
        if line.startswith("@"):
            continue
        if line.startswith("indicator(") or line.startswith("strategy(") or line.startswith("plot("):
            continue

        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\s*:?\=\s*(.+)$", line)
        if not match:
            raise StrategyLabError(
                "Unsupported Pine syntax. Use simple assignments such as 'fast = ta.ema(close, 12)'."
            )

        name = match.group(1)
        expr = match.group(2).strip()
        try:
            value = _eval_pine_expression(expr=expr, context=base_context, length=len(time))
        except StrategyLabError:
            raise
        except Exception as exc:  # pragma: no cover
            raise StrategyLabError(f"Failed to evaluate Pine expression '{expr}': {exc}") from exc

        base_context[name] = value
        assigned.append(name)

    buy_series = _extract_pine_signal(base_context, BUY_NAME_CANDIDATES, len(time), missing_label="buy")
    sell_series = _extract_pine_signal(base_context, SELL_NAME_CANDIDATES, len(time), missing_label="sell")

    overlays = _extract_pine_overlays(
        context=base_context,
        assigned_names=assigned,
        times=ctx.frame["time"],
        close_values=ctx.frame["close"].to_numpy(dtype=float),
    )
    return buy_series, sell_series, overlays, {"pine_script": script}


def _build_signal_events(
    *,
    frame: pd.DataFrame,
    buy_mask: np.ndarray,
    sell_mask: np.ndarray,
    strategy_type: str,
    parameters: dict[str, Any],
) -> list[dict[str, Any]]:
    signals: list[dict[str, Any]] = []
    close = frame["close"].to_numpy(dtype=float)
    time = frame["time"].to_numpy(dtype=np.int64)
    window = max(DEFAULT_LOOKBACK_WINDOW, _strategy_window_hint(strategy_type, parameters))

    for idx in range(len(frame)):
        is_buy = bool(buy_mask[idx]) if idx < len(buy_mask) else False
        is_sell = bool(sell_mask[idx]) if idx < len(sell_mask) else False
        if is_buy == is_sell:
            continue

        side = "BUY" if is_buy else "SELL"
        start_idx = max(0, idx - window)
        end_idx = min(len(frame) - 1, idx + window)
        signals.append(
            {
                "id": f"signal-{idx}-{side.lower()}",
                "index": idx,
                "time": int(time[idx]),
                "price": float(close[idx]),
                "side": side,
                "label": _signal_label(strategy_type=strategy_type, side=side, parameters=parameters),
                "position": "belowBar" if side == "BUY" else "aboveBar",
                "shape": "arrowUp" if side == "BUY" else "arrowDown",
                "color": BUY_COLOR if side == "BUY" else SELL_COLOR,
                "range_start_time": int(time[start_idx]),
                "range_end_time": int(time[end_idx]),
            }
        )

    return signals


def _build_trades(*, frame: pd.DataFrame, signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not signals:
        return []

    close = frame["close"].to_numpy(dtype=float)
    time = frame["time"].to_numpy(dtype=np.int64)
    last_index = len(frame) - 1

    trades: list[dict[str, Any]] = []
    open_signal: dict[str, Any] | None = None

    for signal in signals:
        if open_signal is None:
            open_signal = signal
            continue

        if signal["side"] == open_signal["side"]:
            continue

        trades.append(
            _create_trade(
                frame=frame,
                entry_signal=open_signal,
                exit_index=int(signal["index"]),
                exit_time=int(signal["time"]),
                exit_price=float(signal["price"]),
                exit_reason="opposite_signal",
            )
        )
        open_signal = signal

    if open_signal is not None and int(open_signal["index"]) < last_index:
        trades.append(
            _create_trade(
                frame=frame,
                entry_signal=open_signal,
                exit_index=last_index,
                exit_time=int(time[last_index]),
                exit_price=float(close[last_index]),
                exit_reason="end_of_data",
            )
        )

    for idx, trade in enumerate(trades, start=1):
        trade["id"] = f"trade-{idx}"

    return trades


def _create_trade(
    *,
    frame: pd.DataFrame,
    entry_signal: dict[str, Any],
    exit_index: int,
    exit_time: int,
    exit_price: float,
    exit_reason: str,
) -> dict[str, Any]:
    entry_index = int(entry_signal["index"])
    entry_price = float(entry_signal["price"])
    direction = str(entry_signal["side"])
    bars_held = max(0, int(exit_index) - entry_index)

    if direction == "BUY":
        return_pct = ((exit_price - entry_price) / entry_price) * 100.0 if entry_price else 0.0
        pnl_points = exit_price - entry_price
    else:
        return_pct = ((entry_price - exit_price) / entry_price) * 100.0 if entry_price else 0.0
        pnl_points = entry_price - exit_price

    window = max(DEFAULT_LOOKBACK_WINDOW, min(96, bars_held + DEFAULT_LOOKBACK_WINDOW))
    start_idx = max(0, entry_index - window)
    end_idx = min(len(frame) - 1, int(exit_index) + window)
    times = frame["time"].to_numpy(dtype=np.int64)

    return {
        "direction": direction,
        "signal_time": int(entry_signal["time"]),
        "signal_label": str(entry_signal["label"]),
        "entry": {"time": int(entry_signal["time"]), "price": entry_price},
        "exit": {"time": int(exit_time), "price": float(exit_price)},
        "bars_held": bars_held,
        "return_pct": float(return_pct),
        "pnl_points": float(pnl_points),
        "exit_reason": exit_reason,
        "range_start_time": int(times[start_idx]),
        "range_end_time": int(times[end_idx]),
    }


def _build_setups(*, frame: pd.DataFrame, trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not trades:
        return []

    setups: list[dict[str, Any]] = []
    for idx, trade in enumerate(trades, start=1):
        setups.append(
            {
                "id": trade["id"],
                "sequence": idx,
                "time": int(trade["signal_time"]),
                "direction": trade["direction"],
                "label": trade["signal_label"],
                "entry_time": int(trade["entry"]["time"]),
                "entry_price": float(trade["entry"]["price"]),
                "exit_time": int(trade["exit"]["time"]),
                "exit_price": float(trade["exit"]["price"]),
                "bars_held": int(trade["bars_held"]),
                "return_pct": float(trade["return_pct"]),
                "exit_reason": str(trade["exit_reason"]),
                "range_start_time": int(trade["range_start_time"]),
                "range_end_time": int(trade["range_end_time"]),
            }
        )
    return setups


def _compute_metrics(*, trades: list[dict[str, Any]], signal_count: int) -> dict[str, Any]:
    if not trades:
        metrics = _empty_metrics()
        metrics["signalCount"] = int(signal_count)
        return metrics

    returns = np.array([float(t["return_pct"]) for t in trades], dtype=float)
    wins = returns[returns > 0]
    losses = returns[returns < 0]

    equity_curve = np.concatenate(([0.0], np.cumsum(returns)))
    running_peak = np.maximum.accumulate(equity_curve)
    drawdowns = equity_curve - running_peak

    loss_sum = float(abs(losses.sum())) if losses.size else 0.0
    profit_factor = None
    if loss_sum > 0:
        profit_factor = float(wins.sum() / loss_sum)

    return {
        "totalTrades": int(len(trades)),
        "signalCount": int(signal_count),
        "winRate": float((wins.size / len(trades)) * 100.0),
        "netPnL": float(returns.sum()),
        "avgReturn": float(returns.mean()),
        "maxDrawdown": float(drawdowns.min()),
        "profitFactor": profit_factor,
        "longTrades": int(sum(1 for trade in trades if trade["direction"] == "BUY")),
        "shortTrades": int(sum(1 for trade in trades if trade["direction"] == "SELL")),
    }


def _empty_metrics() -> dict[str, Any]:
    return {
        "totalTrades": 0,
        "signalCount": 0,
        "winRate": 0.0,
        "netPnL": 0.0,
        "avgReturn": 0.0,
        "maxDrawdown": 0.0,
        "profitFactor": None,
        "longTrades": 0,
        "shortTrades": 0,
    }


def _line_overlay(
    *,
    overlay_id: str,
    label: str,
    values: pd.Series | np.ndarray | float,
    times: pd.Series,
    color: str,
) -> dict[str, Any]:
    arr = _ensure_numeric_series(values, len(times))
    ts = times.to_numpy(dtype=np.int64)
    data = [{"time": int(ts[idx]), "value": float(arr[idx])} for idx in range(len(arr)) if math.isfinite(float(arr[idx]))]
    return {
        "id": overlay_id,
        "label": label,
        "type": "line",
        "color": color,
        "lineWidth": 2,
        "data": data,
    }


def _strategy_window_hint(strategy_type: str, parameters: dict[str, Any]) -> int:
    if strategy_type == "moving_average":
        return max(int(parameters.get("slow_ma_period", 0)), DEFAULT_LOOKBACK_WINDOW)
    if strategy_type == "rsi":
        return max(int(parameters.get("rsi_length", 0)) * 2, DEFAULT_LOOKBACK_WINDOW)
    if strategy_type == "breakout":
        return max(int(parameters.get("lookback_period", 0)) * 2, DEFAULT_LOOKBACK_WINDOW)
    return DEFAULT_LOOKBACK_WINDOW


def _signal_label(*, strategy_type: str, side: str, parameters: dict[str, Any]) -> str:
    if strategy_type == "moving_average":
        ma_type = parameters["ma_type"]
        fast = parameters["fast_ma_period"]
        slow = parameters["slow_ma_period"]
        verb = "crossed above" if side == "BUY" else "crossed below"
        return f"{ma_type} {fast} {verb} {ma_type} {slow}"

    if strategy_type == "rsi":
        threshold = parameters["oversold"] if side == "BUY" else parameters["overbought"]
        verb = "crossed above" if side == "BUY" else "crossed below"
        return f"RSI {verb} {threshold:g}"

    if strategy_type == "breakout":
        lookback = parameters["lookback_period"]
        threshold = parameters["breakout_threshold"]
        band = "high" if side == "BUY" else "low"
        verb = "above" if side == "BUY" else "below"
        return f"Close broke {verb} {lookback}-bar {band} by {threshold:g}%"

    return f"Pine {side.lower()} condition"


def _sma(values: pd.Series | np.ndarray | float, length: int) -> pd.Series:
    series = pd.Series(_ensure_numeric_series(values, _infer_length(values)))
    return series.rolling(window=int(length), min_periods=int(length)).mean()


def _ema(values: pd.Series | np.ndarray | float, length: int) -> pd.Series:
    series = pd.Series(_ensure_numeric_series(values, _infer_length(values)))
    return series.ewm(span=int(length), adjust=False).mean()


def _rsi(values: pd.Series | np.ndarray | float, length: int) -> pd.Series:
    series = pd.Series(_ensure_numeric_series(values, _infer_length(values)))
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1.0 / float(length), adjust=False, min_periods=int(length)).mean()
    avg_loss = loss.ewm(alpha=1.0 / float(length), adjust=False, min_periods=int(length)).mean()

    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    rsi = rsi.where(avg_loss != 0.0, 100.0)
    rsi = rsi.where(~((avg_gain == 0.0) & (avg_loss == 0.0)), 50.0)
    return rsi


def _crossover(left: pd.Series | np.ndarray | float, right: pd.Series | np.ndarray | float) -> np.ndarray:
    a = _ensure_numeric_series(left, _max_length(left, right))
    b = _ensure_numeric_series(right, len(a))
    out = np.zeros(len(a), dtype=bool)
    if len(a) < 2:
        return out
    valid = np.isfinite(a) & np.isfinite(b)
    prev_valid = np.roll(valid, 1)
    prev_valid[0] = False
    out[1:] = valid[1:] & prev_valid[1:] & (a[1:] > b[1:]) & (a[:-1] <= b[:-1])
    return out


def _crossunder(left: pd.Series | np.ndarray | float, right: pd.Series | np.ndarray | float) -> np.ndarray:
    a = _ensure_numeric_series(left, _max_length(left, right))
    b = _ensure_numeric_series(right, len(a))
    out = np.zeros(len(a), dtype=bool)
    if len(a) < 2:
        return out
    valid = np.isfinite(a) & np.isfinite(b)
    prev_valid = np.roll(valid, 1)
    prev_valid[0] = False
    out[1:] = valid[1:] & prev_valid[1:] & (a[1:] < b[1:]) & (a[:-1] >= b[:-1])
    return out


def _suppress_duplicate_directions(primary: np.ndarray, other_side: np.ndarray) -> np.ndarray:
    active = False
    out = np.zeros(len(primary), dtype=bool)
    for idx, value in enumerate(primary):
        if other_side[idx]:
            active = False
        if value and not active:
            out[idx] = True
            active = True
    return out


def _get_int_param(
    parameters: dict[str, Any],
    key: str,
    *,
    default: int,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    value = parameters.get(key, default)
    try:
        parsed = int(value)
    except Exception as exc:
        raise StrategyLabError(f"Parameter '{key}' must be an integer.") from exc
    if minimum is not None and parsed < minimum:
        raise StrategyLabError(f"Parameter '{key}' must be >= {minimum}.")
    if maximum is not None and parsed > maximum:
        raise StrategyLabError(f"Parameter '{key}' must be <= {maximum}.")
    return parsed


def _get_float_param(
    parameters: dict[str, Any],
    key: str,
    *,
    default: float,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float:
    value = parameters.get(key, default)
    try:
        parsed = float(value)
    except Exception as exc:
        raise StrategyLabError(f"Parameter '{key}' must be a number.") from exc
    if minimum is not None and parsed < minimum:
        raise StrategyLabError(f"Parameter '{key}' must be >= {minimum}.")
    if maximum is not None and parsed > maximum:
        raise StrategyLabError(f"Parameter '{key}' must be <= {maximum}.")
    return parsed


def _infer_length(value: pd.Series | np.ndarray | float) -> int:
    if isinstance(value, pd.Series):
        return int(len(value))
    if isinstance(value, np.ndarray):
        return int(len(value))
    raise StrategyLabError("Series input is required for indicator evaluation.")


def _max_length(left: pd.Series | np.ndarray | float, right: pd.Series | np.ndarray | float) -> int:
    return max(_series_length(left), _series_length(right), 1)


def _series_length(value: pd.Series | np.ndarray | float) -> int:
    if isinstance(value, pd.Series):
        return int(len(value))
    if isinstance(value, np.ndarray):
        return int(len(value))
    return 1


def _ensure_numeric_series(value: pd.Series | np.ndarray | float | int | bool, length: int) -> np.ndarray:
    if isinstance(value, pd.Series):
        arr = value.to_numpy()
    elif isinstance(value, np.ndarray):
        arr = value
    elif np.isscalar(value):
        fill = float(value)
        return np.full(length, fill, dtype=float)
    else:
        arr = np.asarray(value)

    if arr.ndim != 1:
        raise StrategyLabError("Expected a one-dimensional series.")
    if len(arr) != length:
        if len(arr) == 1:
            return np.full(length, float(arr[0]), dtype=float)
        raise StrategyLabError("Series lengths do not match.")
    return arr.astype(float, copy=False)


def _ensure_boolean_series(value: pd.Series | np.ndarray | float | int | bool, length: int) -> np.ndarray:
    if isinstance(value, pd.Series):
        arr = value.to_numpy()
    elif isinstance(value, np.ndarray):
        arr = value
    elif np.isscalar(value):
        return np.full(length, bool(value), dtype=bool)
    else:
        arr = np.asarray(value)

    if arr.ndim != 1:
        raise StrategyLabError("Expected a one-dimensional series.")
    if len(arr) != length:
        if len(arr) == 1:
            return np.full(length, bool(arr[0]), dtype=bool)
        raise StrategyLabError("Series lengths do not match.")
    return arr.astype(bool, copy=False)


def _eval_pine_expression(*, expr: str, context: dict[str, Any], length: int) -> Any:
    parsed = ast.parse(expr, mode="eval")
    evaluator = _PineExpressionEvaluator(context=context, length=length)
    return evaluator.visit(parsed.body)


def _extract_pine_signal(
    context: dict[str, Any],
    candidates: tuple[str, ...],
    length: int,
    *,
    missing_label: str,
) -> np.ndarray:
    lowered = {name.lower(): name for name in context}
    for candidate in candidates:
        key = lowered.get(candidate)
        if key is None:
            continue
        return _ensure_boolean_series(context[key], length)
    raise StrategyLabError(f"Pine Script must define a '{missing_label}' signal series.")


def _extract_pine_overlays(
    *,
    context: dict[str, Any],
    assigned_names: list[str],
    times: pd.Series,
    close_values: np.ndarray,
) -> list[dict[str, Any]]:
    overlays: list[dict[str, Any]] = []
    for color_index, name in enumerate(assigned_names):
        lowered = name.lower()
        if lowered in BUY_NAME_CANDIDATES or lowered in SELL_NAME_CANDIDATES:
            continue

        value = context.get(name)
        try:
            arr = _ensure_numeric_series(value, len(times))
        except Exception:
            continue

        if np.all(~np.isfinite(arr)):
            continue

        close_median = float(np.nanmedian(close_values)) if np.isfinite(np.nanmedian(close_values)) else 0.0
        series_median = float(np.nanmedian(arr)) if np.isfinite(np.nanmedian(arr)) else 0.0
        if close_median > 0 and series_median > 0:
            ratio = max(close_median, series_median) / max(min(close_median, series_median), 1e-9)
            if ratio > 6.0:
                continue

        overlays.append(
            _line_overlay(
                overlay_id=f"pine-{name}",
                label=name,
                values=arr,
                times=times,
                color=OVERLAY_COLORS[color_index % len(OVERLAY_COLORS)],
            )
        )
        if len(overlays) >= 4:
            break
    return overlays


class _PineExpressionEvaluator(ast.NodeVisitor):
    def __init__(self, *, context: dict[str, Any], length: int):
        self.context = context
        self.length = int(length)

    def visit_Name(self, node: ast.Name) -> Any:
        key = node.id
        if key in self.context:
            return self.context[key]
        if key in {"true", "True"}:
            return True
        if key in {"false", "False"}:
            return False
        raise StrategyLabError(f"Unknown identifier '{key}' in Pine Script.")

    def visit_Constant(self, node: ast.Constant) -> Any:
        if isinstance(node.value, (int, float, bool)):
            return node.value
        raise StrategyLabError("Only numeric and boolean constants are supported in Pine Script.")

    def visit_UnaryOp(self, node: ast.UnaryOp) -> Any:
        operand = self.visit(node.operand)
        if isinstance(node.op, ast.Not):
            return np.logical_not(_ensure_boolean_series(operand, self.length))
        if isinstance(node.op, ast.USub):
            return -_ensure_numeric_series(operand, self.length)
        if isinstance(node.op, ast.UAdd):
            return _ensure_numeric_series(operand, self.length)
        raise StrategyLabError("Unsupported unary operator in Pine Script.")

    def visit_BinOp(self, node: ast.BinOp) -> Any:
        left = _ensure_numeric_series(self.visit(node.left), self.length)
        right = _ensure_numeric_series(self.visit(node.right), self.length)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        raise StrategyLabError("Unsupported arithmetic operator in Pine Script.")

    def visit_BoolOp(self, node: ast.BoolOp) -> Any:
        values = [_ensure_boolean_series(self.visit(value), self.length) for value in node.values]
        if isinstance(node.op, ast.And):
            out = values[0]
            for value in values[1:]:
                out = np.logical_and(out, value)
            return out
        if isinstance(node.op, ast.Or):
            out = values[0]
            for value in values[1:]:
                out = np.logical_or(out, value)
            return out
        raise StrategyLabError("Unsupported boolean operator in Pine Script.")

    def visit_Compare(self, node: ast.Compare) -> Any:
        left = self.visit(node.left)
        out: np.ndarray | None = None
        current = left
        for op, comparator_node in zip(node.ops, node.comparators):
            right = self.visit(comparator_node)
            result = self._apply_compare(op, current, right)
            out = result if out is None else np.logical_and(out, result)
            current = right
        if out is None:
            raise StrategyLabError("Invalid comparison in Pine Script.")
        return out

    def visit_Call(self, node: ast.Call) -> Any:
        name = self._resolve_call_name(node.func)
        args = [self.visit(arg) for arg in node.args]
        if name == "ta.ema":
            return _ema(args[0], self._require_int_scalar(args, index=1, name=name))
        if name == "ta.sma":
            return _sma(args[0], self._require_int_scalar(args, index=1, name=name))
        if name == "ta.rsi":
            return _rsi(args[0], self._require_int_scalar(args, index=1, name=name))
        if name == "ta.crossover":
            return _crossover(args[0], args[1])
        if name == "ta.crossunder":
            return _crossunder(args[0], args[1])
        raise StrategyLabError(f"Unsupported Pine function '{name}'.")

    def generic_visit(self, node: ast.AST) -> Any:  # pragma: no cover
        raise StrategyLabError(f"Unsupported Pine syntax: {type(node).__name__}")

    def _resolve_call_name(self, node: ast.AST) -> str:
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
            return f"{node.value.id}.{node.attr}"
        raise StrategyLabError("Unsupported function call in Pine Script.")

    def _apply_compare(self, op: ast.cmpop, left: Any, right: Any) -> np.ndarray:
        a = _ensure_numeric_series(left, self.length)
        b = _ensure_numeric_series(right, self.length)
        if isinstance(op, ast.Gt):
            return a > b
        if isinstance(op, ast.GtE):
            return a >= b
        if isinstance(op, ast.Lt):
            return a < b
        if isinstance(op, ast.LtE):
            return a <= b
        if isinstance(op, ast.Eq):
            return a == b
        if isinstance(op, ast.NotEq):
            return a != b
        raise StrategyLabError("Unsupported comparison operator in Pine Script.")

    def _require_int_scalar(self, args: list[Any], *, index: int, name: str) -> int:
        if index >= len(args):
            raise StrategyLabError(f"Function '{name}' requires at least {index + 1} arguments.")
        value = args[index]
        if isinstance(value, pd.Series):
            arr = value.to_numpy()
        elif isinstance(value, np.ndarray):
            arr = value
        else:
            arr = None

        if arr is not None:
            if len(arr) != 1:
                raise StrategyLabError(f"Function '{name}' length argument must be a scalar.")
            raw = arr[0]
        else:
            raw = value

        try:
            parsed = int(raw)
        except Exception as exc:
            raise StrategyLabError(f"Function '{name}' length argument must be an integer.") from exc
        if parsed <= 0:
            raise StrategyLabError(f"Function '{name}' length argument must be > 0.")
        return parsed
