import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Button, Card, Field, Input, errorText } from '../components/ui';

export default function Login() {
  const { login } = useAuth();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const u = await login(username, password);
      const next = sp.get('next');
      if (next) nav(next, { replace: true });
      else if (u.merchantId) nav(u.permissions.includes('merchant.portal') ? '/merchant' : '/pos', { replace: true });
      else if (u.role === 'INFORMATION' || u.role === 'CASHIER') nav('/counter', { replace: true });
      else nav('/admin', { replace: true });
    } catch (x) {
      setErr(errorText(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-page">
      <Card className="login-card">
        <form onSubmit={submit} className="col">
          <h2 style={{ textAlign: 'center' }}>Smart Parking</h2>
          <p className="muted center small" style={{ marginTop: -8 }}>
            ระบบบริหารลานจอดรถ · Merchant POS
          </p>
          <Field label="ชื่อผู้ใช้">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          </Field>
          <Field label="รหัสผ่าน">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
          <Button type="submit" variant="primary" block loading={busy}>
            เข้าสู่ระบบ
          </Button>
          <a href="/merchant/register" className="small center">
            ร้านค้า: ลงทะเบียนขอใช้งาน POS
          </a>
        </form>
      </Card>
    </div>
  );
}
