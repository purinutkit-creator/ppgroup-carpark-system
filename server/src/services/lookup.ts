import { provinceByCode, provinceByName, plateKey } from '@pp/shared';
import { q, type Row } from '../db/index.ts';
import { sessionByToken } from './sessions.ts';

/**
 * Find ACTIVE sessions from whatever the operator / customer has:
 * QR token or URL, parking number, or plate (+ optional province).
 */
export function findSessions(input: { code?: string; parkingNo?: string; prefix?: string; number?: string; plate?: string; province?: string; siteId?: number | null; includeClosed?: boolean }): Row[] {
  const statusSql = input.includeClosed ? '1=1' : "status='ACTIVE'";
  const site = input.siteId ? ` AND site_id=${Number(input.siteId)}` : '';
  if (input.code) {
    const c = input.code.trim();
    const token = c.includes('/p/') ? c.slice(c.lastIndexOf('/p/') + 3).split(/[?#]/)[0] : c;
    const s = sessionByToken(token);
    if (s) return [s];
    if (/^PK\d{8,}/i.test(c)) input.parkingNo = c.toUpperCase();
    else return [];
  }
  if (input.parkingNo) {
    return q.all(`SELECT * FROM parking_sessions WHERE parking_no=? AND ${statusSql}${site}`, input.parkingNo.trim().toUpperCase());
  }
  let prefix = input.prefix?.replace(/\s/g, '');
  let number = input.number?.replace(/\D/g, '');
  if (!prefix && input.plate) {
    const m = /^\s*([0-9]?[ก-ฮ]{1,3})\s*-?\s*([0-9]{1,4})/.exec(input.plate.replace(/[๐-๙]/g, (d) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(d))));
    if (m) {
      prefix = m[1];
      number = m[2];
    }
  }
  if (!prefix || !number) return [];
  number = String(parseInt(number, 10));
  const prov = provinceByCode(input.province) ?? provinceByName(input.province);
  if (prov) {
    const exact = q.all(`SELECT * FROM parking_sessions WHERE plate_key=? AND ${statusSql}${site} ORDER BY entry_at DESC LIMIT 20`, plateKey(prefix, number, prov.code));
    if (exact.length) return exact;
    // include sessions whose province was not read
    return q.all(`SELECT * FROM parking_sessions WHERE plate_prefix=? AND plate_number=? AND province IS NULL AND ${statusSql}${site} ORDER BY entry_at DESC LIMIT 20`, prefix, number);
  }
  return q.all(`SELECT * FROM parking_sessions WHERE plate_prefix=? AND plate_number=? AND ${statusSql}${site} ORDER BY entry_at DESC LIMIT 20`, prefix, number);
}
