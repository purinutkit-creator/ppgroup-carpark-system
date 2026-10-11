/**
 * Design configuration versions: who/when/where, devices that received each
 * version, before → after changes and rollback.
 */
import { useState } from 'react';
import { get, post } from '../../../lib/api';
import { Badge, Button, Card, ConfirmDialog, Empty, Modal, Pagination, errorText, useAsync, useToast } from '../../../components/ui';
import { dateTime } from '../../../lib/format';
import { ALL_SYSTEM_IDS, systemName, useAppearance } from './context';

interface VersionRow {
  id: number;
  versionNo: number;
  label: string;
  createdBy: string | null;
  createdAt: string;
  appliedTo: string[] | null;
  note: string | null;
  rolledBackFrom: number | null;
  rolledBackFromNo: number | null;
  deliveries: number;
}

interface VersionDetail {
  id: number;
  label: string;
  createdAt: string;
  createdBy: string | null;
  note: string | null;
  changes: Array<{ path: string; before?: unknown; after?: unknown }>;
}

interface Delivery {
  clientId: string;
  system: string | null;
  deviceName: string | null;
  deviceType: string | null;
  receivedAt: string;
}

const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

export function Versions() {
  const { data, perms, reload } = useAppearance();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const list = useAsync(() => get<{ items: VersionRow[]; total: number }>(`/api/appearance/versions?limit=${limit}&offset=${offset}`), [offset, data.version.id]);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [deliv, setDeliv] = useState<{ v: VersionRow; items: Delivery[] } | null>(null);
  const [rb, setRb] = useState<VersionRow | null>(null);

  const open = async (v: VersionRow) => {
    try {
      setDetail(await get<VersionDetail>(`/api/appearance/versions/${v.id}`));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const openDeliveries = async (v: VersionRow) => {
    try {
      const r = await get<{ items: Delivery[] }>(`/api/appearance/versions/${v.id}/deliveries`);
      setDeliv({ v, items: r.items });
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const applied = (a: string[] | null) => {
    if (!a || ALL_SYSTEM_IDS.every((s) => a.includes(s))) return <Badge tone="info">ทุกระบบ</Badge>;
    return <span className="small">{a.map(systemName).join(', ')}</span>;
  };

  return (
    <Card title="Design Configuration Versions" actions={<span className="small muted">ปัจจุบัน: v{data.version.versionNo}</span>}>
      {list.error && <div className="error">{list.error}</div>}
      {list.data && !list.data.items.length && <Empty>ยังไม่มีการบันทึก Version</Empty>}
      {list.data && list.data.items.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Version</th>
                <th>ผู้แก้ไข</th>
                <th>วันที่ / เวลา</th>
                <th>ระบบที่ใช้</th>
                <th>อุปกรณ์ที่ได้รับ</th>
                <th>หมายเหตุ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((v) => (
                <tr key={v.id}>
                  <td className="nowrap">
                    <b>{v.label}</b>
                    {v.id === data.version.id && (
                      <>
                        {' '}
                        <Badge tone="success">ใช้งานอยู่</Badge>
                      </>
                    )}
                    {v.rolledBackFrom && <div className="small muted">↺ Rollback จาก v{v.rolledBackFromNo ?? v.rolledBackFrom}</div>}
                  </td>
                  <td>{v.createdBy ?? '-'}</td>
                  <td className="nowrap">{dateTime(v.createdAt)}</td>
                  <td style={{ maxWidth: 280 }}>{applied(v.appliedTo)}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => openDeliveries(v)}>
                      {v.deliveries} เครื่อง
                    </Button>
                  </td>
                  <td className="small" style={{ maxWidth: 240 }}>
                    {v.note ?? ''}
                  </td>
                  <td className="nowrap right">
                    <Button size="sm" onClick={() => open(v)}>
                      View changes
                    </Button>{' '}
                    {perms.rollback && v.id !== data.version.id && (
                      <Button size="sm" variant="danger" onClick={() => setRb(v)}>
                        ROLLBACK
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && <Pagination total={list.data.total} limit={limit} offset={offset} onChange={setOffset} />}

      <Modal open={!!detail} onClose={() => setDetail(null)} size="lg" title={detail ? `${detail.label} — การเปลี่ยนแปลง` : ''}>
        {detail && (
          <div className="col">
            <div className="small muted">
              {detail.createdBy ?? '-'} · {dateTime(detail.createdAt)} {detail.note ? `· ${detail.note}` : ''}
            </div>
            {!detail.changes.length ? (
              <Empty>ไม่มีการเปลี่ยนแปลง</Empty>
            ) : (
              <div className="table-wrap">
                <table className="table ap-diff">
                  <thead>
                    <tr>
                      <th>ค่า</th>
                      <th>ก่อน</th>
                      <th>หลัง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.changes.map((c) => (
                      <tr key={c.path}>
                        <td className="mono">{c.path}</td>
                        <td className="before">{show(c.before)}</td>
                        <td className="after">{show(c.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!deliv} onClose={() => setDeliv(null)} size="lg" title={deliv ? `${deliv.v.label} — อุปกรณ์ที่ได้รับ` : ''}>
        {deliv && !deliv.items.length && <Empty>ยังไม่มีอุปกรณ์ยืนยันการรับ</Empty>}
        {deliv && deliv.items.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>อุปกรณ์</th>
                  <th>ระบบ</th>
                  <th>Client ID</th>
                  <th>ได้รับเมื่อ</th>
                </tr>
              </thead>
              <tbody>
                {deliv.items.map((d) => (
                  <tr key={d.clientId}>
                    <td>{d.deviceName ? `${d.deviceName} (${d.deviceType})` : <span className="muted">Browser</span>}</td>
                    <td>{d.system ? systemName(d.system) : '-'}</td>
                    <td className="mono">{d.clientId.slice(0, 12)}</td>
                    <td>{dateTime(d.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!rb}
        danger
        title={`Rollback ไปยัง ${rb?.label}?`}
        message={
          <div className="col">
            <div>ระบบจะสร้าง Version ใหม่ที่มีค่าเหมือน {rb?.label} และส่งไปยังทุกระบบแบบ Real-Time ทันที</div>
            <div className="small muted">การกระทำนี้ถูกบันทึกใน Audit Log</div>
          </div>
        }
        confirmText="ROLLBACK"
        onClose={() => setRb(null)}
        onConfirm={async () => {
          try {
            const r = await post<{ version: { versionNo: number } }>(`/api/appearance/versions/${rb!.id}/rollback`, {});
            toast(`Rollback แล้ว (v${r.version.versionNo})`, 'success');
            await reload();
          } catch (e) {
            toast(errorText(e), 'error');
          }
        }}
      />
    </Card>
  );
}
