from __future__ import annotations


EPSILON = 1e-9
ZONE_TOLERANCE = 0.0005


def _price(candle: dict, key: str) -> float:
    return float(candle[key])


def _c3_midpoint(c3: dict) -> float:
    high = _price(c3, "high")
    low = _price(c3, "low")
    return low + ((high - low) / 2)


def _has_strong_pullback(pullback_candles: list[dict], direction: str, midpoint: float) -> bool:
    normalized_direction = str(direction or "").upper()
    if normalized_direction == "DOWN":
        return any(_price(candle, "low") < midpoint - EPSILON for candle in pullback_candles)
    if normalized_direction == "UP":
        return any(_price(candle, "high") > midpoint + EPSILON for candle in pullback_candles)
    raise ValueError("Direction must be UP or DOWN.")


def _has_news(news_events: list[dict] | None) -> bool:
    return bool(news_events)


def calculate_target(
    c1: dict,
    c2: dict,
    c3: dict,
    pullback_candles: list[dict],
    direction: str,
    news_events: list[dict] | None = None,
) -> dict:
    normalized_direction = str(direction or "").upper()
    if normalized_direction not in {"UP", "DOWN"}:
        raise ValueError("Direction must be UP or DOWN.")
    if not pullback_candles:
        raise ValueError("At least one pullback candle is required.")

    if normalized_direction == "DOWN":
        target = max(_price(candle, "high") for candle in pullback_candles)
        target_method = "c4_high"
    else:
        target = min(_price(candle, "low") for candle in pullback_candles)
        target_method = "c4_low"

    zone_upper = target + (target * ZONE_TOLERANCE)
    zone_lower = target - (target * ZONE_TOLERANCE)
    return {
        "target": float(target),
        "zone_upper": float(zone_upper),
        "zone_lower": float(zone_lower),
        "pullback_type": "simple",
        "target_method": target_method,
    }
