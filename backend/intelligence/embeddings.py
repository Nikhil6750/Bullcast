import re
import logging
import numpy as np

logger = logging.getLogger(__name__)


_model = None
_model_checked = False
_faiss = None
_faiss_checked = False


def get_model():
    global _model, _model_checked
    if _model_checked:
        return _model

    _model_checked = True
    try:
        from sentence_transformers import SentenceTransformer
    except Exception as exc:
        logger.info("SentenceTransformers unavailable; using keyword fallback: %s", exc)
        return None

    try:
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    except Exception as exc:
        logger.warning("SentenceTransformers model unavailable; using keyword fallback: %s", exc)
        _model = None

    return _model


def get_faiss():
    global _faiss, _faiss_checked
    if _faiss_checked:
        return _faiss

    _faiss_checked = True
    try:
        import faiss
    except Exception as exc:
        logger.info("FAISS unavailable; using keyword fallback: %s", exc)
        return None

    _faiss = faiss
    return _faiss


class TradeVectorStore:
    """
    In-memory vector store for trade journal.
    Uses FAISS when available. Falls back to keyword search otherwise.
    """

    def __init__(self, trades: list[dict], sentiment_context: dict = None):
        self.trades = trades or []
        self.trade_contexts = []
        if isinstance(sentiment_context, dict) and "trades" in sentiment_context:
            self.trade_contexts = sentiment_context.get("trades", [])
            self.sentiment_context = {}
        else:
            self.sentiment_context = sentiment_context or {}

        self.documents = [
            self._trade_to_text(
                trade,
                self.trade_contexts[idx] if idx < len(self.trade_contexts) else None
            )
            for idx, trade in enumerate(self.trades)
        ]
        self.index = None
        self.available = False
        self.model = None
        self.faiss = None

        if self.documents:
            self.model = get_model()
            self.faiss = get_faiss()
            self.available = self.model is not None and self.faiss is not None

        if self.available and self.documents:
            self._build_index()

    def _trade_to_text(self, trade: dict, context: dict | None = None) -> str:
        date = trade.get("date", "unknown date")
        symbol = trade.get("symbol", "unknown")
        trade_type = trade.get("type", "LONG")
        entry = trade.get("entry_price", 0)
        exit_p = trade.get("exit_price", 0)
        pnl = trade.get("pnl", 0)
        result = trade.get("result", "LOSS")
        qty = trade.get("quantity", 1)
        notes = trade.get("notes", "")

        sent = self.sentiment_context.get(date, {})
        sentiment_text = ""
        if sent:
            sentiment_text = (
                f"Market sentiment on this date was "
                f"{sent.get('sentiment', 'unknown')} "
                f"with score {sent.get('score', 'unknown')}. "
            )
        if context:
            if context.get("sentiment_available"):
                sentiment_text += (
                    f"Trade sentiment context was "
                    f"{context.get('sentiment_label', 'unknown')} "
                    f"with score {context.get('sentiment_score', 'unknown')}. "
                )
            if context.get("market_available"):
                if context.get("price_change_pct") is not None:
                    sentiment_text += (
                        f"Recent price change was "
                        f"{context.get('price_change_pct')}%. "
                    )
                if context.get("volatility_proxy") is not None:
                    sentiment_text += (
                        f"Volatility proxy was "
                        f"{context.get('volatility_proxy')}%. "
                    )

        pnl_sign = "+" if pnl >= 0 else ""

        return (
            f"Trade on {date}: "
            f"{result} trade on {symbol}. "
            f"Entered {trade_type} position at "
            f"₹{entry:,.2f}, exited at ₹{exit_p:,.2f}. "
            f"Quantity: {qty} shares. "
            f"P&L: {pnl_sign}₹{pnl:,.2f}. "
            f"{sentiment_text}"
            f"Trader notes: {notes if notes else 'none'}."
        )

    def _build_index(self):
        if not self.model or not self.faiss or not self.documents:
            self.available = False
            return

        try:
            embeddings = self.model.encode(
                self.documents,
                convert_to_numpy=True,
                normalize_embeddings=True,
            )

            dim = embeddings.shape[1]
            self.index = self.faiss.IndexFlatIP(dim)
            self.index.add(embeddings.astype(np.float32))
        except Exception as exc:
            logger.warning("Semantic index build failed; using keyword fallback: %s", exc)
            self.index = None
            self.available = False

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        """
        Semantic search over trade journal.
        Falls back to keyword search if FAISS/model is unavailable.
        """
        if not self.available or not self.model or not self.index or not self.documents:
            return self._keyword_search(query, top_k)

        try:
            query_embedding = self.model.encode(
                [query],
                convert_to_numpy=True,
                normalize_embeddings=True,
            ).astype(np.float32)

            k = min(top_k, len(self.documents))
            scores, indices = self.index.search(query_embedding, k)
        except Exception as exc:
            logger.warning("Semantic search failed; using keyword fallback: %s", exc)
            return self._keyword_search(query, top_k)

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < len(self.trades) and score > 0.3:
                results.append({
                    "trade": self.trades[idx],
                    "document": self.documents[idx],
                    "relevance": round(float(score), 3),
                })

        return results

    def _keyword_search(self, query: str, top_k: int = 5) -> list[dict]:
        if not self.trades or not self.documents:
            return []

        terms = re.findall(r"[a-z0-9.]+", str(query or "").lower())
        scored = []

        for idx, trade in enumerate(self.trades):
            document = self.documents[idx]
            searchable = " ".join([
                str(trade.get("symbol", "")),
                str(trade.get("result", "")),
                str(trade.get("type", "")),
                str(trade.get("notes", "")),
                document,
            ]).lower()

            score = sum(1 for term in terms if term in searchable)
            if score > 0:
                relevance = round(min(score / max(len(terms), 1), 1.0), 3)
                scored.append((relevance, idx))

        if not scored:
            return [{
                "trade": self.trades[idx],
                "document": self.documents[idx],
                "relevance": 0.1,
            } for idx in range(min(top_k, len(self.trades)))]

        scored.sort(key=lambda item: item[0], reverse=True)
        return [{
            "trade": self.trades[idx],
            "document": self.documents[idx],
            "relevance": relevance,
        } for relevance, idx in scored[:top_k]]
