/**
 * Bind this browser (kiosk PC / counter tablet) to a device record.
 * Open once with /setup?key=<device key>&next=/kiosk/entry or paste the key.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { get, getDeviceKey, setDeviceKey } from '../lib/api';
import { Button, Card, Field, Input, errorText } from '../components/ui';

const TARGET: Record<string, string> = { ENTRY_KIOSK: '/kiosk/entry', EXIT_KIOSK: '/kiosk/exit', PAYMENT_KIOSK: '/kiosk/pay', COUNTER: '/counter', DISPLAY: '/display' };

export default function DeviceSetup() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [key, setKey] = useState(sp.get('key') ?? getDeviceKey() ?? '');
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const verify = async (k: string) => {
    setErr(null);
    setDeviceKey(k);
    try {
      const r = await get('/api/kiosk/bootstrap', { device: true });
      setInfo(r);
      const next = sp.get('next') ?? TARGET[r.device?.type ?? ''];
      if (sp.get('key') && next) nav(next, { replace: true });
    } catch (e) {
      setDeviceKey(null);
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
