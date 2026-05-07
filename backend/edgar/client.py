from __future__ import annotations

import os
import time
from typing import Any
from urllib.parse import urlparse

import requests

from .cache import read_json_cache, write_json_cache


COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"


class EdgarClient:
    def __init__(self, user_agent: str | None = None):
        # Set BULLCAST_SEC_USER_AGENT to a real app/contact string before production use.
        self.user_agent = (
            user_agent
            or os.getenv("BULLCAST_SEC_USER_AGENT")
            or "Bullcast Research Contact: example@example.com"
        )
        self._last_request_at = 0.0
        self.last_error: str | None = None

    def get_company_tickers(self, force_refresh: bool = False) -> dict[str, Any] | None:
        cache_name = "company_tickers"
        if not force_refresh:
            cached = read_json_cache(cache_name, max_age_hours=24 * 7)
            if cached is not None:
                return cached

        data = self._get_json(COMPANY_TICKERS_URL)
        if data is not None:
            write_json_cache(cache_name, data)
        return data

    def resolve_ticker_to_cik(self, ticker: str) -> dict[str, str] | None:
        target = str(ticker or "").strip().upper()
        if not target or "." in target:
            self.last_error = "SEC EDGAR applies mainly to US public companies; dotted/non-US tickers are not supported."
            return None

        mapping = self.get_company_tickers()
        if mapping is None:
            if not self.last_error:
                self.last_error = "SEC company ticker mapping is unavailable."
            return None

        for item in mapping.values():
            if not isinstance(item, dict):
                continue
            if str(item.get("ticker", "")).upper() != target:
                continue

            cik = _pad_cik(item.get("cik_str"))
            if not cik:
                self.last_error = f"SEC mapping for {target} did not include a valid CIK."
                return None

            self.last_error = None
            return {
                "ticker": target,
                "cik": cik,
                "title": str(item.get("title") or target),
            }

        self.last_error = f"{target} was not found in the SEC company ticker mapping."
        return None

    def get_submissions(self, cik: str, force_refresh: bool = False) -> dict[str, Any] | None:
        padded = _pad_cik(cik)
        if not padded:
            self.last_error = "Invalid CIK for SEC submissions request."
            return None

        cache_name = f"submissions_{padded}"
        if not force_refresh:
            cached = read_json_cache(cache_name, max_age_hours=24)
            if cached is not None:
                return cached

        data = self._get_json(SUBMISSIONS_URL.format(cik=padded))
        if data is not None:
            write_json_cache(cache_name, data)
        return data

    def get_company_facts(self, cik: str, force_refresh: bool = False) -> dict[str, Any] | None:
        padded = _pad_cik(cik)
        if not padded:
            self.last_error = "Invalid CIK for SEC company facts request."
            return None

        cache_name = f"companyfacts_{padded}"
        if not force_refresh:
            cached = read_json_cache(cache_name, max_age_hours=24 * 7)
            if cached is not None:
                return cached

        data = self._get_json(COMPANY_FACTS_URL.format(cik=padded))
        if data is not None:
            write_json_cache(cache_name, data)
        return data

    def _get_json(self, url: str) -> dict[str, Any] | None:
        self._rate_limit()
        host = urlparse(url).netloc
        headers = {
            "User-Agent": self.user_agent,
            "Accept-Encoding": "gzip, deflate",
            "Host": host,
        }

        try:
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            data = response.json()
        except requests.RequestException as exc:
            self.last_error = f"SEC request failed: {exc}"
            return None
        except ValueError as exc:
            self.last_error = f"SEC response was not valid JSON: {exc}"
            return None

        if not isinstance(data, dict):
            self.last_error = "SEC response was not a JSON object."
            return None

        self.last_error = None
        return data

    def _rate_limit(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < 0.12:
            time.sleep(0.12 - elapsed)
        self._last_request_at = time.monotonic()


def _pad_cik(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        number = int(text)
    except ValueError:
        return None
    if number <= 0:
        return None
    return f"{number:010d}"
