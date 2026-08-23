test line one
/**
 * Kalshi Trade API v2 client.
  *
   * Covers every endpoint documented at https://docs.kalshi.com/welcome for
    * the core "Predictions" REST API (exchange, market data, events, orders,
     * order groups, portfolio, transfers/subaccounts, communications, API keys,
      * account) — one typed method per operation, ~76 in total. Generated from
       * Kalshi's published OpenAPI spec (docs.kalshi.com/openapi.yaml, "Kalshi
        * Trade API Manual Endpoints", v3.28.0).
         *
          * Not covered here (out of scope for this pass, but same auth scheme
           * applies): the Perps (margin) REST/WebSocket API, the FIX protocol
            * gateway, and the two WebSocket feeds (predictions + perps) — those are
             * push-based streams rather than request/response calls and want a
              * different shape of client. See docs.kalshi.com/welcome → "The APIs" and
               * "Specifications" for their specs if you want to extend this feature.
                *
                 * Usage:
                  *
                   *   import { KalshiClient } from "./kalshi";
                    *
                     *   const kalshi = new KalshiClient({
                      *     apiKeyId: process.env.KALSHI_API_KEY_ID!,
                       *     privateKey: process.env.KALSHI_PRIVATE_KEY_PEM!,
                        *   });
                         *
                          *   const status = await kalshi.getExchangeStatus();
                           *   const markets = await kalshi.getMarkets({ status: "open", limit: 50 });
                            */
  
import type { KeyLike } from "node:crypto";
import { signKalshiRequest } from "./sign";
import type {
  AcceptBlockTradeProposalRequest,
  AcceptQuoteRequest,
  AmendOrderV2Params,
  AmendOrderV2Request,
  ApplySubaccountTransferRequest,
  BatchCancelOrdersV2Request,
  BatchCreateOrdersV2Request,
  BatchGetMarketCandlesticksParams,
  CancelOrderV2Params,
  CreateApiKeyRequest,
  CreateOrderGroupRequest,
  CreateOrderV2Request,
  CreateOrderV2Response,
  CreateQuoteRequest,
  CreateRFQRequest,
  DecreaseOrderV2Params,
  DecreaseOrderV2Request,
  GenerateApiKeyRequest,
  GetBlockTradeProposalsParams,
  GetEventCandlesticksParams,
  GetEventFeeChangesParams,
  GetEventForecastPercentileHistoryParams,
  GetEventParams,
  GetEventsParams,
  GetFillsParams,
  GetMarketCandlesticksParams,
  GetMarketOrderbookParams,
  GetMarketOrderbooksParams,
  GetMarketsParams,
  GetMultivariateEventsParams,
  GetOrderQueuePositionsParams,
  GetOrderGroupsParams,
  GetOrdersParams,
  GetPositionsParams,
  GetQuotesParams,
  GetRFQsParams,
  GetSeriesFeeChangesParams,
  GetSeriesListParams,
  GetSeriesParams,
  GetSettlementsParams,
  GetTradesParams,
  IntraExchangeInstanceTransferRequest,
  OrderGroupIdParams,
  PaginatedQuery,
  ProposeBlockTradeRequest,
  SubaccountScopedParams,
  UpdateOrderGroupLimitRequest,
  UpdateSubaccountNettingRequest,
} from "./types";

export * from "./types";
export { signKalshiRequest } from "./sign";

export const KALSHI_BASE_URLS = {
  production: "https://api.elections.kalshi.com/trade-api/v2",
  productionAlt: "https://external-api.kalshi.com/trade-api/v2",
  demo: "https://demo-api.kalshi.co/trade-api/v2",
  demoAlt: "https://external-api.demo.kalshi.co/trade-api/v2",
} as const;

export interface KalshiClientConfig {
  apiKeyId: string;
  privateKey?: KeyLike;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class KalshiApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body: unknown,
    ) {
    super(`Kalshi API error ${status} on ${path}: ${JSON.stringify(body)}`);
    this.name = "KalshiApiError";
  }
}
type QueryParams = object;

function buildQuery(params?: QueryParams): string {
  if (!params) return "";
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    usp.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export class KalshiClient {
  private readonly apiKeyId: string;
  private readonly privateKey?: KeyLike;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  
  constructor(config: KalshiClientConfig) {
    this.apiKeyId = config.apiKeyId;
    this.privateKey = config.privateKey;
    this.baseUrl = (config.baseUrl ?? KALSHI_BASE_URLS.production).replace(/\/+$/, "");
    this.fetchFn = config.fetchFn ?? fetch;
  }
  
  private async request<T>(
    method: string,
    path: string,
    opts: { query?: QueryParams; body?: unknown; auth?: boolean } = {},
    ): Promise<T> {
    const { query, body, auth = true } = opts;
    const qs = buildQuery(query);
    const url = `${this.baseUrl}${path}${qs}`;
    
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    
    if (auth) {
      if (!this.privateKey) {
        throw new Error(
          `Kalshi: ${method} ${path} requires authentication but no privateKey was configured on KalshiClient.`,
          );
      }
      const signPath = new URL(url).pathname;
      Object.assign(
        headers,
        signKalshiRequest(this.apiKeyId, this.privateKey, method, signPath),
        );
    }
    
    const res = await this.fetchFn(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    
    if (!res.ok) {
      throw new KalshiApiError(res.status, path, data);
    }
    return data as T;
  }
  
  // Exchange
  
  getExchangeStatus() {
    return this.request<unknown>("GET", "/exchange/status", { auth: false });
  }
  
  getExchangeSchedule() {
    return this.request<unknown>("GET", "/exchange/schedule", { auth: false });
  }
  
  getUserDataTimestamp() {
    return this.request<unknown>("GET", "/exchange/user_data_timestamp", { auth: false });
  }
  
  getSeriesFeeChanges(params: GetSeriesFeeChangesParams = {}) {
    return this.request<unknown>("GET", "/series/fee_changes", { query: params, auth: false });
  }
  
  // Market data
  
  getSeries(seriesTicker: string, params: GetSeriesParams = {}) {
    return this.request<unknown>("GET", `/series/${encodeURIComponent(seriesTicker)}`, {
      query: params,
      auth: false,
    });
  }
  
  getSeriesList(params: GetSeriesListParams = {}) {
    return this.request<unknown>("GET", "/series", { query: params, auth: false });
  }
  
  getMarkets(params: GetMarketsParams = {}) {
    return this.request<unknown>("GET", "/markets", { query: params, auth: false });
  }
  
  getMarket(ticker: string) {
    return this.request<unknown>("GET", `/markets/${encodeURIComponent(ticker)}`, { auth: false });
  }
  
  getMarketOrderbook(ticker: string, params: GetMarketOrderbookParams = {}) {
    return this.request<unknown>("GET", `/markets/${encodeURIComponent(ticker)}/orderbook`, {
      query: params,
    });
  }
  
  getMarketOrderbooks(params: GetMarketOrderbooksParams) {
    return this.request<unknown>("GET", "/markets/orderbooks", { query: params });
  }
  
  getTrades(params: GetTradesParams = {}) {
    return this.request<unknown>("GET", "/markets/trades", { query: params, auth: false });
  }
  
  getMarketCandlesticks(seriesTicker: string, ticker: string, params: GetMarketCandlesticksParams) {
    return this.request<unknown>(
      "GET",
      `/series/${encodeURIComponent(seriesTicker)}/markets/${encodeURIComponent(ticker)}/candlesticks`,
      { query: params, auth: false },
      );
  }
  
  batchGetMarketCandlesticks(params: BatchGetMarketCandlesticksParams) {
    return this.request<unknown>("GET", "/markets/candlesticks", { query: params });
  }
  
  // Events
  
  getEvents(params: GetEventsParams = {}) {
    return this.request<unknown>("GET", "/events", { query: params });
  }
  
  getMultivariateEvents(params: GetMultivariateEventsParams = {}) {
    return this.request<unknown>("GET", "/events/multivariate", { query: params });
  }
  
  getEvent(eventTicker: string, params: GetEventParams = {}) {
    return this.request<unknown>("GET", `/events/${encodeURIComponent(eventTicker)}`, {
      query: params,
    });
  }
  
  getEventMetadata(eventTicker: string) {
    return this.request<unknown>("GET", `/events/${encodeURIComponent(eventTicker)}/metadata`);
  }
  
  getEventFeeChanges(params: GetEventFeeChangesParams = {}) {
    return this.request<unknown>("GET", "/events/fee_changes", { query: params, auth: false });
  }
  
  getEventCandlesticks(seriesTicker: string, ticker: string, params: GetEventCandlesticksParams) {
    return this.request<unknown>(
      "GET",
      `/series/${encodeURIComponent(seriesTicker)}/events/${encodeURIComponent(ticker)}/candlesticks`,
      { query: params, auth: false },
      );
  }
  
  getEventForecastPercentileHistory(
    seriesTicker: string,
    ticker: string,
    params: GetEventForecastPercentileHistoryParams,
    ) {
    return this.request<unknown>(
      "GET",
      `/series/${encodeURIComponent(seriesTicker)}/events/${encodeURIComponent(ticker)}/forecast_percentile_history`,
      { query: params },
      );
  }
  
  // Orders (v2)
  
  getOrders(params: GetOrdersParams = {}) {
    return this.request<unknown>("GET", "/portfolio/orders", { query: params });
  }
  
  getOrder(orderId: string) {
    return this.request<unknown>("GET", `/portfolio/orders/${encodeURIComponent(orderId)}`);
  }
  
  createOrder(body: CreateOrderV2Request) {
    return this.request<CreateOrderV2Response>("POST", "/portfolio/events/orders", { body });
  }
  
  batchCreateOrders(body: BatchCreateOrdersV2Request) {
    return this.request<unknown>("POST", "/portfolio/events/orders/batched", { body });
  }
  
  batchCancelOrders(body: BatchCancelOrdersV2Request) {
    return this.request<unknown>("DELETE", "/portfolio/events/orders/batched", { body });
  }
  
  cancelOrder(orderId: string, params: CancelOrderV2Params = {}) {
    return this.request<unknown>("DELETE", `/portfolio/orders/${encodeURIComponent(orderId)}`, {
      query: params,
    });
  }
  
  amendOrder(orderId: string, body: AmendOrderV2Request, params: AmendOrderV2Params = {}) {
    return this.request<unknown>("POST", `/portfolio/orders/${encodeURIComponent(orderId)}/amend`, {
      body,
      query: params,
    });
  }
  
  decreaseOrder(orderId: string, body: DecreaseOrderV2Request, params: DecreaseOrderV2Params = {}) {
    return this.request<unknown>(
      "POST",
      `/portfolio/orders/${encodeURIComponent(orderId)}/decrease`,
      { body, query: params },
      );
  }
  
  getOrderQueuePositions(params: GetOrderQueuePositionsParams = {}) {
    return this.request<unknown>("GET", "/portfolio/orders/queue_positions", { query: params });
  }
  
  getOrderQueuePosition(orderId: string) {
    return this.request<unknown>(
      "GET",
      `/portfolio/orders/${encodeURIComponent(orderId)}/queue_position`,
      );
  }
  
  // Order groups
  
  getOrderGroups(params: GetOrderGroupsParams = {}) {
    return this.request<unknown>("GET", "/portfolio/order_groups", { query: params });
  }
  
  createOrderGroup(body: CreateOrderGroupRequest = {}) {
    return this.request<unknown>("POST", "/portfolio/order_groups/create", { body });
  }
  
  getOrderGroup(orderGroupId: string, params: { subaccount?: string } = {}) {
    return this.request<unknown>(
      "GET",
      `/portfolio/order_groups/${encodeURIComponent(orderGroupId)}`,
      { query: params },
      );
  }
  
  deleteOrderGroup(orderGroupId: string, params: OrderGroupIdParams = {}) {
    return this.request<unknown>(
      "DELETE",
      `/portfolio/order_groups/${encodeURIComponent(orderGroupId)}`,
      { query: params },
      );
  }
  
  resetOrderGroup(orderGroupId: string, params: OrderGroupIdParams = {}) {
    return this.request<unknown>(
      "PUT",
      `/portfolio/order_groups/${encodeURIComponent(orderGroupId)}/reset`,
      { query: params },
      );
  }
  
  triggerOrderGroup(orderGroupId: string, params: OrderGroupIdParams = {}) {
    return this.request<unknown>(
      "PUT",
      `/portfolio/order_groups/${encodeURIComponent(orderGroupId)}/trigger`,
      { query: params },
      );
  }
  
  updateOrderGroupLimit(
    orderGroupId: string,
    body: UpdateOrderGroupLimitRequest,
    params: OrderGroupIdParams = {},
    ) {
    return this.request<unknown>(
      "PUT",
      `/portfolio/order_groups/${encodeURIComponent(orderGroupId)}/limit`,
      { body, query: params },
      );
  }
  
  // Portfolio
  
  getBalance(params: SubaccountScopedParams = {}) {
    return this.request<unknown>("GET", "/portfolio/balance", { query: params });
  }
  
  getPositions(params: GetPositionsParams = {}) {
    return this.request<unknown>("GET", "/portfolio/positions", { query: params });
  }
  
  getFills(params: GetFillsParams = {}) {
    return this.request<unknown>("GET", "/portfolio/fills", { query: params });
  }
  
  getSettlements(params: GetSettlementsParams = {}) {
    return this.request<unknown>("GET", "/portfolio/settlements", { query: params });
  }
  
  getDeposits(params: PaginatedQuery = {}) {
    return this.request<unknown>("GET", "/portfolio/deposits", { query: params });
  }
  
  getWithdrawals(params: PaginatedQuery = {}) {
    return this.request<unknown>("GET", "/portfolio/withdrawals", { query: params });
  }
  
  getPortfolioRestingOrderTotalValue() {
    return this.request<unknown>("GET", "/portfolio/summary/total_resting_order_value");
  }
  
  // Transfers & subaccounts
  
  intraExchangeInstanceTransfer(body: IntraExchangeInstanceTransferRequest) {
    return this.request<unknown>("POST", "/portfolio/intra_exchange_instance_transfer", { body });
  }
  
  getIntraExchangeInstanceTransfers(params: PaginatedQuery = {}) {
    return this.request<unknown>("GET", "/portfolio/intra_exchange_instance_transfers", {
      query: params,
    });
  }
  
  getIntraExchangeInstanceTransfer(transferId: string) {
    return this.request<unknown>(
      "GET",
      `/portfolio/intra_exchange_instance_transfers/${encodeURIComponent(transferId)}`,
      );
  }
  
  createSubaccount() {
    return this.request<unknown>("POST", "/portfolio/subaccounts");
  }
  
  applySubaccountTransfer(body: ApplySubaccountTransferRequest) {
    return this.request<unknown>("POST", "/portfolio/subaccounts/transfer", { body });
  }
  
  getSubaccountBalances() {
    return this.request<unknown>("GET", "/portfolio/subaccounts/balances");
  }
  
  getSubaccountTransfers(params: PaginatedQuery = {}) {
    return this.request<unknown>("GET", "/portfolio/subaccounts/transfers", { query: params });
  }
  
  getSubaccountNetting() {
    return this.request<unknown>("GET", "/portfolio/subaccounts/netting");
  }
  
  updateSubaccountNetting(body: UpdateSubaccountNettingRequest) {
    return this.request<unknown>("PUT", "/portfolio/subaccounts/netting", { body });
  }
  
  // Communications: block trades
  
  getCommunicationsId() {
    return this.request<unknown>("GET", "/communications/id");
  }
  
  getBlockTradeProposals(params: GetBlockTradeProposalsParams = {}) {
    return this.request<unknown>("GET", "/communications/block-trade-proposals", { query: params });
  }
  
  proposeBlockTrade(body: ProposeBlockTradeRequest) {
    return this.request<unknown>("POST", "/communications/block-trade-proposals", { body });
  }
  
  acceptBlockTradeProposal(id: string, body: AcceptBlockTradeProposalRequest = {}) {
    return this.request<unknown>(
      "POST",
      `/communications/block-trade-proposals/${encodeURIComponent(id)}/accept`,
      { body },
      );
  }
  
  // Communications: RFQs
  
  getRFQs(params: GetRFQsParams = {}) {
    return this.request<unknown>("GET", "/communications/rfqs", { query: params });
  }
  
  createRFQ(body: CreateRFQRequest) {
    return this.request<unknown>("POST", "/communications/rfqs", { body });
  }
  
  getRFQ(rfqId: string) {
    return this.request<unknown>("GET", `/communications/rfqs/${encodeURIComponent(rfqId)}`);
  }
  
  deleteRFQ(rfqId: string) {
    return this.request<unknown>("DELETE", `/communications/rfqs/${encodeURIComponent(rfqId)}`);
  }
  
  getRFQQuote(rfqId: string, quoteId: string) {
    return this.request<unknown>(
      "GET",
      `/communications/rfqs/${encodeURIComponent(rfqId)}/quotes/${encodeURIComponent(quoteId)}`,
      );
  }
  
  deleteRFQQuote(rfqId: string, quoteId: string) {
    return this.request<unknown>(
      "DELETE",
      `/communications/rfqs/${encodeURIComponent(rfqId)}/quotes/${encodeURIComponent(quoteId)}`,
      );
  }
  
  acceptRFQQuote(rfqId: string, quoteId: string, body: AcceptQuoteRequest = {}) {
    return this.request<unknown>(
      "PUT",
      `/communications/rfqs/${encodeURIComponent(rfqId)}/quotes/${encodeURIComponent(quoteId)}/accept`,
      { body },
      );
  }
  
  confirmRFQQuote(rfqId: string, quoteId: string) {
    return this.request<unknown>(
      "PUT",
      `/communications/rfqs/${encodeURIComponent(rfqId)}/quotes/${encodeURIComponent(quoteId)}/confirm`,
      { body: {} },
      );
  }
  
  // Communications: quotes (general + deprecated single-id variants)
  
  getQuotes(params: GetQuotesParams = {}) {
    return this.request<unknown>("GET", "/communications/quotes", { query: params });
  }
  
  createQuote(body: CreateQuoteRequest) {
    return this.request<unknown>("POST", "/communications/quotes", { body });
  }
  
  getQuote(quoteId: string) {
    return this.request<unknown>("GET", `/communications/quotes/${encodeURIComponent(quoteId)}`);
  }
  
  deleteQuote(quoteId: string) {
    return this.request<unknown>("DELETE", `/communications/quotes/${encodeURIComponent(quoteId)}`);
  }
  
  acceptQuote(quoteId: string, body: AcceptQuoteRequest = {}) {
    return this.request<unknown>(
      "PUT",
      `/communications/quotes/${encodeURIComponent(quoteId)}/accept`,
      { body },
      );
  }
  
  confirmQuote(quoteId: string) {
    return this.request<unknown>(
      "PUT",
      `/communications/quotes/${encodeURIComponent(quoteId)}/confirm`,
      { body: {} },
      );
  }
  
  // API keys
  
  getApiKeys() {
    return this.request<unknown>("GET", "/api_keys");
  }
  
  createApiKey(body: CreateApiKeyRequest) {
    return this.request<unknown>("POST", "/api_keys", { body });
  }
  
  generateApiKey(body: GenerateApiKeyRequest = {}) {
    return this.request<unknown>("POST", "/api_keys/generate", { body });
  }
  
  deleteApiKey(apiKey: string) {
    return this.request<unknown>("DELETE", `/api_keys/${encodeURIComponent(apiKey)}`);
  }
  
  // Account
  
  getAccountApiLimits() {
    return this.request<unknown>("GET", "/account/limits");
  }
}
est line two
