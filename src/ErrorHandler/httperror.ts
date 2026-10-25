// Will UPDATE in future
export class HTTPError extends Error {
  public statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);

    // HTTPError, NotFoundError, BadRequestError
    this.name = this.constructor.name;
    this.statusCode = statusCode;

    // Restore native prototype chain for built-in classes in TS
    Object.setPrototypeOf(this, new.target.prototype);

    if (Error.captureStackTrace) {
      // omit all of the stack frames invoked by code inside this constructor, itself
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class NotFoundError extends HTTPError {
  constructor(message = "Resource Not Found") {
    super(404, message);
  }
}

export class BadRequestError extends HTTPError {
  constructor(message = "Bad Request") {
    super(400, message);
  }
}
