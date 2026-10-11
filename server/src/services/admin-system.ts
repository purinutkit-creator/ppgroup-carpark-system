/**
 * Admin: backups / restore (backup.manage) and PDPA tools (pdpa.manage).
 */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { q, db, openDb, setDb, tx, json } from '../db/index.ts';
import { config } from '../config.ts';
import { body, h, reqStr, str, badRequest, conflict, forbidden, notFound } from '../lib/http.ts';
import { requirePerm } from '../auth/middleware.ts';
import { audit } from '../lib/audit.ts';
import { clearSettingsCache } from '../lib/settings.ts';
import { invalidatePermissionCache } from '../auth/rbac.ts';
import { backupNow, applyRetention } from '../jobs/index.ts';
import { uploadSingle } from '../routes/media.ts';
import { idParam, plateFrom } from './admin-common.ts';

export const systemRouter = Router();
const backupGuard = requirePerm('backup.manage');
const pdpaGuard = requirePerm('pdpa.manage');

// ---------------------------------------------------------------- backups --

function backupFile(name: string): string {
  const abs = path.resolve(config.backupDir, name);
  if (path.dirname(abs) !== path.resolve(config.backupDir)) throw badRequest('INVALID_BACKUP');
  return abs;
}

systemRouter.get(
  '/backups',
  backupGuard,
  h((_req, res) => {
    const rows = q.all('SELECT b.*, u.display_name created_by_name FROM backups b LEFT JOIN users u ON u.id=b.created_by ORDER BY b.id DESC LIMIT 200');
    res.json({ items: rows.map((b) => ({ ...b, exists: fs.existsSync(backupFile(b.file)) })), dbSize: fs.existsSync(config.dbFile) ? fs.statSync(config.dbFile).size : null });
  }),
);

systemRouter.post(
  '/backups',
  backupGuard,
  h((req, res) => {
    const r = backupNow('MANUAL', req.user!.id);
    audit(req, { action: 'backup.create', entityType: 'backup', entityId: r.file, after: r });
    res.json(r);
  }),
);

systemRouter.get(
  '/backups/:id/download',
  backupGuard,
  h((req, res) => {
    if (req.user!.role !== 'OWNER') throw forbidden('OWNER_ONLY', 'ดาวน์โหลดไฟล์สำรองได้เฉพาะ OWNER');
    const b = q.get('SELECT * FROM backups WHERE id=?', idParam(req));
    if (!b) throw notFound();
    const abs = backupFile(b.file);
    if (!fs.existsSync(abs)) throw notFound('BACKUP_FILE_MISSING');
    audit(req, { action: 'backup.download', entityType: 'backup', entityId: b.id, meta: { file: b.file } });
    res.download(abs, b.file);
  }),
);

/** Verify an uploaded file is one of our SQLite databases (read-only open). */
function verifyBackup(file: string) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3\u0000') throw badRequest('NOT_SQLITE', 'ไฟล์ไม่ใช่ฐานข้อมูล SQLite');
  let probe: DatabaseSync | null = null;
  try {
    probe = new DatabaseSync(file, { readOnly: true });
    const ok = probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parking_sessions'").get();
    if (!ok) throw badRequest('NOT_PARKING_DB', 'ไฟล์ไม่มีตาราง parking_sessions');
    const integrity = probe.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined;
    if (integrity?.quick_check !== 'ok') throw badRequest('CORRUPT_BACKUP', `quick_check: ${integrity?.quick_check}`);
    const counts = probe.prepare("SELECT (SELECT COUNT(*) FROM parking_sessions) sessions, (SELECT COUNT(*) FROM users) users").get() as { sessions: number; users: number };
    return counts;
  } catch (e) {
    if (e instanceof Error && 'status' in e) throw e;
    throw badRequest('INVALID_BACKUP', (e as Error).message);
  } finally {
    probe?.close();
  }
}

systemRouter.post(
  '/backups/restore',
  backupGuard,
  uploadSingle,
  h((req, res) => {
    if (req.user!.role !== 'OWNER') throw forbidden('OWNER_ONLY', 'กู้คืนฐานข้อมูลได้เฉพาะ OWNER');
    if (!req.file) throw badRequest('FILE_REQUIRED');
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) throw badRequest('REASON_REQUIRED', 'กรุณาระบุเหตุผลการกู้คืน');
    const tmp = path.join(config.backupDir, `upload-${crypto.randomUUID()}.db`);
    fs.writeFileSync(tmp, req.file.buffer);
    try {
      const counts = verifyBackup(tmp);
      const safety = backupNow('PRE_RESTORE', req.user!.id);
      const actor = { id: req.user!.id, username: req.user!.username };
      // Swap: close the live db, replace the file (dropping WAL/SHM), reopen.
      db().close();
      for (const ext of ['-wal', '-shm']) fs.rmSync(config.dbFile + ext, { force: true });
      fs.copyFileSync(tmp, config.dbFile);
      setDb(openDb());
      clearSettingsCache();
      invalidatePermissionCache();
      // The restored db has its own backups table: re-register the safety copy so it stays visible.
      if (!q.get('SELECT id FROM backups WHERE file=?', safety.file)) q.insert('backups', { file: safety.file, size: safety.size, kind: 'PRE_RESTORE', created_by: null });
      audit(req, { action: 'backup.restore', entityType: 'backup', entityId: req.file.originalname, reason, before: { safetyBackup: safety.file }, after: { file: req.file.originalname, size: req.file.size, ...counts }, meta: { restoredBy: actor } });
      res.json({ ok: true, safetyBackup: safety.file, restored: counts });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }),
);

// ------------------------------------------------------------------- PDPA --

systemRouter.post(
  '/pdpa/retention-run',
  pdpaGuard,
  h((req, res) => {
    const r = applyRetention();
    audit(req, { action: 'pdpa.retention_manual', entityType: 'pdpa', after: r });
    res.json(r);
  }),
);

function subjectKey(input: { plateKey?: string; plate?: string; prefix?: string; number?: string; province?: string }) {
  if (input.plateKey) {
    if (!/^[^|]+\|\d+\|[^|]+$/.test(input.plateKey)) throw badRequest('INVALID_PLATE_KEY');
    return input.plateKey;
  }
  return plateFrom({ plate: input.plate, prefix: input.prefix, number: input.number, province: input.province ?? null }).key;
}

systemRouter.get(
  '/pdpa/subject',
  pdpaGuard,
  h((req, res) => {
    const qs = req.query as Record<string, string | undefined>;
    const key = subjectKey({ plateKey: qs.plateKey, plate: qs.plate, prefix: qs.prefix, number: qs.number, province: qs.province });
    const sessions = q.all(
      `SELECT id, parking_no, site_id, plate_text, province, entry_at, exit_at, status, payment_status, member_id, pass_id FROM parking_sessions
        WHERE plate_key=? ORDER BY entry_at DESC LIMIT 500`,
      key,
    );
    const detections = q.all(
      'SELECT id, gate_id, camera_id, direction, captured_at, decision, plate_prefix, plate_number, province, image_path IS NOT NULL has_image, session_id FROM detections WHERE plate_key=? ORDER BY captured_at DESC LIMIT 500',
      key,
    );
    const members = q.all('SELECT m.id, m.phone, m.first_name, m.last_name, m.email, m.tier, m.consent_at, m.active FROM member_vehicles v JOIN members m ON m.id=v.member_id WHERE v.plate_key=?', key);
    const passes = q.all('SELECT id, type, holder_name, plate_text, valid_from, valid_to, active FROM passes WHERE plate_key=?', key);
    const lists = q.all('SELECT id, list_type, plate_text, reason, valid_from, valid_to, active FROM plate_lists WHERE plate_key=?', key);
    const reservations = q.all('SELECT id, code, name, phone, start_at, end_at, status FROM reservations WHERE plate_key=?', key);
    audit(req, { action: 'pdpa.subject_lookup', entityType: 'plate', entityId: key, meta: { sessions: sessions.length, detections: detections.length } });
    res.json({ plateKey: key, sessions, detections, members, passes, lists, reservations });
  }),
);

function removeDetectionImages(d: { image_path: string | null; candidates_json: string }) {
  let n = 0;
  const files = [d.image_path, ...json<Array<{ cropPath?: string }>>(d.candidates_json, []).map((c) => c.cropPath)].filter(Boolean) as string[];
  for (const f of files) {
    const abs = path.resolve(config.uploadDir, f);
    if (!abs.startsWith(path.resolve(config.uploadDir, 'private') + path.sep)) continue;
    fs.rmSync(abs, { force: true });
    n++;
  }
  return n;
}

systemRouter.post(
  '/pdpa/subject/anonymise',
  pdpaGuard,
  h((req, res) => {
    const b = body(req);
    const key = subjectKey({ plateKey: str(b, 'plateKey'), plate: str(b, 'plate'), province: str(b, 'province') });
    const reason = reqStr(b, 'reason', 500);
    const active = q.get<{ n: number }>("SELECT COUNT(*) n FROM parking_sessions WHERE plate_key=? AND status='ACTIVE'", key)!.n;
    const dets = q.all("SELECT d.id, d.image_path, d.candidates_json FROM detections d LEFT JOIN parking_sessions s ON s.id=d.session_id WHERE d.plate_key=? AND (s.id IS NULL OR s.status!='ACTIVE')", key);
    const result = tx(() => {
      const sessions = q.run(
        `UPDATE parking_sessions SET plate_prefix=NULL, plate_number=NULL, plate_text='***', plate_key=NULL,
           flags=json_insert(COALESCE(flags,'[]'),'$[#]','ANONYMISED') WHERE plate_key=? AND status!='ACTIVE'`,
        key,
      ).changes;
      for (const d of dets) {
        q.run(
          "UPDATE detections SET plate_prefix=NULL, plate_number=NULL, plate_key=NULL, image_path=NULL, candidates_json='[]', original_json=NULL, corrected_json=NULL WHERE id=?",
          d.id,
        );
      }
      return { sessions, detections: dets.length };
    });
    let images = 0;
    for (const d of dets) images += removeDetectionImages(d);
    if (active) result.sessions += 0; // active sessions are kept until exit (still needed for billing)
    audit(req, { action: 'pdpa.anonymise', entityType: 'plate', entityId: key, reason, before: { plateKey: key }, after: { ...result, imagesRemoved: images, activeSessionsKept: active } });
    if (!result.sessions && !result.detections) throw conflict('NOTHING_TO_ANONYMISE', active ? 'มีเฉพาะรายการที่ยังจอดอยู่ (ACTIVE) — ทำได้หลังรถออก' : 'ไม่พบข้อมูลของทะเบียนนี้');
    res.json({ ok: true, ...result, imagesRemoved: images, activeSessionsKept: active });
  }),
);
