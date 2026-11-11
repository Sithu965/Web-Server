import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  validateFirstLine,
  validateHeaders,
  parseDec,
  parseEncoding,
} from "../../../src/Validation/requestMsg.ts";

import { HTTPError } from "../../../src/ErrorHandler/httperror.ts";

describe("validateFirstLine()", () => {
  it("should accept a valid GET request", () => {
    const result = validateFirstLine("GET", Buffer.from("/"), "HTTP/1.1");

    assert.equal(result, true);
  });

  it("should accept a valid HEAD request", () => {
    assert.equal(
      validateFirstLine("HEAD", Buffer.from("/echo"), "HTTP/1.0"),
      true,
    );
  });

  it("should reject unsupported HTTP methods with 405", () => {
    assert.throws(
      () => validateFirstLine("POST", Buffer.from("/"), "HTTP/1.1"),
      (error: unknown) =>
        error instanceof HTTPError && error.statusCode === 405,
    );
  });

  it("should reject invalid method syntax with 400", () => {
    assert.throws(
      () => validateFirstLine("get", Buffer.from("/"), "HTTP/1.1"),
      (error: unknown) =>
        error instanceof HTTPError && error.statusCode === 400,
    );
  });

  it("should reject unknown URIs with 404", () => {
    assert.throws(
      () => validateFirstLine("GET", Buffer.from("/unknown"), "HTTP/1.1"),
      (error: unknown) =>
        error instanceof HTTPError && error.statusCode === 404,
    );
  });

  it("should reject unsupported HTTP versions with 505", () => {
    assert.throws(
      () => validateFirstLine("GET", Buffer.from("/"), "HTTP/2"),
      (error: unknown) =>
        error instanceof HTTPError && error.statusCode === 505,
    );
  });
});

// =====================================
// validateHeaders()
// =====================================

describe("validateHeaders()", () => {
  it("should accept a valid HTTP header", () => {
    assert.equal(validateHeaders(Buffer.from("Host: example.com")), true);
  });

  it("should accept horizontal tabs in header values", () => {
    assert.equal(validateHeaders(Buffer.from("X-Test: hello\tworld")), true);
  });

  it("should reject empty headers", () => {
    assert.equal(validateHeaders(Buffer.from("")), false);
  });

  it("should reject an empty field name", () => {
    assert.equal(validateHeaders(Buffer.from(": value")), false);
  });

  it("should reject whitespace before the colon", () => {
    assert.equal(validateHeaders(Buffer.from("Host : example.com")), false);
  });

  it("should reject control characters in header values", () => {
    assert.equal(validateHeaders(Buffer.from("X-Test: hello\x01world")), false);
  });
});

// =====================================
// parseDec()
// =====================================

describe("parseDec()", () => {
  it("should parse a valid decimal number", () => {
    assert.equal(parseDec("12345"), 12345);
  });

  it("should handle leading and trailing whitespace", () => {
    assert.equal(parseDec("  123  "), 123);
    assert.equal(parseDec("\t123\t"), 123);
  });

  it("should accept zero", () => {
    assert.equal(parseDec("0"), 0);
  });

  it("should reject empty values", () => {
    assert.throws(
      () => parseDec(""),
      (error: unknown) =>
        error instanceof HTTPError && error.statusCode === 400,
    );
  });

  it("should reject negative numbers", () => {
    assert.throws(() => parseDec("-10"));
  });

  it("should reject decimal numbers", () => {
    assert.throws(() => parseDec("10.5"));
  });

  it("should reject values exceeding MAX_SAFE_INTEGER", () => {
    assert.throws(() => parseDec("9007199254740992"));
  });
});

// =====================================
// parseEncoding()
// =====================================

describe("parseEncoding()", () => {
  it("should parse chunked encoding", () => {
    const result = parseEncoding(Buffer.from("chunked"));

    assert.equal(result.toString(), "chunked");
  });

  it("should handle uppercase encoding", () => {
    const result = parseEncoding(Buffer.from("CHUNKED"));

    assert.equal(result.toString(), "chunked");
  });

  it("should handle surrounding whitespace", () => {
    const result = parseEncoding(Buffer.from("  chunked\t"));

    assert.equal(result.toString(), "chunked");
  });

  it("should return an empty buffer for empty input", () => {
    const result = parseEncoding(Buffer.from(""));

    assert.equal(result.length, 0);
  });
});
