from __future__ import annotations

import time
from collections.abc import Callable


class RateLimiter:
    def __init__(self, time_func: Callable[[], float] | None = None):
        self._time = time_func or time.time
        # In-memory state resets on Vercel cold starts; acceptable for current scale.
        self._requests: dict[tuple[str, str], list[float]] = {}

    def check(self, user_id: str, endpoint: str, limit: int, window_seconds: int) -> bool:
        key = (str(user_id or ""), str(endpoint or ""))
        now = self._time()
        timestamps = [
            ts for ts in self._requests.get(key, [])
            if now - ts < window_seconds
        ]
        if len(timestamps) >= limit:
            self._requests[key] = timestamps
            return False
        timestamps.append(now)
        self._requests[key] = timestamps
        return True

    def retry_after_seconds(self, user_id: str, endpoint: str, window_seconds: int) -> int:
        key = (str(user_id or ""), str(endpoint or ""))
        now = self._time()
        timestamps = [
            ts for ts in self._requests.get(key, [])
            if now - ts < window_seconds
        ]
        self._requests[key] = timestamps
        if not timestamps:
            return 0
        return max(1, int((window_seconds - (now - min(timestamps))) + 0.999))

    def reset(self) -> None:
        self._requests.clear()


rate_limiter = RateLimiter()
