import request from "supertest";
import { Application } from "express";
import fs from "fs/promises";

import { expressApp } from "../express-app";
import { SQLiteStore } from "../sqlite-store";
import { InMemoryStore } from "../in-memory-store";
import { CoinMarketCapAPI } from "../coin-market-cap-api";
import { Scenes } from "../scenes";
import { CurrencyStore } from "../types";

type ServerInfo = {
    app: Application;
    bearer: string;
    store: CurrencyStore;
};

const configServer = (apiKey: string, store: CurrencyStore): ServerInfo => {
    const api = new CoinMarketCapAPI(apiKey);
    const scenes = new Scenes(store, api);
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    const bearer = arr.toBase64();
    const app = expressApp(scenes, bearer);
    return { app, bearer, store };
};

const currencies: [string, number][] = [
    ["btc", 1],
    ["eth", 1027],
    ["xrp", 52],
];

const apiKey = process.env.API_KEY;
if (apiKey == null) {
    throw new Error("API_KEY not configured in .env.test");
}

const createSQLiteServer = async (): Promise<ServerInfo> => {
    const sqliteStore = new SQLiteStore(":memory:");
    await sqliteStore.initDB();
    return configServer(apiKey, sqliteStore);
};

const createRequestTemplate = (
    app: Application,
    bearer: string,
    method: "get" | "post" | "delete",
    url: string,
): request.Test => {
    const req = request(app);
    const reqWithAction =
        method === "get"
            ? req.get(url)
            : method === "post"
              ? req.post(url)
              : req.delete(url);
    const reqWithAuth = reqWithAction.set("Authorization", `Bearer ${bearer}`);
    const typedReq = reqWithAuth.expect("Content-Type", /json/);
    return typedReq;
};

const expectToBePriceRecord = (record: any): void => {
    expect(record).not.toBeNull();
    expect(record.time).toMatch(
        /^\d{4}\-\d{2}\-\d{2}T\d{2}\:\d{2}\:\d{2}\.\d{3}Z$/,
    );
    if (record.value != null) {
        expect(typeof record.value).toBe("number");
    }
};

describe("test endpoints", () => {
    it("add, info, list, remove-from-list, load, price, erase", async () => {
        const { app, bearer } = await createSQLiteServer();

        const createRequest = (
            method: "get" | "post" | "delete",
            url: string,
        ) => createRequestTemplate(app, bearer, method, url);

        for (const [symbolLower, id] of currencies) {
            const symbol = symbolLower.toUpperCase();
            // /add
            const resp = await createRequest(
                "post",
                "/add?id=" + id + "&load=1",
            );
            expect(resp.status).toBe(201);
            expect(resp.body).toMatchObject({ id, symbol, added: true });
            expect(typeof resp.body.name).toBe("string");
            expectToBePriceRecord(resp.body.latestRecord);

            // test location
            const loc = resp.headers.location;
            expect(typeof loc).toBe("string");
            const locResp = await createRequest("get", loc as string);
            expect(locResp.status).toBe(200);
            expect(resp.body).toMatchObject(locResp.body);
        }

        // /price
        let [record] = (await createRequest("get", "/price?id=1")).body; // bitcoin
        expectToBePriceRecord(record);
        // /remove-from-list
        let resp = await createRequest("delete", "/remove-from-list?id=1");
        expect(resp.body).toStrictEqual({ removed: true });
        // /price
        resp = await createRequest("get", "/price?id=1");
        expect(resp.status).toBe(400);
        expect(resp.body).toHaveProperty("error");
        // /add
        resp = await createRequest("post", "/add?id=1");
        expect(resp.status).toBe(201);
        expect(resp.body).toStrictEqual({
            id: 1,
            symbol: "BTC",
            name: "Bitcoin",
            added: true,
        });
        expect(typeof resp.body.name).toBe("string");
        // /price
        resp = await createRequest("get", "/price?id=1");
        expect(resp.body).toStrictEqual([]);
        // /load
        resp = await createRequest("post", "/load?id=1");
        expect(resp.status).toBe(201);
        record = resp.body;
        expectToBePriceRecord(record);
        let loc = resp.headers.location;
        expect(typeof loc).toBe("string");
        // check location
        resp = await createRequest("get", loc as string);
        expect(resp.body[0]).toStrictEqual(record);
        // /erase
        resp = await createRequest("delete", "/erase?symbol=BTC");
        expect(resp.body).toStrictEqual({ erased: 1 });
        resp = await createRequest("delete", "/erase?id=1");
        expect(resp.body).toStrictEqual({ erased: 0 });
        // /price
        resp = await createRequest("get", "/price?id=1");
        expect(resp.body).toStrictEqual([]);
        // /list
        resp = await createRequest("get", "/list");
        expect(resp.status).toBe(200);
        expect(resp.body).toStrictEqual([
            {
                id: 1,
                symbol: "BTC",
                name: "Bitcoin",
            },
            {
                id: 52,
                symbol: "XRP",
                name: "XRP",
            },
            {
                id: 1027,
                symbol: "ETH",
                name: "Ethereum",
            },
        ]);
        // /info
        resp = await createRequest("get", "/info?symbol=XRP");
        expect(resp.body).toMatchObject({
            id: 52,
            symbol: "XRP",
            name: "XRP",
        });
        expectToBePriceRecord(resp.body.latestRecord);
    });

    it("bearer authentification", async () => {
        const { app, bearer } = await createSQLiteServer();

        const url = "/add?symbol=BTC";

        let resp = await request(app).post(url);
        expect(resp.status).toBe(401);
        expect(resp.body).toStrictEqual({});

        resp = await request(app)
            .post(url)
            .set("Authorization", "Bearer " + bearer + "a");
        expect(resp.status).toBe(401);
        expect(resp.body).toStrictEqual({});
        resp = await request(app)
            .post(url)
            .set("Authorization", "Bearer " + bearer);
        expect(resp.status).toBe(201);
        expect(resp.body).toStrictEqual({
            id: 1,
            symbol: "BTC",
            name: "Bitcoin",
            added: true,
        });
    });
});

describe("test SQLite Store", () => {
    it("tests whether GET /price and DELETE /erase for sqlite and in-memory stores work the same way", async () => {
        const sqliteServer = await createSQLiteServer();
        const inMemoryServer = configServer(apiKey, new InMemoryStore());

        const testServers = async (
            f: (server: ServerInfo) => Promise<any>,
        ): Promise<void> => {
            const [v1, v2] = await Promise.all([
                f(sqliteServer),
                f(inMemoryServer),
            ]);
            expect(v1).toStrictEqual(v2);
        };

        // check whether different store representations (InMemoryStore and SQLiteStore) works the same
        const testRequest = (
            method: "get" | "post" | "delete",
            url: string,
            success: boolean = true,
        ): Promise<void> =>
            testServers(async (server) => {
                const resp = await createRequestTemplate(
                    server.app,
                    server.bearer,
                    method,
                    url,
                );
                if (success) {
                    expect(
                        200 <= resp.status && resp.status < 300,
                    ).toBeTruthy();
                }
                return resp.body;
            });

        for (const currency of currencies.map(([s, id]) => s.toUpperCase())) {
            await testRequest("post", "/add?symbol=" + currency);
        }

        // loading test data from files
        for (const [symbol, _id] of currencies) {
            const data = JSON.parse(
                await fs.readFile(`./testData/${symbol}.json`, "utf8"),
            );
            expect(Array.isArray(data)).toBeTruthy();
            for (const { time, value } of data as any[]) {
                expect(typeof time).toBe("string");
                expect(typeof value).toBe("number");
                await testServers((server) =>
                    server.store.addRecord(
                        { symbol: symbol.toUpperCase() },
                        {
                            value: value as number,
                            time: new Date(time),
                        },
                    ),
                );
            }
        }

        // testing price and erase requests
        for (const [_, id] of currencies) {
            for (let i = 0; i < 3; ++i) {
                await testRequest(
                    "get",
                    `/price?id=${id}&offset=2&limit=3&asc=0&until=2026-10-17T00:26:03.000Z`,
                );
                await testRequest(
                    "delete",
                    `/erase?id=${id}&offset=2&limit=3&asc=0&until=2026-10-17T00:26:03.000Z`,
                );
            }
            for (let i = 0; i < 3; ++i) {
                await testRequest(
                    "get",
                    `/price?id=${id}&offset=2&limit=3&asc=1&after=2026-10-17T00:26:03.000Z`,
                );
                await testRequest(
                    "delete",
                    `/erase?id=${id}&offset=2&limit=3&asc=1&after=2026-10-17T00:26:03.000Z`,
                );
            }
        }
    });
});
