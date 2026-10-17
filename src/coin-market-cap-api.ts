import axios from "axios";

import type {
    Currency,
    CurrencyAPI,
    CurrencyHandler,
    CurrencyIdHandler,
    CurrencyPriceRecord,
    CurrencySymbolicHandler,
} from "./types";
import { isCurrencyIdHandler } from "./types";
import { API_TIMEOUT_MS } from "./constants/coin-market-cap-api";
import { UserFriendlyAPIError, TimeoutError } from "./errors/api";
import { TARGET_CURRENCY } from "./constants/general";
import { InternalError, InvalidCurrencyHandlerError } from "./errors/general";

type IdToHandlerIndex = {
    index(id: number, symbol: string): number | null;
};

class IdToIdHandlerIndex implements IdToHandlerIndex {
    protected map: Map<number, number>;

    constructor(handlers: CurrencyIdHandler[]) {
        this.map = new Map();
        for (const [i, handler] of handlers.entries()) {
            this.map.set(handler.id, i);
        }
    }

    index(id: number, _symbol: string): number | null {
        return this.map.get(id) ?? null;
    }
}

class IdToSymbolicHandlerIndex implements IdToHandlerIndex {
    protected map: Map<string, number>;

    constructor(handlers: CurrencySymbolicHandler[]) {
        this.map = new Map();
        for (const [i, handler] of handlers.entries()) {
            this.map.set(handler.symbol, i);
        }
    }

    index(_id: number, symbol: string): number | null {
        return this.map.get(symbol) ?? null;
    }
}

export class CoinMarketCapAPI implements CurrencyAPI {
    constructor(protected apiKey: string) {}

    protected async requestQuotes(handlers: CurrencyHandler[]): Promise<any[]> {
        if (handlers.length === 0) {
            return [];
        }
        const [firstHandler, ...restHandlers] = handlers;
        if (firstHandler == null) {
            return [];
        }
        const isIdHandler = isCurrencyIdHandler(firstHandler);
        if (
            !restHandlers.every(
                (handler) => isCurrencyIdHandler(handler) === isIdHandler,
            )
        ) {
            return Promise.reject(
                new InternalError(
                    "all handlers passed to requestQuotes must have the same type",
                ),
            );
        }

        const [idType, justify]: [
            string,
            (handler: CurrencyHandler) => string,
        ] = isIdHandler
            ? ["id", (handler) => String((handler as CurrencyIdHandler).id)]
            : [
                  "symbol",
                  (handler) =>
                      encodeURI((handler as CurrencySymbolicHandler).symbol),
              ];

        const idsQuery = justify(firstHandler).concat(
            ...restHandlers.map((handler) => "," + justify(handler)),
        );

        const url = `https://pro-api.coinmarketcap.com/v3/cryptocurrency/quotes/latest?${idType}=${idsQuery}&convert=${encodeURI(TARGET_CURRENCY)}`;

        return axios
            .get(url, {
                headers: {
                    "X-CMC_PRO_API_KEY": this.apiKey,
                },
                timeout: API_TIMEOUT_MS,
            })
            .then(
                (resp) => {
                    const data = resp.data.data;
                    // console.log(JSON.stringify(data));
                    if (!Array.isArray(data)) {
                        return Promise.reject(
                            new InternalError(
                                `invalid resp.data format (getCurrency): ${JSON.stringify(data)}`,
                            ),
                        );
                    }
                    return data;
                },
                (err) => {
                    if (!axios.isAxiosError(err)) {
                        return Promise.reject(err);
                    }

                    if (
                        err.code === "ETIMEDOUT" ||
                        err.code === "ECONNABORTED"
                    ) {
                        return Promise.reject(new TimeoutError());
                    }

                    switch (err?.status) {
                        case 400:
                            return Promise.reject(
                                new InternalError("bad request"),
                            );
                        case 401:
                        case 403:
                            return Promise.reject(
                                new UserFriendlyAPIError(
                                    "something wrong with CoinMarketCapAPI auth token",
                                ),
                            );
                        case 429:
                            return Promise.reject(
                                new UserFriendlyAPIError(
                                    "CoinMarketCapAPI auth token exceeded request rate limit",
                                ),
                            );
                        case 500:
                            return Promise.reject(
                                new UserFriendlyAPIError(
                                    "CoinMarketCapAPI has some internal error",
                                ),
                            );
                    }

                    return Promise.reject(err);
                },
            );
    }

    getCurrency(handler: CurrencyHandler): Promise<Currency> {
        return this.requestQuotes([handler]).then((data) => {
            if (data.length === 0) {
                return Promise.reject(new InvalidCurrencyHandlerError(handler));
            }

            const currencyInfo = data[0];

            const { id, name, symbol } = currencyInfo;

            if (
                typeof id !== "number" ||
                typeof name !== "string" ||
                typeof symbol !== "string"
            ) {
                return Promise.reject(
                    new InternalError(
                        `invalid id = ${JSON.stringify(id)}, name = ${JSON.stringify(name)} or symbol = ${JSON.stringify(symbol)}`,
                    ),
                );
            }

            return { id, name, symbol };
        });
    }

    getPrice(handlers: CurrencyHandler[]): Promise<CurrencyPriceRecord[]> {
        const firstHandler = handlers[0];
        if (firstHandler == null) {
            return Promise.resolve([]);
        }
        return this.requestQuotes(handlers).then((data) => {
            const indexer: IdToHandlerIndex = isCurrencyIdHandler(firstHandler)
                ? new IdToIdHandlerIndex(handlers as CurrencyIdHandler[])
                : new IdToSymbolicHandlerIndex(
                      handlers as CurrencySymbolicHandler[],
                  );
            const records = new Array<CurrencyPriceRecord>(handlers.length);
            for (const { id, symbol, quote } of data.slice(
                0,
                handlers.length,
            )) {
                if (typeof id !== "number" || typeof symbol !== "string") {
                    return Promise.reject(
                        new InternalError(
                            `invalid id = ${JSON.stringify(id)} or symbol = ${JSON.stringify(symbol)}`,
                        ),
                    );
                }
                const i = indexer.index(id, symbol);
                if (i == null) {
                    return Promise.reject(
                        new InternalError(
                            `response contains extra currency: ${symbol} (id=${id})`,
                        ),
                    );
                }
                if (
                    !Array.isArray(quote) ||
                    quote.length === 0 ||
                    quote[0].symbol !== "USD" ||
                    (quote[0].price != null &&
                        typeof quote[0].price !== "number") ||
                    typeof quote[0].last_updated !== "string"
                ) {
                    return Promise.reject(
                        new InternalError(
                            `invalid quote = ${JSON.stringify(quote)}`,
                        ),
                    );
                }
                const time = Date.parse(quote[0].last_updated);
                if (Number.isNaN(time)) {
                    return Promise.reject(
                        new InternalError(
                            `cannot parse date = ${JSON.stringify(quote[0].last_updated)}`,
                        ),
                    );
                }
                records[i] = {
                    time: new Date(time),
                    value: quote[0].price ?? null,
                };
            }
            const badIndex = records.findIndex((record) => record == null);
            if (badIndex !== -1) {
                return Promise.reject(
                    new InvalidCurrencyHandlerError(handlers[badIndex]!),
                );
            }
            return records;
        });
    }
}
