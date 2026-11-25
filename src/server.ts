import * as net from "net";
import { HTTPError } from "./ErrorHandler/httperror.ts";
import type { HTTPReq, DynBuf } from "./HTTP/type.ts";
import { parseDec, parseEncoding } from "./Validation/requestMsg.ts";
import { MAX_CHUNK_LINE_LEN, BUFFER_SIZE } from "./Utils/staticValue.ts";
import {
  fieldGet,
  getChunkSize,
  getStatusText,
  bufPop,
  cutMessage,
  bufPush,
} from "./HTTP/requestParser.ts";
import * as fs from "fs/promises";

// *** No Error Handling Yet ***
// ******************************************

// HTTP Body Reader
type BodyReader = {
  length: number;
  read: () => Promise<Buffer>;
};

// Read the Body from the Req Message
const readerFromReq = (
  conn: TCPConn,
  buf: DynBuf,
  req: HTTPReq,
): BodyReader => {
  let bodyLen = -1;
  const contentLen = fieldGet(req.headers, "Content-Length");
  if (contentLen) {
    bodyLen = parseDec(contentLen.toString("latin1"));
    if (isNaN(bodyLen) || bodyLen < 0) {
      throw new HTTPError(400, "Invalid Content-Length");
    }
  }
  const bodyAllowed = !(req.method === "GET" || req.method === "HEAD");
  let chunked = false;
  const encoding = fieldGet(req.headers, "Transfer-Encoding");
  if (encoding) {
    chunked = parseEncoding(encoding).equals(Buffer.from("chunked"));
  }
  if (!bodyAllowed && (bodyLen > 0 || chunked)) {
    throw new HTTPError(400, "Body not allowed");
  }
  if (!bodyAllowed) {
    // Since body is not allowed, length is not less than 0 , change the length to 0 to avoid reading any body data.
    bodyLen = 0;
  }
  if (contentLen && chunked) {
    throw new HTTPError(
      400,
      "Cannot have both Content-Length and Transfer-Encoding",
    );
  }
  if (bodyLen >= 0) {
    // "Content-Length" is present
    return readerFromConnLength(conn, buf, bodyLen);
  } else if (chunked) {
    // Chunked Encoding
    return readerFromGenerator(readChunks(conn, buf));
  } else {
    // No Content-Length or Chunked Encoding (HTTP/1.0)
    return readerFromConnEOF(conn, buf);
  }
};

// Read the Body from Memory
const readerFromMemory = (memory: Buffer): BodyReader => {
  let done = false;
  return {
    length: memory.length,
    read: async (): Promise<Buffer> => {
      if (done) {
        return Buffer.from("");
      } else {
        done = true;
        return memory;
      }
    },
  };
};

// This function is for compatibility with HTTP/1.0 clients.
const readerFromConnEOF = (conn: TCPConn, buf: DynBuf): BodyReader => {
  return {
    length: -1,
    read: async (): Promise<Buffer> => {
      // No data
      if (buf.length === 0) {
        // get data
        const data: Buffer = await soRead(conn);
        // store data
        bufPush(buf, data);
        // No data get(EOF)
        if (data.length === 0) {
          return Buffer.from("");
        }
      }
      const data = Buffer.from(buf.data.subarray(0, buf.length));
      bufPop(buf, data.length);
      return data;
    },
  };
};

const readerFromConnLength = (
  conn: TCPConn,
  buf: DynBuf,
  remain: number,
): BodyReader => {
  return {
    length: remain,
    read: async (): Promise<Buffer> => {
      if (remain === 0) {
        return Buffer.from(""); // EOF
      }
      // No data in the buffer
      if (buf.length === 0) {
        // Read more data from the connection
        const data: Buffer = await soRead(conn);
        bufPush(buf, data);
        if (data.length === 0) {
          throw new Error("Unexpected EOF from HTTP body");
        }
      }
      const consume = Math.min(remain, buf.length);
      remain -= consume;
      // Simulate reading from the buffer
      const data = Buffer.from(buf.data.subarray(0, consume));
      bufPop(buf, data.length);
      return data;
    },
  };
};

// Create a BodyReader from an AsyncGenerator
function readerFromGenerator(gen: BufferGenerator): BodyReader {
  return {
    length: -1,
    read: async (): Promise<Buffer> => {
      const r = await gen.next();
      if (r.done) {
        return Buffer.from(""); // EOF
      } else {
        console.assert(r.value.length > 0);
        // if (r.value.length === 0) {
        //   throw new Error("Body generator yielded an empty buffer");
        // }
        return r.value;
      }
    },
  };
}

// JS Generators As Producers
type BufferGenerator = AsyncGenerator<Buffer, void, void>;

// Generator function to count sheep and yield the count every second
async function* countSheep(): BufferGenerator {
  for (let i = 0; i < 100; i++) {
    // sleep 1s, then output the counter
    await new Promise((resolve) => setTimeout(resolve, 1000));
    yield Buffer.from(`${i}\n`);
  }
}

const bufExpectMore = async (
  conn: TCPConn,
  buf: DynBuf,
  context: string,
): Promise<void> => {
  const data: Buffer = await soRead(conn);
  if (data.length === 0) {
    throw new Error(`Unexpected EOF while reading ${context}`);
  }
  bufPush(buf, data);
};

// Consumer(Usually this will not be used directly, but it can be used for testing or debugging purposes)
// decode the chunked encoding and yield the data on the fly
async function* readChunks(conn: TCPConn, buf: DynBuf): BufferGenerator {
  for (let last = false; !last; ) {
    // read the chunk-size line
    const idx = buf.data.subarray(0, buf.length).indexOf("\r\n");
    if (idx < 0) {
      if (buf.length > MAX_CHUNK_LINE_LEN) {
        throw new Error("400 Bad Request: Chunk size line too long");
      }
      // need more data,
      await bufExpectMore(conn, buf, "chunk size line");
      continue;
    }
    // parse the chunk-size and remove the line
    let remain = getChunkSize(buf.data.subarray(0, idx));
    bufPop(buf, idx + 2);
    // is it the last one?
    last = remain === 0;
    // read and yield the chunk data
    while (remain > 0) {
      if (buf.length === 0) {
        await bufExpectMore(conn, buf, "chunk data");
      }
      const consume = Math.min(remain, buf.length);
      // Do not mutate original buffer, create a new buffer to yield
      const data = Buffer.from(buf.data.subarray(0, consume));
      bufPop(buf, consume);
      remain -= consume;
      yield data;
    }
    // the chunk data is followed by CRLF
    if (buf.length < 2) {
      await bufExpectMore(conn, buf, "chunk data CRLF");
    }
    if (buf.data[0] !== 0x0d || buf.data[1] !== 0x0a) {
      throw new Error("400 Bad Request: Missing CRLF after chunk data");
    }
    bufPop(buf, 2);
  } // for each chunk
}

// HTTP Response
type HTTPRes = {
  // first line of Res Header [200 Ok]
  code: number; // 200, 401
  headers: Buffer[]; // Remaining headers
  body: BodyReader;
};

// Handle the Req and Return Res
// Echo response for /echo and a default response for other URIs(Not Finished)
const handleReq = async (
  header: HTTPReq,
  body: BodyReader,
): Promise<HTTPRes> => {
  let resp: BodyReader;
  switch (header.uri.toString("latin1")) {
    case "/echo":
      resp = body;
      break;
    case "/sheep":
      resp = readerFromGenerator(countSheep());
      break;
    default:
      resp = readerFromMemory(Buffer.from("HTTP Server Speaking.\n"));
      break;
  }

  return {
    code: 200,
    headers: [Buffer.from("Server: my_first_http_server")],
    body: resp,
  };
};

const encodeHTTPResp = (resp: HTTPRes): Buffer => {
  // write the header
  const sl = `HTTP/1.1 ${resp.code} ${getStatusText(resp.code)}\r\n`;
  const statusLine = Buffer.from(sl, "latin1");
  const crlf = Buffer.from("\r\n", "latin1");
  // Build an array of buffers to hold the complete raw sequence
  const respHeaders: Buffer[] = [statusLine];

  // Loop through your raw header buffers and put CRLF between them
  for (const headerBuffer of resp.headers) {
    respHeaders.push(headerBuffer);
    respHeaders.push(crlf);
  }

  // Add the final mandatory blank line CRLF that indicates the end of header block
  respHeaders.push(crlf);

  // Concatenate everything directly into a single Buffer
  return Buffer.concat(respHeaders);
};

const writeHTTPResp = async (conn: TCPConn, resp: HTTPRes): Promise<void> => {
  if (resp.body.length < 0) {
    // Transfer-Encoding Header
    resp.headers.push(Buffer.from(`Transfer-Encoding: chunked`));
  } else {
    // Content-Length Header
    resp.headers.push(Buffer.from(`Content-Length: ${resp.body.length}`));
  }

  const writer = createBufferedWriter(conn);

  // write the Response Header into BufferedWriter
  await writer.write(encodeHTTPResp(resp));

  // write the Response Body into BufferedWriter
  const crlf = Buffer.from("\r\n", "latin1");
  for (let last = false; !last; ) {
    let data = await resp.body.read();
    last = data.length === 0;
    // Transfer-Encoding: chunked
    if (resp.body.length < 0) {
      data = Buffer.concat([
        Buffer.from(data.length.toString(16)),
        crlf,
        data,
        crlf,
      ]);
    }
    if (data.length) await writer.write(data);
  }
  // flush the BufferedWriter to ensure all data is sent
  await writer.flush();
};

//*** Write Buffer Stroage Quene(Same with GO's write and flush)
// *************************************************************

type BufferedWriter = {
  write: (data: Buffer) => Promise<void>;
  flush: () => Promise<void>;
};

const createBufferedWriter = (conn: TCPConn): BufferedWriter => {
  // The fixed internal memory array
  let buf = Buffer.alloc(BUFFER_SIZE);
  // An integer tracking the current position in the buffer (how much data is currently sitting inside it)
  let n = 0;
  let stickyError: Error | null = null;

  // the remaining empty space of the internal buffer
  const available = () => BUFFER_SIZE - n;
  // the internal buffer space
  const buffered = () => n;

  // A helper to pause execution if the OS kernel is saturated
  const waitForDrain = (): Promise<void> => {
    return new Promise((resolve) => {
      if (!conn.socket) return resolve();
      conn.socket.once("drain", resolve);
    });
  };

  const flush = async (): Promise<void> => {
    if (stickyError) throw stickyError;
    if (n === 0) return;

    try {
      // Slice out only the filled data: b.buf[0:b.n]
      const dataChunk = buf.subarray(0, n);

      // Execute your exact immediate write function
      const bufferFlushed = await soWrite(conn, dataChunk);

      // If false, the kernel queue is full. Wait for it to drain before clearing n.
      if (!bufferFlushed) {
        await waitForDrain();
      }

      // Success clean-up: b.n = 0
      n = 0;
    } catch (err) {
      stickyError = err instanceof Error ? err : new Error(String(err));
      throw stickyError;
    }
  };

  const write = async (p: Buffer): Promise<void> => {
    let remainBytes = p;

    // Loop handling overflows: for len(p) > b.Available()
    while (remainBytes.length > available() && !stickyError) {
      if (buffered() === 0) {
        // Massive write, empty buffer. Bypass buffer to save CPU/memory copies
        try {
          const bufferFlushed = await soWrite(conn, remainBytes);
          if (!bufferFlushed) {
            await waitForDrain();
          }
          remainBytes = Buffer.alloc(0);
        } catch (err) {
          stickyError = err instanceof Error ? err : new Error(String(err));
          throw stickyError;
        }
      } else {
        // Buffer partially full. Fill it up and flush it.
        const spaceLeft = available();
        remainBytes.copy(buf, n, 0, spaceLeft);
        n += spaceLeft;

        remainBytes = remainBytes.subarray(spaceLeft);
        await flush();
      }
    }

    if (stickyError) throw stickyError;

    // Storing the rest which are not overflow . Remaining data fits cleanly within the buffer bounds.
    if (remainBytes.length > 0) {
      remainBytes.copy(buf, n);
      n += remainBytes.length;
    }
  };

  return { write, flush };
};

// *** Connection Socket handling
// ******************************

// TCP Connection
type TCPConn = {
  socket: net.Socket | null;
  reader: null | {
    resolve: (value: Buffer) => void;
    reject: (reason?: Error) => void;
  };
  end: boolean; // EOF
  error: null | Error;
};

const newConnection = async (conn: TCPConn): Promise<void> => {
  console.log(
    "New connection established:",
    conn.socket?.remoteAddress,
    ":",
    conn.socket?.remotePort,
  );
  try {
    await serveClient(conn);
  } catch (e) {
    console.log("Exception", e);
    // HTTP Error Handling : Note -  Don't throw error like this in production code.
    if (e instanceof HTTPError) {
      // intended to send an error response
      const res: HTTPRes = {
        code: e.statusCode,
        headers: [],
        body: readerFromMemory(Buffer.from(e.message + "\n")),
      };
      try {
        await writeHTTPResp(conn, res);
      } catch (e) {
        throw new Error("Failed to send error response: " + e);
      }
    }
  } finally {
    conn.socket?.destroy(); // use destroy cuz of allowHalfOpen: true, to close the socket immediately
  }
};

const soInit = (socket: net.Socket): TCPConn => {
  const conn: TCPConn = {
    socket,
    reader: null,
    end: false,
    error: null,
  };

  conn.socket?.on("data", (data: Buffer) => {
    conn.socket?.pause();
    conn.reader!.resolve(data);
    conn.reader = null;
  });
  conn.socket?.on("end", () => {
    conn.end = true;
    if (conn.reader) {
      conn.reader.resolve(Buffer.from("")); // EOF
      conn.reader = null;
    }
  });
  conn.socket?.on("drain", () => {
    // queue clear resume reading for write
    conn.socket!.resume();
  });
  conn.socket?.on("error", (err: Error) => {
    conn.error = err;
    if (conn.reader) {
      conn.reader.reject(err);
      conn.reader = null;
    }
  });
  return conn;
};

const soRead = (conn: TCPConn): Promise<Buffer> => {
  console.assert(!conn.reader);
  return new Promise((resolve, reject) => {
    // If the connection has encoutered an error, reject the promise with the error.
    if (conn.error) {
      reject(conn.error);
      return;
    }
    // If the connection has reached EOF, resolve the promise with an empty buffer.
    if (conn.end) {
      resolve(Buffer.from("")); // EOF
      return;
    }
    // If the connection is still open, store the resolve and reject functions in the reader property of the connection object.
    conn.reader = { resolve, reject };
    // and resume the 'data' event to fulfill the promise later
    conn.socket?.resume();
  });
};

const soWrite = (conn: TCPConn, data: Buffer): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    if (conn.error) {
      reject(conn.error);
      return;
    }
    if (conn.socket) {
      const buffer_flashed = conn.socket.write(data);
      resolve(buffer_flashed);
    }
  });
};

// *** Server Loop
// ***************

const serveClient = async (conn: TCPConn): Promise<void> => {
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };

  while (true) {
    // Search for a complete message in the buffer
    const msg: null | HTTPReq = cutMessage(buf);

    // When => Not found a complete header in the buffer
    if (!msg) {
      // Read more data from the connection
      const data: Buffer = await soRead(conn);
      // Push the received data to the buffer
      bufPush(buf, data);
      // No data received || EOF
      if (data.length === 0 && buf.length === 0) {
        return; // no more requests
      }
      if (data.length === 0) {
        throw new HTTPError(400, "Unexpected EOF.");
      }
      // got some data, try it agan.
      continue;
    }

    const reqBody: BodyReader = readerFromReq(conn, buf, msg);
    const res: HTTPRes = await handleReq(msg, reqBody);
    await writeHTTPResp(conn, res);
    // close the connection for HTTP/1.0
    if (msg.version === "1.0") {
      return;
    }
    // make sure that the request body is consumed completely
    while ((await reqBody.read()).length > 0) {
      /* Drain the data By Looping */
    }
  }
};

// *** Listening Socket handling
// ******************************

// TCP Listener
type TCPListener = {
  server: net.Server;
  error: null | Error;
  accepter: null | {
    resolve: (conn: TCPConn) => void;
    reject: (reason?: Error) => void;
  };
  close: boolean;
};

const soListen = (): TCPListener => {
  const server = net.createServer({
    pauseOnConnect: true,
    // allowHalfOpen: true,
  });
  const listener: TCPListener = {
    server: server,
    error: null,
    accepter: null,
    close: false,
  };
  // attached events on the created server
  server.on("listening", () => {
    server.once("close", () => {
      listener.close = true;
      console.log("Server closed");
    });
    server.on("error", (err: Error) => {
      listener.error = err;
    });
  });
  return listener;
};

const soAccept = (listener: TCPListener): Promise<TCPConn> => {
  return new Promise((resolve, reject) => {
    if (listener.error) {
      reject(listener.error);
      return;
    }
    if (listener.close) {
      reject(new Error("Listener is closed"));
      return;
    }
    listener.accepter = { resolve, reject };
  });
};

const handleAcceptConn = async (listener: TCPListener): Promise<void> => {
  listener.server.on("connection", (socket: net.Socket) => {
    const conn: TCPConn = soInit(socket);
    listener.accepter?.resolve(conn);
    listener.accepter = null;
  });
  while (true) {
    const conn = await soAccept(listener);
    newConnection(conn);
  }
};

// *** Server initialization
// ******************************
const listener = soListen();
handleAcceptConn(listener);

const host = "0.0.0.0";
const port = 1234;

listener.server.listen({ host, port }, () => {
  console.log(`server is listening on server port ${port} host ${host}`);
});
