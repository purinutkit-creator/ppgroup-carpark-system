import { useEffect, useState } from 'react';
import { CrudTable, activeBadge } from '../../components/config/Crud';
import { useLookups } from '../../components/config/common';
import { Button, Card, MediaInput, errorText, useAsync, useToast } from '../../components/ui';
import { get, post } from '../../lib/api';
import { uploadMedia } from '../../lib/upload';
import { dateTime } from '../../lib/format';

type Row = Record<string, any>;

function PlaylistPreview({ items }: { items: Row[] }) {
  const live = items.filter((i) => i.active);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!live.length) return;
    const t = setTimeout(() => setI((x) => (x + 1) % live.length), (live[i % live.length]?.duration_sec ?? 10) * 1000);
    return () => clearTimeout(t);
  }, [i, live]);
  const cur = live[i % Math.max(1, live.length)];
  return (
    <Card title="ตัวอย่าง Playlist (วนอัตโนมัติ)">
      <div style={{ width: 216, height: 384, margin: '0 auto', background: '#000', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {cur ? (
          <>
            <div style={{ flex: cur.layout === 'SPLIT' ? '0 0 60%' : 1 }}>
              {cur.kind === 'VIDEO' ? <video src={cur.media_url} autoPlay muted loop style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <img src={cur.media_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            {cur.layout === 'SPLIT' && <div style={{ flex: 1, background: 'var(--color-primary)', color: '#fff', display: 'grid', placeItems: 'center' }}>ชำระค่าจอดรถ</div>}
          </>
        ) : (
          <div style={{ color: '#fff', margin: 'auto' }}>ยังไม่มีสื่อ</div>
        )}
      </div>
      {cur && <div className="center small muted mt">{cur.title} · {cur.duration_sec} วินาที</div>}
    </Card>
  );
}

export default function KioskContent() {
  const lk = useLookups();
  const toast = useToast();
  const list = useAsync(() => get('/api/admin/kiosk-content'), []);
  const items: Row[] = list.data?.items ?? [];
  const move = async (r: Row, dir: -1 | 1) => {
    const ids = items.map((x) => x.id);
    const idx = ids.indexOf(r.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await post('/api/admin/kiosk-content/reorder', { ids });
    list.reload();
  };
  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">Kiosk Content Management</h1>
        <div className="actions">
          <Button
            variant="secondary"
            onClick={async () => {
              if (!confirm('แสดงสื่อทั้งหมดบนทุก Kiosk?')) return;
              try {
                await post('/api/admin/kiosk-content/apply-all');
                toast('Apply to All Kiosks แล้ว', 'success');
                list.reload();
              } catch (e) {
                toast(errorText(e), 'error');
              }
            }}
          >
            Apply to All Kiosks
          </Button>
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 280px' }}>
        <CrudTable<Row, Row>
          key={list.data ? items.length + ':' + items.map((x) => x.id).join() : 'x'}
          title="Playlist"
          url="/api/admin/kiosk-content"
          onSaved={() => list.reload()}
          columns={[
            { label: '', render: (r) => (r.kind === 'VIDEO' ? <video src={r.media_url} className="img-thumb" muted /> : <img src={r.media_url} className="img-thumb" alt="" />) },
            { label: 'ชื่อ', render: (r) => <><b>{r.title}</b><div className="small muted">{r.category} · {r.layout} · {r.duration_sec}s</div></> },
            { label: 'ช่วงแสดง', render: (r) => <span className="small">{r.start_at || r.end_at ? `${dateTime(r.start_at)} – ${dateTime(r.end_at)}` : 'ตลอด'}{r.daily_start ? ` · ${r.daily_start}–${r.daily_end}` : ''}</span> },
            { label: 'Kiosk', render: (r) => (r.device_ids?.length ? `${r.device_ids.length} เครื่อง` : 'ทุกเครื่อง') },
            { label: '', render: (r) => activeBadge(r.active) },
          ]}
          actions={(r) => (
            <>
              <Button size="sm" variant="ghost" onClick={() => move(r, -1)}>↑</Button>
              <Button size="sm" variant="ghost" onClick={() => move(r, 1)}>↓</Button>
            </>
          )}
          fields={[
            { key: 'title', label: 'ชื่อ' },
            { key: 'category', label: 'หมวด', type: 'select', options: ['PROMOTION', 'CAMPAIGN', 'BANNER', 'ADVERTISEMENT'].map((v) => ({ value: v, label: v })) },
            {
              key: 'mediaUrl', label: 'รูป / วิดีโอ', type: 'custom', wide: true,
              render: (f, set) => (
                <MediaInput label="" value={f.mediaUrl} accept="image/*,video/mp4,video/webm" recommended="Kiosk แนวตั้ง 1080×1920 px · Banner 1920×480 px · Video 1920×1080" upload={(file) => uploadMedia(file, 'kiosk')} onChange={(url) => set({ mediaUrl: url, kind: /\.(mp4|webm)$/i.test(url) ? 'VIDEO' : 'IMAGE' })} />
              ),
            },
            { key: 'layout', label: 'รูปแบบ', type: 'select', options: [{ value: 'FULL', label: 'Full Screen' }, { value: 'SPLIT', label: 'Split Screen' }] },
            { key: 'durationSec', label: 'แสดงต่อ Slide (วินาที)', type: 'number' },
            { key: 'startAt', label: 'วันที่เริ่ม', type: 'datetime' },
            { key: 'endAt', label: 'วันที่สิ้นสุด', type: 'datetime' },
            { key: 'dailyStart', label: 'เวลาแสดงเริ่ม (ทุกวัน)', type: 'time' },
            { key: 'dailyEnd', label: 'เวลาแสดงสิ้นสุด', type: 'time' },
            { key: 'deviceId', label: 'Kiosk', type: 'select', options: [{ value: '', label: 'ทุก Kiosk' }, ...lk.devicesOf('PAYMENT_KIOSK', 'ENTRY_KIOSK', 'EXIT_KIOSK').map((d) => ({ value: String(d.id), label: d.name }))] },
            { key: 'active', label: 'ใช้งาน', type: 'check' },
          ]}
          empty={() => ({ title: '', category: 'PROMOTION', mediaUrl: '', kind: 'IMAGE', layout: 'FULL', durationSec: 10, startAt: null, endAt: null, dailyStart: null, dailyEnd: null, deviceId: '', active: true })}
          toForm={(r) => ({ title: r.title, category: r.category, mediaUrl: r.media_url, kind: r.kind, layout: r.layout, durationSec: r.duration_sec, startAt: r.start_at, endAt: r.end_at, dailyStart: r.daily_start, dailyEnd: r.daily_end, deviceId: r.device_ids?.[0] ? String(r.device_ids[0]) : '', active: !!r.active })}
          toBody={(f) => ({ ...f, deviceIds: f.deviceId ? [Number(f.deviceId)] : null, deviceId: undefined })}
        />
        <PlaylistPreview items={items} />
      </div>
    </>
  );
}
