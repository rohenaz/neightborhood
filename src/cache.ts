import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RawIncident } from "./types.ts";

// ---------------------------------------------------------------------------
// In-memory TTL cache (for geocode results within a session)
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlSeconds: number) {
    this.defaultTtlMs = defaultTtlSeconds * 1000;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds?: number): void {
    const ttlMs = ttlSeconds ? ttlSeconds * 1000 : this.defaultTtlMs;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    let count = 0;
    const now = Date.now();
    for (const [, entry] of this.store) {
      if (entry.expiresAt > now) {
        count++;
      }
    }
    return count;
  }
}

export const geocodeCache = new TTLCache<{
  lat: number;
  lng: number;
  boundingBox?: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  displayName?: string;
}>(86400); // 24 hours for geocode results

// ---------------------------------------------------------------------------
// SQLite persistent cache for incident data
// ---------------------------------------------------------------------------

const DATA_DIR = join(process.env.HOME ?? "/tmp", ".config", "neighborhood");

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

let _db: Database | null = null;

function getDb(): Database {
  if (_db) return _db;

  ensureDataDir();
  _db = new Database(join(DATA_DIR, "cache.sqlite"), { create: true });
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 3000");

  _db.run(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      date TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      url TEXT,
      severity TEXT,
      zip_code TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    )
  `);

  _db.run(`
    CREATE INDEX IF NOT EXISTS idx_incidents_zip ON incidents (zip_code)
  `);
  _db.run(`
    CREATE INDEX IF NOT EXISTS idx_incidents_source ON incidents (source)
  `);
  _db.run(`
    CREATE INDEX IF NOT EXISTS idx_incidents_date ON incidents (date)
  `);

  return _db;
}

/**
 * Store incidents in the persistent cache, keyed by their unique ID.
 * Upserts — newer fetches overwrite older ones.
 */
export function cacheIncidents(
  zipCode: string,
  incidents: RawIncident[]
): void {
  if (incidents.length === 0) return;

  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO incidents
      (id, source, type, description, date, address, lat, lng, url, severity, zip_code, fetched_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const inc of incidents) {
      stmt.run(
        inc.id,
        inc.source,
        inc.type,
        inc.description,
        inc.date,
        inc.address,
        inc.lat,
        inc.lng,
        inc.url ?? null,
        inc.severity ?? null,
        zipCode,
        now
      );
    }
  });

  tx();
}

/**
 * Retrieve cached incidents for a zip code, optionally filtered by source
 * and date range. Returns incidents sorted by date descending.
 */
export function getCachedIncidents(opts: {
  zipCode: string;
  days?: number;
  sources?: string[];
}): RawIncident[] {
  const db = getDb();
  const { zipCode, days = 365, sources } = opts;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString();

  let sql = `SELECT * FROM incidents WHERE zip_code = ? AND date >= ?`;
  const params: (string | number)[] = [zipCode, cutoffIso];

  if (sources && sources.length > 0) {
    const placeholders = sources.map(() => "?").join(",");
    sql += ` AND source IN (${placeholders})`;
    params.push(...sources);
  }

  sql += " ORDER BY date DESC LIMIT 500";

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string;
    source: string;
    type: string;
    description: string;
    date: string;
    address: string;
    lat: number;
    lng: number;
    url: string | null;
    severity: string | null;
  }>;

  return rows.map((r) => ({
    id: r.id,
    source: r.source as RawIncident["source"],
    type: r.type,
    description: r.description,
    date: r.date,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    url: r.url ?? undefined,
    severity: (r.severity as RawIncident["severity"]) ?? undefined,
  }));
}

/**
 * Check how many cached incidents exist for a zip code.
 */
export function getCacheStats(zipCode: string): {
  total: number;
  bySource: Record<string, number>;
  oldestDate: string | null;
  newestDate: string | null;
} {
  const db = getDb();

  const total = (
    db
      .prepare("SELECT COUNT(*) as count FROM incidents WHERE zip_code = ?")
      .get(zipCode) as { count: number }
  ).count;

  const bySource: Record<string, number> = {};
  const sourceRows = db
    .prepare(
      "SELECT source, COUNT(*) as count FROM incidents WHERE zip_code = ? GROUP BY source"
    )
    .all(zipCode) as Array<{ source: string; count: number }>;
  for (const row of sourceRows) {
    bySource[row.source] = row.count;
  }

  const dateRange = db
    .prepare(
      "SELECT MIN(date) as oldest, MAX(date) as newest FROM incidents WHERE zip_code = ?"
    )
    .get(zipCode) as { oldest: string | null; newest: string | null };

  return {
    total,
    bySource,
    oldestDate: dateRange.oldest,
    newestDate: dateRange.newest,
  };
}

/**
 * Prune incidents older than maxDays from the cache.
 */
export function pruneCache(maxDays: number = 365): number {
  const db = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxDays);

  const result = db
    .prepare("DELETE FROM incidents WHERE date < ?")
    .run(cutoff.toISOString());
  return result.changes;
}
