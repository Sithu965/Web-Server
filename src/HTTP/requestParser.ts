import { HTTPError } from "../ErrorHandler/httperror.ts";
import { HttpValidationError } from "../ErrorHandler/validationerror.ts";
import type { HTTPReq, FirstReqLine, DynBuf } from "./type.ts";
import {
  validateFirstLine,
  validateHeaders,
} from "../Validation/requestMsg.ts";
import {
  MAX_HEADER_COUNT,
  MAX_CHUNK_SIZE,
  HTTP_STATUS_PHRASES,
  kMaxHeaderLen,
} from "../Utils/staticValue.ts";

export const splitLines = (buf: Buffer): Buffer[] => {
  const lines: Buffer[] = [];
  let start = 0;
  // Stop 1 byte early because we look ahead to i + 1 but \n | LF MUST be the last byte of the buffer.
  // So check till \r | CR and look ahead to \n | LF
  const CR = 0x0d; // '\r'
  const LF = 0x0a; // '\n'
  for (let i = 0; i < buf.length - 1; i++) {
    // Detect CRLF
    if (buf[i] === CR && buf[i + 1] === LF) {
      if (start !== i) {
        lines.push(buf.subarray(start, i)); // Push without CR
      } else {
        // If start === i, it's an empty line (\r\n\r\n) marking the end of headers.
        // So, update the start to check, if there is any left, then break
        start = i + 2;
        break;
      }
      // start without LF
      start = i + 2;
      i++; // Skip the LF since we already know it's there
    }
  }
  // Found unfinished headers after empty line - Need To Make Desicion -> [Remain or Remove or Error]
  if (start < buf.length) {
    // Giving Error is a good idea here, but for now we will just return the remaining data as a line.
    // since there is no Error Handling for this in the current implementation.
    lines.push(buf.subarray(start)); // Currently [Remain]
  }
  return lines; // without CRLF
};

export const fieldGet = (headers: Buffer[], name: string): null | Buffer => {
  // Convert FieldName to lowercase to perform comparison
  const lowerName = name.toLowerCase();
  const nameLen = lowerName.length;

  for (let i = 0; i < headers.length; i++) {
    const field = headers[i];
    // Safety bounds check
    if (field.length <= nameLen) continue;
    let match = true;

    for (let j = 0; j < nameLen; j++) {
      let byte = field[j];
      // Convert uppercase ASCII [A-Z] to lowercase [a-z]
      // the only difference between an uppercase letter and its lowercase counterpart is the 6th bit
      // which is 32 or 0x20
      if (byte >= 0x41 && byte <= 0x5a) {
        // perform bitwise operation OR
        byte |= 0x20;
      }

      if (byte !== lowerName.charCodeAt(j)) {
        match = false;
        break;
      }
    }

    // Ensure the character following the name is the colon ':'
    if (match && field[nameLen] === 0x3a) {
      // If it is , return the raw value view behind the ':' without copying memory
      return field.subarray(nameLen + 1);
    }
  }
  // No match found
  return null;
};

export const parseRequestLine = (line: Buffer): FirstReqLine => {
  const SPACE = 0x20; // ' '
  const TAB = 0x09; // '\t'
  const space1 = line.indexOf(SPACE);
  const space2 = line.indexOf(SPACE, space1 + 1);
  // If the format is invalid, return empty or handle error

  // The request line must not contain tabs, and must not start or end with a space.
  if (
    line.indexOf(TAB) !== -1 ||
    line[0] === SPACE ||
    line[line.length - 1] === SPACE
  ) {
    throw new HttpValidationError(
      "Invalid format: Tab characters or outer padding spaces found",
    );
  }

  const invalidFormat =
    space1 <= 0 ||
    space2 <= space1 + 1 ||
    line.indexOf(SPACE, space2 + 1) !== -1;
  if (invalidFormat) {
    throw new HttpValidationError("Invalid format");
  }
  const method: string = line.subarray(0, space1).toString(); // "GET"
  const uri = line.subarray(space1 + 1, space2);
  const version = line.subarray(space2 + 1).toString();

  return [method, uri, version];
};

// Parse the Req Message and Return HTTPReq
export const parseHTTPReq = (reqHeader: Buffer): HTTPReq => {
  const lines: Buffer[] = splitLines(reqHeader);
  const [method, uri, version] = parseRequestLine(lines[0]);
  const validateLine: boolean = validateFirstLine(method, uri, version);
  if (!validateLine) {
    throw new HTTPError(400, "bad field");
  }
  const headers: Buffer[] = [];
  let hostCount = 0;
  for (let i = 1; i < lines.length; i++) {
    const h = Buffer.from(lines[i]); // Copy from Original Buffer Cuz of POP(My thought on this)
    if (!validateHeaders(h)) {
      throw new HTTPError(400, "bad field");
    }
    // Lookahead check for Host header duplicate validation
    // Lowercase match for case-insensitivity comparison
    const lowerLine = lines[i].toString().toLowerCase();
    if (lowerLine.startsWith("host:")) {
      hostCount++;
      if (hostCount > 1) {
        throw new HTTPError(400, "Bad Request: Duplicate Host Headers");
      }
    }
    headers.push(h);
  }
  // Final Global HTTP/1.1 Validation Requirement
  if (hostCount === 0) {
    throw new HTTPError(400, "Bad Request: Missing Mandatory Host Header");
  }
  if (headers.length >= MAX_HEADER_COUNT) {
    throw new HTTPError(431, "Request Header Fields Too Large");
  }
  return { method, uri, version: version.split("/")[1], headers };
};

export const getChunkSize = (line: Buffer): number => {
  const hexStr = line.toString("ascii");
  if (hexStr.length > 8) {
    throw new Error("400 Bad Request: Chunk size hex string too long");
  }
  // remove chunk-ext
  const stdHex = hexStr.split(";")[0].trim();
  if (!/^[0-9A-Fa-f]+$/.test(stdHex)) {
    throw new Error("400 Bad Request: Invalid chunk size format");
  }
  const size = parseInt(stdHex, 16);
  if (isNaN(size) || size < 0) {
    throw new Error("400 Bad Request: Invalid chunk size format");
  }
  if (size > MAX_CHUNK_SIZE) {
    throw new Error(
      "413 Payload Too Large: Chunk size exceeds server maximum limit",
    );
  }
  return size;
};

export const getStatusText = (code: number): string => {
  if (code < 100 || code > 599) {
    throw new Error("Invalid HTTP status code");
  }
  // Check if we have the exact text for this specific code
  if (HTTP_STATUS_PHRASES[code]) {
    return HTTP_STATUS_PHRASES[code];
  }
  // Fallback to generic class name if someone uses an unassigned code
  if (code >= 100 && code <= 199) return "Informational";
  if (code >= 200 && code <= 299) return "Success";
  if (code >= 300 && code <= 399) return "Redirection";
  if (code >= 400 && code <= 499) return "Client Error";
  return "Server Error";
};

// Dynamics Buffer Stroage

// *** Parsing the sended message
// the end of the header is marked by '\r\n\r\n'
export const cutMessage = (buf: DynBuf): null | HTTPReq => {
  // get the reference of buf and find the index of header end / from the start to data end
  const idx = buf.data.subarray(0, buf.length).indexOf("\r\n\r\n");
  if (idx < 0) {
    // Not found a complete header in the buffer but already reached the maximum header length
    if (buf.length >= kMaxHeaderLen) {
      throw new HTTPError(413, "header is too large");
    }
    return null; // Not a complete header
  }

  const end = idx + 4; // the end of the header is marked by '\r\n\r\n'

  const msg = Buffer.from(buf.data.subarray(0, end));
  if (msg.length >= kMaxHeaderLen) {
    throw new HTTPError(413, "header is too large");
  }
  const reqHeader = parseHTTPReq(msg); // parse the header
  bufPop(buf, end); // remove the header from the buffer
  return reqHeader;
};

export const bufPop = (buf: DynBuf, length: number): void => {
  buf.data.copyWithin(0, length, buf.length);
  buf.length -= length;
};

// Adding data to buffer
export const bufPush = (buf: DynBuf, data: Buffer): void => {
  const newLength = buf.length + data.length;
  if (newLength > buf.data.length) {
    // increase the size of the buffer
    let cap = Math.max(buf.data.length, 32);
    while (newLength > cap) {
      cap *= 2;
    }
    const newBuf = Buffer.alloc(cap);
    buf.data.copy(newBuf, 0, 0, buf.length);
    buf.data = newBuf;
  }
  data.copy(buf.data, buf.length, 0, data.length);
  buf.length = newLength;
};
