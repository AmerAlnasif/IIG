---
name: ai-trader-polymarket
version: 1.0.0
description: |
  Resolve Polymarket public markets and outcome-token orderbook prices
  directly from Polymarket's own public APIs (never routed through
  AI-Trader), then hand a resolved market/outcome/token_id to
  ai-trader-tradesync for simulated publication. Use for any Polymarket
  market discovery or price-lookup request.
triggers:
  - "Polymarket market"
  - "Polymarket price"
  - "resolve this Polymarket outcome"
  - "what's the orderbook on"
tools:
  - http_fetch
mutating: false
---

# Polymarket Public Data

No AI-Trader session required. This skill talks only to Polymarket's own
public infrastructure (`gamma-api.polymarket.com`,
`clob.polymarket.com`) — never to `ai4trade.ai` for discovery. AI-Trader is
used only afterward, to publish a simulated trade against an already
resolved market/outcome (see `skills/ai-trader-tradesync/SKILL.md`).

## Contract

This skill guarantees:

- All market discovery and pricing reads go directly to Polymarket's public
  APIs, not through AI-Trader.
- A concrete outcome (`Yes`/`No`/etc.) and its `token_id` are resolved
  before handing off to `ai-trader-tradesync` — never a bare market slug.
- This skill never publishes a trade itself.

## Phases

1. **Resolve the market.** `GET https://gamma-api.polymarket.com/markets?slug=<slug>`
   or `?conditionId=<id>`. Read `question`, `slug`, `outcomes[]`,
   `clobTokenIds[]`.
2. **Pick a concrete outcome.** Pair `outcomes[i]` with `clobTokenIds[i]` to
   get the exact `token_id`.
3. **Read the orderbook.** `GET https://clob.polymarket.com/book?token_id=<id>`;
   derive a mid price from best bid/ask.
4. **Hand off (only if the user wants to act).** Give
   `skills/ai-trader-tradesync/SKILL.md` a publish payload shaped as:
   `{"market": "polymarket", "symbol": <slug or conditionId>, "outcome": <Yes/No>, "token_id": <id>, "price": 0, "quantity": <qty>, "executed_at": "now"}`.

## Output Format

Market question, resolved outcome, `token_id`, and best bid/ask/mid price.

## Anti-Patterns

- Querying AI-Trader for Polymarket market discovery instead of Polymarket's
  own public APIs.
- Publishing to AI-Trader with only a slug and no resolved outcome/token_id.
- Treating a Polymarket "buy" as a real-money bet — via AI-Trader it is
  simulated only; this skill never sends orders to Polymarket itself.

## Tools Used

- `http_fetch` — `https://gamma-api.polymarket.com/markets`,
  `https://clob.polymarket.com/book`. No auth required (public APIs).

## API Reference

| Endpoint | Description |
|----------|--------------|
| `GET https://gamma-api.polymarket.com/markets?slug=<slug>` | Resolve by slug |
| `GET https://gamma-api.polymarket.com/markets?conditionId=<id>` | Resolve by condition ID |
| `GET https://clob.polymarket.com/book?token_id=<id>` | Orderbook for one outcome token |
