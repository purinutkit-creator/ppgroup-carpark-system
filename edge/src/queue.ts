/**
 * Durable local queue (SQLite). Events are written before any network call and
 * removed only after the server acknowledges them, so a power cut or outage
 * never loses an entry/exit. Each event has a UUID → server-side idempotency.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { cfg } from './config.ts';

fs.mkdirSync(path.dirname(cfg.queueFile), { recursive: true });
const db = new DatabaseSync(cfg.queueFile);
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, type TEXT NOT NULL, gate_id INTEGER NOT NULL, occurred_at TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);

export type EdgeEventType = 'ENTRY' | 'EXIT' | 'DETECTION' | 'BARRIER_OPEN';

export function enqueue(type: EdgeEventType, gateId: number, payload: unknown) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO events (id, type, gate_id, occurred_at, payload) VALUES (?,?,?,?,?)').run(id, type, gateId, new Date().toISOString(), JSON.stringify(payload));
  return id;
}

export function pending(limit = 200) {
  return (db.prepare('SELECT * FROM events ORDER BY occurred_at LIMIT ?').all(limit) as any[]).map((e) => ({
    id: e.id as string,
    type: e.type as EdgeEventType,
    gateId: e.gate_id as number,
    occurredAt: e.occurred_at as string,
    payload: JSON.parse(e.payload),
  }));
}

export function ack(id: string) {
  db.prepare('DELETE FROM events WHERE id=?').run(id);
}

export function fail(id: string, error: string) {
  db.prepare('UPDATE events SET attempts=attempts+1, last_error=? WHERE id=?').run(error, id);
}

export function count(): number {
  return (db.prepare('SELECT COUNT(*) n FROM events').get() as any).n;
}

export function kvGet<T>(k: string, fallback: T): T {
  const r = db.prepare('SELECT v FROM kv WHERE k=?').get(k) as any;
  return r ? JSON.parse(r.v) : fallback;
}
export function kvSet(k: string, v: unknown) {
  db.prepare('INSERT INTO kv (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, JSON.stringify(v));
}

export function nextLocalSeq(day: string): number {
  const n = kvGet<number>(`seq:${day}`, 0) + 1;
  kvSet(`seq:${day}`, n);
  return n;
}
