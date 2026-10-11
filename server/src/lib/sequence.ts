import { q, tx } from '../db/index.ts';

/** Atomically increment a named counter for a period (e.g. a date). */
export function nextSequence(name: string, period: string): number {
  return tx(() => {
    const row = q.get<{ last_value: number }>('SELECT last_value FROM sequences WHERE name=? AND period=?', name, period);
    const next = (row?.last_value ?? 0) + 1;
    if (row) q.run('UPDATE sequences SET last_value=? WHERE name=? AND period=?', next, name, period);
    else q.run('INSERT INTO sequences (name, period, last_value) VALUES (?,?,?)', name, period, next);
    return next;
  });
}

/** yyyymmdd in a fixed UTC offset (minutes). */
export function ymd(d: Date, tz = 420): string {
  return new Date(d.getTime() + tz * 60_000).toISOString().slice(0, 10).replace(/-/g, '');
}
