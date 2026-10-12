import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, Empty, Field, Input, PlateBadge, ProvinceSelect, TextArea, errorText, useAsync, useToast } from '../../components/ui';
import { api, get, post } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime } from '../../lib/format';
import { downloadAuthed } from '../../components/ops/download';
import { provinceName } from '../../components/config/common';

type Row = Record<string, any>;
const kb = (n: number | null | undefined) => (n == null ? '-' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

function Backups() {
  const { user } = useAuth();
  const toast = useToast();
  const list = useAsync(() => get('/api/admin/backups'), []);
  const [file, setFile] = useState<File | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  return (
    <Card
      title={`สำรองข้อมูล (ฐานข้อมูล ${kb(list.data?.dbSize)})`}
      actions={
        <Button
          variant="primary"
          size="sm"
          onClick={async () => {
            try {
              await post('/api/admin/backups');
              toast('สำรองข้อมูลแล้ว', 'success');
              list.reload();
            } catch (e) {
              toast(errorText(e), 'error');
            }
          }}
        >
          สำรองตอนนี้
        </Button>
      }
    >
      <div className="small muted mb">ระบบสำรองอัตโนมัติทุกคืน 02:00 น. (เก็บ 30 ชุดล่าสุด)</div>
      {!list.data?.items?.length ? (
        <Empty>ยังไม่มีไฟล์สำรอง</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>ไฟล์</th><th>ประเภท</th><th>ขนาด</th><th>เวลา</th><th /></tr></thead>
            <tbody>
              {list.data.items.map((b: Row) => (
                <tr key={b.id}>
                  <td className="mono small">{b.file}</td>
                  <td><Badge>{b.kind}</Badge></td>
                  <td>{kb(b.size)}</td>
                  <td>{dateTime(b.created_at)}</td>
                  <td className="right">
                    {user?.role === 'OWNER' && b.exists && <Button size="sm" onClick={() => downloadAuthed(`/api/admin/backups/${b.id}/download`, {}, b.file)}>ดาวน์โหลด</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="divider" />
      <div className="row">
        <b>กู้คืนข้อมูล:</b>
        <input type="file" accept=".db,.sqlite" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button variant="danger" disabled={!file} onClick={() => setConfirmRestore(true)}>กู้คืน</Button>
      </div>
      <ConfirmDialog
        open={confirmRestore}
        danger
        title="กู้คืนฐานข้อมูล?"
        message="ข้อมูลปัจจุบันจะถูกแทนที่ทั้งหมด (ระบบจะสำรองข้อมูลปัจจุบันก่อนอัตโนมัติ)"
        confirmText="กู้คืน"
        onClose={() => setConfirmRestore(false)}
        onConfirm={async () => {
          const fd = new FormData();
          fd.append('file', file!);
          try {
            const r = await api('/api/admin/backups/restore', { method: 'POST', body: fd });
            toast(`กู้คืนสำเร็จ (สำรองเดิมไว้ที่ ${r.safetyBackup})`, 'success');
            list.reload();
          } catch (e) {
            toast(errorText(e), 'error');
          }
        }}
      />
    </Card>
  );
}

function Pdpa() {
  const toast = useToast();
  const [prefix, setPrefix] = useState('');
  const [number, setNumber] = useState('');
  const [province, setProvince] = useState<string | null>('10');
  const [result, setResult] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const search = async () => {
    try {
      setResult(await get(`/api/admin/pdpa/subject?plate=${encodeURIComponent(`${prefix} ${number}`)}&province=${province ?? ''}`));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Card title="PDPA — ข้อมูลส่วนบุคคล">
      <div className="row mb">
        <Button
          onClick={async () => {
            try {
              const r = await post('/api/admin/pdpa/retention-run');
              toast(`ลบภาพ ${r.imagesRemoved ?? 0} ไฟล์ · ปกปิดทะเบียน ${r.sessionsAnonymised ?? 0} รายการ`, 'success');
            } catch (e) {
              toast(errorText(e), 'error');
            }
          }}
        >
          รันนโยบายระยะเวลาเก็บรักษาตอนนี้
        </Button>
        <span className="small muted">ตั้งค่าจำนวนวันได้ที่ ตั้งค่าระบบ → PDPA</span>
      </div>
      <h3>คำขอของเจ้าของข้อมูล (ค้นหาตามทะเบียน)</h3>
      <div className="row">
        <Input style={{ width: 90 }} placeholder="กข" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        <Input style={{ width: 90 }} placeholder="1234" value={number} onChange={(e) => setNumber(e.target.value)} />
        <div style={{ minWidth: 200 }}><ProvinceSelect value={province} onChange={setProvince} /></div>
        <Button variant="primary" onClick={search}>ค้นหา</Button>
      </div>
      {result && (
        <div className="mt col">
          <PlateBadge plate={`${prefix} ${number}`} province={provinceName(province)} />
          <div className="kv">
            <span>รายการจอด</span><span>{result.sessions?.length ?? 0}</span>
            <span>ภาพตรวจจับ</span><span>{result.detections?.length ?? 0}</span>
            <span>สมาชิก</span><span>{result.members?.length ?? 0}</span>
            <span>บัตรจอด</span><span>{result.passes?.length ?? 0}</span>
            <span>Blacklist/Whitelist</span><span>{result.lists?.length ?? 0}</span>
            <span>การจอง</span><span>{result.reservations?.length ?? 0}</span>
          </div>
          <Button size="sm" onClick={() => {
            const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `pdpa-${prefix}${number}.json`;
            a.click();
          }}>ส่งออกข้อมูล (JSON)</Button>
          <Field label="เหตุผลการลบ/ปกปิดข้อมูล"><TextArea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <Button
            variant="danger"
            disabled={!reason}
            onClick={async () => {
              try {
                const r = await post('/api/admin/pdpa/subject/anonymise', { plateKey: result.plateKey, reason });
                toast(`ปกปิดข้อมูลแล้ว (รถที่ยังจอดอยู่ ${r.activeSessionsKept ?? 0} รายการไม่ถูกแก้)`, 'success');
                search();
              } catch (e) {
                toast(errorText(e), 'error');
              }
            }}
          >
            ปกปิด/ลบข้อมูลของทะเบียนนี้
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function SystemPage() {
  const { can } = useAuth();
  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">สำรองข้อมูล & PDPA</h1>
      </div>
      {can('backup.manage') && <Backups />}
      {can('pdpa.manage') && <Pdpa />}
    </>
  );
}
