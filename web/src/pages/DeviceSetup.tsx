/**
 * Bind this browser (kiosk PC / counter tablet) to a device record.
 * Open once with /setup?key=<device key>&next=/kiosk/entry or paste the key.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getDeviceKey, setDeviceKey, storage, ApiError } from '../lib/api';
import { Button, Card, Field, Input, errorText } from '../components/ui';

const TARGET: Record<string, string> = { CAMERA: '/camera', ENTRY_KIOSK: '/kiosk/entry', EXIT_KIOSK: '/kiosk/exit', PAYMENT_KIOSK: '/kiosk/pay', COUNTER: '/counter', DISPLAY: '/display' };

export const CAMERA_KEY = 'pp.cameraKey';

export default function DeviceSetup() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [key, setKey] = useState(sp.get('key') ?? getDeviceKey() ?? '');
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const verify = async (k: string) => {
    setErr(null);
    try {
      const res = await fetch('/api/kiosk/bootstrap', { headers: { 'X-Device-Key': k } });
      const r = await res.json();
      if (!res.ok) throw new ApiError(res.status, r.error ?? 'ERROR', r.message ?? r.error ?? res.statusText);
      // A webcam station can run on the same PC as a kiosk, so its key is stored separately.
      if (r.device?.type === 'CAMERA') storage.set(CAMERA_KEY, k);
      else setDeviceKey(k);
      setInfo(r);
      const next = sp.get('next') ?? TARGET[r.device?.type ?? ''];
      if (sp.get('key') && next) nav(next, { replace: true });
    } catch (e) {
      setInfo(null);
      setErr(errorText(e));
    }
  };
  useEffect(() => {
    if (sp.get('key')) verify(sp.get('key')!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="login-page">
      <Card className="login-card">
        <div className="col">
          <h2>ตั้งค่าอุปกรณ์</h2>
          <Field label="Device Key" hint="สร้างได้ที่ Admin → อุปกรณ์ → สร้าง Key">
            <Input value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
          {info?.device && (
            <div className="small">
              ✓ {info.device.name} ({info.device.type}) {info.gate ? `· ${info.gate.name}` : ''} · {info.site?.name}
            </div>
          )}
          <div className="row">
            <Button variant="primary" onClick={() => verify(key.trim())}>
              บันทึก
            </Button>
            {info?.device && TARGET[info.device.type] && <Button onClick={() => nav(TARGET[info.device.type])}>เปิดหน้าจอ</Button>}
            <Button
              variant="ghost"
              onClick={() => {
                setDeviceKey(null);
                setInfo(null);
                setKey('');
              }}
            >
              ล้าง
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
