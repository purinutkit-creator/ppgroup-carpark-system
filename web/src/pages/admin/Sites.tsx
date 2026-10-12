import { CrudTable, activeBadge } from '../../components/config/Crud';
import { useLookups } from '../../components/config/common';
import { Badge } from '../../components/ui';

type Row = Record<string, any>;
const triState = [
  { value: '', label: 'ใช้ค่าระบบ' },
  { value: 'true', label: 'เปิด' },
  { value: 'false', label: 'ปิด' },
];
const tri = (v: unknown) => (v === true ? 'true' : v === false ? 'false' : '');
const fromTri = (v: string) => (v === 'true' ? true : v === 'false' ? false : null);

export default function Sites() {
  const lk = useLookups();
  const siteOpts = lk.sites.map((s) => ({ value: s.id, label: s.name }));
  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">สาขา / โซน / ทางเข้า–ออก</h1>
      </div>
      <CrudTable<Row, Row>
        title="สาขา (ลานจอด)"
        url="/api/admin/sites"
        columns={[
          { label: 'รหัส', render: (r) => r.code },
          { label: 'ชื่อ', render: (r) => r.name },
          { label: 'ที่อยู่', render: (r) => r.address ?? '-' },
          { label: 'รถในลาน / ความจุ', render: (r) => `${r.occupied} / ${r.capacity || '∞'}` },
          { label: 'สถานะ', render: (r) => activeBadge(r.active) },
        ]}
        fields={[
          { key: 'code', label: 'รหัสสาขา' },
          { key: 'name', label: 'ชื่อ' },
          { key: 'address', label: 'ที่อยู่', wide: true },
          { key: 'capacity', label: 'จำนวนช่องจอด (0 = ไม่จำกัด)', type: 'number' },
          { key: 'tzOffset', label: 'Timezone offset (นาที)', type: 'number', hint: 'ประเทศไทย = 420' },
        ]}
        empty={() => ({ code: '', name: '', address: '', capacity: 0, tzOffset: 420 })}
        toForm={(r) => ({ code: r.code, name: r.name, address: r.address ?? '', capacity: r.capacity, tzOffset: r.tz_offset })}
        toBody={(f) => f}
        onSaved={() => lk.reload()}
      />
      <CrudTable<Row, Row>
        title="โซนจอดรถ"
        url="/api/admin/zones"
        listUrl="/api/admin/sites"
        rowsFrom={(d) => d.items.flatMap((s: Row) => s.zones.map((z: Row) => ({ ...z, site_name: s.name })))}
        columns={[
          { label: 'สาขา', render: (r) => r.site_name },
          { label: 'โซน', render: (r) => r.name },
          { label: 'รถในโซน / ความจุ', render: (r) => `${r.occupied} / ${r.capacity || '∞'}` },
          { label: 'ประเภทรถ', render: (r) => (r.vehicle_types?.length ? r.vehicle_types.join(', ') : 'ทุกประเภท') },
        ]}
        fields={[
          { key: 'siteId', label: 'สาขา', type: 'select', options: siteOpts, createOnly: true },
          { key: 'name', label: 'ชื่อโซน' },
          { key: 'capacity', label: 'จำนวนช่องจอด', type: 'number' },
          { key: 'vehicleTypes', label: 'ประเภทรถ (คั่นด้วย , เว้นว่าง = ทุกประเภท)', hint: lk.vehicleTypes.map((v) => v.code).join(', ') },
        ]}
        empty={() => ({ siteId: lk.sites[0]?.id ?? '', name: '', capacity: 0, vehicleTypes: '' })}
        toForm={(r) => ({ siteId: r.site_id, name: r.name, capacity: r.capacity, vehicleTypes: (r.vehicle_types ?? []).join(',') })}
        toBody={(f) => ({ ...f, siteId: Number(f.siteId), vehicleTypes: f.vehicleTypes ? String(f.vehicleTypes).split(',').map((x: string) => x.trim()).filter(Boolean) : null })}
        onSaved={() => lk.reload()}
      />
      <CrudTable<Row, Row>
        title="ทางเข้า / ทางออก"
        url="/api/admin/gates"
        listUrl="/api/admin/sites"
        rowsFrom={(d) => d.items.flatMap((s: Row) => s.gates.map((g: Row) => ({ ...g, site_name: s.name, zone_name: s.zones.find((z: Row) => z.id === g.zone_id)?.name })))}
        columns={[
          { label: 'สาขา', render: (r) => r.site_name },
          { label: 'ชื่อ', render: (r) => r.name },
          { label: 'ทิศทาง', render: (r) => <Badge tone={r.direction === 'ENTRY' ? 'info' : 'warning'}>{r.direction === 'ENTRY' ? 'ทางเข้า' : 'ทางออก'}</Badge> },
          { label: 'โซน', render: (r) => r.zone_name ?? '-' },
          { label: 'ออกบัตรอัตโนมัติ', render: (r) => (r.settings?.autoIssueTicket == null ? 'ค่าระบบ' : r.settings.autoIssueTicket ? 'เปิด' : 'ปิด') },
          { label: 'อุปกรณ์', render: (r) => r.devices },
        ]}
        fields={[
          { key: 'siteId', label: 'สาขา', type: 'select', options: siteOpts, createOnly: true },
          { key: 'name', label: 'ชื่อ' },
          { key: 'direction', label: 'ทิศทาง', type: 'select', options: [{ value: 'ENTRY', label: 'ทางเข้า' }, { value: 'EXIT', label: 'ทางออก' }], createOnly: true },
          {
            key: 'zoneId',
            label: 'โซน',
            type: 'custom',
            render: (f, set) => (
              <select className="input" value={f.zoneId ?? ''} onChange={(e) => set({ zoneId: e.target.value })}>
                <option value="">— ไม่ระบุ —</option>
                {lk.zones.filter((z) => z.site_id === Number(f.siteId)).map((z) => (
                  <option key={z.id} value={z.id}>{z.name}</option>
                ))}
              </select>
            ),
          },
          { key: 'autoIssueTicket', label: 'ออกบัตรอัตโนมัติเมื่ออ่านป้ายได้', type: 'select', options: triState },
          { key: 'allowTicketWithoutPlate', label: 'อนุญาตออกบัตรแบบไม่ระบุทะเบียน', type: 'select', options: triState },
        ]}
        empty={() => ({ siteId: lk.sites[0]?.id ?? '', name: '', direction: 'ENTRY', zoneId: '', autoIssueTicket: '', allowTicketWithoutPlate: '' })}
        toForm={(r) => ({ siteId: r.site_id, name: r.name, direction: r.direction, zoneId: r.zone_id ?? '', autoIssueTicket: tri(r.settings?.autoIssueTicket), allowTicketWithoutPlate: tri(r.settings?.allowTicketWithoutPlate) })}
        toBody={(f) => ({
          siteId: Number(f.siteId),
          name: f.name,
          direction: f.direction,
          zoneId: f.zoneId ? Number(f.zoneId) : null,
          settings: { autoIssueTicket: fromTri(f.autoIssueTicket), allowTicketWithoutPlate: fromTri(f.allowTicketWithoutPlate) },
        })}
        onSaved={() => lk.reload()}
      />
    </>
  );
}
