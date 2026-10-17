import * as https from "https";
import * as http from "http";

import { CoinMarketCapAPI } from "./coin-market-cap-api";
import { AUTO_LOAD_INTERVAL_MS } from "./constants/general";
import { expressApp } from "./express-app";
import { Scenes } from "./scenes";
import { SQLiteStore } from "./sqlite-store";
import { getEnv } from "./util/env";

const DEV_MODE: boolean = process.env.DEV_MODE?.trim() === "1";

const main = async () => {
    const bearerToken = getEnv("BEARER_TOKEN");
    const apiKey = getEnv("API_KEY");
    const port = getEnv("PORT");
    const sqlitePath = getEnv("SQLITE_PATH");

    const cleanupList: { close(): any }[] = [];
    const cleanup = (): Promise<any[]> =>
        Promise.all(
            cleanupList.reverse().map((obj) => {
                try {
                    return Promise.resolve(obj.close()).catch((err) => {
                        console.warn(`error closing ${obj} (async):`, err);
                    });
                } catch (err) {
                    console.warn(`error closing ${obj} (sync):`, err);
                }
            }),
        ).finally(() => {
            console.log("exiting the process...");
            process.exit();
        });

    for (const signal of ["SIGINT", "SIGTERM"]) {
        process.on(signal, () => {
            console.log("got signal " + signal);
            cleanup();
        });
    }

    let shouldCleanUp = true;

    try {
        const store = new SQLiteStore(sqlitePath);
        cleanupList.push(store);

        await store.initDB();

        const scenes = new Scenes(store, new CoinMarketCapAPI(apiKey));

        const app = expressApp(scenes, bearerToken);
        const server = (
            DEV_MODE ? http.createServer(app) : https.createServer(app)
        ).listen(port);
        cleanupList.push(server);

        const timeout = scenes.autoLoad(AUTO_LOAD_INTERVAL_MS);
        cleanupList.push(timeout);

        shouldCleanUp = false;
    } finally {
        if (shouldCleanUp) {
            await cleanup();
        }
    }
};

if (DEV_MODE) {
    process.loadEnvFile();
}

main();
