import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  splitLines,
  fieldGet,
  parseRequestLine,
  parseHTTPReq,
  getChunkSize,
  getStatusText,
  cutMessage,
} from "../../../src/HTTP/requestParser.ts";

import { HttpValidationError } from "../../../src/ErrorHandler/validationerror.ts";
import { HTTPError } from "../../../src/ErrorHandler/httperror.ts";

// Helper for creating buffers
const buf = (value: string) => Buffer.from(value, "latin1");

describe("splitLines()", () => {
  it("should split lines using CRLF", () => {
    const result = splitLines(buf("GET / HTTP/1.1\r\nHost: localhost\r\n"));

    assert.deepEqual(
      result.map((line) => line.toString()),
      ["GET / HTTP/1.1", "Host: localhost"],
    );
  });

  it("should stop at an empty line marking the end of headers", () => {
    const result = splitLines(
      buf("GET / HTTP/1.1\r\nHost: localhost\r\n\r\nbody"),
    );

    assert.deepEqual(
      result.map((line) => line.toString()),
      ["GET / HTTP/1.1", "Host: localhost", "body"],
    );
  });

  it("should return remaining unfinished data as a line", () => {
    const result = splitLines(buf("GET / HTTP/1.1\r\nHost:"));

    assert.deepEqual(
      result.map((line) => line.toString()),
      ["GET / HTTP/1.1", "Host:"],
    );
  });

  it("should return an empty array for an empty buffer", () => {
    assert.deepEqual(splitLines(Buffer.alloc(0)), []);
  });

  it("should return a single line when no CRLF exists", () => {
    const result = splitLines(buf("GET / HTTP/1.1"));

    assert.equal(result.length, 1);
    assert.equal(result[0].toString(), "GET / HTTP/1.1");
  });
});

describe("fieldGet()", () => {
  it("should return the value of an existing header", () => {
    const headers = [buf("Host: localhost")];

    const result = fieldGet(headers, "Host");

    assert.equal(result?.toString(), " localhost");
  });

  it("should match header names case-insensitively", () => {
    const headers = [buf("Content-Length: 123")];

    const result = fieldGet(headers, "content-length");

    assert.equal(result?.toString(), " 123");
  });

  it("should return null when the header does not exist", () => {
    const headers = [buf("Host: localhost")];

    assert.equal(fieldGet(headers, "Content-Length"), null);
  });

  it("should not match a partial header name", () => {
    const headers = [buf("HostName: localhost")];

    assert.equal(fieldGet(headers, "Host"), null);
  });

  it("should return the first matching header", () => {
    const headers = [buf("Host: first.com"), buf("Host: second.com")];

    assert.equal(fieldGet(headers, "Host")?.toString(), " first.com");
  });

  it("should return null for an empty header array", () => {
    assert.equal(fieldGet([], "Host"), null);
  });
});

describe("parseRequestLine()", () => {
  it("should parse a valid GET request line", () => {
    const result = parseRequestLine(buf("GET / HTTP/1.1"));

    assert.equal(result[0], "GET");
    assert.equal(result[1].toString(), "/");
    assert.equal(result[2], "HTTP/1.1");
  });

  it("should parse a valid HEAD request line", () => {
    const result = parseRequestLine(buf("HEAD /echo HTTP/1.0"));

    assert.equal(result[0], "HEAD");
    assert.equal(result[1].toString(), "/echo");
    assert.equal(result[2], "HTTP/1.0");
  });

  it("should reject a line with a leading space", () => {
    assert.throws(
      () => parseRequestLine(buf(" GET / HTTP/1.1")),
      HttpValidationError,
    );
  });

  it("should reject a line with a trailing space", () => {
    assert.throws(
      () => parseRequestLine(buf("GET / HTTP/1.1 ")),
      HttpValidationError,
    );
  });

  it("should reject tab characters", () => {
    assert.throws(
      () => parseRequestLine(buf("GET\t/ HTTP/1.1")),
      HttpValidationError,
    );
  });

  it("should reject missing request-line parts", () => {
    assert.throws(() => parseRequestLine(buf("GET /")), HttpValidationError);
  });

  it("should reject multiple spaces between parts", () => {
    assert.throws(
      () => parseRequestLine(buf("GET  / HTTP/1.1")),
      HttpValidationError,
    );
  });

  it("should reject extra spaces between request-line parts", () => {
    assert.throws(
      () => parseRequestLine(buf("GET / HTTP/1.1 extra")),
      HttpValidationError,
    );
  });
});

describe("parseHTTPReq()", () => {
  it("should parse a valid HTTP request", () => {
    const request = buf(
      "GET / HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "User-Agent: test\r\n" +
        "\r\n",
    );

    const result = parseHTTPReq(request);

    assert.equal(result.method, "GET");
    assert.equal(result.uri.toString(), "/");
    assert.equal(result.version, "1.1");
    assert.equal(result.headers.length, 2);
  });

  it("should parse header names without case sensitivity", () => {
    const request = buf("GET / HTTP/1.1\r\n" + "hOsT: localhost\r\n" + "\r\n");

    const result = parseHTTPReq(request);

    assert.equal(result.method, "GET");
  });

  it("should reject a request without a Host header", () => {
    const request = buf("GET / HTTP/1.1\r\n" + "User-Agent: test\r\n" + "\r\n");

    assert.throws(
      () => parseHTTPReq(request),
      (error: unknown) =>
        error instanceof HTTPError && error.statusCode === 400,
    );
  });

  it("should reject duplicate Host headers", () => {
    const request = buf(
      "GET / HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "host: example.com\r\n" +
        "\r\n",
    );

    assert.throws(
      () => parseHTTPReq(request),
      (error: unknown) =>
        error instanceof HTTPError && error.statusCode === 400,
    );
  });

  it("should reject an invalid request line", () => {
    const request = buf("GET  / HTTP/1.1\r\n" + "Host: localhost\r\n" + "\r\n");

    assert.throws(() => parseHTTPReq(request), HttpValidationError);
  });

  it("should reject an invalid header", () => {
    const request = buf(
      "GET / HTTP/1.1\r\n" +
        "Invalid Header: value\r\n" +
        "Host: localhost\r\n" +
        "\r\n",
    );

    assert.throws(
      () => parseHTTPReq(request),
      (error: unknown) =>
        error instanceof HTTPError && error.statusCode === 400,
    );
  });

  it("should reject unsupported HTTP methods", () => {
    const request = buf("POST / HTTP/1.1\r\n" + "Host: localhost\r\n" + "\r\n");

    assert.throws(
      () => parseHTTPReq(request),
      (error: unknown) =>
        error instanceof HTTPError && error.statusCode === 405,
    );
  });
});

describe("getChunkSize()", () => {
  it("should parse a hexadecimal chunk size", () => {
    assert.equal(getChunkSize(buf("A")), 10);
  });

  it("should parse uppercase hexadecimal", () => {
    assert.equal(getChunkSize(buf("FF")), 255);
  });

  it("should parse lowercase hexadecimal", () => {
    assert.equal(getChunkSize(buf("ff")), 255);
  });

  it("should parse zero-sized chunks", () => {
    assert.equal(getChunkSize(buf("0")), 0);
  });

  it("should ignore chunk extensions", () => {
    assert.equal(getChunkSize(buf("A;name=value")), 10);
  });

  it("should allow whitespace around the hexadecimal size", () => {
    assert.equal(getChunkSize(buf("  A  ")), 10);
  });

  it("should reject an empty chunk size", () => {
    assert.throws(() => getChunkSize(buf("")));
  });

  it("should reject invalid hexadecimal characters", () => {
    assert.throws(() => getChunkSize(buf("G")));
  });

  it("should reject negative chunk sizes", () => {
    assert.throws(() => getChunkSize(buf("-1")));
  });

  it("should reject chunk-size strings longer than 8 characters", () => {
    assert.throws(() => getChunkSize(buf("123456789")));
  });

  it("should reject chunk sizes exceeding 16 MB", () => {
    assert.throws(() => getChunkSize(buf("1000001")), /413 Payload Too Large/);
  });
});

describe("getStatusText()", () => {
  it("should return the reason phrase for a known status code", () => {
    assert.equal(getStatusText(200), "OK");
    assert.equal(getStatusText(404), "Not Found");
    assert.equal(getStatusText(500), "Internal Server Error");
  });

  it("should return a generic phrase for an unassigned 1xx status", () => {
    assert.equal(getStatusText(199), "Informational");
  });

  it("should return a generic phrase for an unassigned 2xx status", () => {
    assert.equal(getStatusText(299), "Success");
  });

  it("should return a generic phrase for an unassigned 3xx status", () => {
    assert.equal(getStatusText(306), "Redirection");
  });

  it("should return a generic phrase for an unassigned 4xx status", () => {
    assert.equal(getStatusText(499), "Client Error");
  });

  it("should return a generic phrase for an unassigned 5xx status", () => {
    assert.equal(getStatusText(599), "Server Error");
  });

  it("should reject status codes below 100", () => {
    assert.throws(() => getStatusText(99), /Invalid HTTP status code/);
  });

  it("should reject status codes above 599", () => {
    assert.throws(() => getStatusText(600), /Invalid HTTP status code/);
  });
});

describe("cutMessage()", () => {
  // Creates a DynBuf-like object for testing
  const createDynBuf = (message: string) => {
    const data = buf(message);

    return {
      data,
      length: data.length,
    };
  };

  it("should return null when the header is incomplete", () => {
    const buffer = createDynBuf("GET / HTTP/1.1\r\nHost: localhost");

    const result = cutMessage(buffer);

    assert.equal(result, null);
    assert.equal(
      buffer.length,
      buf("GET / HTTP/1.1\r\nHost: localhost").length,
    );
  });

  it("should parse a complete HTTP request header", () => {
    const buffer = createDynBuf(
      "GET / HTTP/1.1\r\n" + "Host: localhost\r\n" + "\r\n",
    );

    const result = cutMessage(buffer);

    assert.notEqual(result, null);
    assert.equal(result?.method, "GET");
    assert.equal(result?.uri.toString(), "/");
    assert.equal(result?.version, "1.1");
  });

  it("should remove the parsed header from the buffer", () => {
    const body = "remaining body";

    const buffer = createDynBuf(
      "GET / HTTP/1.1\r\n" + "Host: localhost\r\n" + "\r\n" + body,
    );

    cutMessage(buffer);

    assert.equal(buffer.data.subarray(0, buffer.length).toString(), body);
  });

  it("should leave the buffer unchanged when no complete header exists", () => {
    const original = "GET / HTTP/1.1\r\nHost: localhost";
    const buffer = createDynBuf(original);

    cutMessage(buffer);

    assert.equal(buffer.data.subarray(0, buffer.length).toString(), original);
  });

  it("should reject a malformed complete request", () => {
    const buffer = createDynBuf(
      "GET  / HTTP/1.1\r\n" + "Host: localhost\r\n" + "\r\n",
    );

    assert.throws(() => cutMessage(buffer));
  });

  it("should accept a small header followed by a large body", () => {
    const header = "GET / HTTP/1.1\r\n" + "Host: localhost\r\n" + "\r\n";

    const body = "x".repeat(100_000);

    const buffer = createDynBuf(header + body);

    const result = cutMessage(buffer);

    assert.notEqual(result, null);
    assert.equal(result?.method, "GET");

    // Body must remain in the buffer.
    assert.equal(buffer.data.subarray(0, buffer.length).toString(), body);
  });

  it("should reject a header exceeding the maximum header size", () => {
    const header =
      "GET / HTTP/1.1\r\n" +
      "Host: localhost\r\n" +
      "X-Large: " +
      "x".repeat(8192) +
      "\r\n\r\n";

    const buffer = createDynBuf(header);

    assert.throws(
      () => cutMessage(buffer),
      (error: unknown) =>
        error instanceof HTTPError && error.statusCode === 413,
    );
  });
});
