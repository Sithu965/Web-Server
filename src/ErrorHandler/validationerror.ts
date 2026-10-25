// Will Implemented in future
export class HttpValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpValidationError";
  }
}
