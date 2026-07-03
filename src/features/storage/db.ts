import Database from "@tauri-apps/plugin-sql";

export const LOCAL_DATABASE_URL = "sqlite:kunochat.db";

export type TransferHistoryItem = {
  id: string;
  name: string;
  size: number;
  direction: "in" | "out";
  peerName: string;
  timestamp: number;
  status: string;
  savePath?: string;
  isFolder?: boolean;
};

const hasTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let dbPromise: Promise<Database> | null = null;
let dbQueue: Promise<void> = Promise.resolve();

async function getDb(): Promise<Database | null> {
  if (!hasTauri) {
    return null;
  }
  if (!dbPromise) {
    dbPromise = Database.load(LOCAL_DATABASE_URL).then(async (db) => {
      await db.execute(`
        CREATE TABLE IF NOT EXISTS transfers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          size INTEGER NOT NULL,
          direction TEXT NOT NULL,
          peer_name TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          status TEXT NOT NULL,
          save_path TEXT,
          is_folder INTEGER DEFAULT 0
        )
      `);
      return db;
    });
  }
  return dbPromise;
}

export const dbService = {
  async logTransfer(item: Omit<TransferHistoryItem, "timestamp">) {
    dbQueue = dbQueue.then(async () => {
      const db = await getDb();
      if (!db) return;
      const timestamp = Date.now();
      await db.execute(
        `INSERT OR REPLACE INTO transfers (id, name, size, direction, peer_name, timestamp, status, save_path, is_folder)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          item.id,
          item.name,
          item.size,
          item.direction,
          item.peerName,
          timestamp,
          item.status,
          item.savePath || null,
          item.isFolder ? 1 : 0
        ]
      );
    }).catch((err) => {
      console.error("Database logTransfer failed:", err);
    });
    try {
      await dbQueue;
    } catch (err) {
      console.error("Database logTransfer failed:", err);
    }
  },

  async getTransfersHistory(): Promise<TransferHistoryItem[]> {
    try {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select<any[]>("SELECT * FROM transfers ORDER BY timestamp DESC");
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        direction: row.direction,
        peerName: row.peer_name,
        timestamp: row.timestamp,
        status: row.status,
        savePath: row.save_path || undefined,
        isFolder: row.is_folder === 1
      }));
    } catch (err) {
      console.error("Database getTransfersHistory failed:", err);
      return [];
    }
  },

  async clearTransfersHistory() {
    try {
      const db = await getDb();
      if (!db) return;
      await db.execute("DELETE FROM transfers");
    } catch (err) {
      console.error("Database clearTransfersHistory failed:", err);
    }
  }
};
