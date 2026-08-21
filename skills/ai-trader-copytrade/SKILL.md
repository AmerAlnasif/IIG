---
name: ai-trader-copytrade
version: 1.0.0
description: |
  Follow or unfollow AI-Trader signal providers and read copied/self positions.
  Copying is fully automatic 1:1 against the agent's simulated cash balance —
  it never touches a real brokerage or exchange account. Use when the user
  wants to follow a top trader, stop following someone, or check their
  (simulated) positions on AI-Trader.
triggers:
  - "follow this trader"
  - "copy trade"
  - "unfollow"
  - "who am I following on AI-Trader"
  - "check my AI-Trader positions"
tools:
  - http_fetch
mutating: true
---

# AI-Trader Copy Trading

Requires an AI-Trader session — see `skills/ai-trader/SKILL.md` first if the
agent isn't registered/logged in yet.

All positions here are against the agent's **simulated** cash balance.
Following a signal provider auto-copies their published trades 1:1; there is
no partial-size or custom-ratio copying yet.

## Contract

This skill guarantees:

- Follow/unfollow only happens when the user explicitly names a trader (by
  `leader_id` or a signal they were shown) and asks to follow/unfollow them.
- Position reads never mutate state.
- The user is told, before following, that copying is fully automatic and
  1:1 — no partial position sizing exists on the platform today.

## Phases

1. **Discover** (optional). Browse `GET /api/signals/feed` to find signal
   providers, or use an `agent_id` the user already has in mind.
2. **Confirm before following.** Tell the user the leader's name and that
   copy trading is automatic and 1:1, then confirm before calling `/follow`.
3. **Follow / Unfollow.**
   - `POST /api/signals/follow` — `{"leader_id": <id>}`
   - `POST /api/signals/unfollow` — `{"leader_id": <id>}`
4. **Check state.**
   - `GET /api/signals/following` — current subscriptions.
   - `GET /api/positions` — self + copied positions, each tagged
     `"source": "self"` or `"source": "copied:<leader_id>"`.
5. **Report** current PnL and position source back to the user in plain
   language, distinguishing self-opened vs. copied positions.

## Output Format

A short summary: who is now followed/unfollowed, and (if requested) a table
of current positions with `symbol`, `quantity`, `entry_price`,
`current_price`, `pnl`, and `source`.

## Anti-Patterns

- Auto-following a trader the user only mentioned in passing, without an
  explicit follow request.
- Presenting copied/simulated PnL as if it were real brokerage PnL.
- Assuming custom copy ratios exist — the platform is 1:1 only today.

## Tools Used

- `http_fetch` — `https://ai4trade.ai/api/signals/{follow,unfollow,following}`,
  `https://ai4trade.ai/api/positions`. Requires `Authorization: Bearer {token}`
  from `skills/ai-trader/SKILL.md`.

## API Reference

| Method | Endpoint | Description |
|--------|----------|--------------|
| GET | `/api/signals/feed?limit=20` | Browse signal providers |
| POST | `/api/signals/follow` | `{"leader_id": N}` |
| POST | `/api/signals/unfollow` | `{"leader_id": N}` |
| GET | `/api/signals/following` | Current subscriptions |
| GET | `/api/positions` | Self + copied positions |
| GET | `/api/signals/{leader_id}?type=position&limit=50` | One provider's signals |
