import { MAX_RECORD_LIMIT } from "../constants/general";
import { BadQueryError } from "../errors/server";
import { CurrencyHandler, CurrencySearchRequest } from "../types";

const isAlphaNumeric = /^[a-z0-9]+$/i;

export const queryCurrencyHandler = (query: any): CurrencyHandler => {
    const { id, symbol } = query;
    const vId = id != null ? Number.parseInt(String(id)) : null;
    const vSymbol = symbol != null ? String(symbol) : null;

    if (vId != null) {
        if (Number.isNaN(vId)) {
            throw new BadQueryError(`id = ${JSON.stringify(id)} is NaN`);
        }
        return { id: vId };
    }

    if (vSymbol != null) {
        if (!isAlphaNumeric.test(vSymbol)) {
            throw new BadQueryError(
                "symbol should be alphanumeric, got " + vSymbol,
            );
        }
        return { symbol: vSymbol };
    }

    throw new BadQueryError("no currency handler specified");
};

export const queryBoolean = (
    name: string,
    query: any,
    default_: boolean = false,
): boolean => {
    const value = Object(query)[name];
    if (value == null) {
        return default_;
    }
    if (typeof value !== "string") {
        throw new BadQueryError(
            `problem processing ${name} = ${JSON.stringify(value)}`,
        );
    }
    const lower = value.toLowerCase().trim();
    if (lower === "true" || lower === "t") {
        return true;
    }
    if (lower === "false" || lower === "f") {
        return false;
    }
    const i = Number.parseInt(value);
    if (Number.isNaN(i)) {
        throw new BadQueryError(`${name} = ${value} is not a valid boolean`);
    }
    return i !== 0;
};

export const queryDate = (name: string, query: any): Date | null => {
    const value = Object(query)[name];
    if (value == null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new BadQueryError(
            `problem processing ${name} = ${JSON.stringify(value)}`,
        );
    }
    const decoded = decodeURI(value);
    const dateInteger = Date.parse(decoded);
    if (Number.isNaN(dateInteger)) {
        throw new BadQueryError(`invalid date ${name} = ${value}`);
    }
    return new Date(dateInteger);
};

const isNumeric = /^[0-9a-fx]+$/i;

export const queryInt = (name: string, query: any): number | null => {
    const value = Object(query)[name];
    if (value == null) {
        return null;
    }
    if (typeof value !== "string") {
        throw new BadQueryError(
            `problem processing ${name} = ${JSON.stringify(value)}`,
        );
    }
    if (!isNumeric.test(value)) {
        throw new BadQueryError(`invalid integer '${name}' = ${value}`);
    }
    const i = Number.parseInt(value);
    if (Number.isNaN(i)) {
        throw new BadQueryError(`invalid integer '${name}' = ${value}`);
    }
    return i;
};

export const queryCurrencySearchRequest = (
    query: any,
    noRecordLimit: boolean = false,
): CurrencySearchRequest => {
    const handler = queryCurrencyHandler(query);
    const after = queryDate("after", query);
    const until = queryDate("until", query);
    const offset = queryInt("offset", query);
    const limit = queryInt("limit", query);
    const asc = queryBoolean("asc", query, false);
    if (!noRecordLimit && limit != null && limit > MAX_RECORD_LIMIT) {
        throw new BadQueryError(
            "limit cannot be greater than " + MAX_RECORD_LIMIT,
        );
    }
    return {
        handler,
        after,
        until,
        offset: offset ?? 0,
        limit: limit ?? 1,
        asc,
    };
};
