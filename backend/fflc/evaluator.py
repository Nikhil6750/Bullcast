from __future__ import annotations


EPSILON = 1e-9


def _time(candle: dict) -> int:
    return int(candle["time"])


def _high(candle: dict) -> float:
    return float(candle["high"])


def _low(candle: dict) -> float:
    return float(candle["low"])


def evaluate_trade(
    candles,
    direction,
    target,
    alert_candle_index,
    session_end_ts,
    zone_lower=None,
    zone_upper=None,
    c1_open=None,
) -> dict:
    normalized_direction = str(direction or "").upper()
    if normalized_direction not in {"UP", "DOWN"}:
        raise ValueError("Direction must be UP or DOWN.")

    target_price = float(target)
    alert_index = int(alert_candle_index)
    end_ts = int(session_end_ts)
    lower = float(zone_lower) if zone_lower is not None else target_price - (target_price * 0.0005)
    upper = float(zone_upper) if zone_upper is not None else target_price + (target_price * 0.0005)
    stop_price = float(c1_open) if c1_open is not None else target_price

    for candle in candles[alert_index + 1:]:
        if _time(candle) > end_ts:
            break

        high = _high(candle)
        low = _low(candle)

        if normalized_direction == "DOWN":
            if high > stop_price + EPSILON:
                return {"result": "loss", "reason": "Price exceeded C1 open (stop hit)"}
            if low <= upper + EPSILON:
                return {"result": "win", "reason": "Price dropped to target zone"}
        else:
            if low < stop_price - EPSILON:
                return {"result": "loss", "reason": "Price dropped below C1 open (stop hit)"}
            if high >= lower - EPSILON:
                return {"result": "win", "reason": "Price rose to target zone"}

    return {"result": "pending", "reason": "Session ended without resolution"}
