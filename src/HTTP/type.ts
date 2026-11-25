// HTTP Request Header
export type HTTPReq = {
  // first line of Req Header [GET /echo HTTP/1.1]
  method: string; // Get, Post
  uri: Buffer; // left as bytes until parse needed
  version: string; // HTTP/1, HTTP/1.1, HTTP/2
  headers: Buffer[]; // Remaining headers e.g. HOST, User-Agent, Accept, Accept-Language, Accept-Encoding, Referer, Connection, etc...
};

export type FirstReqLine = [
  method: string, // GET, POST, PUT, DELETE, etc.
  uri: Buffer, // The requested URI as a Buffer
  version: string, // HTTP version
];

// Dynamics Buffer Stroage
export type DynBuf = {
  data: Buffer; // Buffer that store data
  length: number; // length of existing data
};
