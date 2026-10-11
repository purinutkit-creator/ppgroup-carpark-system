import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

process.removeAllListeners('warning'); // silence node:sqlite ExperimentalWarning noise
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') console.warn(w);
});

export type Row = Record<string, any>;
export type Params = SQLInputValue[] | Record<string, SQLInputValue>;

let _db: DatabaseSync | null = null;

export function openDb(file = config.dbFile): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));
  return db;
}

export function db(): DatabaseSync {
  if (!_db) _db = openDb();
  return _db;
}

/** Swap the database (tests / restore). */
export function setDb(next: DatabaseSync) {
  _db = next;
}

const stmtCache = new WeakMap<DatabaseSync, Map<string, ReturnType<DatabaseSync['prepare']>>>();
function prep(sql: string) {
  const d = db();
  let m = stmtCache.get(d);
  if (!m) stmtCache.set(d, (m = new Map()));
  let s = m.get(sql);
  if (!s) m.set(sql, (s = d.prepare(sql)));
  return s;
}

function norm(params: unknown[]): SQLInputValue[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (p !== null && typeof p === 'object' && !(p instanceof Uint8Array)) return JSON.stringify(p);
    return p as SQLInputValue;
  });
}

export const q = {
  get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
    return prep(sql).get(...norm(params)) as T | undefined;
  },
  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return prep(sql).all(...norm(params)) as T[];
  },
  run(sql: string, ...params: unknown[]) {
    const r = prep(sql).run(...norm(params));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  },
  /** INSERT helper: q.insert('table', {col: value}) → id */
  insert(table: string, data: Record<string, unknown>): number {
    const cols = Object.keys(data);
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    return q.run(sql, ...cols.map((c) => data[c])).id;
  },
  update(table: string, id: number, data: Record<string, unknown>) {
    const cols = Object.keys(data);
    if (!cols.length) return { changes: 0, id };
    const sql = `UPDATE ${table} SET ${cols.map((c) => `${c}=?`).join(',')} WHERE id=?`;
    return q.run(sql, ...cols.map((c) => data[c]), id);
  },
};

let depth = 0;
/** Run fn in a transaction (nested calls use savepoints). */
export function tx<T>(fn: () => T): T {
  const d = db();
  const sp = `sp${depth}`;
  d.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth++;
  try {
    const r = fn();
    depth--;
    d.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    return r;
  } catch (e) {
    depth--;
    d.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    throw e;
  }
}

export function json<T = any>(s: string | null | undefined, fallback: T): T {
  if (s == null || s === '') return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export const nowIso = () => new Date().toISOString();
