from .context import (
    FOREX_KEYWORDS,
    STOCK_KEYWORDS,
    filter_symbols_by_question,
)


SYSTEM_PROMPT = """You are a trading performance
analyst for Bullcast, a trading journal and sentiment
analysis platform.

Your role is to analyze a trader's actual trade data
and provide specific, evidence-based insights.

STRICT RULES:
1. Only reference facts from the trade data provided.
2. Never invent trades, prices, or statistics.
3. Never give specific buy/sell recommendations.
4. Never predict future prices or market movements.
5. Always cite which trades you are referring to.
6. Use clear, direct language. No financial jargon.
7. Keep responses under 200 words.
8. Always end with one specific, actionable suggestion.

If the data is insufficient to answer, say so clearly.
Do not guess or generalize."""

def build_question_prompt(
    question: str,
    retrieved_trades: list[dict],
    analysis_summary: dict,
    trade_count: int
) -> str:
    """
    Builds the user message for the Q&A endpoint.
    Injects retrieved trades as grounded context.
    """

    trade_context = ""
    for i, item in enumerate(retrieved_trades[:5]):
        t = item['trade']
        trade_context += (
            f"\nTrade {i+1} (relevance: {item['relevance']}):\n"
            f"  {item['document']}\n"
        )

    stats = analysis_summary.get('basic_stats', {})
    stats_context = (
        f"Overall stats across {trade_count} trades:\n"
        f"  Win rate: {stats.get('win_rate', 0)}%\n"
        f"  Net P&L: ₹{stats.get('total_pnl', 0):,.2f}\n"
        f"  Avg win: ₹{stats.get('avg_win', 0):,.2f}\n"
        f"  Avg loss: ₹{stats.get('avg_loss', 0):,.2f}\n"
        f"  R/R ratio: {stats.get('risk_reward_ratio', 0):.2f}\n"
    )

    return f"""Trader question: "{question}"

Retrieved relevant trades:
{trade_context}

{stats_context}

Answer the trader's question based strictly on the
trade data above. Be specific and cite the trades."""


def build_fallback_response(
    question: str,
    retrieved_trades: list[dict],
    analysis: dict
) -> str:
    """
    Template-based response when no LLM available.
    Generates a useful response using pattern matching
    on the question and retrieved data.
    """
    question_lower = str(question or "").lower()
    stats = analysis.get('basic_stats', {})
    by_symbol = analysis.get('by_symbol', [])
    symbol_candidates = filter_symbols_by_question(question, by_symbol)
    by_day = analysis.get('by_day', {})
    by_type = analysis.get('by_type', {})
    streaks = analysis.get('streaks', {})
    insights = analysis.get('insights', [])
    context_summary = analysis.get('context_summary', {})
    sentiment_alignment = analysis.get('sentiment_alignment', {})

    def money(value, signed=False):
        try:
            amount = float(value or 0)
        except (TypeError, ValueError):
            amount = 0.0
        sign = "+" if signed and amount >= 0 else ""
        return f"₹{sign}{amount:,.2f}"

    def count_word(count, singular, plural=None):
        return singular if count == 1 else (plural or f"{singular}s")

    def sample_note(total):
        if total < 10:
            return "The sample size is still small, so this is a useful signal but not a reliable pattern yet."
        if total < 20:
            return "The sample is improving, but it still needs more trades before you treat it as stable."
        return "The sample is large enough to start comparing this pattern against your rules and notes."

    def symbol_sample_note(trades):
        count = int(trades or 0)
        if count < 3:
            return f"This is not reliable yet because it is based on only {count} {count_word(count, 'trade')}."
        return sample_note(count)

    def response(direct, meaning, evidence, action):
        sections = [
            f"Direct answer:\n{direct}",
            f"What it means:\n{meaning}",
            f"Evidence:\n{evidence}",
        ]
        sections.append(f"Action:\n{action}")
        return "\n\n".join(sections)

    total = int(stats.get('total_trades', 0) or 0)
    wins = int(stats.get('total_wins', 0) or 0)
    losses = int(stats.get('total_losses', 0) or 0)
    win_rate = stats.get('win_rate', 0)
    total_pnl = stats.get('total_pnl', 0)
    profit_factor = stats.get('profit_factor', 0)
    avg_pnl = stats.get('avg_pnl_per_trade', 0)
    rr = stats.get('risk_reward_ratio', 0)

    if not total:
        return response(
            "You do not have enough trade data to analyze yet.",
            "Win rate, risk/reward, weekday patterns, and symbol patterns need logged trades before they mean anything.",
            "The current analysis contains 0 trades.",
            "Log your next trade with date, symbol, side, entry, exit, quantity, result, and notes."
        )

    context_words = [
        "sentiment", "bullish", "bearish", "market condition",
        "market context", "against sentiment", "trading against",
        "condition hurts", "market hurts"
    ]
    if any(word in question_lower for word in context_words):
        sentiment_coverage = context_summary.get("sentiment_coverage", 0)
        market_coverage = context_summary.get("market_coverage", 0)

        if not sentiment_alignment:
            unavailable = (
                "Sentiment context is not available for enough trades yet."
                if "sentiment" in question_lower or
                "bullish" in question_lower or
                "bearish" in question_lower else
                "Market context is not available for enough trades yet."
            )
            return response(
                unavailable,
                "Bullcast will not infer a sentiment or market pattern from missing or sparse context.",
                f"Sentiment coverage is {sentiment_coverage}%. Market coverage is {market_coverage}%.",
                "For the next 10 trades, record the market mood and key price condition before entry."
            )

        aligned = sentiment_alignment.get("aligned", {})
        misaligned = sentiment_alignment.get("misaligned", {})
        bullish = sentiment_alignment.get("by_sentiment", {}).get("BULLISH", {})
        if "bullish" in question_lower:
            return response(
                f"You have {bullish.get('trades', 0)} trades with BULLISH sentiment context.",
                "This only measures trades where Bullcast had sentiment data; it does not predict future market direction.",
                f"BULLISH trades: {bullish.get('win_rate', 0)}% win rate, total P&L {money(bullish.get('total_pnl', 0), signed=True)}.",
                "For the next 10 trades, note whether sentiment was bullish, bearish, or neutral before entry."
            )

        return response(
            "Sentiment alignment is available for part of your journal.",
            "Aligned trades followed the sentiment direction; misaligned trades went against it.",
            f"Aligned: {aligned.get('trades', 0)} trades, {aligned.get('win_rate', 0)}% win rate. Misaligned: {misaligned.get('trades', 0)} trades, {misaligned.get('win_rate', 0)}% win rate.",
            "Before each new stock trade, write whether the direction agrees with sentiment."
        )

    for sym_data in symbol_candidates:
        sym = sym_data['symbol'].upper()
        if sym.lower() in question_lower or \
           sym.replace('.NS','').lower() in question_lower:
            symbol_pnl = sym_data.get('total_pnl', 0)
            meaning = (
                "This symbol is contributing positively to your journal."
                if symbol_pnl > 0 else
                "This symbol is currently dragging down your journal."
                if symbol_pnl < 0 else
                "This symbol is roughly flat in your current journal."
            )
            return response(
                f"For {sym}, your win rate is {sym_data.get('win_rate', 0)}% across {sym_data.get('trades', 0)} {count_word(int(sym_data.get('trades', 0) or 0), 'trade')}.",
                f"{meaning} {symbol_sample_note(sym_data.get('trades', 0))}",
                f"{sym_data.get('trades', 0)} {count_word(int(sym_data.get('trades', 0) or 0), 'trade')}, total P&L {money(symbol_pnl, signed=True)}, average P&L per trade {money(sym_data.get('avg_pnl', 0), signed=True)}.",
                f"Review the notes for your {sym} trades and write down the setup condition that appeared before each result."
            )

    symbol_words = [
        'stock', 'share', 'equity', 'company', 'symbol', 'ticker',
        'forex', 'currency', 'pair', 'best stock', 'best symbol'
    ]
    if by_symbol and any(w in question_lower for w in symbol_words):
        if not symbol_candidates and any(w in question_lower for w in STOCK_KEYWORDS):
            return response(
                "I do not have enough stock trades in your journal yet.",
                "Your question asks about stocks, so forex pairs are excluded from this answer.",
                f"Your journal has {total} {count_word(total, 'trade')}, but no stock-like symbols such as .NS, .BO, RELIANCE, TATASTEEL, INFY, or TCS.",
                "Log at least 3 stock trades before comparing your strongest stock."
            )
        if not symbol_candidates and any(w in question_lower for w in FOREX_KEYWORDS):
            return response(
                "I do not have enough forex trades in your journal yet.",
                "Your question asks about forex, so stock-like symbols are excluded from this answer.",
                f"Your journal has {total} {count_word(total, 'trade')}, but no 6-letter forex pairs such as AUDCAD, EURUSD, or USDJPY.",
                "Log at least 3 forex trades before comparing your strongest pair."
            )

        label = "symbol"
        if any(w in question_lower for w in STOCK_KEYWORDS):
            label = "stock"
        elif any(w in question_lower for w in FOREX_KEYWORDS):
            label = "forex pair"

        best = max(
            symbol_candidates,
            key=lambda row: (
                row.get('total_pnl', 0),
                row.get('win_rate', 0),
                row.get('trades', 0),
            )
        )
        return response(
            f"Your strongest {label} so far is {best.get('symbol')} based on total P&L.",
            f"It is the best contributor in the matching journal set. {symbol_sample_note(best.get('trades', 0))}",
            f"{best.get('symbol')} has {best.get('trades', 0)} {count_word(int(best.get('trades', 0) or 0), 'trade')}, {best.get('win_rate', 0)}% win rate, total P&L {money(best.get('total_pnl', 0), signed=True)}, and average P&L {money(best.get('avg_pnl', 0), signed=True)}.",
            f"Tag each {best.get('symbol')} trade note with the setup you used so you can confirm whether the edge repeats."
        )

    if any(w in question_lower for w in
           ['risk reward', 'risk/reward', 'r:r', 'rr', 'profit factor', 'reward']):
        meaning = (
            "Your winners are larger than your losers on average."
            if rr >= 1 else
            "Your average win is smaller than your average loss, so the win rate has to carry more of the performance."
            if rr > 0 else
            "Risk/reward cannot be judged well until both wins and losses exist in the data."
        )
        return response(
            f"Your risk/reward ratio is {rr:.2f}, and your profit factor is {profit_factor:.2f}.",
            f"{meaning} {sample_note(total)}",
            f"Average win {money(stats.get('avg_win', 0))}, average loss {money(stats.get('avg_loss', 0))}, net P&L {money(total_pnl, signed=True)}, across {total} {count_word(total, 'trade')}.",
            "For your next 5 trades, write the planned risk and expected reward in the notes before judging the setup."
        )

    if any(w in question_lower for w in
           ['day', 'weekday', 'monday', 'tuesday', 'wednesday',
            'thursday', 'friday', 'saturday', 'sunday']):
        if by_day:
            best_day = max(
                by_day.items(),
                key=lambda item: (item[1].get('avg_pnl', 0), item[1].get('win_rate', 0))
            )
            worst_day = min(
                by_day.items(),
                key=lambda item: (item[1].get('avg_pnl', 0), item[1].get('win_rate', 0))
            )
            return response(
                f"Your most profitable day is {best_day[0]} based on average P&L.",
                f"{best_day[0]} is currently stronger than {worst_day[0]}, but weekday patterns need repeated samples before they are reliable.",
                f"{best_day[0]}: {best_day[1].get('trades', 0)} {count_word(int(best_day[1].get('trades', 0) or 0), 'trade')}, {best_day[1].get('win_rate', 0)}% win rate, average P&L {money(best_day[1].get('avg_pnl', 0), signed=True)}. {worst_day[0]}: average P&L {money(worst_day[1].get('avg_pnl', 0), signed=True)}.",
                "Add the market session and reason-for-entry to each trade note for the next 10 trades."
            )
        return response(
            "There is not enough weekday data to identify your best or worst trading day.",
            "The day-of-week pattern needs trades spread across multiple days.",
            f"Your journal has {total} {count_word(total, 'trade')} and no usable weekday breakdown yet.",
            "Log at least 2 trades on several different weekdays before comparing day performance."
        )

    if any(w in question_lower for w in
           ['long', 'short', 'side', 'direction']):
        if by_type:
            parts = [
                f"{side}: {data.get('trades', 0)} {count_word(int(data.get('trades', 0) or 0), 'trade')}, {data.get('win_rate', 0)}% win rate, total P&L {money(data.get('total_pnl', 0), signed=True)}"
                for side, data in by_type.items()
            ]
            best_side = max(
                by_type.items(),
                key=lambda item: (item[1].get('total_pnl', 0), item[1].get('win_rate', 0))
            )
            return response(
                f"{best_side[0]} is your stronger side so far based on total P&L.",
                f"This compares trade direction only; it does not mean you should favor that side without matching it to your setup rules. {sample_note(total)}",
                "; ".join(parts) + ".",
                "For your next 10 trades, add a note explaining why the trade was LONG or SHORT."
            )
        return response(
            "There is not enough LONG vs SHORT data to compare direction performance.",
            "Direction performance needs at least one logged trade for each side you want to compare.",
            f"Your journal currently has {total} {count_word(total, 'trade')}.",
            "Keep the trade side field accurate for every new journal entry."
        )

    if any(w in question_lower for w in
           ['loss', 'losing', 'weakness', 'weak', 'mistake', 'problem']):
        if total < 10:
            clue = "the sample is too small to name a reliable weakness"
            clue_evidence = (
                f"{wins} {count_word(wins, 'win')}, "
                f"{losses} {count_word(losses, 'loss')}, "
                f"net P&L {money(total_pnl, signed=True)}"
            )
            negative_symbol = min(
                by_symbol,
                key=lambda row: row.get('total_pnl', 0),
                default=None
            )
            if losses == 1:
                clue = "only one losing trade is visible so far"
            elif negative_symbol and negative_symbol.get('total_pnl', 0) < 0:
                clue = f"{negative_symbol.get('symbol')} has negative P&L"
                clue_evidence = (
                    f"{negative_symbol.get('symbol')}: "
                    f"{negative_symbol.get('trades', 0)} "
                    f"{count_word(int(negative_symbol.get('trades', 0) or 0), 'trade')}, "
                    f"total P&L {money(negative_symbol.get('total_pnl', 0), signed=True)}"
                )
            elif rr and rr < 1:
                clue = "your risk/reward is below 1.00"
                clue_evidence = (
                    f"Risk/reward {rr:.2f}, profit factor "
                    f"{profit_factor:.2f}, net P&L {money(total_pnl, signed=True)}"
                )
            elif by_day:
                worst_day = min(
                    by_day.items(),
                    key=lambda item: (
                        item[1].get('avg_pnl', 0),
                        item[1].get('win_rate', 0)
                    )
                )
                clue = f"{worst_day[0]} is the weakest visible weekday"
                clue_evidence = (
                    f"{worst_day[0]}: {worst_day[1].get('trades', 0)} "
                    f"{count_word(int(worst_day[1].get('trades', 0) or 0), 'trade')}, "
                    f"{worst_day[1].get('win_rate', 0)}% win rate, "
                    f"average P&L {money(worst_day[1].get('avg_pnl', 0), signed=True)}"
                )

            return response(
                f"Your biggest weakness is not reliable yet because it is based on only {total} {count_word(total, 'trade')}.",
                f"Preliminary clue: {clue}. Treat this as an early signal, not a pattern.",
                clue_evidence + f", across {total} {count_word(total, 'trade')}.",
                "Log at least 10 trades, then review losses by symbol, weekday, and trade notes before naming a real weakness."
            )

        worst_insight = next(
            (item for item in insights
             if item.get('severity') in {'critical', 'warning'}),
            None
        )
        if worst_insight:
            streak_count = int(streaks.get('current_streak', 0) or 0)
            streak_type = str(streaks.get('current_streak_type', '') or '').lower()
            streak_text = (
                f"{streak_count} {streak_type} {count_word(streak_count, 'trade')}"
                if streak_type else
                f"{streak_count} {count_word(streak_count, 'trade')}"
            )
            return response(
                f"Your biggest visible weakness is: {worst_insight.get('title', 'a recurring performance issue')}.",
                str(worst_insight.get('finding', 'This issue comes from the patterns in your journal.')),
                f"Current streak: {streak_text}. Max loss streak: {streaks.get('max_loss_streak', 0)}. Net P&L {money(total_pnl, signed=True)} across {total} {count_word(total, 'trade')}.",
                "For the next 10 trades, tag the issue named above in your notes so you can verify whether it repeats."
            )
        return response(
            "No single weakness is clear from the current journal yet.",
            "Your data does not show a strong warning pattern, or the sample is still too small.",
            f"{wins} {count_word(wins, 'win')}, {losses} {count_word(losses, 'loss')}, {win_rate}% win rate, net P&L {money(total_pnl, signed=True)}, max loss streak {streaks.get('max_loss_streak', 0)}.",
            "For every loss in the next 10 trades, add one note naming the exact rule that failed or was ignored."
        )

    if any(w in question_lower for w in
           ['win rate', 'win', 'performance', 'good', 'bad', 'doing']):
        if win_rate > 50:
            meaning = "You are winning more trades than you lose."
        elif win_rate < 50:
            meaning = "You are losing more trades than you win."
        else:
            meaning = "Your wins and losses are evenly split."
        return response(
            f"Your win rate is {win_rate}% across {total} {count_word(total, 'trade')}.",
            f"{meaning} {sample_note(total)}",
            f"{wins} {count_word(wins, 'win')}, {losses} {count_word(losses, 'loss')}, net P&L {money(total_pnl, signed=True)}, profit factor {profit_factor:.2f}, average P&L per trade {money(avg_pnl, signed=True)}.",
            "Log at least 10-20 trades before treating this as a real performance pattern."
        )

    top_symbol = max(
        by_symbol,
        key=lambda row: row.get('total_pnl', 0),
        default=None
    )
    symbol_line = (
        f" Best symbol by P&L is {top_symbol.get('symbol')} at {money(top_symbol.get('total_pnl', 0), signed=True)}."
        if top_symbol else ""
    )
    return response(
        f"Your current journal summary is {win_rate}% win rate across {total} {count_word(total, 'trade')}.",
        f"Net performance is {'positive' if total_pnl > 0 else 'negative' if total_pnl < 0 else 'flat'}, but {sample_note(total).lower()}",
        f"{wins} {count_word(wins, 'win')}, {losses} {count_word(losses, 'loss')}, net P&L {money(total_pnl, signed=True)}, profit factor {profit_factor:.2f}, average P&L {money(avg_pnl, signed=True)}.{symbol_line}",
        "Review the last 3 trade notes and add one tag for setup quality, entry timing, or rule discipline."
    )
