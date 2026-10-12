import { useState } from 'react';
import { CrudTable, activeBadge } from '../../components/config/Crud';
import { DEVICE_TYPE_LABEL, StatusDot, useLookups } from '../../components/config/common';
import { Button, Modal, Select, errorText, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { EscPos, toBase64 } from '@pp/shared/escpos';

type Row = Record<string, any>;
const TYPES = Object.keys(DEVICE_TYPE_LABEL);
const has = (f: Row, ...t: string[]) => t.includes(f.type);

export default function Devices() {
  const lk = useLookups();
  const toast = useToast();
  const [type, setType] = useState('');
  const [keyInfo, setKeyInfo] = useState<Row | null>(null);
  const edges = lk.devicesOf('EDGE');

  const genKey = async (r: Row) => {
    try {
      setKeyInfo(await post(`/api/admin/devices/${r.id}/key`));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const test = async (r: Row) => {
    try {
      const res = await post(`/api/admin/devices/${r.id}/test`);
      if (res.bridge) {
        // Bridge printers are attached to a kiosk PC: print the test page locally.
        const bytes = new EscPos().init().align('center').text('SMART PARKING\nPRINTER TEST\n').text(new Date().toISOString() + '\n').feed(3).cut().bytes();
        const url = (res.connection?.bridgeUrl ?? 'http://127.0.0.1:9110').replace(/\/$/, '');
        await fetch(`${url}/print`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: toBase64(bytes) }) });
        toast('ส่งหน้าทดสอบไปยัง Printer Bridge แล้ว', 'success');
      } else toast(res.ok === false ? `ไม่สำเร็จ: ${res.error ?? res.status}` : 'ทดสอบสำเร็จ', res.ok === false ? 'error' : 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">อุปกรณ์ (กล้อง / เครื่องพิมพ์ / ไม้กั้น / Kiosk)</h1>
        <div className="actions">
          <Select value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'ทุกประเภท' }, ...TYPES.map((t) => ({ value: t, label: DEVICE_TYPE_LABEL[t] }))]} />
        </div>
      </div>
      <CrudTable<Row, Row>
        title="อุปกรณ์"
        url="/api/admin/devices"
        filter={(rows) => (type ? rows.filter((r) => r.type === type) : rows)}
        deleteLabel="ปิดใช้งาน"
        columns={[
          { label: 'สถานะ', render: (r) => <span className="row" style={{ gap: 6 }}><StatusDot status={r.status} /> <span className="small">{r.status}</span></span> },
          { label: 'ประเภท', render: (r) => DEVICE_TYPE_LABEL[r.type] ?? r.type },
          { label: 'ชื่อ', render: (r) => r.name },
          { label: 'สาขา / จุด', render: (r) => `${r.site_name ?? '-'}${r.gate_name ? ` · ${r.gate_name}` : ''}` },
          { label: 'การเชื่อมต่อ', render: (r) => <span className="small mono">{r.connection?.mode ?? r.connection?.protocol ?? '-'} {r.connection?.host ?? r.connection?.rtspUrl ?? r.connection?.url ?? ''}</span> },
          { label: 'เห็นล่าสุด', render: (r) => <span className="small">{dateTime(r.last_seen_at)}{r.last_error ? <div style={{ color: 'var(--color-danger)' }}>{r.last_error}</div> : null}</span> },
          { label: 'Key', render: (r) => (r.hasKey ? '✓' : '-') },
          { label: '', render: (r) => activeBadge(r.active) },
        ]}
        actions={(r) => (
          <>
            <Button size="sm" onClick={() => genKey(r)}>สร้าง Key</Button>
            {has(r, 'PRINTER', 'BARRIER') && <Button size="sm" onClick={() => test(r)}>ทดสอบ</Button>}
          </>
        )}
        fields={[
          { key: 'type', label: 'ประเภท', type: 'select', options: TYPES.map((t) => ({ value: t, label: DEVICE_TYPE_LABEL[t] })), createOnly: true },
          { key: 'name', label: 'ชื่อ' },
          { key: 'model', label: 'รุ่น' },
          { key: 'siteId', label: 'สาขา', type: 'select', options: lk.sites.map((s) => ({ value: s.id, label: s.name })) },
          { key: 'gateId', label: 'ทางเข้า/ออก', type: 'select', options: [{ value: '', label: '— ไม่ผูก —' }, ...lk.gates.map((g) => ({ value: g.id, label: `${g.name} (${g.direction})` }))] },
          { key: 'edgeDeviceId', label: 'Edge Agent ที่ควบคุม', type: 'select', options: [{ value: '', label: '—' }, ...edges.map((d) => ({ value: d.id, label: d.name }))], show: (f) => has(f, 'CAMERA', 'PRINTER', 'BARRIER') },
          { key: 'protocol', label: 'โปรโตคอลกล้อง', type: 'select', options: ['rtsp', 'onvif', 'http-lpr', 'platerecognizer'].map((v) => ({ value: v, label: v })), show: (f) => has(f, 'CAMERA') },
          { key: 'rtspUrl', label: 'RTSP URL', placeholder: 'rtsp://10.0.0.11/stream1', show: (f) => has(f, 'CAMERA'), wide: true },
          { key: 'snapshotUrl', label: 'Snapshot / ONVIF URL', show: (f) => has(f, 'CAMERA'), wide: true },
          { key: 'onvifUser', label: 'ONVIF username', show: (f) => has(f, 'CAMERA') },
          { key: 'onvifPassword', label: 'ONVIF password', type: 'password', placeholder: 'เว้นว่าง = ไม่เปลี่ยน', show: (f) => has(f, 'CAMERA') },
          { key: 'zones', label: 'Detection zones (JSON)', type: 'textarea', hint: '[{"name":"กระจกหน้า","rect":{"x":0.2,"y":0.1,"w":0.6,"h":0.4},"expect":"PAPER_SIGN"}] — พิกัด 0–1', show: (f) => has(f, 'CAMERA') },
          { key: 'mode', label: 'โหมด', type: 'select', options: [{ value: 'lan', label: 'LAN (RAW 9100)' }, { value: 'edge', label: 'ผ่าน Edge Agent (USB/Serial/BT)' }, { value: 'bridge', label: 'Printer Bridge บนเครื่อง Kiosk' }], show: (f) => has(f, 'PRINTER') },
          { key: 'bmode', label: 'โหมด', type: 'select', options: [{ value: 'edge', label: 'ผ่าน Edge Agent' }, { value: 'http', label: 'HTTP relay' }, { value: 'tcp', label: 'TCP command' }, { value: 'none', label: 'ไม่มี' }], show: (f) => has(f, 'BARRIER') },
          { key: 'host', label: 'Host / IP', show: (f) => has(f, 'PRINTER', 'BARRIER') },
          { key: 'port', label: 'Port', type: 'number', show: (f) => has(f, 'PRINTER', 'BARRIER') },
          { key: 'bridgeUrl', label: 'Bridge URL', placeholder: 'http://127.0.0.1:9110', show: (f) => has(f, 'PRINTER') },
          { key: 'usbPath', label: 'USB device (edge)', placeholder: '/dev/usb/lp0', show: (f) => has(f, 'PRINTER') },
          { key: 'paperWidth', label: 'ขนาดกระดาษ', type: 'select', options: [{ value: '80', label: '80 มม.' }, { value: '58', label: '58 มม.' }], show: (f) => has(f, 'PRINTER') },
          { key: 'url', label: 'Relay URL', placeholder: 'http://10.0.0.21/relay/0?turn=on&timer=2', show: (f) => has(f, 'BARRIER'), wide: true },
          { key: 'payloadHex', label: 'TCP payload (hex)', show: (f) => has(f, 'BARRIER') },
          { key: 'cashAcceptor', label: 'มีเครื่องรับเงินสด', type: 'check', show: (f) => has(f, 'PAYMENT_KIOSK') },
          { key: 'active', label: 'ใช้งาน', type: 'check' },
        ]}
        empty={() => ({ type: type || 'CAMERA', name: '', model: '', siteId: lk.sites[0]?.id ?? '', gateId: '', protocol: 'rtsp', mode: 'lan', bmode: 'edge', paperWidth: '80', zones: '', active: true })}
        toForm={(r) => {
          const c = r.connection ?? {};
          return {
            type: r.type, name: r.name, model: r.model ?? '', siteId: r.site_id ?? '', gateId: r.gate_id ?? '', active: !!r.active,
            edgeDeviceId: c.edgeDeviceId ?? '', protocol: c.protocol ?? 'rtsp', rtspUrl: c.rtspUrl ?? '', snapshotUrl: c.snapshotUrl ?? '',
            onvifUser: c.onvif?.username ?? '', onvifPassword: '', mode: c.mode ?? 'lan', bmode: c.mode ?? 'edge', host: c.host ?? '', port: c.port ?? '',
            bridgeUrl: c.bridgeUrl ?? '', usbPath: c.usbPath ?? '', paperWidth: c.paperWidth ?? '80', url: c.url ?? '', payloadHex: c.payloadHex ?? '',
            zones: r.settings?.zones?.length ? JSON.stringify(r.settings.zones) : '', cashAcceptor: !!r.settings?.cashAcceptor,
          };
        }}
        toBody={(f) => {
          const edgeDeviceId = f.edgeDeviceId ? Number(f.edgeDeviceId) : undefined;
          let connection: Row = {};
          let settings: Row = {};
          if (f.type === 'CAMERA') {
            connection = { protocol: f.protocol, rtspUrl: f.rtspUrl || undefined, snapshotUrl: f.snapshotUrl || undefined, onvif: { username: f.onvifUser || undefined, password: f.onvifPassword || '********' }, edgeDeviceId };
            if (f.zones) settings = { zones: JSON.parse(f.zones) };
          } else if (f.type === 'PRINTER') {
            connection = { mode: f.mode, host: f.host || undefined, port: f.port || undefined, bridgeUrl: f.bridgeUrl || undefined, usbPath: f.usbPath || undefined, paperWidth: f.paperWidth, edgeDeviceId };
          } else if (f.type === 'BARRIER') {
            connection = { mode: f.bmode, url: f.url || undefined, host: f.host || undefined, port: f.port || undefined, payloadHex: f.payloadHex || undefined, edgeDeviceId };
          } else if (f.type === 'PAYMENT_KIOSK') settings = { cashAcceptor: f.cashAcceptor };
          return { type: f.type, name: f.name, model: f.model || null, siteId: f.siteId ? Number(f.siteId) : null, gateId: f.gateId ? Number(f.gateId) : null, active: f.active, connection, settings };
        }}
        onSaved={() => lk.reload()}
      />
      <Modal open={!!keyInfo} title={`Device Key — ${keyInfo?.device?.name ?? ''}`} onClose={() => setKeyInfo(null)}>
        {keyInfo && (
          <div className="col">
            <div style={{ color: 'var(--color-warning)' }}>แสดงเพียงครั้งเดียว — คัดลอกเก็บไว้ (Key เดิมใช้ไม่ได้แล้ว)</div>
            <div className="mono" style={{ wordBreak: 'break-all', padding: 10, background: 'var(--color-bg)', borderRadius: 8 }}>{keyInfo.key}</div>
            <div className="small muted">เปิดลิงก์นี้บนเครื่อง Kiosk / Counter เพื่อผูกอุปกรณ์:</div>
            <a href={keyInfo.setupUrl} className="mono small" style={{ wordBreak: 'break-all' }}>{keyInfo.setupUrl}</a>
            <img alt="setup QR" style={{ width: 200, alignSelf: 'center' }} src={`/api/public/qr?text=${encodeURIComponent(keyInfo.setupUrl)}`} />
            <Button onClick={() => navigator.clipboard?.writeText(keyInfo.key)}>คัดลอก Key</Button>
          </div>
        )}
      </Modal>
    </>
  );
}
