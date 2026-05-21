from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from backend.fflc.backtest import SUPPORTED_PAIRS, run_backtest
from backend.fflc.candles import normalize_pair


def _unique_pairs(pairs: list[str] | None) -> list[str]:
    raw_pairs = pairs or SUPPORTED_PAIRS
    seen: set[str] = set()
    unique: list[str] = []
    for pair in raw_pairs:
        clean = normalize_pair(pair)
        if clean not in seen:
            seen.add(clean)
            unique.append(clean)
    return unique


def run_multi_backtest(pairs: list[str], date_str: str = None) -> dict:
    clean_pairs = _unique_pairs(pairs)
    results: list[dict] = []

    if clean_pairs:
        max_workers = min(8, len(clean_pairs))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_pair = {
                executor.submit(run_backtest, pair, date_str): pair
                for pair in clean_pairs
            }
            for future in as_completed(future_to_pair):
                pair = future_to_pair[future]
                try:
                    results.append(future.result())
                except Exception as exc:
                    results.append({
                        "pair": pair,
                        "date": date_str,
                        "total_setups": 0,
                        "wins": 0,
                        "losses": 0,
                        "setup_not_formed": 0,
                        "pending": 0,
                        "win_rate": 0.0,
                        "patterns": [],
                        "candles_count": 0,
                        "skipped": False,
                        "data_source": "error",
                        "error": str(exc),
                    })

    results.sort(key=lambda item: clean_pairs.index(item["pair"]) if item.get("pair") in clean_pairs else 999)
    wins = sum(int(result.get("wins", 0)) for result in results)
    losses = sum(int(result.get("losses", 0)) for result in results)
    setup_not_formed = sum(int(result.get("setup_not_formed", 0)) for result in results)
    pending = sum(int(result.get("pending", 0)) for result in results)
    total_setups = sum(int(result.get("total_setups", 0)) for result in results)
    candles_count = sum(int(result.get("candles_count", 0)) for result in results)
    skipped = bool(results) and all(bool(result.get("skipped")) for result in results)
    sources = sorted({str(result.get("data_source", "unknown")) for result in results})
    closed = wins + losses
    win_rate = round((wins / closed) * 100, 2) if closed else 0.0
    patterns = [
        pattern
        for result in results
        for pattern in result.get("patterns", [])
    ]

    return {
        "pairs": clean_pairs,
        "date": date_str,
        "total_setups": total_setups,
        "wins": wins,
        "losses": losses,
        "setup_not_formed": setup_not_formed,
        "pending": pending,
        "win_rate": win_rate,
        "patterns": patterns,
        "candles_count": candles_count,
        "skipped": skipped,
        "data_source": "+".join(sources) if sources else "unknown",
        "results": results,
        "per_pair": results,
    }
