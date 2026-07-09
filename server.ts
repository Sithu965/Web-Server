import * as net from "net";

type TCPConn = {
  socket: net.Socket | null;
  reader: null | {
    resolve: (value: Buffer) => void;
    reject: (reason?: Error) => void;
  };
  end: boolean; // EOF
  error: null | Error;
};

// *** Connection Socket handling
// ******************************

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

    let buffer_flashed = true;
    if (conn.socket && buffer_flashed) {
      buffer_flashed = conn.socket.write(data, (err) => {
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
  while (true) {
    const data = await soRead(conn);
    if (data.length === 0) {
      console.log("Connection closed by client");
      break;
    }
    console.log("Received data:", data);
    const flash: boolean = await soWrite(conn, data); // Echo back the received data
    if (!flash) {
      // backpressure / control flow
      conn.socket!.pause();
    }
  }
};

// *** Listening socket handling
// ******************************

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

const handleAcceptConn = (listener: TCPListener): void => {
  listener.server.on("connection", (socket: net.Socket) => {
    const conn: TCPConn = soInit(socket);
    listener.accepter?.resolve(conn);
    listener.accepter = null;
  });
};

const connectionLoops = async (listener: TCPListener) => {
  const solistener = listener;
  handleAcceptConn(solistener);
  while (true) {
    const conn = await soAccept(solistener);
    await newConnection(conn);
  }
};

// *** Server initialization
// ******************************
const listener = soListen();
connectionLoops(listener);
listener.server.listen({ host: "127.0.0.1", port: 1234 });
