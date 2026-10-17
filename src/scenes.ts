import { InternalError } from "./errors/general";
import type {
    CurrencyHandler,
    Currency,
    CurrencyPriceRecord,
    CurrencySearchRequest,
    ScenesList,
    CurrencyStore,
    CurrencyAPI,
    CurrencyInfo,
} from "./types";

export class Scenes implements ScenesList {
    constructor(
        protected store: CurrencyStore,
        protected api: CurrencyAPI,
    ) {}

    async add(
        handler: CurrencyHandler,
        load: boolean,
    ): Promise<[Currency, boolean, CurrencyPriceRecord | null]> {
        const currency = await this.api.getCurrency(handler);
        const added = await this.store.add(currency);
        return [currency, added, load ? await this.load(handler) : null];
    }

    async load(handler: CurrencyHandler): Promise<CurrencyPriceRecord> {
        await this.store.getCurrency(handler); // check whether handler is valid
        const record = (await this.api.getPrice([handler]))[0];
        if (record == null) {
            throw new InternalError("api.getPrice returns no records");
        }
        await this.store.addRecord(handler, record);
        return record;
    }

    list(): Promise<Currency[]> {
        return this.store.list();
    }

    async info(handler: CurrencyHandler): Promise<CurrencyInfo> {
        const info = await this.store.getCurrency(handler);

        const [record] = await this.store.price({
            handler,
            after: null,
            until: null,
            offset: 0,
            limit: 1,
            asc: false,
        });

        return record == null
            ? info
            : {
                  ...info,
                  latestRecord: record,
              };
    }

    removeFromList(handler: CurrencyHandler): Promise<boolean> {
        return this.store.removeFromList(handler);
    }

    price(request: CurrencySearchRequest): Promise<CurrencyPriceRecord[]> {
        return this.store.price(request);
    }

    erase(request: CurrencySearchRequest): Promise<number> {
        return this.store.erase(request);
    }

    protected async singleLoad(): Promise<void> {
        try {
            const currencies = await this.store.list();
            if (currencies.length === 0) {
                return;
            }
            const records = await this.api.getPrice(currencies);
            let successfulLoads = 0;
            for (let i = 0; i < currencies.length; ++i) {
                const currency = currencies[i]!;
                const record = records[i]!;
                try {
                    if (await this.store.addRecord(currency, record))
                        ++successfulLoads;
                } catch (e) {
                    console.warn(
                        `error auto loading currency ${currency.symbol} (id=${currency.id}): ${e}`,
                    );
                }
            }
            const now = new Date();
            console.log(
                `[${now.toLocaleString()}] loaded ${successfulLoads} out of ${currencies.length} currencies`,
            );
        } catch (e) {
            console.error(`error loading list in autoLoad: ${e}`);
        }
    }

    autoLoad(delayMs: number): NodeJS.Timeout {
        this.singleLoad();
        return setInterval(() => this.singleLoad(), delayMs);
    }
}
