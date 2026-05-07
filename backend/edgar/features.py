from __future__ import annotations

from datetime import date, datetime
from typing import Any

from .client import EdgarClient


RELEVANT_FORMS = {"10-K", "10-Q", "8-K"}
CORE_FACTS = {
    "revenues": ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"],
    "net_income": ["NetIncomeLoss"],
    "assets": ["Assets"],
    "liabilities": ["Liabilities"],
    "stockholders_equity": ["StockholdersEquity"],
    "cash_and_cash_equivalents": ["CashAndCashEquivalentsAtCarryingValue"],
    "operating_cash_flow": ["NetCashProvidedByUsedInOperatingActivities"],
    "eps_diluted": ["EarningsPerShareDiluted"],
}


def parse_date_safe(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return datetime.combine(value, datetime.min.time())

    text = str(value or "").strip()
    if not text:
        return None

    candidates = [text]
    if len(text) > 10:
        candidates.append(text[:10])

    for candidate in candidates:
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            continue

    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue

    return None


def filter_filings_as_of(recent_filings: list[dict[str, Any]], as_of_date: Any) -> list[dict[str, Any]]:
    as_of = parse_date_safe(as_of_date)
    if as_of is None:
        return []

    filtered: list[dict[str, Any]] = []
    for filing in recent_filings if isinstance(recent_filings, list) else []:
        if not isinstance(filing, dict):
            continue
        if filing.get("form") not in RELEVANT_FORMS:
            continue
        filing_date = parse_date_safe(filing.get("filingDate"))
        if filing_date is None or filing_date > as_of:
            continue
        filtered.append(filing)

    return sorted(filtered, key=lambda filing: parse_date_safe(filing.get("filingDate")) or datetime.min, reverse=True)


def latest_fact_as_of(companyfacts: dict[str, Any], concept_names: str | list[str], as_of_date: Any) -> dict[str, Any] | None:
    as_of = parse_date_safe(as_of_date)
    if as_of is None:
        return None

    names = [concept_names] if isinstance(concept_names, str) else list(concept_names or [])
    us_gaap = (
        companyfacts.get("facts", {}).get("us-gaap", {})
        if isinstance(companyfacts, dict)
        else {}
    )
    if not isinstance(us_gaap, dict):
        return None

    candidates: list[dict[str, Any]] = []
    for concept in names:
        candidates.extend(_fact_candidates(us_gaap.get(concept), as_of=as_of))

    if not candidates:
        return None

    return max(candidates, key=_fact_sort_key)


def extract_core_company_facts_as_of(companyfacts: dict[str, Any], as_of_date: Any) -> dict[str, Any]:
    as_of = parse_date_safe(as_of_date)
    if as_of is None:
        return {
            "available": False,
            "facts": {},
            "warnings": ["Invalid as-of date for SEC company facts filtering."],
        }

    us_gaap = (
        companyfacts.get("facts", {}).get("us-gaap", {})
        if isinstance(companyfacts, dict)
        else {}
    )
    if not isinstance(us_gaap, dict):
        return {
            "available": False,
            "facts": {},
            "warnings": ["SEC company facts did not include a usable us-gaap facts object."],
        }

    facts: dict[str, Any] = {}
    for output_name, concept_names in CORE_FACTS.items():
        fact = latest_fact_as_of(companyfacts, concept_names, as_of)
        if fact is not None:
            facts[output_name] = fact

    return {
        "available": bool(facts),
        "facts": facts,
        "warnings": [],
    }


def extract_recent_filings(submissions: dict[str, Any], limit: int = 10) -> list[dict[str, Any]]:
    recent = submissions.get("filings", {}).get("recent", {}) if isinstance(submissions, dict) else {}
    if not isinstance(recent, dict):
        return []

    forms = _list_field(recent, "form")
    filings: list[dict[str, Any]] = []
    count = len(forms)

    for idx in range(count):
        form = _at(forms, idx)
        if form not in RELEVANT_FORMS:
            continue

        filing = {
            "accessionNumber": _at(_list_field(recent, "accessionNumber"), idx),
            "filingDate": _at(_list_field(recent, "filingDate"), idx),
            "reportDate": _at(_list_field(recent, "reportDate"), idx),
            "form": form,
            "primaryDocument": _at(_list_field(recent, "primaryDocument"), idx),
            "description": _at(_list_field(recent, "primaryDocDescription"), idx),
        }
        filings.append(filing)
        if len(filings) >= limit:
            break

    return filings


def extract_core_company_facts(companyfacts: dict[str, Any]) -> dict[str, Any]:
    warnings: list[str] = []
    us_gaap = (
        companyfacts.get("facts", {}).get("us-gaap", {})
        if isinstance(companyfacts, dict)
        else {}
    )
    if not isinstance(us_gaap, dict):
        return {
            "available": False,
            "facts": {},
            "warnings": ["SEC company facts did not include a usable us-gaap facts object."],
        }

    facts: dict[str, Any] = {}
    for output_name, concept_names in CORE_FACTS.items():
        fact = _latest_fact_for_concepts(us_gaap, concept_names)
        if fact is None:
            warnings.append(f"Missing SEC concept: {', '.join(concept_names)}")
            continue
        facts[output_name] = fact

    return {
        "available": bool(facts),
        "facts": facts,
        "warnings": warnings,
    }


def build_edgar_context_for_ticker(ticker: str) -> dict[str, Any]:
    client = EdgarClient()
    normalized = str(ticker or "").strip().upper()
    warnings: list[str] = []

    resolved = client.resolve_ticker_to_cik(normalized)
    if resolved is None:
        warning = client.last_error or f"{normalized or 'Ticker'} was not found in SEC EDGAR."
        return {
            "ticker": normalized,
            "cik": None,
            "company_name": None,
            "available": False,
            "recent_filings": [],
            "core_facts": {"available": False, "facts": {}, "warnings": []},
            "warnings": [warning],
        }

    cik = resolved["cik"]
    submissions = client.get_submissions(cik)
    if submissions is None:
        warnings.append(client.last_error or "SEC submissions are unavailable.")
        submissions = {}

    companyfacts = client.get_company_facts(cik)
    if companyfacts is None:
        warnings.append(client.last_error or "SEC company facts are unavailable.")
        companyfacts = {}

    recent_filings = extract_recent_filings(submissions)
    core_facts = extract_core_company_facts(companyfacts)
    warnings.extend(core_facts.get("warnings", []))

    available = bool(recent_filings) or bool(core_facts.get("available"))
    if not available and not warnings:
        warnings.append("No SEC filings or company facts were available for this ticker.")

    return {
        "ticker": resolved["ticker"],
        "cik": cik,
        "company_name": resolved["title"],
        "available": available,
        "recent_filings": recent_filings,
        "core_facts": core_facts,
        "warnings": warnings,
    }


def fetch_edgar_source_for_ticker(ticker: str) -> dict[str, Any]:
    client = EdgarClient()
    normalized = str(ticker or "").strip().upper()
    warnings: list[str] = []

    resolved = client.resolve_ticker_to_cik(normalized)
    if resolved is None:
        warning = client.last_error or f"{normalized or 'Ticker'} was not found in SEC EDGAR."
        return {
            "ticker": normalized,
            "cik": None,
            "company_name": None,
            "available": False,
            "submissions": {},
            "companyfacts": {},
            "warnings": [warning],
        }

    cik = resolved["cik"]
    submissions = client.get_submissions(cik)
    if submissions is None:
        warnings.append(client.last_error or "SEC submissions are unavailable.")
        submissions = {}

    companyfacts = client.get_company_facts(cik)
    if companyfacts is None:
        warnings.append(client.last_error or "SEC company facts are unavailable.")
        companyfacts = {}

    return {
        "ticker": resolved["ticker"],
        "cik": cik,
        "company_name": resolved["title"],
        "available": bool(submissions) or bool(companyfacts),
        "submissions": submissions,
        "companyfacts": companyfacts,
        "warnings": warnings,
    }


def build_edgar_context_from_source_as_of(source: dict[str, Any], as_of_date: Any) -> dict[str, Any]:
    as_of = parse_date_safe(as_of_date)
    ticker = str(source.get("ticker") or "").upper() if isinstance(source, dict) else ""
    warnings = list(source.get("warnings") or []) if isinstance(source, dict) else []

    if as_of is None:
        return {
            "ticker": ticker,
            "cik": source.get("cik") if isinstance(source, dict) else None,
            "company_name": source.get("company_name") if isinstance(source, dict) else None,
            "available": False,
            "point_in_time": False,
            "as_of_date": None,
            "recent_filings": [],
            "core_facts": {"available": False, "facts": {}, "warnings": []},
            "warnings": warnings + ["Invalid or missing trade date for point-in-time EDGAR filtering."],
        }

    if not isinstance(source, dict) or not source.get("available"):
        return {
            "ticker": ticker,
            "cik": source.get("cik") if isinstance(source, dict) else None,
            "company_name": source.get("company_name") if isinstance(source, dict) else None,
            "available": False,
            "point_in_time": True,
            "as_of_date": as_of.date().isoformat(),
            "recent_filings": [],
            "core_facts": {"available": False, "facts": {}, "warnings": []},
            "warnings": warnings or ["SEC source data was unavailable for point-in-time filtering."],
        }

    all_filings = extract_recent_filings(source.get("submissions", {}), limit=1000)
    recent_filings = filter_filings_as_of(all_filings, as_of)[:10]
    core_facts = extract_core_company_facts_as_of(source.get("companyfacts", {}), as_of)
    warnings.extend(core_facts.get("warnings", []))

    if not core_facts.get("available"):
        warnings.append("No SEC facts available as of trade date.")
    if not recent_filings:
        warnings.append("No SEC filings available as of trade date.")

    available = bool(recent_filings) or bool(core_facts.get("available"))
    if not available:
        warnings.append("No point-in-time SEC data available as of trade date.")

    return {
        "ticker": source.get("ticker"),
        "cik": source.get("cik"),
        "company_name": source.get("company_name"),
        "available": available,
        "point_in_time": True,
        "as_of_date": as_of.date().isoformat(),
        "recent_filings": recent_filings,
        "core_facts": core_facts,
        "warnings": _unique_strings(warnings),
    }


def build_edgar_context_for_ticker_as_of(ticker: str, as_of_date: Any) -> dict[str, Any]:
    source = fetch_edgar_source_for_ticker(ticker)
    return build_edgar_context_from_source_as_of(source, as_of_date)


def _latest_fact(concept_data: Any) -> dict[str, Any] | None:
    candidates = _fact_candidates(concept_data)
    if not candidates:
        return None

    return max(candidates, key=_fact_sort_key)


def _latest_fact_for_concepts(us_gaap: dict[str, Any], concept_names: list[str]) -> dict[str, Any] | None:
    candidates: list[dict[str, Any]] = []
    for concept in concept_names:
        candidates.extend(_fact_candidates(us_gaap.get(concept)))

    if not candidates:
        return None

    return max(candidates, key=_fact_sort_key)


def _fact_candidates(concept_data: Any, as_of: datetime | None = None) -> list[dict[str, Any]]:
    if not isinstance(concept_data, dict):
        return []

    units = concept_data.get("units", {})
    if not isinstance(units, dict):
        return []

    candidates: list[dict[str, Any]] = []
    for unit, items in units.items():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict) or "val" not in item:
                continue
            filed_date = parse_date_safe(item.get("filed"))
            if as_of is not None and (filed_date is None or filed_date > as_of):
                continue
            candidates.append({
                "value": item.get("val"),
                "unit": unit,
                "fiscal_year": item.get("fy"),
                "fiscal_period": item.get("fp"),
                "form": item.get("form"),
                "filed": item.get("filed"),
                "end": item.get("end"),
            })

    return candidates


def _fact_sort_key(item: dict[str, Any]) -> tuple[datetime, datetime]:
    return (_parse_date(item.get("filed")), _parse_date(item.get("end")))


def _parse_date(value: Any) -> datetime:
    return parse_date_safe(value) or datetime.min


def _list_field(source: dict[str, Any], name: str) -> list[Any]:
    value = source.get(name)
    return value if isinstance(value, list) else []


def _at(values: list[Any], index: int) -> Any:
    return values[index] if index < len(values) else None


def _unique_strings(values: list[Any]) -> list[str]:
    unique: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if text and text not in unique:
            unique.append(text)
    return unique
