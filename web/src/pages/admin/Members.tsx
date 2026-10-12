import { useState } from 'react';
import { CrudTable, activeBadge } from '../../components/config/Crud';
import { provinceName, useLookups } from '../../components/config/common';
import { Badge, Button, Input, Modal, PlateBadge, ProvinceSelect, Tabs, errorText, useToast } from '../../components/ui';
import { del, post } from '../../lib/api';
import { date } from '../../lib/format';

type Row = Record<string, any>;

function VehiclesModal({ member, onClose }: { member: Row | null; onClose: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<Row[]>(member?.vehicles ?? []);
  const [prefix, setPrefix] = useState('');
  const [number, setNumber] = useState('');
  const [province, setProvince] = useState<string | null>('10');
  if (!member) return null;
  const add = async () => {
    try {
      const r = await post(`/api/admin/members/${member.id}/vehicles`, { prefix, number, province });
      setList([...list, { id: r.id, plate_prefix: prefix.replace(/\s/g, ''), plate_number: String(parseInt(number, 10)), province }]);
      setPrefix('');
      setNumber('');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const remove = async (v: Row) => {
    try {
      await del(`/api/admin/members/${member.id}/vehicles/${v.id}`);
      setList(list.filter((x) => x.id !== v.id));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Modal open title={`รถของ ${member.first_name} ${member.last_name ?? ''}`} onClose={onClose}>
      <div className="col">
        {list.map((v) => (
          <div key={v.id} className="row">
            <PlateBadge plate={`${v.plate_prefix} ${v.plate_number}`} province={provinceName(v.province)} />
            <span className="spacer" />
            <Button size="sm" variant="ghost" onClick={() => remove(v)}>ลบ</Button>
          </div>
        ))}
        <div className="row">
          <Input style={{ width: 90 }} placeholder="กข" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          <Input style={{ width: 90 }} placeholder="1234" value={number} onChange={(e) => setNumber(e.target.value)} />
          <div style={{ flex: 1, minWidth: 160 }}>
            <ProvinceSelect value={province} onChange={setProvince} />
          </div>
          <Button variant="primary" onClick={add}>เพิ่มรถ</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function Members() {
  const [tab, setTab] = useState<'members' | 'tiers' | 'passes'>('members');
  const [vehicles, setVehicles] = useState<Row | null>(null);
  const [search, setSearch] = useState('');
  const lk = useLookups();
  const tierOpts = [
    { value: 'REGULAR', label: 'Regular' },
    { value: 'SILVER', label: 'Silver' },
    { value: 'GOLD', label: 'Gold' },
    { value: 'PLATINUM', label: 'Platinum' },
    { value: 'VIP', label: 'VIP' },
  ];
  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">สมาชิก & บัตรจอดรถ</h1>
      </div>
      <Tabs
        tabs={[
          { id: 'members', label: 'สมาชิก' },
          { id: 'tiers', label: 'Member Tier' },
          { id: 'passes', label: 'บัตรรายเดือน / รายปี / พนักงาน' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'members' && (
        <CrudTable<Row, Row>
          title="สมาชิก"
          url="/api/admin/members"
          query={search ? `?q=${encodeURIComponent(search)}` : ''}
          headerActions={<Input placeholder="ค้นหาชื่อ / เบอร์ / ทะเบียน" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />}
          columns={[
            { label: 'ชื่อ', render: (r) => `${r.first_name} ${r.last_name ?? ''}` },
            { label: 'เบอร์โทร', render: (r) => r.phone },
            { label: 'Tier', render: (r) => <Badge tone="info">{r.tier_name ?? r.tier}</Badge> },
            { label: 'รถ', render: (r) => (r.vehicles ?? []).map((v: Row) => `${v.plate_prefix} ${v.plate_number}`).join(', ') || '-' },
            { label: 'ยินยอม PDPA', render: (r) => (r.consent_at ? date(r.consent_at) : '-') },
            { label: 'สถานะ', render: (r) => activeBadge(r.active) },
          ]}
          actions={(r) => (
            <Button size="sm" onClick={() => setVehicles(r)}>
              รถ ({r.vehicles?.length ?? 0})
            </Button>
          )}
          fields={[
            { key: 'firstName', label: 'ชื่อ' },
            { key: 'lastName', label: 'นามสกุล' },
            { key: 'phone', label: 'เบอร์โทรศัพท์' },
            { key: 'email', label: 'Email' },
            { key: 'tier', label: 'Tier', type: 'select', options: tierOpts },
            { key: 'consent', label: 'ลูกค้ายินยอมให้เก็บข้อมูลตาม PDPA', type: 'check' },
            { key: 'prefix', label: 'ทะเบียนรถคันแรก: หมวด', createOnly: true },
            { key: 'number', label: 'เลขทะเบียน', createOnly: true },
            { key: 'province', label: 'จังหวัด', type: 'province', createOnly: true },
          ]}
          empty={() => ({ firstName: '', lastName: '', phone: '', email: '', tier: 'REGULAR', consent: true, prefix: '', number: '', province: '10' })}
          toForm={(r) => ({ firstName: r.first_name, lastName: r.last_name ?? '', phone: r.phone, email: r.email ?? '', tier: r.tier, consent: !!r.consent_at })}
          toBody={(f, editing) => {
            const b: Row = { firstName: f.firstName, lastName: f.lastName, phone: f.phone, email: f.email || null, tier: f.tier, consent: f.consent };
            if (!editing && f.prefix && f.number) b.vehicles = [{ prefix: f.prefix, number: f.number, province: f.province }];
            return b;
          }}
        />
      )}
      {tab === 'tiers' && (
        <CrudTable<Row, Row>
          title="Member Tier และสิทธิประโยชน์"
          url="/api/admin/member-tiers"
          itemUrl={(r) => `/api/admin/member-tiers/${r.code}`}
          rowKey={(r) => r.code}
          columns={[
            { label: 'รหัส', render: (r) => r.code },
            { label: 'ชื่อ', render: (r) => r.name },
            { label: 'จอดฟรีเพิ่ม (นาที)', render: (r) => r.benefits?.extraFreeMinutes ?? 0 },
            { label: 'ส่วนลด %', render: (r) => r.benefits?.discountPercent ?? 0 },
            { label: 'ไม่ต้องรับบัตร', render: (r) => (r.benefits?.ticketless ? '✓' : '-') },
            { label: 'สมาชิก', render: (r) => r.members },
          ]}
          fields={[
            { key: 'code', label: 'รหัส', createOnly: true },
            { key: 'name', label: 'ชื่อ' },
            { key: 'sort', label: 'ลำดับ', type: 'number' },
            { key: 'extraFreeMinutes', label: 'จอดฟรีเพิ่ม (นาที)', type: 'number' },
            { key: 'discountPercent', label: 'ส่วนลดค่าจอด %', type: 'number' },
            { key: 'ticketless', label: 'เข้า–ออกโดยไม่ต้องรับบัตร', type: 'check' },
          ]}
          empty={() => ({ code: '', name: '', sort: 0, extraFreeMinutes: 0, discountPercent: 0, ticketless: false })}
          toForm={(r) => ({ code: r.code, name: r.name, sort: r.sort, ...r.benefits })}
          toBody={(f) => ({ code: f.code, name: f.name, sort: f.sort, benefits: { extraFreeMinutes: f.extraFreeMinutes, discountPercent: f.discountPercent, ticketless: f.ticketless } })}
        />
      )}
      {tab === 'passes' && (
        <CrudTable<Row, Row>
          title="บัตรจอดรถ"
          url="/api/admin/passes"
          columns={[
            { label: 'ประเภท', render: (r) => <Badge tone="info">{r.type}</Badge> },
            { label: 'ทะเบียน', render: (r) => <PlateBadge plate={r.plate_text} province={provinceName(r.province)} /> },
            { label: 'ผู้ถือ', render: (r) => r.member_name ?? r.holder_name ?? '-' },
            { label: 'ใช้ได้', render: (r) => `${date(r.valid_from)} – ${date(r.valid_to)}` },
            { label: 'ไม่ต้องรับบัตร', render: (r) => (r.ticketless ? '✓' : '-') },
            { label: 'จอดฟรี', render: (r) => (r.free_parking ? '✓' : '-') },
            { label: 'สถานะ', render: (r) => activeBadge(r.active) },
          ]}
          fields={[
            { key: 'type', label: 'ประเภท', type: 'select', options: [{ value: 'MONTHLY', label: 'รายเดือน' }, { value: 'YEARLY', label: 'รายปี' }, { value: 'STAFF', label: 'พนักงาน' }, { value: 'PERMIT', label: 'ทะเบียนที่ได้รับอนุญาต' }] },
            { key: 'holderName', label: 'ชื่อผู้ถือบัตร' },
            { key: 'prefix', label: 'หมวดอักษร' },
            { key: 'number', label: 'เลขทะเบียน' },
            { key: 'province', label: 'จังหวัด', type: 'province' },
            { key: 'siteId', label: 'สาขา', type: 'select', options: [{ value: '', label: 'ทุกสาขา' }, ...lk.sites.map((s) => ({ value: s.id, label: s.name }))] },
            { key: 'validFrom', label: 'เริ่ม', type: 'datetime' },
            { key: 'validTo', label: 'สิ้นสุด', type: 'datetime' },
            { key: 'price', label: 'ราคา (บาท)', type: 'number' },
            { key: 'ticketless', label: 'เข้า–ออกโดยไม่ต้องรับบัตร', type: 'check' },
            { key: 'freeParking', label: 'ไม่คิดค่าจอด', type: 'check' },
            { key: 'active', label: 'ใช้งาน', type: 'check' },
          ]}
          empty={() => ({ type: 'MONTHLY', holderName: '', prefix: '', number: '', province: '10', siteId: '', validFrom: new Date().toISOString(), validTo: new Date(Date.now() + 30 * 86400_000).toISOString(), price: 0, ticketless: true, freeParking: true, active: true })}
          toForm={(r) => ({ type: r.type, holderName: r.holder_name ?? '', prefix: r.plate_text?.split(' ')[0], number: r.plate_text?.split(' ')[1], province: r.province, siteId: r.site_id ?? '', validFrom: r.valid_from, validTo: r.valid_to, price: r.price, ticketless: !!r.ticketless, freeParking: !!r.free_parking, active: !!r.active })}
          toBody={(f) => ({ ...f, siteId: f.siteId ? Number(f.siteId) : null })}
        />
      )}
      {vehicles && <VehiclesModal member={vehicles} onClose={() => setVehicles(null)} />}
    </>
  );
}
