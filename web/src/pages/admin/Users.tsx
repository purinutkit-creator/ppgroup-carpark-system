import { useState } from 'react';
import { CrudTable, activeBadge } from '../../components/config/Crud';
import { useLookups } from '../../components/config/common';
import { Button, Card, Field, Input, Modal, Tabs, errorText, useAsync, useToast } from '../../components/ui';
import { get, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime } from '../../lib/format';

type Row = Record<string, any>;
const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'INFORMATION', 'CASHIER', 'PARKING_STAFF', 'AUDITOR', 'MERCHANT_OWNER', 'MERCHANT_MANAGER', 'MERCHANT_CASHIER'];
const ROLE_TH: Record<string, string> = {
  OWNER: 'Owner — เข้าถึงทุกระบบ', ADMIN: 'Admin — ตั้งค่าและจัดการลานจอด', MANAGER: 'Manager — อนุมัติส่วนลด/แก้ไขรายการ', INFORMATION: 'Information — แสตมป์บัตรจอด',
  CASHIER: 'Cashier — รับชำระเงิน', PARKING_STAFF: 'Parking Staff — ตรวจรถ/ไม้กั้น', AUDITOR: 'Auditor — ดูรายงานและประวัติ',
  MERCHANT_OWNER: 'เจ้าของร้าน', MERCHANT_MANAGER: 'ผู้จัดการร้าน', MERCHANT_CASHIER: 'แคชเชียร์ร้าน',
};

function Credentials({ user, onClose }: { user: Row; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const toast = useToast();
  return (
    <Modal
      open
      title={`รหัสผ่าน / PIN — ${user.username}`}
      onClose={onClose}
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await post(`/api/admin/users/${user.id}/credentials`, { password: password || undefined, pin: pin || undefined });
              toast('บันทึกแล้ว', 'success');
              onClose();
            } catch (e) {
              toast(errorText(e), 'error');
            }
          }}
        >
          บันทึก
        </Button>
      }
    >
      <div className="grid grid-2">
        <Field label="รหัสผ่านใหม่"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="PIN ใหม่ (สำหรับอนุมัติ)"><Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" /></Field>
      </div>
    </Modal>
  );
}

function RoleMatrix() {
  const r = useAsync(() => get('/api/admin/roles'), []);
  const toast = useToast();
  const { user } = useAuth();
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  if (!r.data) return <Card>{r.error ?? 'กำลังโหลด…'}</Card>;
  const perms: string[] = r.data.permissions;
  const matrix: Row[] = r.data.matrix;
  const current = (role: string) => draft[role] ?? matrix.find((m) => m.role === role)?.permissions ?? [];
  const toggle = (role: string, p: string) => {
    const cur = current(role);
    setDraft({ ...draft, [role]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
  };
  const save = async () => {
    try {
      for (const [role, permissions] of Object.entries(draft)) await put(`/api/admin/roles/${role}`, { permissions });
      setDraft({});
      r.reload();
      toast('บันทึกสิทธิ์แล้ว', 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Card title="สิทธิ์ตามบทบาท (Role-Based Access Control)" actions={<Button variant="primary" size="sm" disabled={!Object.keys(draft).length || user?.role !== 'OWNER'} onClick={save}>บันทึก</Button>}>
      <div className="table-wrap" style={{ maxHeight: '70vh' }}>
        <table className="table">
          <thead>
            <tr>
              <th>สิทธิ์</th>
              {matrix.map((m) => <th key={m.role} className="center" style={{ fontSize: 11 }}>{m.role}{m.overridden ? ' *' : ''}</th>)}
            </tr>
          </thead>
          <tbody>
            {perms.map((p) => (
              <tr key={p}>
                <td className="mono">{p}</td>
                {matrix.map((m) => (
                  <td key={m.role} className="center">
                    <input type="checkbox" checked={current(m.role).includes(p)} disabled={m.role === 'OWNER'} onChange={() => toggle(m.role, p)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="small muted mt">* = ปรับแต่งจากค่าเริ่มต้น · แก้ไขได้เฉพาะ Owner</div>
    </Card>
  );
}

export default function Users() {
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [cred, setCred] = useState<Row | null>(null);
  const lk = useLookups();
  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">ผู้ใช้งาน & สิทธิ์</h1>
      </div>
      <Tabs tabs={[{ id: 'users', label: 'ผู้ใช้งาน' }, { id: 'roles', label: 'สิทธิ์ตามบทบาท' }]} value={tab} onChange={setTab} />
      {tab === 'users' ? (
        <CrudTable<Row, Row>
          title="ผู้ใช้งาน"
          url="/api/admin/users"
          deleteLabel="ปิดใช้งาน"
          columns={[
            { label: 'Username', render: (r) => <span className="mono">{r.username}</span> },
            { label: 'ชื่อ', render: (r) => r.display_name },
            { label: 'บทบาท', render: (r) => r.role },
            { label: 'สาขา', render: (r) => (r.site_ids?.length ? r.site_ids.map((id: number) => lk.siteName(id)).join(', ') : 'ทุกสาขา') },
            { label: 'ร้านค้า', render: (r) => r.merchant_name ?? '-' },
            { label: 'เข้าระบบล่าสุด', render: (r) => dateTime(r.last_login_at) },
            { label: 'สถานะ', render: (r) => activeBadge(r.active) },
          ]}
          actions={(r) => <Button size="sm" onClick={() => setCred(r)}>รหัสผ่าน/PIN</Button>}
          fields={[
            { key: 'username', label: 'Username', createOnly: true },
            { key: 'displayName', label: 'ชื่อที่แสดง' },
            { key: 'role', label: 'บทบาท', type: 'select', options: ROLES.map((r) => ({ value: r, label: ROLE_TH[r] })) },
            { key: 'siteIds', label: 'จำกัดสาขา', type: 'select', options: [{ value: '', label: 'ทุกสาขา' }, ...lk.sites.map((s) => ({ value: String(s.id), label: s.name }))] },
            { key: 'password', label: 'รหัสผ่าน', type: 'password', createOnly: true },
            { key: 'pin', label: 'PIN (สำหรับอนุมัติรายการ)', type: 'password', createOnly: true },
            { key: 'merchantId', label: 'Merchant ID (สำหรับบทบาทร้านค้า)', type: 'number', show: (f) => String(f.role).startsWith('MERCHANT') },
            { key: 'active', label: 'ใช้งาน', type: 'check' },
          ]}
          empty={() => ({ username: '', displayName: '', role: 'PARKING_STAFF', siteIds: '', password: '', pin: '', merchantId: null, active: true })}
          toForm={(r) => ({ displayName: r.display_name, role: r.role, siteIds: r.site_ids?.[0] ? String(r.site_ids[0]) : '', merchantId: r.merchant_id, active: !!r.active })}
          toBody={(f) => ({ ...f, siteIds: f.siteIds ? [Number(f.siteIds)] : null, password: f.password || undefined, pin: f.pin || undefined })}
        />
      ) : (
        <RoleMatrix />
      )}
      {cred && <Credentials user={cred} onClose={() => setCred(null)} />}
    </>
  );
}
