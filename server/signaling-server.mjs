import { WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? process.env.SIGNALING_PORT ?? 8787);
const rooms = new Map();

const server = new WebSocketServer({ port });

server.on("connection", (socket) => {
  socket.peerId = "";
  socket.roomId = "";
  socket.displayName = "Peer";
  socket.isAlive = true;

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      send(socket, { type: "error", message: "Invalid JSON." });
      return;
    }

    if (message.type === "join") {
      joinRoom(socket, message);
      return;
    }

    if (!socket.roomId || !socket.peerId) {
      send(socket, { type: "error", message: "Join a room before signaling." });
      return;
    }

    if (["offer", "answer", "ice"].includes(message.type)) {
      broadcast(socket.roomId, socket, {
        type: message.type,
        from: socket.peerId,
        payload: message.payload
      });
    }
  });

  socket.on("close", () => {
    leaveRoom(socket);
  });
});

const heartbeat = setInterval(() => {
  for (const socket of server.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, 15000);

server.on("close", () => {
  clearInterval(heartbeat);
});

console.log(`KunoChat signaling server listening on ws://localhost:${port}`);

function joinRoom(socket, message) {
  const roomId = normalizeRoomId(message.roomId);
  const peerId = String(message.peerId ?? "");
  const displayName = String(message.displayName ?? "Peer").slice(0, 80);

  if (!roomId || !peerId) {
    send(socket, { type: "error", message: "roomId and peerId are required." });
    return;
  }

  let room = rooms.get(roomId);
  if (!room) {
    room = new Map();
    rooms.set(roomId, room);
  }

  if (!room.has(peerId) && room.size >= 2) {
    send(socket, { type: "error", message: "This KunoChat room already has two peers." });
    socket.close(1008, "room full");
    return;
  }

  socket.roomId = roomId;
  socket.peerId = peerId;
  socket.displayName = displayName;

  const existingPeers = Array.from(room.values()).map(peerSummary);
  room.set(peerId, socket);

  send(socket, { type: "peers", peers: existingPeers });
  broadcast(roomId, socket, {
    type: "peer-joined",
    peer: peerSummary(socket)
  });
}

function leaveRoom(socket) {
  if (!socket.roomId || !socket.peerId) {
    return;
  }

  const room = rooms.get(socket.roomId);
  if (!room) {
    return;
  }

  room.delete(socket.peerId);
  broadcast(socket.roomId, socket, {
    type: "peer-left",
    peerId: socket.peerId
  });

  if (room.size === 0) {
    rooms.delete(socket.roomId);
  }
}

function broadcast(roomId, sender, message) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  for (const peer of room.values()) {
    if (peer !== sender && peer.readyState === peer.OPEN) {
      send(peer, message);
    }
  }
}

function send(socket, message) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function normalizeRoomId(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 6);
}

function peerSummary(socket) {
  return {
    peerId: socket.peerId,
    displayName: socket.displayName
  };
}
