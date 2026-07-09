"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const net = __importStar(require("net"));
// *** Connection Socket handling
// ******************************
const newConnection = async (conn) => {
    console.log("New connection established:", conn.socket?.remoteAddress, ":", conn.socket?.remotePort);
    try {
        await serveClient(conn);
    }
    catch (e) {
        console.log("Exception", e);
        // instead of all catch error, will use proper error handling later
    }
    finally {
        conn.socket?.destroy(); // use destroy cuz of allowHalfOpen: true, to close the socket immediately
    }
};
const soInit = (socket) => {
    const conn = {
        socket,
        reader: null,
        end: false,
        error: null,
    };
    conn.socket?.on("data", (data) => {
        conn.socket?.pause();
        conn.reader.resolve(data);
        conn.reader = null;
    });
    conn.socket?.on("end", () => {
        conn.end = true;
        if (conn.reader) {
            conn.reader.resolve(Buffer.from("")); // EOF
            conn.reader = null;
        }
    });
    conn.socket?.on("error", (err) => {
        conn.error = err;
        if (conn.reader) {
            conn.reader.reject(err);
            conn.reader = null;
        }
    });
    return conn;
};
const soRead = (conn) => {
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
const soWrite = (conn, data) => {
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
                }
                else {
                    resolve();
                }
            });
        }
    });
};
const serveClient = async (conn) => {
    while (true) {
        const data = await soRead(conn);
        if (data.length === 0) {
            console.log("Connection closed by client");
            break;
        }
        console.log("Received data:", data);
        await soWrite(conn, data); // Echo back the received data
    }
};
const soListen = () => {
    const server = net.createServer({
        pauseOnConnect: true,
        allowHalfOpen: true,
    });
    const listener = {
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
        server.on("error", (err) => {
            listener.error = err;
        });
    });
    return listener;
};
const soAccept = (listener) => {
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
const handleAcceptConn = (listener) => {
    listener.server.on("connection", (socket) => {
        const conn = soInit(socket);
        listener.accepter?.resolve(conn);
        listener.accepter = null;
    });
};
const connectionLoops = async (listener) => {
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
//# sourceMappingURL=server.js.map