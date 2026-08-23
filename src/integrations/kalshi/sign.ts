/**
 * Kalshi Trade API — request signing.
 *
 * Kalshi authenticates every request with three headers:
 *   KALSHI-ACCESS-KEY        the API Key ID
 *   KALSHI-ACCESS-TIMESTAMP  current time in Unix milliseconds
 *   KALSHI-ACCESS-SIGNATURE  base64(RSA-PSS-SHA256(timestamp + METHOD + path))
import { createSign, type KeyLike } from "node:crypto";

export interface KalshiSignedHeaders {
"KALSHI-ACCESS-KEY": string;
"KALSHI-ACCESS-TIMESTAMP": string;
"KALSHI-ACCESS-SIGNATURE": string;
}

export function signKalshiRequest(
apiKeyId: string,
privateKey: KeyLike,
method: string,
path: string,
): KalshiSignedHeaders {
const timestampMs = Date.now().toString();
const message = `${timestampMs}${method.toUpperCase()}${path}`;

const signature = createSign("RSA-SHA256")
.update(message)
.end()
.sign(
{
key: privateKey,
padding: 6,
saltLength: 32,
},
"base64",
);

return {
"KALSHI-ACCESS-KEY": apiKeyId,
"KALSHI-ACCESS-TIMESTAMP": timestampMs,
"KALSHI-ACCESS-SIGNATURE": signature,
};
}
*
 * The signed message is `${timestampMs}${HTTP_METHOD}${path}` where `path`
 * is the request path WITHOUT the query string (e.g. `/trade-api/v2/portfolio/orders`,
 * not `/trade-api/v2/portfolio/orders?limit=5`).
 *
 * The private key is the RSA key you download once when generating an API
 * key in the Kalshi dashboard (docs.kalshi.com/getting_started/api_keys).
 * Kalshi does not store it — keep it somewhere safe (env var / secret
 * manager), never commit it.
 */

import { createSign, type KeyLike } from "node:crypto";

export interface KalshiSignedHeaders {
    "KALSHI-ACCESS-KEY": string;
  "KALSHI-ACCESS-TIMESTAMP": string;
  "KALSHI-ACCESS-SIGNATURE": string;
}

/**
 * Sign a request and produce the three auth headers Kalshi expects.
 *
 * @param apiKeyId    Your Kalshi API Key ID (KALSHI-ACCESS-KEY value).
 * @param privateKey  PEM-encoded RSA private key (string, or a parsed KeyObject).
 * @param method      HTTP method, e.g. "GET", "POST", "DELETE", "PUT".
 * @param path        Request path INCLUDING the `/trade-api/v2` prefix,
 *                    EXCLUDING any query string.
 */
export function signKalshiRequest(
    apiKeyId: string,
    privateKey: KeyLike,
    method: string,
    path: string,
  ): KalshiSignedHeaders {
    const timestampMs = Date.now().toString();
    const message = `${timestampMs}${method.toUpperCase()}${path}`;

  const signature = createSign("RSA-SHA256")
      .update(message)
      .end()
      .sign(
        {
                  key: privateKey,
                  padding: 6 /* crypto.constants.RSA_PKCS1_PSS_PADDING */,
                  saltLength: 32 /* crypto.constants.RSA_PSS_SALTLEN_DIGEST, equiv. */,
        },
              "base64",
            );

  return {
        "KALSHI-ACCESS-KEY": apiKeyId,
        "KALSHI-ACCESS-TIMESTAMP": timestampMs,
        "KALSHI-ACCESS-SIGNATURE": signature,
  };
}
