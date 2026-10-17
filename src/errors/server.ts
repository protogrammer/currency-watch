export class BadQueryError extends Error {
    constructor(msg: string) {
        super("bad query: " + msg);
        Object.setPrototypeOf(this, BadQueryError.prototype);
    }
}
