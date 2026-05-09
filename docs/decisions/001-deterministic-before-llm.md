# 001: Deterministic Analysis Before LLM Summarization

## Status

Accepted

## Context

Bullcast uses deterministic journal analytics as the source of truth and optional Gemini-powered summaries for natural-language review.

The platform analyzes journal trades through rule-based scoring, setup matching, mistake detection, and trader profile generation. These outputs are computed before any LLM is called. Gemini is available only as an optional backend summarization layer that reviews already-computed journal insights in clearer natural language.

## Decision

Bullcast will keep deterministic scoring, setup matching, mistake detection, and trader profile generation as the primary analysis layer.

Gemini will be used only as a summarization and coaching layer over already-computed journal insights. It must not be treated as the source of truth for metrics, setup quality, trade outcomes, or market direction.

## Rationale

- Explainability: deterministic analytics can show exactly which journal fields and rules produced a result.
- Testability: deterministic outputs can be covered in unit and HTTP-layer CI tests without relying on external model behavior.
- Lower cost during development: core analysis remains available without paying for every iteration or local test run.
- Safer behavior for trading-related analysis: fixed rules reduce the risk of unsupported trading claims or unstable model interpretations.
- Avoids unsupported prediction claims: Bullcast reviews journal history and behavior; it does not predict markets.
- Keeps financial advice boundaries clear: LLM output is constrained to educational journal review, not trade signals, broker instructions, or buy/sell recommendations.

## Consequences

- Bullcast is not an ML prediction engine.
- LLM output is educational only.
- Deterministic outputs can be tested in CI.
- Gemini can be unavailable or disabled while journal analytics still work.
- Future RAG or ML layers can be added later, but only with evaluation gates, deterministic fallbacks, and clear separation from financial advice.
