/**
 * Building blocks shared by the admin configuration pages.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { get } from '../../lib/api';
import { PROVINCES } from '@pp/shared/provinces';
import { Check, Field, Input, ProvinceSelect } from '../ui';

export interface Lookups {
  sites: Array<{ id: number; code: string; name: string; capacity: number; tz_offset: number }>;
  zones: Array<{ id: number; site_id: number; name: string; capacity: number; vehicle_types: string[] | null }>;
  gates: Array<{ id: number; site_id: number; zone_id: number | null; name: string; direction: 'ENTRY' | 'EXIT' }>;
  devices: Array<{ id: number; site_id: number | null; gate_id: number | null; type: string; name: string; status: string }>;
  ratePlans: Array<{ id: number; site_id: number | null; zone_id: number | null; name: string; vehicle_type: string }>;
  vehicleTypes: Array<{ code: string; name: string }>;
}

const EMPTY: Lookups = { sites: [], zones: [], gates: [], devices: [], ratePlans: [], vehicleTypes: [] };

/** Reference data for forms and "Apply To…" pickers (GET /api/admin/lookups). */
export function useLookups() {
  const [data, setData] = useState<Lookups>(EMPTY);
  const reload = useCallback(() => get<Lookups>('/api/admin/lookups').then(setData).catch(() => undefined), []);
  useEffect(() => {
    reload();
  }, [reload]);
  const helpers = useMemo(
    () => ({
      siteName: (id: number | null | undefined) => (id ? (data.sites.find((s) => s.id === id)?.name ?? `#${id}`) : 'ทุกสาขา'),
      zoneName: (id: number | null | undefined) => (id ? (data.zones.find((z) => z.id === id)?.name ?? `#${id}`) : 'ทุกโซน'),
      vehicleName: (code: string) => data.vehicleTypes.find((v) => v.code === code)?.name ?? code,
      devicesOf: (...types: string[]) => data.devices.filter((d) => types.includes(d.type)),
    }),
    [data],
  );
  return { ...data, ...helpers, reload };
}

export const DEVICE_TYPE_LABEL: Record<string, string> = {
  CAMERA: 'กล้อง LPR',
  PRINTER: 'เครื่องพิมพ์',
  BARRIER: 'ไม้กั้น',
  ENTRY_KIOSK: 'Kiosk ทางเข้า',
  EXIT_KIOSK: 'Kiosk ทางออก',
  PAYMENT_KIOSK: 'Payment Kiosk',
  COUNTER: 'Counter',
  EDGE: 'Edge Agent',
  DISPLAY: 'จอแสดงผล',
  POS: 'POS',
};

export const DAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

export function provinceName(code: string | null | undefined) {
  if (!code) return null;
  return PROVINCES.find((p) => p.code === code)?.th ?? code;
}

export function StatusDot({ status }: { status: string }) {
  const cls = status === 'ONLINE' ? 'dot dot-online' : status === 'OFFLINE' || status === 'ERROR' ? 'dot dot-offline' : 'dot';
  return <span className={cls} title={status} />;
}

/** Multi-select as a compact checkbox list. Empty selection means "all". */
export function MultiCheck<T extends string | number>({
  options,
  value,
  onChange,
  allLabel = 'ทั้งหมด',
}: {
  options: Array<{ value: T; label: ReactNode }>;
  value: T[] | null | undefined;
  onChange: (v: T[] | null) => void;
  allLabel?: string;
}) {
  const sel = value ?? [];
  return (
    <div className="row" style={{ gap: 12 }}>
      <Check label={allLabel} checked={!sel.length} onChange={(v) => v && onChange(null)} />
      {options.map((o) => (
        <Check
          key={String(o.value)}
          label={o.label}
          checked={sel.includes(o.value)}
          onChange={(v) => {
            const next = v ? [...sel, o.value] : sel.filter((x) => x !== o.value);
            onChange(next.length ? next : null);
          }}
        />
      ))}
    </div>
  );
}

export interface PlateValue {
  prefix: string;
  number: string;
  province: string | null;
}

/** Thai plate entry: หมวดอักษร + เลขทะเบียน + จังหวัด. */
export function PlateFields({ value, onChange, requireProvince }: { value: PlateValue; onChange: (v: PlateValue) => void; requireProvince?: boolean }) {
  return (
    <div className="grid grid-3">
      <Field label="หมวดอักษร">
        <Input value={value.prefix} placeholder="เช่น 1กข" maxLength={4} onChange={(e) => onChange({ ...value, prefix: e.target.value.replace(/\s/g, '') })} />
      </Field>
      <Field label="เลขทะเบียน">
        <Input value={value.number} inputMode="numeric" placeholder="1234" maxLength={4} onChange={(e) => onChange({ ...value, number: e.target.value.replace(/\D/g, '') })} />
      </Field>
      <Field label="จังหวัด">
        <ProvinceSelect value={value.province} allowEmpty={!requireProvince} onChange={(p) => onChange({ ...value, province: p })} />
      </Field>
    </div>
  );
}

export const emptyPlate = (): PlateValue => ({ prefix: '', number: '', province: '10' });

/** Split a stored plate_key "prefix|number|province" back into fields. */
export function plateFromKey(key: string | null | undefined): PlateValue {
  const [prefix = '', number = '', province = ''] = (key ?? '').split('|');
  return { prefix, number, province: province && province !== '?' ? province : null };
}

export function Section({ title, children, hint }: { title: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {hint && <div className="small muted mb">{hint}</div>}
      {children}
    </fieldset>
  );
}

/** Deep equality for dirty checks of small JSON-able configs. */
export function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** yyyy-mm-dd of an ISO timestamp in Bangkok time. */
export function localDay(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Bangkok-local yyyy-mm-dd → ISO at local midnight (or end of day). */
export function dayToIso(d: string, endOfDay = false) {
  if (!d) return null;
  const t = Date.parse(`${d}T00:00:00Z`) - 7 * 3600_000 + (endOfDay ? 86400_000 - 1000 : 0);
  return new Date(t).toISOString();
}
