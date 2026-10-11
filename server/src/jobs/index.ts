/**
 * Background jobs: device offline detection, long-stay alerts, payment
 * reconciliation, PDPA retention, nightly backup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { q, nowIso, db } from '../db/index.ts';
import { config } from '../config.ts';
import { raiseAlert } from '../lib/alerts.ts';
import { getSetting } from '../lib/settings.ts';
import { reconcilePending } from '../services/payments.ts';
import { markDevice } from '../realtime-server.ts';
import { audit } from '../lib/audit.ts';

export function checkDevices() {
  // Devices that report via heartbeat must be seen within 90s.
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  for (const d of q.all("SELECT id FROM devices WHERE active=1 AND status='ONLINE' AND (last_seen_at IS NULL OR last_seen_at<?)", cutoff)) markDevice(d.id, 'OFFLINE');
}

export function checkLongStays() {
  const hours = getSetting('operation').longStayHours;
  if (!hours) return;
  const cutoff = new Date(Date.now() - hours * 3600_000).toISOString();
  for (const s of q.all("SELECT * FROM parking_sessions WHERE status='ACTIVE' AND entry_at<? AND pass_id IS NULL", cutoff)) {
    raiseAlert({
      type: 'LONG_STAY',
      siteId: s.site_id,
      refType: 'session',
      refId: s.id,
      message: `รถจอดนานผิดปกติ (> ${hours} ชม.): ${s.plate_text ?? s.parking_no}`,
      dedupeKey: `LONG_STAY:${s.id}`,
    });
  }
}

/** PDPA retention: delete old images, anonymise plates of closed sessions. */
export function applyRetention() {
  const p = getSetting('pdpa');
  let removed = 0;
  if (p.imageRetentionDays > 0) {
    const cutoff = new Date(Date.now() - p.imageRetentionDays * 86400_000).toISOString();
    for (const d of q.all('SELECT id, image_path, candidates_json FROM detections WHERE captured_at<? AND (image_path IS NOT NULL OR candidates_json LIKE \'%cropPath%\')', cutoff)) {
      const files = [d.image_path, ...((JSON.parse(d.candidates_json) as any[]).map((c) => c.cropPath))].filter(Boolean);
      for (const f of files) {
        try {
          fs.rmSync(path.join(config.uploadDir, f), { force: true });
          removed++;
        } catch {
          /* ignore */
        }
      }
      const cands = (JSON.parse(d.candidates_json) as any[]).map(({ cropPath: _c, ...rest }) => rest);
      q.run('UPDATE detections SET image_path=NULL, candidates_json=? WHERE id=?', JSON.stringify(cands), d.id);
    }
  }
  let anonymised = 0;
  if (p.plateRetentionDays > 0) {
    const cutoff = new Date(Date.now() - p.plateRetentionDays * 86400_000).toISOString();
    anonymised = q.run(
      "UPDATE parking_sessions SET plate_prefix=NULL, plate_number=NULL, plate_text='***', plate_key=NULL, flags=json_insert(COALESCE(flags,'[]'),'$[#]','ANONYMISED') WHERE status!='ACTIVE' AND exit_at<? AND plate_text!='***'",
      cutoff,
    ).changes;
    q.run("UPDATE detections SET plate_prefix=NULL, plate_number=NULL, plate_key=NULL, candidates_json='[]', original_json=NULL, corrected_json=NULL WHERE captured_at<? AND plate_key IS NOT NULL", cutoff);
  }
  if (p.auditRetentionDays > 0) {
    q.run('DELETE FROM audit_logs WHERE at<?', new Date(Date.now() - p.auditRetentionDays * 86400_000).toISOString());
  }
  if (removed || anonymised) audit(null, { action: 'pdpa.retention_run', meta: { imagesRemoved: removed, sessionsAnonymised: anonymised } });
  return { imagesRemoved: removed, sessionsAnonymised: anonymised };
}

export function backupNow(kind = 'AUTO', userId: number | null = null) {
  const file = path.join(config.backupDir, `parking-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const size = fs.statSync(file).size;
  q.insert('backups', { file: path.basename(file), size, kind, created_by: userId });
  // keep the 30 most recent automatic backups
  const old = q.all("SELECT * FROM backups WHERE kind='AUTO' ORDER BY id DESC LIMIT -1 OFFSET 30");
  for (const b of old) {
    fs.rmSync(path.join(config.backupDir, b.file), { force: true });
    q.run('DELETE FROM backups WHERE id=?', b.id);
  }
  return { file: path.basename(file), size };
}

let lastBackupDay = '';
export function startJobs() {
  setInterval(() => safe(checkDevices), 30_000);
  setInterval(() => safe(checkLongStays), 5 * 60_000);
  setInterval(() => safe(() => reconcilePending()), 60_000);
  setInterval(
    () =>
      safe(() => {
        const day = nowIso().slice(0, 10);
        const hour = new Date().getUTCHours();
        if (day !== lastBackupDay && hour === 19) {
          // 02:00 Asia/Bangkok
          lastBackupDay = day;
          backupNow('AUTO');
          applyRetention();
        }
      }),
    10 * 60_000,
  );
  setTimeout(() => safe(checkLongStays), 10_000);
}

function safe(fn: () => unknown) {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch((e) => console.error('job failed', e));
  } catch (e) {
    console.error('job failed', e);
  }
}
