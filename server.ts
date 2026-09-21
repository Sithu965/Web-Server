import * as net from "net";

// HTTP Request Header
type HTTPReq = {
  // first line of Req Header [GET /echo HTTP/1.1]
  method: string; // Get, Post
  uri: Buffer; // left as bytes until parse needed [Host]
  version: string; // HTTP1, HTTP1.1, HTTP2
  headers: Buffer[]; // Remaining headers e.g. HOST, User-Agent, Accept, Accept-Language, Accept-Encoding, Referer, Connection, etc...
};

// HTTP Body Reader
type BodyReader = {
  length: number;
  read: () => Promise<Buffer>;
};

// HTTP Response
type HTTPRes = {
  // first line of Res Header [200 Ok]
  code: number; // 200, 401
  headers: Buffer[]; // Remaining headers
  body: BodyReader;
};

// Dynamics Buffer Stroage
type DynBuf = {
  data: Buffer; // Buffer that store data
  length: number; // length of existing data
};

// Adding data to buffer
const bufPush = (buf: DynBuf, data: Buffer): void => {
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

// Removing data from buffer
const bufPop = (buf: DynBuf, length: number): void => {
  buf.data.copyWithin(0, length, buf.length);
  buf.length -= length;
};

// Parsing the sended message
// Example - buf.data = "helloo\nworld\neveryone\ngood" buf.length = 26(total msg len) buf.data.length = 32 (total buf len)
// start = [0, 7, 13, 22]
// end = [6, 12, 21, -1]
const cutMessage = (buf: DynBuf, start: number, end: number): null | Buffer => {
  const threshold = 0.5;
  const bufLen = buf.data.length; // 32
  if (end < 0) {
    return null; // Not a complete message
  }
  // ["helloo\n", ]
  const msg = Buffer.from(buf.data.subarray(start, end + 1));
  if (end / bufLen > threshold) {
    bufPop(buf, end + 1);
  }
  return msg;
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
    // instead of all catch error, will use proper error handling later
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
      const buffer_flashed = conn.socket.write(data, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(buffer_flashed);
        }
      });
    }
  });
};

const serveClient = async (conn: TCPConn): Promise<void> => {
  const buf: DynBuf = { data: Buffer.alloc(0), length: 0 };
  // Example - helloo\nworld\neveryone\ngood
  let startIdx = 0; // [0, 7, 13, 22]
  let endIdx = buf.data.subarray(0, buf.length).indexOf("\n"); // [6, 12, 21, -1]
  while (true) {
    // Search for a complete message in the buffer
    const msg: null | Buffer = cutMessage(buf, startIdx, endIdx);
    // Cut done - Increase Indexes { Start from sec cut }
    if (endIdx >= 0) {
      startIdx = endIdx + 1; // [7, 13, 22]
      const idx = buf.data.subarray(startIdx, buf.length).indexOf("\n"); // [5, 8, -1]
      if (idx === -1) {
        endIdx = -1;
      } else {
        endIdx = startIdx + idx; // [12, 21, -1]
      }
    }

    // When => Not found a complete message in the buffer
    if (!msg) {
      // Read more data from the connection
      const data: Buffer = await soRead(conn);
      // Push the received data to the buffer
      bufPush(buf, data);
      // No data received
      if (data.length === 0 && buf.length === 0) {
        console.log("Connection closed by client");
        return;
      }
      continue;
    }
    if (msg.equals(Buffer.from("quit"))) {
      console.log("Bye");
      await soWrite(conn, Buffer.from("Bye!\n"));
      conn.socket?.destroy();
      return;
    } else {
      // Echo the receive message back to sender
      console.log("Echo: ", msg);
      const reply = Buffer.concat([Buffer.from("Echo: "), msg]);
      const flash: boolean = await soWrite(conn, reply); // Echo back the received data
      if (!flash) {
        // backpressure
        conn.socket!.pause();
      }
    }
  }
};

// *** Listening socket handling
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
    allowHalfOpen: true,
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
