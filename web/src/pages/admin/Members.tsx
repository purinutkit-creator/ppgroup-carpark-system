import { useEffect, useState } from 'react';
import { del, get, post, put, qs } from '../../lib/api';
import { date, dateTime, money } from '../../lib/format';
import { Badge, Button, Card, Check, ConfirmDialog, Empty, Field, Input, Modal, NumberInput, Pagination, PlateBadge, Select, Tabs, useAsync, useToast, errorText } from '../../components/ui';
import { PlateFields, emptyPlate, localDay, dayToIso, plateFromKey, provinceName, useLookups, type PlateValue } from '../../components/config/common';

interface Vehicle {
  id: number;
  plate_prefix: string;
  plate_number: string;
  province: string | null;
  plate_key: string;
  vehicle_type: string;
}
interface Member {
  id: number;
  phone: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  tier: string;
  tier_name: string | null;
  consent_at: string | null;
  active: number;
  created_at: string;
  vehicles: Vehicle[];
}
interface Tier {
  code: string;
  name: string;
  sort: number;
  members: number;
  benefits: { extraFreeMinutes: number; discountPercent: number; ticketless: boolean };
}
interface Pass {
  id: number;
  type: 'MONTHLY' | 'YEARLY' | 'STAFF' | 'PERMIT';
  member_id: number | null;
  member_name: string | null;
  holder_name: string | null;
  plate_key: string;
  plate_text: string;
  province: string | null;
  site_id: number | null;
  site_name: string | null;
  valid_from: string;
  valid_to: string;
  ticketless: number;
  free_parking: number;
  price: number;
  active: number;
}

const PASS_LABEL: Record<string, string> = { MONTHLY: 'รายเดือน', YEARLY: 'รายปี', STAFF: 'พนักงาน', PERMIT: 'ใบอนุญาต' };
const useTiers = () => useAsync(() => get<{ items: Tier[] }>('/api/admin/member-tiers').then((r) => r.items), []);

export default function Members() {
  const [tab, setTab] = useState<'members' | 'tiers' | 'passes'>('members');
  return (
    <>
      <div className="page-header">
        <h1>สมาชิก / บัตรจอดรถ</h1>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'members', label: 'สมาชิก' },
          { id: 'tiers', label: 'ระดับสมาชิก' },
          { id: 'passes', label: 'บัตรรายเดือน / Pass' },
        ]}
      />
      {tab === 'members' && <MembersTab />}
      {tab === 'tiers' && <TiersTab />}
      {tab === 'passes' && <PassesTab />}
    </>
  );
}

function MembersTab() {
  const tiers = useTiers();
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useAsync(() => get<{ total: number; items: Member[] }>(`/api/admin/members${qs({ q, tier, offset, limit: 50 })}`), [q, tier, offset]);
  const [edit, setEdit] = useState<Partial<Member> | null>(null);
  return (
    <Card>
      <div className="filters mb">
        <Field label="ค้นหา">
          <Input
            value={q}
            placeholder="ชื่อ / เบอร์โทร / ทะเบียน"
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
        <Field label="ระดับ">
          <Select value={tier} placeholder="ทั้งหมด" options={(tiers.data ?? []).map((t) => ({ value: t.code, label: t.name }))} onChange={(e) => setTier(e.target.value)} />
        </Field>
        <span className="spacer" />
        <Button variant="primary" onClick={() => setEdit({ tier: 'REGULAR', vehicles: [] })}>
          + สมาชิกใหม่
        </Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ชื่อ</th>
              <th>เบอร์โทร</th>
              <th>ระดับ</th>
              <th>ทะเบียนรถ</th>
              <th>PDPA</th>
              <th>สมัครเมื่อ</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.items ?? []).map((m) => (
              <tr key={m.id} className="clickable" onClick={() => setEdit(m)}>
                <td>
                  {m.first_name} {m.last_name ?? ''} {!m.active && <Badge tone="danger">ปิด</Badge>}
                </td>
                <td>{m.phone}</td>
                <td>
                  <Badge tone="info">{m.tier_name ?? m.tier}</Badge>
                </td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    {m.vehicles.map((v) => (
                      <PlateBadge key={v.id} plate={`${v.plate_prefix} ${v.plate_number}`} province={provinceName(v.province)} size={12} />
                    ))}
                  </div>
                </td>
                <td>{m.consent_at ? <Badge tone="success">ยินยอม {date(m.consent_at)}</Badge> : <Badge tone="warning">ยังไม่ยินยอม</Badge>}</td>
                <td>{date(m.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.loading && !list.data?.items.length && <Empty />}
      </div>
      <Pagination total={list.data?.total ?? 0} limit={50} offset={offset} onChange={setOffset} />
      <MemberModal member={edit} tiers={tiers.data ?? []} onClose={() => setEdit(null)} onSaved={() => list.reload()} />
    </Card>
  );
}

function MemberModal({ member, tiers, onClose, onSaved }: { member: Partial<Member> | null; tiers: Tier[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Partial<Member>>({});
  const [plate, setPlate] = useState<PlateValue>(emptyPlate());
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [newVehicles, setNewVehicles] = useState<PlateValue[]>([]);
  const [confirmOff, setConfirmOff] = useState(false);
  useEffect(() => {
    setF(member ?? {});
    setVehicles(member?.vehicles ?? []);
    setNewVehicles([]);
    setPlate(emptyPlate());
  }, [member]);
  const isNew = !f.id;
  const save = async () => {
    try {
      const body = { phone: f.phone, firstName: f.first_name, lastName: f.last_name, email: f.email, tier: f.tier, consent: !!f.consent_at, active: f.active !== 0 };
      if (isNew) await post('/api/admin/members', { ...body, vehicles: newVehicles });
      else await put(`/api/admin/members/${f.id}`, body);
      toast('บันทึกสมาชิกแล้ว', 'success');
      onSaved();
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const addVehicle = async () => {
    if (!plate.prefix || !plate.number) return;
    if (isNew) {
      setNewVehicles([...newVehicles, plate]);
      setPlate(emptyPlate());
      return;
    }
    try {
      const r = await post<{ id: number }>(`/api/admin/members/${f.id}/vehicles`, plate);
      setVehicles([...vehicles, { id: r.id, plate_prefix: plate.prefix, plate_number: String(Number(plate.number)), province: plate.province, plate_key: '', vehicle_type: 'CAR' }]);
      setPlate(emptyPlate());
      onSaved();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Modal
      open={!!member}
      size="lg"
      title={isNew ? 'สมาชิกใหม่' : `สมาชิก #${f.id}`}
      onClose={onClose}
      footer={
        <>
          {!isNew && f.active !== 0 && (
            <Button variant="danger" onClick={() => setConfirmOff(true)}>
              ปิดสมาชิก
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" onClick={save}>
            บันทึก
          </Button>
        </>
      }
    >
      <div className="col">
        <div className="grid grid-2">
          <Field label="ชื่อ">
            <Input value={f.first_name ?? ''} onChange={(e) => setF({ ...f, first_name: e.target.value })} />
          </Field>
          <Field label="นามสกุล">
            <Input value={f.last_name ?? ''} onChange={(e) => setF({ ...f, last_name: e.target.value })} />
          </Field>
          <Field label="เบอร์โทรศัพท์">
            <Input value={f.phone ?? ''} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label="อีเมล">
            <Input value={f.email ?? ''} type="email" onChange={(e) => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="ระดับสมาชิก">
            <Select value={f.tier ?? 'REGULAR'} options={tiers.map((t) => ({ value: t.code, label: t.name }))} onChange={(e) => setF({ ...f, tier: e.target.value })} />
          </Field>
          <Field label="ความยินยอม PDPA" hint={f.consent_at ? `ยินยอมเมื่อ ${dateTime(f.consent_at)}` : 'ต้องได้รับความยินยอมก่อนเก็บข้อมูลเพื่อการตลาด'}>
            <Check label="ลูกค้ายินยอมให้เก็บและใช้ข้อมูลส่วนบุคคล" checked={!!f.consent_at} onChange={(v) => setF({ ...f, consent_at: v ? (member?.consent_at ?? new Date().toISOString()) : null })} />
          </Field>
        </div>
        {!isNew && f.active === 0 && <Button onClick={() => setF({ ...f, active: 1 })}>เปิดใช้งานสมาชิกอีกครั้ง</Button>}
        <fieldset className="group">
          <legend>รถของสมาชิก</legend>
          <div className="row mb">
            {vehicles.map((v) => (
              <span key={v.id} className="row" style={{ gap: 4 }}>
                <PlateBadge plate={`${v.plate_prefix} ${v.plate_number}`} province={provinceName(v.province)} size={13} />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await del(`/api/admin/members/${f.id}/vehicles/${v.id}`);
                      setVehicles(vehicles.filter((x) => x.id !== v.id));
                      onSaved();
                    } catch (e) {
                      toast(errorText(e), 'error');
                    }
                  }}
                >
                  ✕
                </Button>
              </span>
            ))}
            {newVehicles.map((v, i) => (
              <span key={`n${i}`} className="row" style={{ gap: 4 }}>
                <PlateBadge plate={`${v.prefix} ${v.number}`} province={provinceName(v.province)} size={13} />
                <Button size="sm" variant="ghost" onClick={() => setNewVehicles(newVehicles.filter((_, j) => j !== i))}>
                  ✕
                </Button>
              </span>
            ))}
            {!vehicles.length && !newVehicles.length && <span className="muted small">ยังไม่มีรถ</span>}
          </div>
          <PlateFields value={plate} onChange={setPlate} />
          <Button size="sm" className="mt" onClick={addVehicle} disabled={!plate.prefix || !plate.number}>
            + เพิ่มรถ
          </Button>
        </fieldset>
      </div>
      <ConfirmDialog
        open={confirmOff}
        danger
        title="ปิดสมาชิกนี้?"
        message="สิทธิประโยชน์สมาชิกจะไม่ถูกใช้กับการจอดครั้งถัดไป"
        onClose={() => setConfirmOff(false)}
        onConfirm={async () => {
          await del(`/api/admin/members/${f.id}`);
          onSaved();
          onClose();
        }}
      />
    </Modal>
  );
}

function TiersTab() {
  const toast = useToast();
  const tiers = useTiers();
  const [edit, setEdit] = useState<(Partial<Tier> & { isNew?: boolean }) | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      const body = { code: edit.code, name: edit.name, sort: edit.sort ?? 0, benefits: edit.benefits };
      if (edit.isNew) await post('/api/admin/member-tiers', body);
      else await put(`/api/admin/member-tiers/${edit.code}`, body);
      setEdit(null);
      tiers.reload();
      toast('บันทึกแล้ว', 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const b = edit?.benefits ?? { extraFreeMinutes: 0, discountPercent: 0, ticketless: false };
  return (
    <Card title="ระดับสมาชิกและสิทธิประโยชน์" actions={<Button size="sm" variant="primary" onClick={() => setEdit({ isNew: true, code: '', name: '', sort: (tiers.data?.length ?? 0) + 1, benefits: { extraFreeMinutes: 0, discountPercent: 0, ticketless: false } })}>+ เพิ่มระดับ</Button>}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อ</th>
              <th>จอดฟรีเพิ่ม</th>
              <th>ส่วนลด</th>
              <th>ไม่ต้องรับบัตร</th>
              <th>สมาชิก</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(tiers.data ?? []).map((t) => (
              <tr key={t.code}>
                <td className="mono">{t.code}</td>
                <td>{t.name}</td>
                <td>{t.benefits.extraFreeMinutes} นาที</td>
                <td>{t.benefits.discountPercent}%</td>
                <td>{t.benefits.ticketless ? 'ใช่' : '-'}</td>
                <td>{t.members}</td>
                <td className="right nowrap">
                  <Button size="sm" variant="ghost" onClick={() => setEdit(structuredClone(t))}>
                    แก้ไข
                  </Button>
                  {t.code !== 'REGULAR' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={t.members > 0}
                      onClick={() =>
                        del(`/api/admin/member-tiers/${t.code}`)
                          .then(tiers.reload)
                          .catch((e) => toast(errorText(e), 'error'))
                      }
                    >
                      ลบ
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={!!edit}
        title={edit?.isNew ? 'ระดับสมาชิกใหม่' : `แก้ไขระดับ ${edit?.code}`}
        onClose={() => setEdit(null)}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>ยกเลิก</Button>
            <Button variant="primary" onClick={save}>
              บันทึก
            </Button>
          </>
        }
      >
        {edit && (
          <div className="col">
            <div className="grid grid-3">
              <Field label="รหัส">
                <Input value={edit.code ?? ''} disabled={!edit.isNew} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="ชื่อ">
                <Input value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </Field>
              <Field label="ลำดับ">
                <NumberInput value={edit.sort ?? 0} onChange={(v) => setEdit({ ...edit, sort: v ?? 0 })} />
              </Field>
              <Field label="จอดฟรีเพิ่ม (นาที)">
                <NumberInput min={0} value={b.extraFreeMinutes} onChange={(v) => setEdit({ ...edit, benefits: { ...b, extraFreeMinutes: v ?? 0 } })} />
              </Field>
              <Field label="ส่วนลดค่าจอด (%)">
                <NumberInput min={0} max={100} value={b.discountPercent} onChange={(v) => setEdit({ ...edit, benefits: { ...b, discountPercent: v ?? 0 } })} />
              </Field>
            </div>
            <Check label="เข้าออกด้วยทะเบียนโดยไม่ต้องรับบัตร (Ticketless)" checked={b.ticketless} onChange={(v) => setEdit({ ...edit, benefits: { ...b, ticketless: v } })} />
          </div>
        )}
      </Modal>
    </Card>
  );
}

function PassesTab() {
  const toast = useToast();
  const lk = useLookups();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const list = useAsync(() => get<{ items: Pass[] }>(`/api/admin/passes${qs({ q, type, status, limit: 200 })}`).then((r) => r.items), [q, type, status]);
  const [edit, setEdit] = useState<Partial<Pass> | null>(null);
  const [plate, setPlate] = useState<PlateValue>(emptyPlate());
  useEffect(() => setPlate(edit?.plate_key ? plateFromKey(edit.plate_key) : emptyPlate()), [edit?.id, edit?.plate_key]);
  const now = new Date().toISOString();
  const save = async () => {
    if (!edit) return;
    try {
      const body = {
        type: edit.type,
        ...plate,
        holderName: edit.holder_name,
        memberId: edit.member_id ?? null,
        siteId: edit.site_id ?? null,
        validFrom: edit.valid_from,
        validTo: edit.valid_to,
        ticketless: edit.ticketless !== 0,
        freeParking: edit.free_parking !== 0,
        price: edit.price ?? 0,
        active: edit.active !== 0,
      };
      if (edit.id) await put(`/api/admin/passes/${edit.id}`, body);
      else await post('/api/admin/passes', body);
      setEdit(null);
      list.reload();
      toast('บันทึกบัตรแล้ว', 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const newPass = (): Partial<Pass> => {
    const from = new Date();
    const to = new Date(from.getTime() + 30 * 86400_000);
    return { type: 'MONTHLY', valid_from: dayToIso(localDay(from.toISOString()))!, valid_to: dayToIso(localDay(to.toISOString()), true)!, ticketless: 1, free_parking: 1, price: 0, site_id: lk.sites[0]?.id ?? null };
  };
  return (
    <Card>
      <div className="filters mb">
        <Field label="ค้นหา">
          <Input value={q} placeholder="ทะเบียน / ชื่อผู้ถือ" onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="ประเภท">
          <Select value={type} placeholder="ทั้งหมด" options={Object.entries(PASS_LABEL).map(([value, label]) => ({ value, label }))} onChange={(e) => setType(e.target.value)} />
        </Field>
        <Field label="สถานะ">
          <Select
            value={status}
            options={[
              { value: '', label: 'ใช้งาน' },
              { value: 'valid', label: 'อยู่ในช่วงใช้ได้' },
              { value: 'expired', label: 'หมดอายุ' },
              { value: 'inactive', label: 'ยกเลิกแล้ว' },
              { value: 'all', label: 'ทั้งหมด' },
            ]}
            onChange={(e) => setStatus(e.target.value)}
          />
        </Field>
        <span className="spacer" />
        <Button variant="primary" onClick={() => setEdit(newPass())}>
          + ออกบัตรใหม่
        </Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>ทะเบียน</th>
              <th>ประเภท</th>
              <th>ผู้ถือ</th>
              <th>สาขา</th>
              <th>ใช้ได้</th>
              <th>สิทธิ์</th>
              <th>ราคา</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((p) => {
              const valid = p.active && p.valid_from <= now && p.valid_to >= now;
              return (
                <tr key={p.id} className="clickable" onClick={() => setEdit(p)}>
                  <td>
                    <PlateBadge plate={p.plate_text} province={provinceName(p.province)} size={13} />
                  </td>
                  <td>{PASS_LABEL[p.type]}</td>
                  <td>{p.holder_name ?? p.member_name ?? '-'}</td>
                  <td>{p.site_name ?? 'ทุกสาขา'}</td>
                  <td className="small nowrap">
                    {date(p.valid_from)} – {date(p.valid_to)}
                  </td>
                  <td className="small">
                    {p.ticketless ? 'ไม่ต้องรับบัตร' : 'รับบัตร'} · {p.free_parking ? 'จอดฟรี' : 'คิดค่าจอด'}
                  </td>
                  <td>{money(p.price)}</td>
                  <td>{!p.active ? <Badge tone="danger">ยกเลิก</Badge> : valid ? <Badge tone="success">ใช้ได้</Badge> : <Badge tone="warning">ไม่อยู่ในช่วง</Badge>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.loading && !list.data?.length && <Empty />}
      </div>
      <Modal
        open={!!edit}
        size="lg"
        title={edit?.id ? `บัตร #${edit.id}` : 'ออกบัตรจอดรถใหม่'}
        onClose={() => setEdit(null)}
        footer={
          <>
            {edit?.id && edit.active !== 0 && (
              <Button
                variant="danger"
                onClick={() =>
                  del(`/api/admin/passes/${edit.id}`)
                    .then(() => {
                      setEdit(null);
                      list.reload();
                    })
                    .catch((e) => toast(errorText(e), 'error'))
                }
              >
                ยกเลิกบัตร
              </Button>
            )}
            <span className="spacer" />
            <Button onClick={() => setEdit(null)}>ปิด</Button>
            <Button variant="primary" onClick={save}>
              บันทึก
            </Button>
          </>
        }
      >
        {edit && (
          <div className="col">
            <PlateFields value={plate} onChange={setPlate} requireProvince />
            <div className="grid grid-3">
              <Field label="ประเภทบัตร">
                <Select value={edit.type ?? 'MONTHLY'} options={Object.entries(PASS_LABEL).map(([value, label]) => ({ value, label }))} onChange={(e) => setEdit({ ...edit, type: e.target.value as Pass['type'] })} />
              </Field>
              <Field label="ชื่อผู้ถือบัตร">
                <Input value={edit.holder_name ?? ''} onChange={(e) => setEdit({ ...edit, holder_name: e.target.value })} />
              </Field>
              <Field label="รหัสสมาชิก (ถ้ามี)">
                <NumberInput value={edit.member_id ?? null} onChange={(v) => setEdit({ ...edit, member_id: v })} />
              </Field>
              <Field label="สาขา">
                <Select value={edit.site_id ?? ''} placeholder="ทุกสาขา" options={lk.sites.map((s) => ({ value: s.id, label: s.name }))} onChange={(e) => setEdit({ ...edit, site_id: e.target.value ? Number(e.target.value) : null })} />
              </Field>
              <Field label="เริ่มใช้">
                <Input type="date" value={localDay(edit.valid_from)} onChange={(e) => setEdit({ ...edit, valid_from: dayToIso(e.target.value) ?? undefined })} />
              </Field>
              <Field label="หมดอายุ">
                <Input type="date" value={localDay(edit.valid_to)} onChange={(e) => setEdit({ ...edit, valid_to: dayToIso(e.target.value, true) ?? undefined })} />
              </Field>
              <Field label="ราคา (บาท)">
                <NumberInput min={0} value={edit.price ?? 0} onChange={(v) => setEdit({ ...edit, price: v ?? 0 })} />
              </Field>
            </div>
            <div className="row">
              <Check label="เข้าออกด้วยทะเบียน ไม่ต้องรับบัตร" checked={edit.ticketless !== 0} onChange={(v) => setEdit({ ...edit, ticketless: v ? 1 : 0 })} />
              <Check label="จอดฟรี" checked={edit.free_parking !== 0} onChange={(v) => setEdit({ ...edit, free_parking: v ? 1 : 0 })} />
              {edit.id && edit.active === 0 && <Check label="เปิดใช้งานอีกครั้ง" checked={false} onChange={(v) => v && setEdit({ ...edit, active: 1 })} />}
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
