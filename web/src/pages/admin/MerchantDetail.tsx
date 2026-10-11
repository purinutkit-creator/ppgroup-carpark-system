import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, put, qs } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, money, num } from '../../lib/format';
import {
  ApprovalDialog,
  Badge,
  Button,
  Card,
  Check,
  Empty,
  Field,
  Input,
  Kpi,
  Modal,
  NumberInput,
  Pagination,
  Select,
  SettingsFooter,
  Tabs,
  errorText,
  useAsync,
  useToast,
} from '../../components/ui';
import { SaleBody, SalesTable, SecretBox, TrendBars } from '../../components/pos/common';
import { PromotionManager } from '../../components/pos/PromotionEditor';
import { MERCHANT_CATEGORIES, MERCHANT_STATUS_LABEL, bkkDate, dayEndIso, dayStartIso, type Sale } from '../../components/pos/types';

type Tab = 'overview' | 'branches' | 'validation' | 'transactions' | 'receipts' | 'validations' | 'refunds' | 'audit';

interface Detail {
  merchant: Record<string, any> & { id: number; name: string; status: string; code: string | null; receipt_info: Record<string, any>; contact: Record<string, string>; reference: string };
  branches: Array<{ id: number; code: string; name: string; site_id: number | null; active: number }>;
  users: Array<{ id: number; username: string; display_name: string; role: string; active: number; last_login_at: string | null; branch_code: string | null }>;
  devices: Array<{ id: number; name: string; type: string; status: string; last_seen_at: string | null; active: number }>;
  stats: {
    today: { sales: number; transactions: number; voids: number; refunds: number; receiptsValidated: number; validatedPurchase: number; parkingDiscountValue: number };
    allTime: { transactions: number; sales: number; receipts: number; purchase: number; discountValue: number };
    staffCount: number;
    devices: number;
    trend: Array<{ date: string; net: number; count: number }>;
    discountMethod: string;
  };
}

type Secret = { title: string; rows: Array<{ label: string; value: string }> };

const ACTIONS: Record<string, { label: string; variant?: 'primary' | 'danger' | 'success'; reason?: boolean; perm: string }> = {
  activate: { label: 'เปิดใช้งาน (Activate)', variant: 'success', perm: 'merchants.approve' },
  reactivate: { label: 'เปิดใช้งานอีกครั้ง', variant: 'success', perm: 'merchants.manage' },
  suspend: { label: 'ระงับร้าน', variant: 'danger', reason: true, perm: 'merchants.manage' },
  close: { label: 'ปิดร้าน', variant: 'danger', reason: true, perm: 'merchants.manage' },
  reject: { label: 'ปฏิเสธคำขอ', variant: 'danger', reason: true, perm: 'merchants.approve' },
};
const AVAILABLE: Record<string, string[]> = {
  PENDING: ['reject', 'close'],
  APPROVED: ['activate', 'suspend', 'close'],
  ACTIVE: ['suspend', 'close'],
  SUSPENDED: ['activate', 'reactivate', 'close'],
  CLOSED: ['reactivate'],
  REJECTED: [],
};

export default function MerchantDetail() {
  const { id } = useParams();
  const mid = Number(id);
  const { can } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [secret, setSecret] = useState<Secret | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const { data, error, reload } = useAsync(() => get<Detail>(`/api/merchants/${mid}`), [mid]);
  const manage = can('merchants.manage');

  if (error) return <div className="card" style={{ color: 'var(--color-danger)' }}>{error}</div>;
  if (!data) return <Empty>กำลังโหลด…</Empty>;
  const m = data.merchant;

  const approve = async () => {
    try {
      const r = await post<{ merchant: { code: string }; credentials: { username: string; temporaryPassword: string; pin: string }; posDevice: { id: number; key: string } }>(`/api/merchants/${mid}/approve`);
      setSecret({
        title: `อนุมัติแล้ว — Merchant ID ${r.merchant.code}`,
        rows: [
          { label: 'Merchant ID', value: r.merchant.code },
          { label: 'ชื่อผู้ใช้ (เจ้าของร้าน)', value: r.credentials.username },
          { label: 'รหัสผ่านชั่วคราว', value: r.credentials.temporaryPassword },
          { label: 'PIN', value: r.credentials.pin },
          { label: 'POS Device Key', value: r.posDevice.key },
        ],
      });
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const run = async (act: string, reason?: string) => {
    await post(`/api/merchants/${mid}/${act}`, { reason });
    toast('บันทึกแล้ว', 'success');
    reload();
  };

  return (
    <>
      <div className="page-header">
        <Link to="/admin/merchants" className="btn btn-ghost btn-sm">
          ← ร้านค้า
        </Link>
        {m.logo_url && <img src={m.logo_url} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} />}
        <div>
          <h1 style={{ margin: 0 }}>{m.name}</h1>
          <div className="small muted">
            {m.code ?? 'ยังไม่มี Merchant ID'} · {m.reference} · <Badge>{m.status}</Badge> {MERCHANT_STATUS_LABEL[m.status]}
            {m.status_reason && ` — ${m.status_reason}`}
          </div>
        </div>
        <div className="actions">
          {m.status === 'PENDING' && can('merchants.approve') && (
            <Button variant="primary" onClick={approve}>
              ✓ อนุมัติร้านค้า
            </Button>
          )}
          {(AVAILABLE[m.status] ?? [])
            .filter((a) => can(ACTIONS[a].perm, 'merchants.approve'))
            .map((a) =>
              ACTIONS[a].reason ? (
                <Button key={a} variant={ACTIONS[a].variant} onClick={() => setAction(a)}>
                  {ACTIONS[a].label}
                </Button>
              ) : (
                <Button key={a} variant={ACTIONS[a].variant} onClick={() => run(a).catch((e) => toast(errorText(e), 'error'))}>
                  {ACTIONS[a].label}
                </Button>
              ),
            )}
        </div>
      </div>

      {secret && (
        <Card>
          <SecretBox title={secret.title} rows={secret.rows} />
          <div className="row" style={{ marginTop: 8 }}>
            <span className="spacer" />
            <Button onClick={() => setSecret(null)}>บันทึกข้อมูลแล้ว — ปิด</Button>
          </div>
        </Card>
      )}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'ภาพรวม' },
          { id: 'branches', label: 'สาขา' },
          { id: 'validation', label: 'สิทธิ์จอดรถ & โปรโมชั่น' },
          { id: 'transactions', label: 'รายการขาย' },
          { id: 'receipts', label: 'ใบเสร็จ & การใช้สิทธิ์' },
          { id: 'validations', label: 'ประวัติใช้สิทธิ์จอด' },
          { id: 'refunds', label: 'คืนเงิน / Void' },
          { id: 'audit', label: 'Audit' },
        ]}
      />

      {tab === 'overview' && <Overview d={data} manage={manage} onSecret={setSecret} reload={reload} />}
      {tab === 'branches' && <Branches mid={mid} manage={manage} />}
      {tab === 'validation' && (
        <>
          <ValidationEligibility m={m} canEdit={manage || can('validation.rules')} reload={reload} />
          <PromotionManager merchantId={mid} canEdit={manage || can('validation.rules')} />
        </>
      )}
      {tab === 'transactions' && <SalesTab mid={mid} kind="transactions" />}
      {tab === 'receipts' && <SalesTab mid={mid} kind="receipts" />}
      {tab === 'validations' && <Validations mid={mid} />}
      {tab === 'refunds' && <Refunds mid={mid} />}
      {tab === 'audit' && <Audit mid={mid} />}

      <ApprovalDialog
        open={!!action}
        title={action ? ACTIONS[action].label : ''}
        description={`${m.name} (${m.code ?? m.reference})`}
        submitText="ยืนยัน"
        onClose={() => setAction(null)}
        onSubmit={async (v) => run(action!, v.reason)}
      />
    </>
  );
}

function Overview({ d, manage, onSecret, reload }: { d: Detail; manage: boolean; onSecret: (s: Secret) => void; reload: () => void }) {
  const toast = useToast();
  const m = d.merchant;
  const s = d.stats;
  const [resetUser, setResetUser] = useState<{ id: number; username: string } | null>(null);
  const resetCredentials = async (reason: string) => {
    const r = await post<{ username: string; temporaryPassword: string; pin: string }>(`/api/merchants/${m.id}/reset-credentials`, { userId: resetUser!.id, reason });
    onSecret({ title: `รีเซ็ตรหัสผ่าน ${r.username}`, rows: [{ label: 'ชื่อผู้ใช้', value: r.username }, { label: 'รหัสผ่านชั่วคราว', value: r.temporaryPassword }, { label: 'PIN', value: r.pin }] });
  };
  const newDevice = async () => {
    try {
      const r = await post<{ id: number; key: string }>(`/api/merchants/${m.id}/pos-devices`, {});
      onSecret({ title: `POS Device ใหม่ (#${r.id})`, rows: [{ label: 'POS Device Key', value: r.key }] });
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const togglePos = async () => {
    try {
      await post(`/api/merchants/${m.id}/pos`, { enabled: !m.pos_enabled });
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const cat = MERCHANT_CATEGORIES.find((c) => c.value === m.category)?.label ?? m.category;
  return (
    <>
      <div className="grid grid-4">
        <Kpi label="ยอดขายวันนี้" value={money(s.today.sales)} hint={`${s.today.transactions} บิล · Void ${s.today.voids}`} />
        <Kpi label="ใบเสร็จที่ใช้สิทธิ์จอดวันนี้" value={num(s.today.receiptsValidated)} hint={`ยอดซื้อ ${money(s.today.validatedPurchase)}`} />
        <Kpi label="มูลค่าส่วนลดจอดรถ (วันนี้)" value={money(s.today.parkingDiscountValue)} hint={`สะสม ${money(s.allTime.discountValue)}`} />
        <Kpi label="ยอดขายสะสม" value={money(s.allTime.sales)} hint={`${num(s.allTime.transactions)} บิล`} />
      </div>
      <Card title="ยอดขาย 30 วัน">
        <TrendBars data={s.trend} />
        <div className="small muted" style={{ marginTop: 6 }}>
          {s.discountMethod}
        </div>
      </Card>
      <div className="grid grid-2">
        <Card title="ข้อมูลร้านค้า">
          <div className="kv">
            <span>ประเภท</span>
            <span>{cat ?? '-'}</span>
            <span>ห้อง / โซน / ชั้น</span>
            <span>
              {m.unit_no ?? '-'} / {m.zone ?? '-'} / {m.floor ?? '-'}
            </span>
            <span>เจ้าของ</span>
            <span>
              {m.owner_first_name} {m.owner_last_name}
            </span>
            <span>โทร / อีเมล</span>
            <span>
              {m.phone} · {m.email}
            </span>
            <span>ผู้ติดต่อ</span>
            <span>{[m.contact?.name, m.contact?.phone, m.contact?.email, m.contact?.lineId && `LINE ${m.contact.lineId}`].filter(Boolean).join(' · ') || '-'}</span>
            <span>เลขผู้เสียภาษี</span>
            <span>{m.tax_id ?? '-'}</span>
            <span>ที่อยู่</span>
            <span>{m.address ?? '-'}</span>
            <span>หัว/ท้ายใบเสร็จ</span>
            <span>
              {m.receipt_info?.header ?? '-'} / {m.receipt_info?.footer ?? '-'}
            </span>
            <span>VAT</span>
            <span>{m.receipt_info?.vatRegistered ? `จด VAT ${m.receipt_info?.taxId ?? ''} (${m.receipt_info?.vatMode ?? 'INCLUDED'} ${m.receipt_info?.vatRate ?? 7}%)` : 'ไม่จด VAT'}</span>
            <span>อนุมัติเมื่อ</span>
            <span>{dateTime(m.approved_at)}</span>
          </div>
          {m.storefront_url && <img src={m.storefront_url} alt="" style={{ width: '100%', maxWidth: 400, borderRadius: 8, marginTop: 10, aspectRatio: '16/9', objectFit: 'cover' }} />}
        </Card>
        <div className="col">
          <Card
            title="POS"
            actions={manage && m.code ? (
              <Button size="sm" variant={m.pos_enabled ? 'danger' : 'success'} onClick={togglePos}>
                {m.pos_enabled ? 'ปิดการใช้งาน POS' : 'เปิดการใช้งาน POS'}
              </Button>
            ) : undefined}
          >
            <div className="row">
              สถานะ POS: {m.pos_enabled ? <Badge tone="success">เปิดใช้งาน</Badge> : <Badge tone="danger">ปิด</Badge>}
            </div>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>อุปกรณ์</th>
                    <th>สถานะ</th>
                    <th>ล่าสุด</th>
                  </tr>
                </thead>
                <tbody>
                  {d.devices.map((x) => (
                    <tr key={x.id}>
                      <td>
                        #{x.id} {x.name}
                        <div className="small muted">{x.type}</div>
                      </td>
                      <td>
                        <Badge>{x.status}</Badge>
                      </td>
                      <td className="small">{dateTime(x.last_seen_at)}</td>
                    </tr>
                  ))}
                  {!d.devices.length && (
                    <tr>
                      <td colSpan={3} className="muted">
                        ยังไม่มีอุปกรณ์
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {manage && m.code && (
              <Button size="sm" onClick={newDevice} style={{ marginTop: 8 }}>
                + สร้าง POS Device Key
              </Button>
            )}
          </Card>
          <Card title={`ผู้ใช้ของร้าน (${d.users.length})`}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>ผู้ใช้</th>
                    <th>บทบาท</th>
                    <th>เข้าระบบล่าสุด</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {d.users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        {u.display_name}
                        <div className="small muted mono">
                          {u.username} {u.branch_code && `· ${u.branch_code}`} {!u.active && '· ปิดใช้งาน'}
                        </div>
                      </td>
                      <td className="small">{u.role}</td>
                      <td className="small">{dateTime(u.last_login_at)}</td>
                      <td className="right">
                        {manage && (
                          <Button size="sm" onClick={() => setResetUser(u)}>
                            รีเซ็ตรหัสผ่าน/PIN
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
      <ApprovalDialog
        open={!!resetUser}
        title={`รีเซ็ตรหัสผ่านและ PIN: ${resetUser?.username ?? ''}`}
        description="ระบบจะสร้างรหัสผ่านชั่วคราวและ PIN ใหม่ และออกจากระบบทุกอุปกรณ์ของผู้ใช้นี้"
        onClose={() => setResetUser(null)}
        onSubmit={async (v) => resetCredentials(v.reason)}
      />
    </>
  );
}

function Branches({ mid, manage }: { mid: number; manage: boolean }) {
  const toast = useToast();
  const { data, reload } = useAsync(() => get<{ items: Detail['branches'] }>(`/api/merchants/${mid}/branches`), [mid]);
  const [edit, setEdit] = useState<{ id?: number; code: string; name: string; active: boolean } | null>(null);
  const save = async () => {
    try {
      if (edit!.id) await put(`/api/merchants/${mid}/branches/${edit!.id}`, { name: edit!.name, active: edit!.active });
      else await post(`/api/merchants/${mid}/branches`, { code: edit!.code || undefined, name: edit!.name });
      setEdit(null);
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Card
      title="สาขา"
      actions={manage ? (
        <Button size="sm" variant="primary" onClick={() => setEdit({ code: '', name: '', active: true })}>
          + เพิ่มสาขา
        </Button>
      ) : undefined}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อสาขา</th>
              <th>สถานะ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.code}</td>
                <td>{b.name}</td>
                <td>{b.active ? <Badge tone="success">ใช้งาน</Badge> : <Badge>ปิด</Badge>}</td>
                <td className="right">
                  {manage && (
                    <Button size="sm" onClick={() => setEdit({ id: b.id, code: b.code, name: b.name, active: !!b.active })}>
                      แก้ไข
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
        title={edit?.id ? `แก้ไขสาขา ${edit.code}` : 'เพิ่มสาขา'}
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
            {!edit.id && (
              <Field label="รหัสสาขา" hint="ว่างไว้ = สร้างอัตโนมัติ (B02, B03 …) — ใช้ในเลขที่ใบเสร็จ แก้ไขภายหลังไม่ได้">
                <Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} maxLength={10} />
              </Field>
            )}
            <Field label="ชื่อสาขา">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} maxLength={120} />
            </Field>
            {edit.id && <Check label="เปิดใช้งาน" checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} />}
          </div>
        )}
      </Modal>
    </Card>
  );
}

function ValidationEligibility({ m, canEdit, reload }: { m: Detail['merchant']; canEdit: boolean; reload: () => void }) {
  const [enabled, setEnabled] = useState(!!m.validation_enabled);
  const [minSpend, setMinSpend] = useState<number | null>(m.validation_min_spend ?? 0);
  useEffect(() => {
    setEnabled(!!m.validation_enabled);
    setMinSpend(m.validation_min_spend ?? 0);
  }, [m.validation_enabled, m.validation_min_spend]);
  const dirty = enabled !== !!m.validation_enabled || (minSpend ?? 0) !== (m.validation_min_spend ?? 0);
  return (
    <Card title="สิทธิ์ส่วนลดค่าจอดรถ (Validation Eligibility)">
      <div className="row">
        <Check label="ใบเสร็จของร้านนี้ใช้รับสิทธิ์จอดรถได้" checked={enabled} onChange={setEnabled} disabled={!canEdit} />
        <Field label="ยอดซื้อขั้นต่ำต่อใบเสร็จ (บาท)" hint="0 = ไม่กำหนด">
          <NumberInput value={minSpend} min={0} onChange={setMinSpend} disabled={!canEdit} style={{ width: 160 }} />
        </Field>
      </div>
      {canEdit && (
        <SettingsFooter
          dirty={dirty}
          onCancel={() => {
            setEnabled(!!m.validation_enabled);
            setMinSpend(m.validation_min_spend ?? 0);
          }}
          onSave={async () => {
            await put(`/api/merchants/${m.id}/validation`, { validation_enabled: enabled, validation_min_spend: minSpend ?? 0 });
            reload();
          }}
        />
      )}
    </Card>
  );
}

const LIMIT = 50;

function SalesTab({ mid, kind }: { mid: number; kind: 'transactions' | 'receipts' }) {
  const [from, setFrom] = useState(bkkDate(-6));
  const [to, setTo] = useState(bkkDate());
  const [status, setStatus] = useState('');
  const [validation, setValidation] = useState('');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Sale | null>(null);
  const { data, error } = useAsync(
    () => get<{ items: Sale[]; total: number; net: number }>(`/api/merchants/${mid}/${kind}${qs({ from: dayStartIso(from), to: dayEndIso(to), status, validation, q, limit: LIMIT, offset })}`),
    [mid, kind, from, to, status, validation, q, offset],
  );
  return (
    <>
      <div className="filters">
        <Field label="ตั้งแต่">
          <Input type="date" value={from} onChange={(e) => (setFrom(e.target.value), setOffset(0))} />
        </Field>
        <Field label="ถึง">
          <Input type="date" value={to} onChange={(e) => (setTo(e.target.value), setOffset(0))} />
        </Field>
        <Field label="สถานะ">
          <Select value={status} onChange={(e) => (setStatus(e.target.value), setOffset(0))} placeholder="ทั้งหมด" options={['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED']} />
        </Field>
        {kind === 'receipts' && (
          <Field label="สิทธิ์จอดรถ">
            <Select
              value={validation}
              onChange={(e) => (setValidation(e.target.value), setOffset(0))}
              placeholder="ทั้งหมด"
              options={[
                { value: 'USED', label: 'ใช้สิทธิ์แล้ว' },
                { value: 'NOT_USED', label: 'ยังไม่ใช้' },
                { value: 'REFUNDED_AFTER_VALIDATION', label: 'คืนเงินหลังใช้สิทธิ์' },
              ]}
            />
          </Field>
        )}
        <Field label="ค้นหา">
          <Input value={q} onChange={(e) => (setQ(e.target.value), setOffset(0))} placeholder="เลขใบเสร็จ / ทะเบียน / Parking ID / เบอร์สมาชิก" style={{ minWidth: 260 }} />
        </Field>
        {data && <span className="small muted">ยอดสุทธิ {money(data.net)} · {data.total} รายการ</span>}
      </div>
      {error && <div className="card" style={{ color: 'var(--color-danger)' }}>{error}</div>}
      <div className="card" style={{ padding: 0 }}>
        <SalesTable items={data?.items ?? []} onOpen={setOpen} />
      </div>
      {data && <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />}
      <Modal open={!!open} title={`ใบเสร็จ ${open?.receipt_no ?? ''}`} onClose={() => setOpen(null)} size="lg">
        {open && <SaleBody sale={open} usage={open.parking_no ? { parking_no: open.parking_no, plate_text: open.plate_text ?? null, created_at: open.validated_at ?? '', status: open.usage_status ?? '' } : null} />}
      </Modal>
    </>
  );
}

function Validations({ mid }: { mid: number }) {
  const [offset, setOffset] = useState(0);
  const { data } = useAsync(() => get<{ items: Array<Record<string, any>>; total: number }>(`/api/merchants/${mid}/validations${qs({ limit: LIMIT, offset })}`), [mid, offset]);
  if (!data) return <Empty>กำลังโหลด…</Empty>;
  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        {!data.items.length ? (
          <Empty>ยังไม่มีการใช้สิทธิ์จอดรถจากใบเสร็จของร้านนี้</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ใบเสร็จ</th>
                  <th className="right">ยอดซื้อ</th>
                  <th>Parking ID / ทะเบียน</th>
                  <th>ส่วนลดที่ได้</th>
                  <th>สถานะ</th>
                  <th>จุดที่สแกน</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td className="nowrap small">{dateTime(u.created_at)}</td>
                    <td className="mono">{u.receipt_ref}</td>
                    <td className="right num">{money(u.amount)}</td>
                    <td>
                      <Link to={`/admin/sessions/${u.session_id}`}>{u.parking_no}</Link>
                      <div className="small muted">{u.plate_text ?? '-'}</div>
                    </td>
                    <td className="small">
                      {u.full_waiver ? 'ฟรีทั้งหมด' : [u.discount_amount ? `ลด ${money(u.discount_amount)}` : null, u.free_minutes ? `ฟรี ${u.free_minutes} นาที` : null].filter(Boolean).join(' + ') || '-'}
                      {u.discount_status && <div><Badge>{u.discount_status}</Badge></div>}
                    </td>
                    <td>
                      <Badge>{u.status}</Badge>
                    </td>
                    <td className="small">
                      {u.counter ?? '-'} {u.scanned_by_name && `· ${u.scanned_by_name}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
    </>
  );
}

function Refunds({ mid }: { mid: number }) {
  const { data } = useAsync(() => get<{ items: Array<Record<string, any>> }>(`/api/merchants/${mid}/refunds`), [mid]);
  if (!data) return <Empty>กำลังโหลด…</Empty>;
  return (
    <div className="card" style={{ padding: 0 }}>
      {!data.items.length ? (
        <Empty>ไม่มีการคืนเงินหรือยกเลิกใบเสร็จ</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>ประเภท</th>
                <th>ใบเสร็จ</th>
                <th className="right">จำนวนเงิน</th>
                <th>เหตุผล</th>
                <th>ผู้ทำ / ผู้อนุมัติ</th>
                <th>สิทธิ์จอดรถ</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={`${r.kind}-${r.id}`}>
                  <td className="nowrap small">{dateTime(r.at)}</td>
                  <td>
                    <Badge tone={r.kind === 'VOID' ? 'danger' : 'warning'}>{r.kind}</Badge>
                  </td>
                  <td className="mono">{r.receipt_no}</td>
                  <td className="right num">{money(r.amount)}</td>
                  <td>{r.reason}</td>
                  <td className="small">
                    {r.user_name ?? '-'} / {r.approved_by_name ?? '-'}
                  </td>
                  <td>
                    <Badge>{r.parking_validation_status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Audit({ mid }: { mid: number }) {
  const [offset, setOffset] = useState(0);
  const { data, error } = useAsync(() => get<{ items: Array<Record<string, any>> }>(`/api/merchants/${mid}/audit${qs({ limit: LIMIT, offset })}`), [mid, offset]);
  if (error) return <div className="card" style={{ color: 'var(--color-danger)' }}>{error}</div>;
  if (!data) return <Empty>กำลังโหลด…</Empty>;
  return (
    <>
      <div className="card" style={{ padding: 0 }}>
        {!data.items.length ? (
          <Empty>ไม่มีประวัติ</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ผู้ใช้</th>
                  <th>การกระทำ</th>
                  <th>ใบเสร็จ</th>
                  <th>เหตุผล</th>
                  <th>ผู้อนุมัติ</th>
                  <th>ก่อน → หลัง</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap small">{dateTime(a.at)}</td>
                    <td className="small">
                      {a.username}
                      <div className="muted">{a.role}</div>
                    </td>
                    <td className="mono">{a.action}</td>
                    <td className="mono small">{a.receipt_no ?? '-'}</td>
                    <td>{a.reason ?? '-'}</td>
                    <td>{a.approved_by_name ?? '-'}</td>
                    <td className="mono small" style={{ maxWidth: 360, wordBreak: 'break-all' }}>
                      {a.before_json ?? ''} {a.after_json ? `→ ${a.after_json}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
          ก่อนหน้า
        </Button>
        <Button size="sm" disabled={data.items.length < LIMIT} onClick={() => setOffset(offset + LIMIT)}>
          ถัดไป
        </Button>
      </div>
    </>
  );
}
