# Kalshi Trade API integration

A typed TypeScript client covering every endpoint documented at
[docs.kalshi.com/welcome](https://docs.kalshi.com/welcome) for Kalshi's core
Predictions REST API — exchange status/schedule, market data (series,
markets, orderbooks, trades, candlesticks), events, orders (v2), order
groups, portfolio (balance, positions, fills, settlements, deposits,
withdrawals), transfers & subaccounts, communications (block trades, RFQs,
quotes), API key management, and account limits. 76 methods, one per API
operation, generated from Kalshi's published OpenAPI spec
(`docs.kalshi.com/openapi.yaml`, "Kalshi Trade API Manual Endpoints", v3.28.0).

Code lives in `src/integrations/kalshi/`:

- `sign.ts` — request signing (RSA-PSS/SHA256, per Kalshi's auth scheme).
- - `types.ts` — request/query param types and the core order-related schemas.
  - - `client.ts` — `KalshiClient`, with one method per endpoint.
    - - `index.ts` — barrel export.
     
      - No dependencies beyond Node's built-in `fetch` and `node:crypto`, so it works
      - the same under Bun or Node >= 18.
     
      - ## Setup
     
      - 1. Get an API key. Log into Kalshi, go to Settings -> API Keys (or
        2.    `docs.kalshi.com/getting_started/api_keys`), and generate a key. Kalshi
        3.   shows you an RSA private key once — save it immediately (a secret
        4.      manager, or a local `.pem` file that's gitignored). It is not recoverable
        5.     after you close that page.
        6. 2. Set credentials, e.g. as environment variables:
          
           3.    ```bash
                    KALSHI_API_KEY_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    KALSHI_PRIVATE_KEY_PEM="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
                    ```

                 3. Instantiate the client:
             
                 4.    ```ts
                          import { KalshiClient, KALSHI_BASE_URLS } from "../integrations/kalshi";

                          const kalshi = new KalshiClient({
                            apiKeyId: process.env.KALSHI_API_KEY_ID!,
                            privateKey: process.env.KALSHI_PRIVATE_KEY_PEM!,
                            // baseUrl defaults to KALSHI_BASE_URLS.production; swap in
                            // KALSHI_BASE_URLS.demo to hit the paper-trading environment instead.
                          });
                          ```

                       ## Usage

                   ```ts
                   // Public market data — no auth needed.
                   const status = await kalshi.getExchangeStatus();
                   const markets = await kalshi.getMarkets({ status: "open", limit: 50 });
                   const book = await kalshi.getMarketOrderbook("HIGHNY-24JAN01-T60", { depth: 10 });

                   // Authenticated: place a limit order.
                   const order = await kalshi.createOrder({
                     ticker: "HIGHNY-24JAN01-T60",
                     side: "bid",
                     count: "10.00",
                     price: "0.5600",
                     time_in_force: "good_till_canceled",
                     self_trade_prevention_type: "taker_at_cross",
                   });

                   // Portfolio.
                   const balance = await kalshi.getBalance();
                   const positions = await kalshi.getPositions({ ticker: "HIGHNY-24JAN01-T60" });

                   // Cancel it.
                   await kalshi.cancelOrder(order.order_id);
                   ```

                   Every method throws `KalshiApiError` (with `.status`, `.path`, `.body`) on a
             non-2xx response — wrap calls in try/catch where that matters.

             ## Scope / what's not included

           This pass covers the Predictions REST API — the primary surface referenced
           from the docs homepage. Kalshi also publishes:

           - Perps (margin futures) REST + WebSocket API — same auth scheme, a parallel
           -   but distinct endpoint set (`perps_openapi.yaml`).
           -   - WebSocket feeds (orderbook deltas, tickers, trades, fills, orders, order
               -   groups) for both Predictions and Perps — push-based streams, not
               -     request/response calls, so they need a different client shape.
               - - FIX protocol gateway for order entry and market data.
                 - - CF Benchmarks data integration and the historical-data endpoints for
                   -   archived markets/positions.
                  
                   -   All of these reuse the `KALSHI-ACCESS-KEY` / `-TIMESTAMP` / `-SIGNATURE`
                   -   signing scheme in `client/sign.ts`, so extending this feature to cover them
                   -   is mostly repeating the same pattern against a different spec rather than
                   -   new plumbing.
                   -   
