import { InvalidCurrencyHandlerError } from "./errors/general";
import {
    Currency,
    CurrencyHandler,
    CurrencyPriceRecord,
    CurrencySearchRequest,
    CurrencyStore,
} from "./types";
import { handlerRelatesToCurrency } from "./types";

export class InMemoryStore implements CurrencyStore {
    protected currencies: Currency[] = [];
    protected idToRecords: Map<number, CurrencyPriceRecord[]> = new Map();

    list(): Promise<Currency[]> {
        return Promise.resolve(this.currencies);
    }

    getCurrency(handler: CurrencyHandler): Promise<Currency> {
        const currency = this.currencies.find((currency) =>
            handlerRelatesToCurrency(handler, currency),
        );
        return currency != null
            ? Promise.resolve(currency)
            : Promise.reject(new InvalidCurrencyHandlerError(handler));
    }

    protected findId(handler: CurrencyHandler): number | null {
        return (
            this.currencies.find((currency) =>
                handlerRelatesToCurrency(handler, currency),
            )?.id ?? null
        );
    }

    add(currency: Currency): Promise<boolean> {
        const i = this.currencies.findIndex(
            (other) => other.id === currency.id,
        );
        if (i !== -1) {
            this.currencies[i] = currency;
            return Promise.resolve(false);
        }
        this.currencies.push(currency);
        this.idToRecords.set(currency.id, []);
        return Promise.resolve(true);
    }

    removeFromList(handler: CurrencyHandler): Promise<boolean> {
        const i = this.currencies.findIndex((currency) =>
            handlerRelatesToCurrency(handler, currency),
        );
        if (i === -1) {
            return Promise.resolve(false);
        }
        this.idToRecords.delete(this.currencies[i]!.id);
        const popped = this.currencies.pop()!;
        if (i !== this.currencies.length) {
            this.currencies[i] = popped;
        }
        return Promise.resolve(true);
    }

    addRecord(
        handler: CurrencyHandler,
        record: CurrencyPriceRecord,
    ): Promise<boolean> {
        const id = this.findId(handler);
        if (id == null) {
            return Promise.reject(new InvalidCurrencyHandlerError(handler));
        }
        const records = this.idToRecords.get(id)!;

        const i = records.findIndex(
            (other) => other.time.getTime() === record.time.getTime(),
        );
        if (i !== -1) {
            if (records[i]!.value !== record.value) {
                console.warn(
                    "updating records with the same time but different value",
                );
                records[i]!.value = record.value;
            }
            return Promise.resolve(false);
        }

        records.push(record);

        return Promise.resolve(true);
    }

    price({
        handler,
        after,
        until,
        offset,
        limit,
        asc,
    }: CurrencySearchRequest): Promise<CurrencyPriceRecord[]> {
        const id = this.findId(handler);
        if (id == null) {
            return Promise.reject(new InvalidCurrencyHandlerError(handler));
        }

        let records = this.idToRecords.get(id)!;

        if (after != null) {
            records = records.filter((record) => after <= record.time);
        }

        if (until != null) {
            records = records.filter((record) => record.time < until);
        }

        const cmp = (a: CurrencyPriceRecord, b: CurrencyPriceRecord): number =>
            a.time.getTime() - b.time.getTime();
        records.sort(asc ? cmp : (a, b) => -cmp(a, b));

        records = records.slice(offset, offset + limit);

        return Promise.resolve(records);
    }

    async erase(search: CurrencySearchRequest): Promise<number> {
        const id = this.findId(search.handler);
        if (id == null) {
            throw new InvalidCurrencyHandlerError(search.handler);
        }

        const toBeErased = await this.price(search);
        const timeBlackList: Set<number> = new Set();
        for (const { time } of toBeErased) {
            timeBlackList.add(time.getTime());
        }

        const records = this.idToRecords.get(id)!;

        this.idToRecords.set(
            id,
            records.filter(
                (record) => !timeBlackList.has(record.time.getTime()),
            ),
        );

        return timeBlackList.size;
    }
}
