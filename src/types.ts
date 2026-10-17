export type Currency = {
    id: number;
    name: string;
    symbol: string;
};

export type CurrencyIdHandler = { id: number };
export type CurrencySymbolicHandler = { symbol: string };
export type CurrencyHandler = CurrencyIdHandler | CurrencySymbolicHandler;

export type CurrencySearchRequest = {
    handler: CurrencyHandler;
    after: Date | null;
    until: Date | null;
    offset: number;
    limit: number;
    asc: boolean;
};

export type CurrencyPriceRecord = {
    time: Date;
    value: number | null;
};

export type CurrencyInfo = Currency & {
    latestRecord?: CurrencyPriceRecord;
};

export type CurrencyAPI = {
    getCurrency(handler: CurrencyHandler): Promise<Currency>;
    getPrice(handlers: CurrencyHandler[]): Promise<CurrencyPriceRecord[]>;
};

export type CommonScenesList = {
    list(): Promise<Currency[]>; // /list
    removeFromList(handler: CurrencyHandler): Promise<boolean>; // /remove-from-list
    price(request: CurrencySearchRequest): Promise<CurrencyPriceRecord[]>; // /price
    erase(request: CurrencySearchRequest): Promise<number>; // /erase
};

export type CurrencyStore = CommonScenesList & {
    add(currency: Currency): Promise<boolean>;
    getCurrency(handler: CurrencyHandler): Promise<Currency>;
    addRecord(
        handler: CurrencyHandler,
        record: CurrencyPriceRecord,
    ): Promise<boolean>;
};

export type ScenesList = CommonScenesList & {
    add(
        handler: CurrencyHandler,
        load: boolean,
    ): Promise<[Currency, boolean, CurrencyPriceRecord | null]>; // /add
    info(handler: CurrencyHandler): Promise<CurrencyInfo>; // /info
    load(handler: CurrencyHandler): Promise<CurrencyPriceRecord>; // /load
    autoLoad(delayMs: number): NodeJS.Timeout;
};

//
// helper functions

export const isCurrencyIdHandler = (
    handler: CurrencyHandler,
): handler is CurrencyIdHandler => typeof Object(handler)["id"] === "number";

export const isCurrencySymbolicHandler = (
    handler: CurrencyHandler,
): handler is CurrencySymbolicHandler =>
    typeof Object(handler)["symbol"] === "string";

export const handlerRelatesToCurrency = (
    handler: CurrencyHandler,
    currency: Currency,
): boolean =>
    isCurrencyIdHandler(handler)
        ? handler.id === currency.id
        : handler.symbol === currency.symbol;

export const getHandlerName = (handler: CurrencyHandler): string =>
    isCurrencyIdHandler(handler) ? "id" : "symbol";
