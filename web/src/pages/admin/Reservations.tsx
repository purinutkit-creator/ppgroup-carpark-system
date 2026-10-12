import { useState } from 'react';
import { CrudTable } from '../../components/config/Crud';
import { provinceName, useLookups } from '../../components/config/common';
import { Badge, Button, PlateBadge, Select, errorText, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { dateTime, money } from '../../lib/format';

type Row = Record<string, any>;

export default function Reservations() {
  const lk = useLookups();
  const toast = useToast();
  const [status, setStatus] = useState('');
  const setSt = async (r: Row, s: string, reload: () => void) => {
    try {
      await post(`/api/admin/reservations/${r.id}/status`, { status: s, reason: 'admin' });
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const inHour = new Date(Date.now() + 3600_000).toISOString();
  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">จองที่จอดรถล่วงหน้า</h1>
        <div className="actions">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={['', 'BOOKED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((s) => ({ value: s, label: s || 'ทุกสถานะ' }))} />
        </div>
      </div>
      <CrudTable<Row, Row>
        title="รายการจอง"
        url="/api/admin/reservations"
        query={status ? `?status=${status}` : ''}
        canDelete={false}
        columns={[
          { label: 'รหัส', render: (r) => <span className="mono">{r.code}</span> },
          { label: 'ทะเบียน', render: (r) => <PlateBadge plate={r.plate_text} province={provinceName(r.province)} /> },
          { label: 'ผู้จอง', render: (r) => `${r.name} · ${r.phone}` },
          { label: 'โซน', render: (r) => lk.zoneName(r.zone_id) },
          { label: 'ช่วงเวลา', render: (r) => `${dateTime(r.start_at)} – ${dateTime(r.end_at)}` },
          { label: 'ค่าจอง', render: (r) => money(r.fee) },
          { label: 'สถานะ', render: (r) => <Badge>{r.status}</Badge> },
        ]}
        actions={(r, reload) =>
          r.status === 'BOOKED' ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setSt(r, 'CANCELLED', reload)}>ยกเลิก</Button>
              <Button size="sm" variant="ghost" onClick={() => setSt(r, 'NO_SHOW', reload)}>ไม่มา</Button>
            </>
          ) : null
        }
        fields={[
          { key: 'siteId', label: 'สาขา', type: 'select', options: lk.sites.map((s) => ({ value: s.id, label: s.name })) },
          { key: 'zoneId', label: 'โซน', type: 'select', options: [{ value: '', label: '— ไม่ระบุ —' }, ...lk.zones.map((z) => ({ value: z.id, label: z.name }))] },
          { key: 'prefix', label: 'หมวดอักษร' },
          { key: 'number', label: 'เลขทะเบียน' },
          { key: 'province', label: 'จังหวัด', type: 'province' },
          { key: 'name', label: 'ชื่อผู้จอง' },
          { key: 'phone', label: 'เบอร์โทร' },
          { key: 'fee', label: 'ค่าจอง (บาท)', type: 'number' },
          { key: 'startAt', label: 'เริ่ม', type: 'datetime' },
          { key: 'endAt', label: 'สิ้นสุด', type: 'datetime' },
        ]}
        empty={() => ({ siteId: lk.sites[0]?.id ?? '', zoneId: '', prefix: '', number: '', province: '10', name: '', phone: '', fee: 0, startAt: inHour, endAt: new Date(Date.now() + 4 * 3600_000).toISOString() })}
        toForm={(r) => ({ siteId: r.site_id, zoneId: r.zone_id ?? '', prefix: r.plate_text?.split(' ')[0], number: r.plate_text?.split(' ')[1], province: r.province, name: r.name, phone: r.phone, fee: r.fee, startAt: r.start_at, endAt: r.end_at })}
        toBody={(f) => ({ ...f, siteId: Number(f.siteId), zoneId: f.zoneId ? Number(f.zoneId) : null })}
      />
    </>
  );
}
