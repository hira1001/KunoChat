import { ChildProcess, spawn } from "node:child_process";
import { AddressInfo } from "node:net";
import net from "node:net";
import path from "node:path";
import WebSocket from "ws";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

let processHandle: ChildProcess | undefined;
let port = 0;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  port = await getFreePort();
  processHandle = spawn(process.execPath, [path.join(process.cwd(), "server/signaling-server.mjs")], {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer(processHandle);
});

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    socket.close();
  }
  processHandle?.kill();
  processHandle = undefined;
});

describe("standalone signaling server protocol", () => {
  test("first peer receives an empty peers list", async () => {
    const alice = await connectPeer("111-222", "alice", "Alice");
    expect(await nextJson(alice)).toEqual({ type: "peers", peers: [] });
  });

  test("second peer receives the first peer summary", async () => {
    const alice = await connectPeer("111222", "alice", "Alice");
    await nextJson(alice);
    const bob = await connectPeer("111222", "bob", "Bob");
    expect(await nextJson(bob)).toEqual({ type: "peers", peers: [{ peerId: "alice", displayName: "Alice" }] });
  });

  test("first peer receives peer-joined when second peer enters", async () => {
    const alice = await connectPeer("111222", "alice", "Alice");
    await nextJson(alice);
    const bob = await connectPeer("111222", "bob", "Bob");
    await nextJson(bob);
    expect(await nextJson(alice)).toEqual({ type: "peer-joined", peer: { peerId: "bob", displayName: "Bob" } });
  });

  test("offer is relayed only to the room peer", async () => {
    const [alice, bob] = await connectedPair();
    alice.send(JSON.stringify({ type: "offer", payload: { type: "offer", sdp: "sdp-offer" } }));
    expect(await nextJson(bob)).toEqual({ type: "offer", from: "alice", payload: { type: "offer", sdp: "sdp-offer" } });
  });

  test("answer is relayed only to the room peer", async () => {
    const [alice, bob] = await connectedPair();
    bob.send(JSON.stringify({ type: "answer", payload: { type: "answer", sdp: "sdp-answer" } }));
    expect(await nextJson(alice)).toEqual({ type: "answer", from: "bob", payload: { type: "answer", sdp: "sdp-answer" } });
  });

  test("ice is relayed only to the room peer", async () => {
    const [alice, bob] = await connectedPair();
    alice.send(JSON.stringify({ type: "ice", payload: { candidate: "candidate", sdpMid: "0" } }));
    expect(await nextJson(bob)).toEqual({ type: "ice", from: "alice", payload: { candidate: "candidate", sdpMid: "0" } });
  });

  test("invalid JSON returns an error", async () => {
    const socket = await openSocket();
    socket.send("{not-json");
    expect(await nextJson(socket)).toEqual({ type: "error", message: "Invalid JSON." });
  });

  test("signaling before join returns an error", async () => {
    const socket = await openSocket();
    socket.send(JSON.stringify({ type: "offer", payload: {} }));
    expect(await nextJson(socket)).toEqual({ type: "error", message: "Join a room before signaling." });
  });

  test("join requires roomId and peerId", async () => {
    const socket = await openSocket();
    socket.send(JSON.stringify({ type: "join", roomId: "", peerId: "" }));
    expect(await nextJson(socket)).toEqual({ type: "error", message: "roomId and peerId are required." });
  });

  test("third peer in same room is rejected", async () => {
    await connectedPair();
    const charlie = await connectPeer("111222", "charlie", "Charlie");
    expect(await nextJson(charlie)).toEqual({ type: "error", message: "This KunoChat room already has two peers." });
  });
});

async function connectedPair(): Promise<[WebSocket, WebSocket]> {
  const alice = await connectPeer("111222", "alice", "Alice");
  await nextJson(alice);
  const bob = await connectPeer("111222", "bob", "Bob");
  await nextJson(bob);
  await nextJson(alice);
  return [alice, bob];
}

async function connectPeer(roomId: string, peerId: string, displayName: string): Promise<WebSocket> {
  const socket = await openSocket();
  socket.send(JSON.stringify({ type: "join", roomId, peerId, displayName }));
  return socket;
}

async function openSocket(): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

async function nextJson(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for signaling message.")), 2000);
    socket.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(raw)));
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const selectedPort = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return selectedPort;
}

async function waitForServer(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for signaling server.")), 3000);
    child.stdout?.on("data", (chunk) => {
      if (String(chunk).includes("KunoChat signaling server listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Signaling server exited early with code ${code}`));
    });
  });
}
