import { useState } from 'react';
import { CrudTable, activeBadge } from '../../components/config/Crud';
import { provinceName, useLookups } from '../../components/config/common';
import { Badge, PlateBadge, Tabs } from '../../components/ui';
import { dateTime } from '../../lib/format';

type Row = Record<string, any>;
const TYPES = [
  { id: 'BLACKLIST', label: 'Blacklist (ห้ามเข้า)' },
  { id: 'WHITELIST', label: 'Whitelist (เข้าออกไม่ต้องรับบัตร)' },
  { id: 'EXEMPT', label: 'ยกเว้นค่าจอด' },
  { id: 'SPECIAL_RATE', label: 'อัตราพิเศษเฉพาะทะเบียน' },
] as const;

export default function PlateLists() {
  const [type, setType] = useState<string>('BLACKLIST');
  const lk = useLookups();
  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">Blacklist / Whitelist / ทะเบียนพิเศษ</h1>
      </div>
      <Tabs tabs={TYPES.map((t) => ({ id: t.id, label: t.label }))} value={type} onChange={setType} />
      <CrudTable<Row, Row>
        key={type}
        title={TYPES.find((t) => t.id === type)?.label}
        url="/api/admin/plate-lists"
        query={`?listType=${type}`}
        filter={(rows) => rows.filter((r) => r.list_type === type)}
        columns={[
          { label: 'ทะเบียน', render: (r) => <PlateBadge plate={r.plate_text} province={provinceName(r.province)} /> },
          { label: 'เหตุผล', render: (r) => r.reason ?? '-' },
          ...(type === 'SPECIAL_RATE' ? [{ label: 'อัตรา', render: (r: Row) => r.rate_plan_name ?? '-' }] : []),
          { label: 'สาขา', render: (r) => r.site_name ?? 'ทุกสาขา' },
          { label: 'ช่วงเวลา', render: (r) => (r.valid_from || r.valid_to ? `${dateTime(r.valid_from)} – ${dateTime(r.valid_to)}` : 'ตลอด') },
          { label: 'สถานะ', render: (r) => activeBadge(r.active) },
          { label: 'โดย', render: (r) => r.created_by_name ?? '-' },
        ]}
        fields={[
          { key: 'prefix', label: 'หมวดอักษร (เช่น กข, 1กข)' },
          { key: 'number', label: 'เลขทะเบียน' },
          { key: 'province', label: 'จังหวัด', type: 'province' },
          { key: 'siteId', label: 'สาขา', type: 'select', options: [{ value: '', label: 'ทุกสาขา' }, ...lk.sites.map((s) => ({ value: s.id, label: s.name }))] },
          ...(type === 'SPECIAL_RATE'
            ? [{ key: 'ratePlanId', label: 'อัตราค่าจอด', type: 'select' as const, options: lk.ratePlans.map((p) => ({ value: p.id, label: `${p.name} (${p.vehicle_type})` })) }]
            : []),
          { key: 'validFrom', label: 'เริ่ม', type: 'datetime' },
          { key: 'validTo', label: 'สิ้นสุด', type: 'datetime' },
          { key: 'reason', label: 'เหตุผล', type: 'textarea' },
          { key: 'active', label: 'ใช้งาน', type: 'check' },
        ]}
        empty={() => ({ prefix: '', number: '', province: '10', siteId: '', ratePlanId: lk.ratePlans[0]?.id ?? '', validFrom: null, validTo: null, reason: '', active: true })}
        toForm={(r) => ({ prefix: r.plate_text?.split(' ')[0] ?? '', number: r.plate_text?.split(' ')[1] ?? '', province: r.province, siteId: r.site_id ?? '', ratePlanId: r.rate_plan_id ?? '', validFrom: r.valid_from, validTo: r.valid_to, reason: r.reason ?? '', active: !!r.active })}
        toBody={(f) => ({ ...f, listType: type, siteId: f.siteId ? Number(f.siteId) : null, ratePlanId: f.ratePlanId ? Number(f.ratePlanId) : null })}
      />
      <div className="small muted">
        <Badge tone="info">หมายเหตุ</Badge> การจับคู่ทะเบียนใช้ หมวดอักษร + เลข + จังหวัด เสมอ (กข 1234 กรุงเทพฯ ≠ กข 1234 ชลบุรี)
      </div>
    </>
  );
}
