from __future__ import annotations

from backend.middleware.rate_limiter import RateLimiter


def test_check_returns_true_within_limit():
    now = [100.0]
    limiter = RateLimiter(time_func=lambda: now[0])

    assert limiter.check("user-1", "/endpoint", 2, 60) is True
    assert limiter.check("user-1", "/endpoint", 2, 60) is True


def test_check_returns_false_when_limit_exceeded():
    now = [100.0]
    limiter = RateLimiter(time_func=lambda: now[0])

    assert limiter.check("user-1", "/endpoint", 2, 60) is True
    assert limiter.check("user-1", "/endpoint", 2, 60) is True
    assert limiter.check("user-1", "/endpoint", 2, 60) is False


def test_check_returns_true_after_window_expires():
    now = [100.0]
    limiter = RateLimiter(time_func=lambda: now[0])

    assert limiter.check("user-1", "/endpoint", 1, 60) is True
    assert limiter.check("user-1", "/endpoint", 1, 60) is False
    now[0] = 161.0

    assert limiter.check("user-1", "/endpoint", 1, 60) is True


def test_limits_are_independent_per_user_endpoint_pair():
    now = [100.0]
    limiter = RateLimiter(time_func=lambda: now[0])

    assert limiter.check("user-1", "/endpoint-a", 1, 60) is True
    assert limiter.check("user-1", "/endpoint-a", 1, 60) is False
    assert limiter.check("user-1", "/endpoint-b", 1, 60) is True


def test_one_user_limit_does_not_affect_another_user():
    now = [100.0]
    limiter = RateLimiter(time_func=lambda: now[0])

    assert limiter.check("user-1", "/endpoint", 1, 60) is True
    assert limiter.check("user-1", "/endpoint", 1, 60) is False
    assert limiter.check("user-2", "/endpoint", 1, 60) is True
