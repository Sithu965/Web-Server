import { TOKEN_CHARS } from "../Utils/staticValue.ts";
import { HTTPError } from "../ErrorHandler/httperror.ts";

// prettier-ignore
const VALID_METHODS = ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH",] as const;

type ValidMethods = (typeof VALID_METHODS)[number];

type ImplementedMethods = Extract<ValidMethods, "GET" | "HEAD">;

// MUST Always allowed Get and Head methods according to RFC 9110
const allowedMethods: ImplementedMethods[] = ["GET", "HEAD"];

const HTTPMethods = new Set<ImplementedMethods>(allowedMethods);

const allowedURIs = new Set<string>(["/echo", "/"]);

const allowedVersions = new Set<string>(["HTTP/1.1", "HTTP/1.0"]);

const validatePath = (uri: string): boolean => {
  // RFC 9110: The path component of the target URI is case-sensitive

  // Empty URI
  if (uri.length === 0) return false;

  // RFC 9110: Request-target cannot contain control characters (0-31 and 127)
  for (let i = 0; i < uri.length; i++) {
    const code = uri.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return false;
    }
  }

  // Basic path-traversal/dot-dot mitigation rule
  // Rejects paths attempting to back out of the root layout via /../
  if (uri.includes("/../") || uri.endsWith("/..")) {
    return false;
  }

  return true;
};

export const validateFirstLine = (
  method: string,
  uri: Buffer,
  version: string,
): boolean => {
  // Case-sensitive validation
  // If user sent a known HTTP method but we don't support it -> 405
  // If it's completely malformed/lowercase (e.g. "get") -> 400 Bad Request
  if (!HTTPMethods.has(method as ImplementedMethods)) {
    // prettier-ignore
    const knownMethods = new Set(["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"]);
    if (knownMethods.has(method.toUpperCase())) {
      throw new HTTPError(405, "Method Not Allowed");
    } else {
      throw new HTTPError(400, "Bad Request: Invalid Method Syntax");
    }
  }

  // URI / Path Validation
  const uriString = uri.toString("latin1");
  if (!allowedURIs.has(uriString)) {
    throw new HTTPError(404, "Not Found");
  }
  if (!validatePath(uriString)) {
    throw new HTTPError(400, "Bad Request: Malformed URI");
  }

  // HTTP Version Check
  if (!allowedVersions.has(version)) {
    throw new HTTPError(505, "HTTP Version Not Supported");
  }

  // All Pass
  return true;
};

export const validateHeaders = (h: Buffer): boolean => {
  const len = h.length;
  if (len === 0) return false; // Empty line Found in Headers
  let colonIdx = -1;
  for (let i = 0; i < len; i++) {
    if (h[i] === 0x3a) {
      // ':' found
      colonIdx = i;
      break;
    }
    // Check if character is allowed in an RFC Token
    if (TOKEN_CHARS[h[i]] !== 1) {
      return false; // Invalid character or whitespace before colon
    }
  }
  // RFC Rule: Field-name cannot be empty (e.g., ": value")
  if (colonIdx <= 0) return false;
  // RFC 9110: Field values consist of visible US-ASCII (VCHAR), spaces (0x20), and horizontal tabs (0x09)
  for (let i = colonIdx + 1; i < len; i++) {
    // Reject CR (0x0D) or LF (0x0A) hidden inside the buffer line
    // Rejects all control characters (0-31) except horizontal tab (0x09)
    // Rejects DEL (0x7F)
    if ((h[i] < 0x20 && h[i] !== 0x09) || h[i] === 0x7f) {
      return false;
    }
  }
  return true;
};

export const parseDec = (fieldValue: string): number => {
  // Strip standard HTTP/1.1 OWS(Spaces and Tabs)
  const trimmed = fieldValue.trim();
  // Reject empty content strings after trimming
  if (trimmed.length === 0) {
    throw new HTTPError(
      400,
      "Bad Request: Missing digits in numeric header value",
    );
  }
  let result = 0;
  // strict character matching with Bytes
  for (let i = 0; i < trimmed.length; i++) {
    const byte = trimmed.charCodeAt(i);
    // Reject anything that is not a raw decimal character 0-9
    // This catches negative values '-', fractions '.', or comma lists ','
    if (byte < 0x30 || byte > 0x39) {
      throw new HTTPError(
        400,
        "Bad Request: Invalid numeric character in header",
      );
    }
    // (byte - 0x30) converts the ASCII character to its numeric value
    result = result * 10 + (byte - 0x30);
    // Max safe limit safeguard to neutralize integer overflows
    // 2^53 - 1
    if (result > Number.MAX_SAFE_INTEGER) {
      throw new HTTPError(
        400,
        "Bad Request: Numeric value exceeds system capabilities",
      );
    }
  }
  return result;
};

export const parseEncoding = (fieldValue: Buffer): Buffer => {
  // chunked, gzip, compress, deflate
  let start = 0;
  let end = fieldValue.length;

  // Trim leading whitespaces (Space: 0x20, Horizontal Tab: 0x09)
  while (
    start < end &&
    (fieldValue[start] === 0x20 || fieldValue[start] === 0x09)
  ) {
    start++;
  }

  // Trim trailing whitespaces
  while (
    end > start &&
    (fieldValue[end - 1] === 0x20 || fieldValue[end - 1] === 0x09)
  ) {
    end--;
  }

  // If the buffer is empty after trimming
  if (start >= end) {
    return Buffer.alloc(0);
  }

  // Slice the trimmed portion
  const trimmedValue = fieldValue.subarray(start, end);

  // Convert uppercase ASCII [A-Z] to lowercase [a-z]
  for (let i = 0; i < trimmedValue.length; i++) {
    const byte = trimmedValue[i];
    if (byte >= 0x41 && byte <= 0x5a) {
      trimmedValue[i] = byte | 0x20; // Flip the bit to lowercase
    }
  }

  return trimmedValue;
};
