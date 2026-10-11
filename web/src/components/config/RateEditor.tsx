/**
 * Full RateConfig editor + live server-side fee preview ("ทดลองคำนวณ").
 */
import { useEffect, useState } from 'react';
import type { RateConfig, TimeBand } from '@pp/shared/pricing';
import { post } from '../../lib/api';
import { dateTime, money, minutesText, toLocalInput, fromLocalInput } from '../../lib/format';
import { Button, Check, Field, Input, NumberInput, Select, errorText } from '../ui';
import { Section } from './common';

const UNITS = [
  { value: 60, label: 'ทุก 60 นาที (รายชั่วโมง)' },
  { value: 30, label: 'ทุก 30 นาที' },
  { value: 15, label: 'ทุก 15 นาที' },
  { value: 1, label: 'ทุก 1 นาที' },
];

type HolidayOverride = NonNullable<NonNullable<RateConfig['holiday']>['override']>;

export function RateEditor({ value, onChange, disabled }: { value: RateConfig; onChange: (v: RateConfig) => void; disabled?: boolean }) {
  const set = <K extends keyof RateConfig>(k: K, v: RateConfig[K]) => onChange({ ...value, [k]: v });
  const bands = value.timeBands ?? [];
  const setBand = (i: number, p: Partial<TimeBand>) => set('timeBands', bands.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const ov: HolidayOverride = value.holiday?.override ?? {};
  const setOv = (p: Partial<HolidayOverride>) => {
    const next = { ...ov, ...p };
    for (const k of Object.keys(next) as Array<keyof HolidayOverride>) if (next[k] === null || next[k] === undefined) delete next[k];
    set('holiday', { ...(value.holiday ?? {}), override: next });
  };
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }} className="col">
      <Section title="ค่าจอดพื้นฐาน">
        <div className="grid grid-4">
          <Field label="จอดฟรี (นาที)" hint={minutesText(value.freeMinutes || 0)}>
            <NumberInput min={0} value={value.freeMinutes} onChange={(v) => set('freeMinutes', v ?? 0)} />
          </Field>
          <Field label="ค่าจอดต่อชั่วโมง (บาท)">
            <NumberInput min={0} step="0.5" value={value.hourlyRate} onChange={(v) => set('hourlyRate', v ?? 0)} />
          </Field>
          <Field label="หน่วยการคิดเงิน">
            <Select value={value.billingUnitMinutes} options={UNITS} onChange={(e) => set('billingUnitMinutes', Number(e.target.value))} />
          </Field>
          <Field label="การปัดเศษ">
            <Select
              value={value.rounding}
              options={[
                { value: 'CEIL', label: 'ปัดขึ้นเต็มหน่วย (CEIL)' },
                { value: 'ACTUAL', label: 'คิดตามจริงเป็นนาที (ACTUAL)' },
              ]}
              onChange={(e) => set('rounding', e.target.value as RateConfig['rounding'])}
            />
          </Field>
          <Field label="ผ่อนผัน (นาที)" hint="ไม่คิดเงินหน่วยสุดท้ายถ้าเกินไม่ถึงค่านี้">
            <NumberInput min={0} value={value.toleranceMinutes ?? 0} onChange={(v) => set('toleranceMinutes', v ?? 0)} />
          </Field>
          <Field label="ค่าบัตรหาย (บาท)">
            <NumberInput min={0} value={value.lostTicketFee ?? 0} onChange={(v) => set('lostTicketFee', v ?? 0)} />
          </Field>
          <Field label="เวลาออกหลังชำระ (นาที)" hint="Grace period หลังจ่ายเงิน">
            <NumberInput min={0} value={value.graceAfterPaymentMinutes ?? 15} onChange={(v) => set('graceAfterPaymentMinutes', v ?? 0)} />
          </Field>
        </div>
      </Section>

      <Section title="ช่วงแรก (First period)" hint="เช่น ชั่วโมงแรก 30 บาท ต่อจากนั้นคิดตามอัตราปกติ">
        <div className="row">
          <Check label="ใช้ราคาช่วงแรก" checked={!!value.firstPeriod} onChange={(v) => set('firstPeriod', v ? { minutes: 60, price: value.hourlyRate } : null)} />
          {value.firstPeriod && (
            <>
              <Field label="ระยะเวลา (นาที)">
                <NumberInput min={1} value={value.firstPeriod.minutes} onChange={(v) => set('firstPeriod', { ...value.firstPeriod!, minutes: v ?? 60 })} />
              </Field>
              <Field label="ราคา (บาท)">
                <NumberInput min={0} value={value.firstPeriod.price} onChange={(v) => set('firstPeriod', { ...value.firstPeriod!, price: v ?? 0 })} />
              </Field>
            </>
          )}
        </div>
      </Section>

      <Section title="อัตราตามช่วงเวลา (กลางวัน / กลางคืน)" hint="ช่วงที่ไม่ได้กำหนดใช้อัตราต่อชั่วโมงปกติ ช่วงเวลาข้ามเที่ยงคืนได้ เช่น 22:00–06:00">
        <div className="col">
          {bands.map((b, i) => (
            <div className="row" key={i}>
              <Input style={{ maxWidth: 160 }} value={b.name} onChange={(e) => setBand(i, { name: e.target.value })} placeholder="ชื่อช่วง" />
              <Input type="time" style={{ maxWidth: 130 }} value={b.start} onChange={(e) => setBand(i, { start: e.target.value })} />
              <span>–</span>
              <Input type="time" style={{ maxWidth: 130 }} value={b.end} onChange={(e) => setBand(i, { end: e.target.value })} />
              <NumberInput style={{ maxWidth: 120 }} min={0} value={b.hourlyRate} onChange={(v) => setBand(i, { hourlyRate: v ?? 0 })} />
              <span className="small muted">บาท/ชม.</span>
              <Button size="sm" variant="ghost" onClick={() => set('timeBands', bands.filter((_, j) => j !== i))}>
                ลบ
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => set('timeBands', [...bands, { name: bands.length ? 'กลางคืน' : 'กลางวัน', start: bands.length ? '22:00' : '06:00', end: bands.length ? '06:00' : '22:00', hourlyRate: value.hourlyRate }])}>
              + เพิ่มช่วงเวลา
            </Button>
          </div>
        </div>
      </Section>

      <Section title="รายวัน / ข้ามคืน">
        <div className="grid grid-4">
          <Field label="เหมาจ่ายรายวัน (บาท)" hint="ว่าง = ไม่ใช้">
            <NumberInput min={0} value={value.dailyFlatRate ?? null} onChange={(v) => set('dailyFlatRate', v || null)} />
          </Field>
          <Field label="สูงสุดต่อวัน (บาท)" hint="ว่าง = ไม่จำกัด">
            <NumberInput min={0} value={value.dailyMax ?? null} onChange={(v) => set('dailyMax', v || null)} />
          </Field>
          <Field label="รอบวัน">
            <Select
              value={value.dayCycle ?? 'ROLLING_24H'}
              options={[
                { value: 'ROLLING_24H', label: 'ทุก 24 ชม. นับจากเวลาเข้า' },
                { value: 'CALENDAR', label: 'ตามวันปฏิทิน (เที่ยงคืน)' },
              ]}
              onChange={(e) => set('dayCycle', e.target.value as RateConfig['dayCycle'])}
            />
          </Field>
          <div className="col">
            <Check label="ค่าจอดข้ามคืน" checked={!!value.overnight} onChange={(v) => set('overnight', v ? { cutoff: '00:00', fee: 100 } : null)} />
            {value.overnight && (
              <div className="row">
                <Input type="time" style={{ maxWidth: 120 }} value={value.overnight.cutoff} onChange={(e) => set('overnight', { ...value.overnight!, cutoff: e.target.value })} />
                <NumberInput style={{ maxWidth: 100 }} min={0} value={value.overnight.fee} onChange={(v) => set('overnight', { ...value.overnight!, fee: v ?? 0 })} />
                <span className="small muted">บาท/คืน</span>
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="วันหยุด" hint="ใช้ค่าด้านล่างแทนค่าปกติในวันหยุดนักขัตฤกษ์ (และเสาร์–อาทิตย์ถ้าเลือก)">
        <div className="col">
          <Check label="มีอัตราวันหยุด" checked={!!value.holiday} onChange={(v) => set('holiday', v ? { weekendsAsHoliday: true, override: {} } : null)} />
          {value.holiday && (
            <>
              <Check label="นับเสาร์–อาทิตย์เป็นวันหยุด" checked={!!value.holiday.weekendsAsHoliday} onChange={(v) => set('holiday', { ...value.holiday!, weekendsAsHoliday: v })} />
              <div className="grid grid-4">
                <Field label="จอดฟรี (นาที)" hint="ว่าง = เหมือนวันปกติ">
                  <NumberInput min={0} value={ov.freeMinutes ?? null} onChange={(v) => setOv({ freeMinutes: v ?? undefined })} />
                </Field>
                <Field label="ต่อชั่วโมง (บาท)">
                  <NumberInput min={0} value={ov.hourlyRate ?? null} onChange={(v) => setOv({ hourlyRate: v ?? undefined })} />
                </Field>
                <Field label="สูงสุดต่อวัน (บาท)">
                  <NumberInput min={0} value={ov.dailyMax ?? null} onChange={(v) => setOv({ dailyMax: v ?? undefined })} />
                </Field>
                <Field label="เหมาจ่ายรายวัน (บาท)">
                  <NumberInput min={0} value={ov.dailyFlatRate ?? null} onChange={(v) => setOv({ dailyFlatRate: v ?? undefined })} />
                </Field>
              </div>
            </>
          )}
        </div>
      </Section>
    </fieldset>
  );
}

interface PreviewResult {
  amount: number;
  durationMinutes: number;
  freeMinutes: number;
  chargeableMinutes: number;
  lines: Array<{ label: string; amount: number; detail?: string }>;
  nextFeeChangeAt: string | null;
}

/** Live preview: every edit is re-priced by the server engine (never in the browser). */
export function RatePreview({ config, siteId }: { config: RateConfig; siteId?: number | null }) {
  const [entry, setEntry] = useState(() => toLocalInput(new Date(Date.now() - 3 * 3600_000).toISOString()));
  const [exit, setExit] = useState(() => toLocalInput(new Date().toISOString()));
  const [extra, setExtra] = useState<number | null>(0);
  const [lost, setLost] = useState(false);
  const [res, setRes] = useState<PreviewResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const entryAt = fromLocalInput(entry);
      const exitAt = fromLocalInput(exit);
      if (!entryAt || !exitAt) return;
      post<PreviewResult>('/api/admin/rates/preview', { config, entryAt, exitAt, extraFreeMinutes: extra ?? 0, lostTicket: lost, siteId: siteId ?? undefined })
        .then((r) => {
          setRes(r);
          setErr(null);
        })
        .catch((e) => setErr(errorText(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [config, entry, exit, extra, lost, siteId]);
  const quick = (h: number) => setExit(toLocalInput(new Date(new Date(fromLocalInput(entry) ?? Date.now()).getTime() + h * 3600_000).toISOString()));
  return (
    <div className="card col">
      <div className="card-title">ทดลองคำนวณ</div>
      <Field label="เวลาเข้า">
        <Input type="datetime-local" value={entry} onChange={(e) => setEntry(e.target.value)} />
      </Field>
      <Field label="เวลาออก">
        <Input type="datetime-local" value={exit} onChange={(e) => setExit(e.target.value)} />
      </Field>
      <div className="row">
        {[1, 2, 3, 5, 8, 12, 24, 26].map((h) => (
          <Button key={h} size="sm" variant="ghost" onClick={() => quick(h)}>
            {h} ชม.
          </Button>
        ))}
      </div>
      <Field label="จอดฟรีเพิ่ม (นาที)" hint="เช่น จากแสตมป์/สมาชิก">
        <NumberInput min={0} value={extra} onChange={setExtra} />
      </Field>
      <Check label="บัตรหาย" checked={lost} onChange={setLost} />
      {err && <div className="error small" style={{ color: 'var(--color-danger)' }}>{err}</div>}
      {res && (
        <div className="col">
          <div className="kpi">
            <span className="kpi-label">ค่าจอด</span>
            <span className="kpi-value num">{money(res.amount)}</span>
          </div>
          <div className="kv small">
            <span>ระยะเวลาจอด</span>
            <span>{minutesText(res.durationMinutes)}</span>
            <span>ฟรี</span>
            <span>{minutesText(res.freeMinutes)}</span>
            <span>คิดเงิน</span>
            <span>{minutesText(res.chargeableMinutes)}</span>
            {res.lines.map((l, i) => [
              <span key={`l${i}`}>
                {l.label} {l.detail && <span className="muted">({l.detail})</span>}
              </span>,
              <span key={`a${i}`} className="num">
                {money(l.amount)}
              </span>,
            ])}
            <span>ราคาเปลี่ยนครั้งถัดไป</span>
            <span>{res.nextFeeChangeAt ? dateTime(res.nextFeeChangeAt) : '-'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
