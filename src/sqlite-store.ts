import { Database } from "sqlite3";

import {
    Currency,
    CurrencyHandler,
    CurrencyPriceRecord,
    CurrencySearchRequest,
    CurrencyStore,
} from "./types";
import { getHandlerName, isCurrencyIdHandler } from "./types";
import { InvalidCurrencyHandlerError } from "./errors/general";

const handleErr =
    (
        resolve: () => void,
        reject: (err: Error) => void,
    ): ((err: Error | null) => void) =>
    (err) =>
        err != null ? reject(err) : resolve();

const dollarize = (obj: Object) =>
    Object.fromEntries(
        Object.entries(obj).map(([name, value]) => ["$" + name, value]),
    );

const ignore: (...args: any[]) => void = (..._args: any[]) => null;

type DatabasePriceRecord = {
    value: number | null;
    time: number;
};

const externalizePriceRecord = (
    record: DatabasePriceRecord,
): CurrencyPriceRecord => ({
    value: record.value,
    time: new Date(record.time),
});

export class SQLiteStore implements CurrencyStore {
    protected database: Database;
    constructor(sqlitePath: string) {
        this.database = new Database(sqlitePath);
    }

    async initDB(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.database.serialize(() => {
                this.database.exec("PRAGMA foreign_keys = ON;");
                this.database.exec(
                    `CREATE TABLE IF NOT EXISTS currency (
                        id INTEGER PRIMARY KEY,
                        name TEXT NOT NULL,
                        symbol TEXT NOT NULL
                    );`,
                    handleErr(resolve, reject),
                );
                this.database.exec(
                    `CREATE TABLE IF NOT EXISTS price_record (
                        id INTEGER NOT NULL,
                        time INTEGER NOT NULL,
                        value REAL,
                        PRIMARY KEY(id, time),
                        FOREIGN KEY(id) REFERENCES currency(id) ON DELETE CASCADE ON UPDATE RESTRICT
                    );`,
                    handleErr(resolve, reject),
                );
            });
        });
    }

    close(): Promise<void> {
        return new Promise((resolve, reject) =>
            this.database.close(handleErr(resolve, reject)),
        );
    }

    list(): Promise<Currency[]> {
        return new Promise((resolve, reject) => {
            this.database.all(
                "SELECT id, symbol, name FROM currency;",
                (err, rows: Currency[]) =>
                    err != null ? reject(err) : resolve(rows),
            );
        });
    }

    protected getChanges(resolve: (n: number) => void): void {
        this.database.get(
            "SELECT changes() AS n;",
            (err, row?: { n: number }) =>
                err != null
                    ? console.warn("error getting changes from sqlite", err)
                    : resolve(row?.n ?? 0),
        );
    }

    protected smthJustChanged(resolve: (change: boolean) => void): void {
        this.getChanges((n) => resolve(n !== 0));
    }

    add(currency: Currency): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.database.serialize(() => {
                this.database.run(
                    `INSERT OR REPLACE INTO currency (id, name, symbol)
                    VALUES ($id, $name, $symbol);`,
                    dollarize(currency),
                    handleErr(ignore, reject),
                );
                this.smthJustChanged(resolve);
            });
        });
    }
    getCurrency(handler: CurrencyHandler): Promise<Currency> {
        return new Promise((resolve, reject) => {
            const idName = getHandlerName(handler);
            this.database.get(
                `SELECT id, symbol, name FROM currency WHERE ${idName} = $${idName};`,
                dollarize(handler),
                (err, row: Currency) =>
                    err != null
                        ? reject(err)
                        : row != null
                          ? resolve(row)
                          : new InvalidCurrencyHandlerError(handler),
            );
        });
    }

    removeFromList(handler: CurrencyHandler): Promise<boolean> {
        return new Promise((resolve, reject) => {
            const idName = getHandlerName(handler);
            this.database.serialize(() => {
                this.database.get(
                    `DELETE FROM currency WHERE ${idName} = $${idName};`,
                    dollarize(handler),
                    handleErr(ignore, reject),
                );
                this.smthJustChanged(resolve);
            });
        });
    }

    protected getCurrencyId(handler: CurrencyHandler): Promise<number | null> {
        return isCurrencyIdHandler(handler)
            ? new Promise((resolve, reject) =>
                  this.database.get(
                      "SELECT COUNT(*) AS n FROM currency WHERE id = ?;",
                      handler.id,
                      (err, row?: { n: number }) =>
                          err != null
                              ? reject(err)
                              : resolve(
                                    row?.n != null && row.n !== 0
                                        ? handler.id
                                        : null,
                                ),
                  ),
              )
            : new Promise((resolve, reject) =>
                  this.database.get(
                      "SELECT id FROM currency WHERE symbol = ?;",
                      handler.symbol,
                      (err, row?: { id: number }) =>
                          err != null ? reject(err) : resolve(row?.id ?? null),
                  ),
              );
    }

    async addRecord(
        handler: CurrencyHandler,
        record: CurrencyPriceRecord,
    ): Promise<boolean> {
        const id = await this.getCurrencyId(handler);
        if (id == null) {
            throw new InvalidCurrencyHandlerError(handler);
        }
        return new Promise((resolve, reject) => {
            this.database.serialize(() => {
                this.database.get(
                    `INSERT OR REPLACE INTO price_record (id, time, value)
                    VALUES ($id, $time, $value);`,
                    dollarize({
                        id,
                        time: record.time.getTime(),
                        value: record.value,
                    }),
                    handleErr(ignore, reject),
                );
                this.smthJustChanged(resolve);
            });
        });
    }

    protected static priceSqlStatement(
        asc: boolean,
        includeValue: boolean = true,
    ): string {
        return `SELECT time${includeValue ? ", value" : ""} FROM price_record
                WHERE id = $id
                AND ($after IS NULL OR $after <= time)
                AND ($until IS NULL OR time < $until)
                ORDER BY time ${asc ? "ASC" : "DESC"}
                LIMIT $limit
                OFFSET $offset`;
    }

    protected async preparePriceRequest(request: CurrencySearchRequest) {
        const id = await this.getCurrencyId(request.handler);
        if (id == null) {
            throw new InvalidCurrencyHandlerError(request.handler);
        }
        const after = request.after?.getTime() ?? null;
        const until = request.until?.getTime() ?? null;
        return dollarize({
            id,
            after,
            until,
            limit: request.limit,
            offset: request.offset,
        });
    }

    async price(
        request: CurrencySearchRequest,
    ): Promise<CurrencyPriceRecord[]> {
        const params = await this.preparePriceRequest(request);
        const sql = SQLiteStore.priceSqlStatement(request.asc) + ";";

        return new Promise((resolve, reject) => {
            this.database.all(
                sql,
                params,
                (err, rows: DatabasePriceRecord[]) =>
                    err != null
                        ? reject(err)
                        : resolve(rows.map(externalizePriceRecord)),
            );
        });
    }

    async erase(request: CurrencySearchRequest): Promise<number> {
        const params = await this.preparePriceRequest(request);
        const subquery = SQLiteStore.priceSqlStatement(request.asc, false);
        const sql = `DELETE FROM price_record WHERE id = $id AND time IN (${subquery});`;

        return new Promise((resolve, reject) => {
            this.database.serialize(() => {
                this.database.all(sql, params, handleErr(ignore, reject));
                this.getChanges(resolve);
            });
        });
    }
}
