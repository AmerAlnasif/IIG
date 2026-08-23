/**
 * Shared types for the Kalshi Trade API v2 client.
 *
 * Field names/shapes here are taken directly from Kalshi's published
 * OpenAPI spec (https://docs.kalshi.com/openapi.yaml, "Kalshi Trade API
 * Manual Endpoints", v3.28.0). Response bodies are intentionally typed as
 * `unknown`/loose records in client.ts for endpoints whose full response
 * schema wasn't pulled down verbatim — refine them from the spec as needed.
 */

export type BookSide = "bid" | "ask";
export type TimeInForce = "fill_or_kill" | "good_till_canceled" | "immediate_or_cancel";
export type SelfTradePreventionType = "taker_at_cross" | "maker";
export type OrderStatus = string;
export type MarketStatus = "unopened" | "open" | "closed" | "settled";
export type FixedPointCount = string;
export type FixedPointDollars = string;
export type ExchangeIndex = number;

export interface PaginatedQuery {
  limit?: number;
  cursor?: string;
}

// Market data

export interface GetSeriesFeeChangesParams {
  series_ticker?: string;
  show_historical?: boolean;
}

export interface GetSeriesParams {
  include_volume?: boolean;
}

export interface GetSeriesListParams {
  category?: string;
  tags?: string;
  include_product_metadata?: boolean;
  include_volume?: boolean;
  min_updated_ts?: number;
}

export interface GetMarketsParams extends PaginatedQuery {
  ticker?: string;
  series_ticker?: string;
  min_created_ts?: number;
  max_created_ts?: number;
  min_updated_ts?: number;
  max_close_ts?: number;
  min_close_ts?: number;
  min_settled_ts?: number;
  max_settled_ts?: number;
  status?: string;
  tickers?: string[];
  mve_filter?: string;
}

export interface GetMarketOrderbookParams {
  depth?: number;
}

export interface GetMarketOrderbooksParams {
  tickers: string[];
}

export interface GetTradesParams extends PaginatedQuery {
  ticker?: string;
  min_ts?: number;
  max_ts?: number;
  is_block_trade?: boolean;
}

export type PeriodIntervalMinutes = 1 | 60 | 1440;

export interface GetMarketCandlesticksParams {
  start_ts: number;
  end_ts: number;
  period_interval: PeriodIntervalMinutes;
  include_latest_before_start?: boolean;
}

export interface BatchGetMarketCandlesticksParams {
  market_tickers: string;
  start_ts: number;
  end_ts: number;
  period_interval: number;
  include_latest_before_start?: boolean;
}

// Events

export interface GetEventsParams extends PaginatedQuery {
  with_nested_markets?: boolean;
  with_milestones?: boolean;
  status?: MarketStatus;
  series_ticker?: string;
  event_tickers?: string[];
  min_close_ts?: number;
  min_updated_ts?: number;
}

export interface GetMultivariateEventsParams extends PaginatedQuery {
  series_ticker?: string;
  collection_ticker?: string;
  with_nested_markets?: boolean;
}

export interface GetEventParams {
  with_nested_markets?: boolean;
}

export interface GetEventFeeChangesParams extends PaginatedQuery {
  event_ticker?: string;
}

export interface GetEventCandlesticksParams {
  start_ts: number;
  end_ts: number;
  // Orders (v2)

  export interface GetOrdersParams extends PaginatedQuery {
  ticker?: string;
  event_tickers?: string;
  min_ts?: number;
  max_ts?: number;
  status?: OrderStatus;
  subaccount?: string;
  exchange_index?: number;
}

export interface CreateOrderV2Request {
  ticker: string;
  client_order_id?: string;
  side: BookSide;
  count: FixedPointCount;
  price: FixedPointDollars;
  expiration_time?: number;
  time_in_force: TimeInForce;
  post_only?: boolean;
  self_trade_prevention_type: SelfTradePreventionType;
  cancel_order_on_pause?: boolean;
  reduce_only?: boolean;
  subaccount?: number;
  order_group_id?: string;
  exchange_index?: ExchangeIndex;
}

export interface CreateOrderV2Response {
  order_id: string;
  client_order_id?: string;
  fill_count: FixedPointCount;
  remaining_count: FixedPointCount;
  ts_ms: number;
  [key: string]: unknown;
}

export interface BatchCreateOrdersV2Request {
  orders: CreateOrderV2Request[];
}

export interface BatchCancelOrdersV2Request {
  order_ids: string[];
}

export interface CancelOrderV2Params {
  subaccount?: string;
  exchange_index?: number;
  market_ticker?: string;
}

export interface AmendOrderV2Request {
  ticker: string;
  side: BookSide;
  price: FixedPointDollars;
  count: FixedPointCount;
  client_order_id?: string;
  updated_client_order_id?: string;
  exchange_index?: ExchangeIndex;
}

export interface AmendOrderV2Params {
  subaccount?: string;
}

export interface DecreaseOrderV2Request {
  reduce_by?: FixedPointCount;
  reduce_to?: FixedPointCount;
  exchange_index?: ExchangeIndex;
  market_ticker?: string;
}

export interface DecreaseOrderV2Params {
  subaccount?: string;
}

export interface GetOrderQueuePositionsParams {
  market_tickers?: string;
  event_ticker?: string;
  subaccount?: string;
}

// Order groups

export interface GetOrderGroupsParams {
  subaccount?: string;
}

export interface CreateOrderGroupRequest {
  subaccount?: number;
  contracts_limit?: number;
  contracts_limit_fp?: FixedPointCount;
}

export interface OrderGroupIdParams {
  subaccount?: string;
  exchange_index?: number;
}

export interface UpdateOrderGroupLimitRequest {
  contracts_limit?: number;
  contracts_limit_fp?: FixedPointCount;
}

// Portfolio

export interface SubaccountScopedParams {
  subaccount?: string;
  exchange_index?: number;
}

export interface GetPositionsParams extends PaginatedQuery {
  count_filter?: string;
  ticker?: string;
  event_ticker?: string;
  subaccount?: string;
  exchange_index?: number;
}

export interface GetFillsParams extends PaginatedQuery {
  ticker?: string;
  order_id?: string;
  min_ts?: number;
  max_ts?: number;
  subaccount?: string;
  exchange_index?: number;
}

export interface GetSettlementsParams extends PaginatedQuery {
  ticker?: string;
  event_ticker?: string;
  min_ts?: number;
  max_ts?: number;
  subaccount?: string;
}

// Transfers & subaccounts

export interface IntraExchangeInstanceTransferRequest {
  source_subaccount: string;
  destination_subaccount: string;
  amount: number;
  source_exchange_index: number;
  destination_exchange_index: number;
}

export interface ApplySubaccountTransferRequest {
  source_subaccount: number;
  destination_subaccount: number;
  amount: number;
  exchange_index?: number;
}

export interface UpdateSubaccountNettingRequest {
  subaccount: number;
  netting_enabled: boolean;
}

// Communications: block trades, RFQs, quotes

export interface GetBlockTradeProposalsParams extends PaginatedQuery {
  market_ticker?: string;
  status?: string;
}

export interface ProposeBlockTradeRequest {
  market_ticker: string;
  side: BookSide;
  count: FixedPointCount;
  price: FixedPointDollars;
  counterparty_id?: string;
  [key: string]: unknown;
}

export interface AcceptBlockTradeProposalRequest {
  [key: string]: unknown;
}

export interface GetRFQsParams extends PaginatedQuery {
  event_ticker?: string;
  market_ticker?: string;
  subaccount?: string;
  status?: string;
  user_filter?: "self";
}

export interface CreateRFQRequest {
  market_ticker: string;
  side?: BookSide;
  count: FixedPointCount;
  subaccount?: string;
  [key: string]: unknown;
}

export interface GetQuotesParams extends PaginatedQuery {
  min_ts?: number;
  max_ts?: number;
  status?: string;
  user_filter?: "self";
  rfq_user_filter?: "self";
  rfq_creator_subtrader_id?: string;
  rfq_id?: string;
}

export interface CreateQuoteRequest {
  rfq_id: string;
  side: BookSide;
  price: FixedPointDollars;
  count?: FixedPointCount;
  [key: string]: unknown;
}

export interface AcceptQuoteRequest {
  [key: string]: unknown;
}

// API keys

export interface CreateApiKeyRequest {
  public_key: string;
  name?: string;
}

export interface GenerateApiKeyRequest {
  name?: string;
}

  period_interval: PeriodIntervalMinutes;
}

export interface GetEventForecastPercentileHistoryParams {
  percentiles: number[];
  start_ts: number;
  end_ts: number;
  period_interval: 0 | 1 | 60 | 1440;
}
