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
