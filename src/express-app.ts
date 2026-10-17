import express, { Application } from "express";

import { isCurrencyIdHandler, ScenesList } from "./types";
import {
    queryBoolean,
    queryCurrencyHandler,
    queryCurrencySearchRequest,
} from "./util/query";
import { TimeoutError, UserFriendlyAPIError } from "./errors/api";
import { BadQueryError } from "./errors/server";
import { InternalError, InvalidCurrencyHandlerError } from "./errors/general";

const bearerMiddleware =
    (bearerToken: string) =>
    (
        req: express.Request,
        resp: express.Response,
        next: express.NextFunction,
    ): void => {
        const args = req.header("Authorization")?.split(" ");
        if (
            args == null ||
            args.length !== 2 ||
            args[0] !== "Bearer" ||
            args[1] !== bearerToken
        ) {
            resp.sendStatus(401);
            return;
        }
        next();
    };

export const expressApp = (
    scenes: ScenesList,
    bearerToken: string,
): Application => {
    const app = express();

    app.use(express.json(), bearerMiddleware(bearerToken));

    app.get("/list", async (req, resp) => {
        const currencies = await scenes.list();
        resp.json(currencies);
    });

    app.post("/add", async (req, resp) => {
        const handler = queryCurrencyHandler(req.query);

        const load = queryBoolean("load", req.query);

        const [currency, added, record] = await scenes.add(handler, load);

        resp.status(201);
        resp.location(`/info?id=${currency.id}`);
        resp.json({
            ...currency,
            added,
            ...(record != null ? { price: record } : {}),
        });
    });

    app.get("/info", async (req, resp) => {
        const handler = queryCurrencyHandler(req.query);
        const currency = await scenes.info(handler);
        resp.json(currency);
    });

    app.delete("/remove-from-list", async (req, resp) => {
        const handler = queryCurrencyHandler(req.query);
        const removed = await scenes.removeFromList(handler);
        resp.json({ removed });
    });

    app.post("/load", async (req, resp) => {
        const handler = queryCurrencyHandler(req.query);
        const record = await scenes.load(handler);
        resp.status(201);
        resp.location(
            `/price?${
                isCurrencyIdHandler(handler)
                    ? "id=" + handler.id
                    : "symbol=" + handler.symbol
            }&after=${record.time.toISOString()}&asc=1`,
        );
        resp.json(record);
    });

    app.get("/price", async (req, resp) => {
        const search = queryCurrencySearchRequest(req.query);
        const records = await scenes.price(search);
        resp.json(records);
    });

    app.delete("/erase", async (req, resp) => {
        const search = queryCurrencySearchRequest(req.query, true);
        const erased = await scenes.erase(search);
        resp.json({ erased });
    });

    app.use(
        (
            err: Error,
            req: express.Request,
            resp: express.Response,
            next: express.NextFunction,
        ) => {
            if (err == null) {
                next();
                return;
            }
            if (
                err instanceof BadQueryError ||
                err instanceof InvalidCurrencyHandlerError
            ) {
                resp.status(400);
            } else if (err instanceof TimeoutError) {
                resp.status(504);
            } else if (err instanceof UserFriendlyAPIError) {
                resp.status(500);
            } else {
                console.warn(
                    err instanceof InternalError
                        ? "internal error"
                        : "unhandled error",
                    err.message,
                    err,
                );
                resp.sendStatus(500);
                return;
            }
            resp.json({
                error: err.message,
            });
        },
    );

    app.use((req, resp, next) => {
        resp.status(404).json({
            error: "page not found",
        });
    });

    return app;
};
