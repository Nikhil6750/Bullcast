from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class JournalTrade(BaseModel):
    """
    Canonical Bullcast journal trade model.

    The model is intentionally tolerant of partially imported rows so analysis
    endpoints can return empty-state guidance instead of failing on sparse
    journal data.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str | None = None
    date: str | None = ""
    symbol: str = "UNKNOWN"
    asset_type: str | None = None
    type: Literal["LONG", "SHORT"] = "LONG"
    entry_price: float | None = None
    exit_price: float | None = None
    quantity: float | None = None
    pnl: float | None = None
    pnl_pct: float | None = None
    result: Literal["WIN", "LOSS"] | None = None
    notes: str | None = ""
    setup_tag: str | None = None
    mistake_tag: str | None = "none"
    confidence_score: int | None = Field(default=None, ge=1, le=5)
    planned_risk: float | None = None
    planned_reward: float | None = None
    rule_followed: bool | None = None
    entry_reason: str | None = None
    exit_reason: str | None = None
    scenario_context: str | None = None
    synthetic_flag: bool | None = None
    source_type: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _map_import_aliases(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value

        data = dict(value)
        aliases = {
            "side": "type",
            "entry": "entry_price",
            "exit": "exit_price",
            "setup": "setup_tag",
            "setupName": "setup_tag",
            "setup_name": "setup_tag",
            "strategy": "setup_tag",
            "mistake": "mistake_tag",
            "confidence": "confidence_score",
        }
        for source_key, target_key in aliases.items():
            if target_key not in data or data.get(target_key) in ("", None):
                if source_key in data:
                    data[target_key] = data.get(source_key)
        return data

    @field_validator("symbol", mode="before")
    @classmethod
    def _symbol(cls, value: Any) -> str:
        text = str(value or "").strip().upper()
        return text or "UNKNOWN"

    @field_validator("type", mode="before")
    @classmethod
    def _direction(cls, value: Any) -> str:
        text = str(value or "LONG").strip().upper()
        if text in {"SHORT", "SELL", "S"}:
            return "SHORT"
        return "LONG"

    @field_validator("result", mode="before")
    @classmethod
    def _result(cls, value: Any) -> str | None:
        text = str(value or "").strip().upper()
        if text in {"WIN", "PROFIT", "W"}:
            return "WIN"
        if text in {"LOSS", "LOSE", "L"}:
            return "LOSS"
        return None

    @field_validator(
        "entry_price",
        "exit_price",
        "quantity",
        "pnl",
        "pnl_pct",
        "planned_risk",
        "planned_reward",
        mode="before",
    )
    @classmethod
    def _optional_float(cls, value: Any) -> float | None:
        if value in ("", None):
            return None
        if isinstance(value, str):
            value = value.replace(",", "").replace("$", "").replace("%", "").strip()
            if value == "":
                return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if number != number or number in {float("inf"), float("-inf")}:
            return None
        return number

    @field_validator("confidence_score", mode="before")
    @classmethod
    def _confidence(cls, value: Any) -> int | None:
        if value in ("", None):
            return None
        try:
            number = int(float(value))
        except (TypeError, ValueError):
            return None
        if 1 <= number <= 5:
            return number
        return None

    @field_validator("rule_followed", "synthetic_flag", mode="before")
    @classmethod
    def _optional_bool(cls, value: Any) -> bool | None:
        if isinstance(value, bool):
            return value
        if value in ("", None):
            return None
        text = str(value).strip().lower()
        if text in {"true", "yes", "y", "1"}:
            return True
        if text in {"false", "no", "n", "0"}:
            return False
        return None

    @field_validator(
        "id",
        "date",
        "asset_type",
        "notes",
        "setup_tag",
        "mistake_tag",
        "entry_reason",
        "exit_reason",
        "scenario_context",
        "source_type",
        mode="before",
    )
    @classmethod
    def _optional_text(cls, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text if text else None

    @model_validator(mode="after")
    def _derive_result_fields(self) -> "JournalTrade":
        if self.pnl is None and _positive(self.entry_price) and _positive(self.exit_price) and _positive(self.quantity):
            if self.type == "SHORT":
                self.pnl = (self.entry_price - self.exit_price) * self.quantity
            else:
                self.pnl = (self.exit_price - self.entry_price) * self.quantity

        if self.pnl_pct is None and self.pnl is not None and _positive(self.entry_price) and _positive(self.quantity):
            cost = self.entry_price * self.quantity
            self.pnl_pct = (self.pnl / cost) * 100 if cost else None

        if self.result is None and self.pnl is not None:
            if self.pnl > 0:
                self.result = "WIN"
            elif self.pnl < 0:
                self.result = "LOSS"

        if not self.id:
            self.id = f"{self.symbol}-{self.date or 'undated'}"
        if not self.date:
            self.date = ""
        if not self.notes:
            self.notes = ""
        if not self.mistake_tag:
            self.mistake_tag = "none"
        self.setup_tag = _normalize_setup_tag(self.setup_tag) or _infer_setup_from_notes(self.notes)
        if self.source_type:
            self.source_type = self.source_type.lower()
        return self


def normalize_journal_trade(trade: Any, index: int = 0) -> dict[str, Any]:
    source = trade if isinstance(trade, dict) else {}
    normalized = JournalTrade.model_validate(source).model_dump()
    if normalized.get("id") in {None, "", "UNKNOWN-undated"}:
        normalized["id"] = f"{normalized.get('symbol') or 'TRADE'}-{index}"
    return normalized


def is_synthetic_trade(trade: dict[str, Any] | JournalTrade | None) -> bool:
    if trade is None:
        return False
    data = trade.model_dump() if isinstance(trade, JournalTrade) else trade
    if not isinstance(data, dict):
        return False
    synthetic_flag = data.get("synthetic_flag") is True
    source_type = str(data.get("source_type") or "").strip().lower()
    trade_id = str(data.get("id") or data.get("trade_id") or "").strip().upper()
    return synthetic_flag or source_type == "synthetic_dev" or trade_id.startswith("SYN-")


def _positive(value: float | None) -> bool:
    return isinstance(value, (int, float)) and value > 0


def _normalize_setup_tag(value: str | None) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    key = text.lower().replace("-", " ").replace("_", " ")
    key = " ".join(key.split())
    if key in {"streak pullback", "streak pullback confirmation", "streak pullback confirmation setup"}:
        return "Streak Pullback Confirmation"
    if key == "pattern alert":
        return "Pattern Alert"
    return text


def _infer_setup_from_notes(notes: str | None) -> str | None:
    text = str(notes or "").lower()
    if "streak" in text and "pullback" in text and "confirmation" in text:
        return "Streak Pullback Confirmation"
    if "pattern alert" in text:
        return "Pattern Alert"
    return None
