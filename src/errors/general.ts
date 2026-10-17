import { CurrencyHandler } from "../types";

export class InternalError extends Error {
    constructor(msg: string) {
        super(msg);
        Object.setPrototypeOf(this, InternalError.prototype);
    }
}

export class InvalidCurrencyHandlerError extends Error {
    constructor(public handler: CurrencyHandler) {
        super(`invalid currency handler ${JSON.stringify(handler)}`);
        Object.setPrototypeOf(this, InvalidCurrencyHandlerError.prototype);
    }
}
