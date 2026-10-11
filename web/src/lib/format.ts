/** Formatting in Thailand time (UTC+7) regardless of the device timezone. */
const TZ = 'Asia/Bangkok';

export function money(n: number | null | undefined, symbol = '฿') {
  const v = Number(n ?? 0);
  return `${symbol}${v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function num(n: number | null | undefined, digits = 0) {
  return Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function date(iso: string | null | undefined) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function time(iso: string | null | undefined, withSeconds = false) {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined });
}

export function dateTime(iso: string | null | undefined) {
  if (!iso) return '-';
  return `${date(iso)} ${time(iso)}`;
}

/** 03:25:18 */
export function hms(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((x) => String(x).padStart(2, '0')).join(':');
}

export function durationText(totalSeconds: number, lang: 'th' | 'en' | 'zh' = 'th') {
  const m = Math.floor(totalSeconds / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (lang === 'en') return `${h} h ${mm} min`;
  if (lang === 'zh') return `${h}小时${mm}分钟`;
  return `${h} ชั่วโมง ${mm} นาที`;
}

export function minutesText(m: number) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h && mm ? `${h} ชม. ${mm} นาที` : h ? `${h} ชม.` : `${mm} นาที`;
}

export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 7 * 3600_000);
  return d.toISOString().slice(0, 16);
}

export function fromLocalInput(v: string) {
  if (!v) return null;
  return new Date(new Date(v + ':00Z').getTime() - 7 * 3600_000).toISOString();
}

/** Bangkok-local day boundaries as ISO strings. */
export function dayRange(offsetDays = 0) {
  const now = new Date(Date.now() + 7 * 3600_000);
  const d0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays) - 7 * 3600_000;
  return { from: new Date(d0).toISOString(), to: new Date(d0 + 86400_000 - 1).toISOString() };
}
