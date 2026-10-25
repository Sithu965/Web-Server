// Control characters used in HTTP parsing
// prettier-ignore
export const CONTROL_CHARS: Record<string, number> = {
  SPACE: 0x20, CR: 0x0d, LF: 0x0a, COLON: 0x3a,
};

// Pre-computed lookup table for HTTP status codes and their reason phrases
export const HTTP_STATUS_PHRASES: Record<number, string> = {
  // 1xx: Informational
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",

  // 2xx: Success
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",

  // 3xx: Redirection
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",

  // 4xx: Client Error
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Payload Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Exposition Failed",
  418: "I'm a teapot",
  421: "Misdirected Request",
  422: "Unprocessable Entity",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",

  // 5xx: Server Error
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
};

// Pre-computed lookup table for RFC 9110 Token characters (1 = allowed, 0 = forbidden)
// prettier-ignore
export const TOKEN_CHARS = new Uint8Array([
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0, // 0-15
    0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0, // 16-31
    0,1,0,1,1,1,1,1,0,0,1,1,0,1,1,0, // 32-47   (Space to /) -> Allows !, #, \$, %, &, ', *, +, -, .
    1,1,1,1,1,1,1,1,1,1,0,0,0,0,0,0, // 48-63   (0 to ?)     -> Allows 0-9
    0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1, // 64-79   (@ to O)     -> Allows A-O
    1,1,1,1,1,1,1,1,1,1,1,0,0,0,1,1, // 80-95   (P to _)     -> Allows P-Z, ^, _
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1, // 96-111  (` to o)     -> Allows `, a-o
    1,1,1,1,1,1,1,1,1,1,1,0,1,0,1,0, // 112-127 (p to DEL)   -> Allows p-z, |, ~
    // 128 to 255 are automatically initialized to 0
]);

// Calculate TOKEN_CHARS
// const initTokenChars = (): Uint8Array<ArrayBuffer> => {
//   const TOKEN_CHARS = new Uint8Array(256);
//   const allowed =
//     "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'*+-.^_`|~";
//   for (let i = 0; i < allowed.length; i++) {
//     TOKEN_CHARS[allowed.charCodeAt(i)] = 1;
//   }
//   return TOKEN_CHARS;
// };
// console.log(initTokenChars());
