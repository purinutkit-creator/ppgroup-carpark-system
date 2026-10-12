/**
 * Merchant Portal — each shop sees only its own data: dashboard, sales &
 * receipts (with parking-validation status), products, staff, POS devices,
 * reports and receipt settings.
 */
import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { CrudTable, activeBadge } from '../../components/config/Crud';
import { Badge, Button, Card, Check, Field, Input, Kpi, MediaInput, Modal, Select, TextArea, errorText, useAsync, useToast } from '../../components/ui';
import { api, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime, money, num } from '../../lib/format';
import { uploadMedia } from '../../lib/upload';
import { posGet, bkkDate, dayStartIso, dayEndIso, PAYMENT_LABEL, type Sale } from '../../components/pos/types';
import { SaleBody, SalesTable, TrendBars } from '../../components/pos/common';
import '../../components/pos/pos.css';

type Row = Record<string, any>;

function Dashboard() {
  const d = useAsync(() => posGet('/api/pos/dashboard'), []);
  if (!d.data) return <Card>{d.error ?? 'กำลังโหลด…'}</Card>;
  const t = d.data.today;
  const el = { label: 'merchant-portal/dashboard/kpi/label', value: 'merchant-portal/dashboard/kpi/value' };
  return (
    <>
      <div className="grid grid-4">
        <Kpi label="ยอดขายวันนี้" value={money(t.sales)} el={el} />
        <Kpi label="จำนวน Transactions" value={num(t.transactions)} el={el} />
        <Kpi label="ใบเสร็จที่ใช้ลดค่าจอด" value={num(t.receiptsValidated)} el={el} />
        <Kpi label="ยอดซื้อที่นำไป Validation" value={money(t.validatedPurchase)} el={el} />
        <Kpi label="มูลค่าส่วนลดจอดรถที่เกิดขึ้น" value={money(t.parkingDiscountValue)} el={el} />
        <Kpi label="Refund" value={`${money(t.refunds)} (${t.refundCount})`} el={el} />
        <Kpi label="Void" value={num(t.voids)} el={el} />
        <Kpi label="พนักงาน / POS" value={`${d.data.staffCount} / ${d.data.devices}`} el={el} />
      </div>
      <Card title="ยอดขาย 30 วัน">
        <TrendBars data={d.data.trend} />
      </Card>
      <div className="small muted">{d.data.discountMethod}</div>
    </>
  );
}

function Sales() {
  const [from, setFrom] = useState(bkkDate(-6));
  const [to, setTo] = useState(bkkDate());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const list = useAsync(() => posGet<{ items: Sale[] }>(`/api/pos/sales?from=${dayStartIso(from)}&to=${dayEndIso(to)}&q=${encodeURIComponent(q)}&status=${status}`), [from, to, q, status]);
  const [sel, setSel] = useState<Row | null>(null);
  return (
    <Card title="ยอดขาย & ใบเสร็จ">
      <div className="filters mb">
        <Field label="ตั้งแต่"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="ถึง"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="สถานะ"><Select value={status} onChange={(e) => setStatus(e.target.value)} options={['', 'PAID', 'VOIDED', 'REFUNDED', 'PARTIALLY_REFUNDED'].map((s) => ({ value: s, label: s || 'ทั้งหมด' }))} /></Field>
        <Field label="ค้นหาเลขใบเสร็จ"><Input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      </div>
      <SalesTable items={list.data?.items ?? []} onOpen={async (s) => setSel(await posGet(`/api/pos/sales/${s.id}`))} />
      <Modal open={!!sel} size="lg" title={sel?.sale.receipt_no} onClose={() => setSel(null)}>
        {sel && <SaleBody sale={sel.sale} refunds={sel.refunds} usage={sel.parkingUsage} />}
      </Modal>
    </Card>
  );
}

function Products() {
  const cats = useAsync(() => posGet('/api/pos/categories'), []);
  const catOpts = [{ value: '', label: '— ไม่ระบุ —' }, ...(cats.data?.items ?? []).map((c: Row) => ({ value: c.id, label: c.name }))];
  const toast = useToast();
  return (
    <>
      <CrudTable<Row, Row>
        title="หมวดหมู่สินค้า"
        url="/api/pos/categories"
        onSaved={() => cats.reload()}
        columns={[{ label: 'ชื่อ', render: (r) => r.name }, { label: 'ลำดับ', render: (r) => r.sort }, { label: '', render: (r) => activeBadge(r.active) }]}
        fields={[{ key: 'name', label: 'ชื่อ' }, { key: 'sort', label: 'ลำดับ', type: 'number' }]}
        empty={() => ({ name: '', sort: 0 })}
        toForm={(r) => ({ name: r.name, sort: r.sort })}
        toBody={(f) => f}
      />
      <CrudTable<Row, Row>
        title="สินค้า"
        url="/api/pos/products"
        query="?all=1"
        deleteLabel="ปิดขาย"
        columns={[
          { label: '', render: (r) => (r.image_url ? <img src={r.image_url} className="img-thumb" style={{ width: 56, height: 42 }} alt="" /> : null) },
          { label: 'ชื่อ', render: (r) => <><b>{r.name}</b><div className="small muted">{r.sku} · {r.barcode}</div></> },
          { label: 'หมวด', render: (r) => (cats.data?.items ?? []).find((c: Row) => c.id === r.category_id)?.name ?? '-' },
          { label: 'ราคา', render: (r) => money(r.price), className: 'right' },
          { label: 'ตัวเลือก', render: (r) => [r.variants.map((v: Row) => v.name).join('/'), r.modifiers.map((m: Row) => m.group).join(', ')].filter(Boolean).join(' · ') || '-' },
          { label: '', render: (r) => activeBadge(r.active) },
        ]}
        actions={(r, reload) => (
          <label className="btn btn-sm">
            รูป
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const fd = new FormData();
                fd.append('file', f);
                try {
                  await api(`/api/pos/products/${r.id}/image`, { method: 'POST', body: fd });
                  reload();
                } catch (x) {
                  toast(errorText(x), 'error');
                }
              }}
            />
          </label>
        )}
        fields={[
          { key: 'name', label: 'ชื่อสินค้า' },
          { key: 'categoryId', label: 'หมวด', type: 'select', options: catOpts },
          { key: 'price', label: 'ราคา (บาท)', type: 'number' },
          { key: 'sku', label: 'SKU' },
          { key: 'barcode', label: 'Barcode' },
          { key: 'sort', label: 'ลำดับ', type: 'number' },
          { key: 'variants', label: 'Variant (ชื่อ=ราคาเพิ่ม บรรทัดละ 1) เช่น Hot=0', type: 'textarea' },
          { key: 'modifiers', label: 'Modifier (กลุ่ม: ตัวเลือก=ราคา, … บรรทัดละกลุ่ม; ใส่ * หลังชื่อกลุ่มถ้าเลือกได้หลายอัน)', type: 'textarea', hint: 'ตัวอย่าง: Extra*: Extra shot=15, Oat milk=20' },
          { key: 'vatApplicable', label: 'คิด VAT', type: 'check' },
          { key: 'active', label: 'เปิดขาย', type: 'check' },
        ]}
        empty={() => ({ name: '', categoryId: '', price: 0, sku: '', barcode: '', sort: 0, variants: '', modifiers: '', vatApplicable: true, active: true })}
        toForm={(r) => ({
          name: r.name, categoryId: r.category_id ?? '', price: r.price, sku: r.sku ?? '', barcode: r.barcode ?? '', sort: r.sort, vatApplicable: r.vat_applicable, active: r.active,
          variants: r.variants.map((v: Row) => `${v.name}=${v.price}`).join('\n'),
          modifiers: r.modifiers.map((m: Row) => `${m.group}${m.multi ? '*' : ''}: ${m.options.map((o: Row) => `${o.name}=${o.price}`).join(', ')}`).join('\n'),
        })}
        toBody={(f) => ({
          name: f.name, categoryId: f.categoryId ? Number(f.categoryId) : null, price: Number(f.price), sku: f.sku || null, barcode: f.barcode || null, sort: f.sort, vatApplicable: f.vatApplicable, active: f.active,
          variants: String(f.variants ?? '').split('\n').filter((l) => l.trim()).map((l) => ({ name: l.split('=')[0].trim(), price: Number(l.split('=')[1] ?? 0) })),
          modifiers: String(f.modifiers ?? '').split('\n').filter((l) => l.includes(':')).map((l) => {
            const [g, rest] = [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1)];
            return { group: g.replace(/\*$/, ''), multi: g.endsWith('*'), options: rest.split(',').filter((x) => x.trim()).map((o) => ({ name: o.split('=')[0].trim(), price: Number(o.split('=')[1] ?? 0) })) };
          }),
        })}
      />
    </>
  );
}

function Staff() {
  const list = useAsync(() => posGet('/api/pos/staff'), []);
  const branches = list.data?.branches ?? [];
  return (
    <CrudTable<Row, Row>
      title="พนักงาน"
      url="/api/pos/staff"
      canDelete={false}
      columns={[
        { label: 'Username', render: (r) => <span className="mono">{r.username}</span> },
        { label: 'ชื่อ', render: (r) => r.display_name },
        { label: 'บทบาท', render: (r) => r.role },
        { label: 'สาขา', render: (r) => r.branch_code },
        { label: 'เข้าล่าสุด', render: (r) => dateTime(r.last_login_at) },
        { label: '', render: (r) => activeBadge(r.active) },
      ]}
      fields={[
        { key: 'username', label: 'Username', createOnly: true },
        { key: 'displayName', label: 'ชื่อ' },
        { key: 'role', label: 'บทบาท', type: 'select', options: [{ value: 'MERCHANT_CASHIER', label: 'แคชเชียร์' }, { value: 'MERCHANT_MANAGER', label: 'ผู้จัดการร้าน' }] },
        { key: 'branchId', label: 'สาขา', type: 'select', options: branches.map((b: Row) => ({ value: b.id, label: `${b.code} ${b.name}` })) },
        { key: 'password', label: 'รหัสผ่าน (เว้นว่าง = ไม่เปลี่ยน)', type: 'password' },
        { key: 'pin', label: 'PIN', type: 'password' },
        { key: 'active', label: 'ใช้งาน', type: 'check' },
      ]}
      empty={() => ({ username: '', displayName: '', role: 'MERCHANT_CASHIER', branchId: branches[0]?.id ?? '', password: '', pin: '', active: true })}
      toForm={(r) => ({ displayName: r.display_name, role: r.role, branchId: r.branch_id, password: '', pin: '', active: !!r.active })}
      toBody={(f) => ({ ...f, branchId: Number(f.branchId), password: f.password || undefined, pin: f.pin || undefined })}
    />
  );
}

function Devices() {
  return (
    <CrudTable<Row, Row>
      title="เครื่อง POS"
      url="/api/pos/devices"
      canDelete={false}
      columns={[
        { label: 'ชื่อ', render: (r) => r.name },
        { label: 'สถานะ', render: (r) => <Badge>{r.status}</Badge> },
        { label: 'เครื่องพิมพ์', render: (r) => r.settings?.printer?.connection?.mode ?? 'พิมพ์ผ่านเบราว์เซอร์' },
        { label: 'เห็นล่าสุด', render: (r) => dateTime(r.last_seen_at) },
      ]}
      fields={[
        { key: 'name', label: 'ชื่อ' },
        { key: 'printerMode', label: 'เครื่องพิมพ์ใบเสร็จ', type: 'select', options: [{ value: '', label: 'พิมพ์ผ่านเบราว์เซอร์' }, { value: 'bridge', label: 'Printer Bridge (USB/Bluetooth บนเครื่อง POS)' }] },
        { key: 'bridgeUrl', label: 'Bridge URL', placeholder: 'http://127.0.0.1:9110' },
        { key: 'paperWidth', label: 'ขนาดกระดาษ', type: 'select', options: [{ value: '80', label: '80 มม.' }, { value: '58', label: '58 มม.' }] },
        { key: 'cashDrawer', label: 'มีลิ้นชักเก็บเงิน', type: 'check' },
        { key: 'displayEnabled', label: 'มีจอลูกค้า', type: 'check' },
      ]}
      empty={() => ({})}
      toForm={(r) => ({ name: r.name, printerMode: r.settings?.printer?.connection?.mode ?? '', bridgeUrl: r.settings?.printer?.connection?.bridgeUrl ?? '', paperWidth: r.settings?.printer?.connection?.paperWidth ?? '80', cashDrawer: !!r.settings?.cashDrawer, displayEnabled: !!r.settings?.displayEnabled })}
      toBody={(f) => ({
        name: f.name,
        printer: f.printerMode ? { connection: { mode: f.printerMode, bridgeUrl: f.bridgeUrl || 'http://127.0.0.1:9110', paperWidth: f.paperWidth } } : null,
        cashDrawer: f.cashDrawer,
        displayEnabled: f.displayEnabled,
      })}
    />
  );
}

function Reports() {
  const [from, setFrom] = useState(bkkDate(-6));
  const [to, setTo] = useState(bkkDate());
  const r = useAsync(() => posGet(`/api/pos/reports?from=${dayStartIso(from)}&to=${dayEndIso(to)}`), [from, to]);
  const d = r.data;
  const table = (title: string, rows: Row[], cols: Array<[string, (x: Row) => any]>) => (
    <Card title={title}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr>{cols.map(([h]) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((x, i) => <tr key={i}>{cols.map(([h, f]) => <td key={h}>{f(x)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </Card>
  );
  return (
    <>
      <div className="filters">
        <Field label="ตั้งแต่"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="ถึง"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button onClick={() => window.print()}>พิมพ์ / PDF</Button>
      </div>
      {d && (
        <>
          <div className="grid grid-4">
            <Kpi label="ยอดขายสุทธิ" value={money(d.summary.net)} />
            <Kpi label="จำนวนบิล" value={num(d.summary.count)} />
            <Kpi label="เฉลี่ยต่อบิล" value={money(d.summary.average)} />
            <Kpi label="Void / Refund" value={`${d.summary.voids} / ${money(d.summary.refunds)}`} />
          </div>
          {table('รายวัน', d.daily, Object.keys(d.daily[0] ?? { date: 1 }).map((k) => [k, (x: Row) => (typeof x[k] === 'number' && k !== 'count' ? money(x[k]) : x[k])]))}
          {table('ตามวิธีชำระ', d.byMethod, Object.keys(d.byMethod[0] ?? { method: 1 }).map((k) => [k, (x: Row) => (k === 'method' ? (PAYMENT_LABEL[x[k]] ?? x[k]) : typeof x[k] === 'number' && k !== 'count' ? money(x[k]) : x[k])]))}
          {table('ตามสินค้า', d.byProduct, Object.keys(d.byProduct[0] ?? { name: 1 }).map((k) => [k, (x: Row) => x[k]]))}
          {table('ตามแคชเชียร์', d.byCashier, Object.keys(d.byCashier[0] ?? { name: 1 }).map((k) => [k, (x: Row) => x[k]]))}
          {table('ตามกะ', d.byShift, Object.keys(d.byShift[0] ?? { id: 1 }).map((k) => [k, (x: Row) => x[k]]))}
        </>
      )}
    </>
  );
}

function SettingsPage() {
  const toast = useToast();
  const s = useAsync(() => posGet('/api/pos/settings'), []);
  const [draft, setDraft] = useState<Row | null>(null);
  const r = draft ?? s.data?.receipt;
  const m = s.data?.merchant;
  if (!r) return <Card>{s.error ?? 'กำลังโหลด…'}</Card>;
  const p = (x: Row) => setDraft({ ...r, ...x });
  return (
    <Card title="ตั้งค่าใบเสร็จและร้าน">
      <div className="grid grid-2">
        <Field label="หัวใบเสร็จ"><TextArea value={r.header ?? ''} onChange={(e) => p({ header: e.target.value })} /></Field>
        <Field label="ท้ายใบเสร็จ"><TextArea value={r.footer ?? ''} onChange={(e) => p({ footer: e.target.value })} /></Field>
        <Field label="ชื่อสาขาบนใบเสร็จ"><Input value={r.branchName ?? ''} onChange={(e) => p({ branchName: e.target.value })} /></Field>
        <Field label="เลขประจำตัวผู้เสียภาษี"><Input value={r.taxId ?? ''} onChange={(e) => p({ taxId: e.target.value })} /></Field>
        <Field label="PromptPay ID (รับเงินผ่าน QR)"><Input value={r.promptPayId ?? ''} onChange={(e) => p({ promptPayId: e.target.value })} /></Field>
        <Check label="จดทะเบียน VAT" checked={!!r.vatRegistered} onChange={(c) => p({ vatRegistered: c })} />
        <Field label="VAT"><Select value={r.vatMode ?? 'INCLUDED'} onChange={(e) => p({ vatMode: e.target.value })} options={[{ value: 'INCLUDED', label: 'รวมในราคา' }, { value: 'EXCLUDED', label: 'แยกนอกราคา' }]} /></Field>
        <Field label="อัตรา VAT %"><Input type="number" value={r.vatRate ?? 7} onChange={(e) => p({ vatRate: Number(e.target.value) })} /></Field>
        <Field label="Service charge %"><Input type="number" value={r.serviceChargePercent ?? 0} onChange={(e) => p({ serviceChargePercent: Number(e.target.value) })} /></Field>
        <MediaInput label="โลโก้ร้าน" value={draft?.logoUrl ?? m?.logo_url} recommended="1000 × 1000 px" upload={(f) => uploadMedia(f, 'merchants')} onChange={(u) => p({ logoUrl: u })} />
      </div>
      <div className="row mt">
        <Button
          variant="primary"
          onClick={async () => {
            try {
              const { logoUrl, ...receipt } = r;
              await put('/api/pos/settings', { receipt, ...(logoUrl !== undefined ? { logoUrl } : {}) });
              toast('บันทึกแล้ว', 'success');
              setDraft(null);
              s.reload();
            } catch (e) {
              toast(errorText(e), 'error');
            }
          }}
        >
          บันทึก
        </Button>
      </div>
    </Card>
  );
}

const NAV = [
  { to: '', label: 'Dashboard', perm: 'merchant.portal' },
  { to: 'sales', label: 'ยอดขาย & ใบเสร็จ', perm: 'pos.reports' },
  { to: 'products', label: 'สินค้า', perm: 'pos.products' },
  { to: 'staff', label: 'พนักงาน', perm: 'merchant.staff' },
  { to: 'devices', label: 'เครื่อง POS', perm: 'merchant.settings' },
  { to: 'reports', label: 'รายงาน', perm: 'pos.reports' },
  { to: 'settings', label: 'ตั้งค่าร้าน', perm: 'merchant.settings' },
];

export default function MerchantPortal() {
  const { user, can, logout } = useAuth();
  return (
    <div className="admin-shell">
      <nav className="admin-nav">
        <div className="brand">
          {user?.merchant?.logo_url ? <img src={user.merchant.logo_url} alt="" /> : <img src="/favicon.svg" alt="" />}
          <span>{user?.merchant?.name ?? 'Merchant'}</span>
        </div>
        <div className="section">{user?.merchant?.code}</div>
        {NAV.filter((n) => can(n.perm)).map((n) => (
          <NavLink key={n.to} to={`/merchant/${n.to}`} end={n.to === ''}>{n.label}</NavLink>
        ))}
        {can('pos.sell') && <Link to="/pos">เปิด POS →</Link>}
      </nav>
      <div className="admin-main">
        <div className="admin-topbar">
          <span data-el="merchant-portal/layout/header/title" style={{ fontWeight: 600 }}>Merchant Portal</span>
          <span className="spacer" />
          <span className="small muted">{user?.displayName} · {user?.role}</span>
          <Button size="sm" onClick={logout}>ออกจากระบบ</Button>
        </div>
        <div className="admin-content">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="sales" element={<Sales />} />
            <Route path="products" element={<Products />} />
            <Route path="staff" element={<Staff />} />
            <Route path="devices" element={<Devices />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
