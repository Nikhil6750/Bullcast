import os
import logging
from .analyzer import TradeAnalyzer
from .context import (FOREX_KEYWORDS,
                      STOCK_KEYWORDS,
                      build_trade_context,
                      infer_asset_type)
from .embeddings import TradeVectorStore
from .prompts import (SYSTEM_PROMPT,
                      build_question_prompt,
                      build_fallback_response)

logger = logging.getLogger(__name__)

try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    logger.warning(
        "anthropic package not installed. "
        "Using template-based responses.")


def filter_sources_by_question(question: str, retrieved: list[dict]) -> list[dict]:
    question_lower = str(question or "").lower()
    if any(word in question_lower for word in STOCK_KEYWORDS):
        return [
            item for item in retrieved
            if infer_asset_type(item.get("trade", {}).get("symbol")) == "stock"
        ]
    if any(word in question_lower for word in FOREX_KEYWORDS):
        return [
            item for item in retrieved
            if infer_asset_type(item.get("trade", {}).get("symbol")) == "forex"
        ]
    return retrieved


class TradeCoach:
    """
    Main intelligence engine.
    Combines analyzer + RAG + LLM generation.
    """

    def __init__(self, trades: list[dict]):
        self.trades = trades
        self.context = build_trade_context(trades)
        self.analyzer = TradeAnalyzer(trades, context=self.context)
        self.analysis = self.analyzer.get_all_analysis()
        self.analysis["context_summary"] = self.context.get("summary", {})
        self.vector_store = TradeVectorStore(trades, sentiment_context=self.context)

        self.llm_client = None
        api_key = os.getenv('ANTHROPIC_API_KEY', '')
        if ANTHROPIC_AVAILABLE and api_key:
            self.llm_client = anthropic.Anthropic(
                api_key=api_key)

    def get_full_analysis(self) -> dict:
        """
        Returns complete behavioral analysis.
        Used by /api/intelligence/analyze endpoint.
        """
        return {
            **self.analysis,
            "context_summary": self.context.get("summary", {}),
            "llm_available": self.llm_client is not None,
            "rag_indexed": self.vector_store.index is not None,
            "rag_available": self.vector_store.available,
            "model": "all-MiniLM-L6-v2" if self.vector_store.available else "keyword-fallback",
        }

    def answer_question(self, question: str) -> dict:
        """
        RAG Q&A: retrieve relevant trades, generate answer.
        Returns answer + sources for transparency.
        """
        if not self.trades:
            return {
                "answer": "No trades in your journal yet. Add trades to get personalized insights.",
                "sources": [],
                "method": "no_data"
            }

        if len(self.trades) < 2:
            return {
                "answer": f"You have {len(self.trades)} trade logged. Add more trades for meaningful analysis.",
                "sources": [],
                "method": "insufficient_data"
            }

        retrieved = self.vector_store.search(
            question, top_k=5)

        if self.llm_client:
            answer = self._llm_answer(
                question, retrieved)
            method = "llm_rag"
        else:
            answer = build_fallback_response(
                question, retrieved, self.analysis)
            method = "template_rag"

        source_items = filter_sources_by_question(question, retrieved)

        sources = []
        for item in source_items[:3]:
            t = item['trade']
            sources.append({
                "date": t.get('date'),
                "symbol": t.get('symbol'),
                "result": t.get('result'),
                "pnl": t.get('pnl'),
                "relevance": item['relevance']
            })

        return {
            "answer": answer,
            "sources": sources,
            "method": method,
            "trades_searched": len(self.trades)
        }

    def _llm_answer(self, question: str,
                    retrieved: list) -> str:
        """
        Call Claude API with RAG context.
        Falls back to template on any error.
        """
        try:
            user_message = build_question_prompt(
                question=question,
                retrieved_trades=retrieved,
                analysis_summary=self.analysis,
                trade_count=len(self.trades)
            )

            response = self.llm_client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=400,
                system=SYSTEM_PROMPT,
                messages=[{
                    "role": "user",
                    "content": user_message
                }]
            )

            return response.content[0].text

        except Exception as e:
            logger.error(f"LLM call failed: {e}")
            return build_fallback_response(
                question, retrieved, self.analysis)
