export class TimeoutError extends Error {
    constructor(message?: string) {
        super(message ?? "request timed out");
        Object.setPrototypeOf(this, TimeoutError.prototype);
    }
}

export class UserFriendlyAPIError extends Error {
    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, UserFriendlyAPIError.prototype);
    }
}
