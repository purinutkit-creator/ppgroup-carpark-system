/**
 * Second screen facing the customer. Opens with a merchant login or
 * /display?key=<POS device key>; mirrors the cart live via `pos:cart`.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { getDeviceKey, setDeviceKey } from '../../lib/api';
import { useSocketEvents } from '../../lib/useSocket';
import { money } from '../../lib/format';
import { posGet } from '../../components/pos/types';
import '../../components/pos/pos.css';

interface Line { name: string; qty: number; price: number; variant?: string | null }
type View =
  | { stage: 'IDLE' }
  | { stage: 'CART'; lines: Line[]; total: number }
  | { stage: 'PAYING'; due: number; paid: number; promptPay?: string | null }
  | { stage: 'DONE'; total: number; change: number; receiptNo: string };

export default function CustomerDisplay() {
  const [sp] = useSearchParams();
  const key = sp.get('key');
  if (key && key !== getDeviceKey()) setDeviceKey(key);
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<View>({ stage: 'IDLE' });
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    posGet('/api/pos/display/info').then(setInfo).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    if (view.stage === 'PAYING' && view.promptPay) QRCode.toDataURL(view.promptPay, { width: 360, margin: 1 }).then(setQr);
    else setQr(null);
  }, [view]);
  useEffect(() => {
    if (view.stage !== 'DONE') return;
    const t = setTimeout(() => setView({ stage: 'IDLE' }), 8000);
    return () => clearTimeout(t);
  }, [view]);

  useSocketEvents({
    'pos:cart': (p: { cart: any }) => {
      const c = p.cart;
      if (!c || (c.stage === 'CART' && !c.lines?.length)) return setView({ stage: 'IDLE' });
      setView(c as View);
    },
    'pos:sale': (p: { total: number; change: number; receiptNo: string }) => setView({ stage: 'DONE', total: p.total, change: p.change ?? 0, receiptNo: p.receiptNo }),
  });

  if (err) return <div className="page-forbidden">ต้องเข้าสู่ระบบร้านค้า หรือเปิดด้วย /display?key=&lt;POS device key&gt; ({err})</div>;
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-bg) var(--bg-image) center/cover' }}>
      <div style={{ padding: '18px 28px', background: 'var(--color-primary)', color: '#fff', display: 'flex', alignItems: 'center', gap: 14 }}>
        {info?.merchant?.logo_url && <img src={info.merchant.logo_url} style={{ height: 48, borderRadius: 8 }} alt="" />}
        <span style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-heading)' }}>{info?.merchant?.name ?? ''}</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        {view.stage === 'IDLE' && <div style={{ fontSize: 44, fontFamily: 'var(--font-heading)' }}>ยินดีต้อนรับ</div>}
        {view.stage === 'CART' && (
          <div className="card" style={{ width: 'min(900px, 100%)' }}>
            {view.lines.map((l, i) => (
              <div key={i} className="row" style={{ padding: '10px 0', borderBottom: '1px dashed var(--color-border)' }}>
                <span data-el="customer-display/main/items/name">{l.name}{l.variant ? ` (${l.variant})` : ''} × {l.qty}</span>
                <span className="spacer" />
                <span className="num" style={{ fontSize: 22 }}>{money(l.price)}</span>
              </div>
            ))}
            <div className="row mt">
              <b style={{ fontSize: 26 }}>ยอดรวม</b>
              <span className="spacer" />
              <span data-el="customer-display/main/amount/total">{money(view.total)}</span>
            </div>
          </div>
        )}
        {view.stage === 'PAYING' && (
          <div className="col center">
            <div style={{ fontSize: 28 }}>ยอดชำระ</div>
            <div data-el="customer-display/main/amount/total">{money(view.due - view.paid)}</div>
            {qr && <img src={qr} alt="PromptPay" style={{ width: 340, background: '#fff', padding: 10, borderRadius: 12 }} />}
            {qr && <div style={{ fontSize: 22 }}>สแกนจ่ายด้วย PromptPay</div>}
          </div>
        )}
        {view.stage === 'DONE' && (
          <div className="col center">
            <div style={{ fontSize: 48 }}>✓ ขอบคุณค่ะ</div>
            <div data-el="customer-display/main/amount/total">{money(view.total)}</div>
            {view.change > 0 && <div style={{ fontSize: 30 }}>เงินทอน {money(view.change)}</div>}
            <div className="muted">นำใบเสร็จไปรับสิทธิ์ส่วนลดค่าจอดรถที่ประชาสัมพันธ์</div>
          </div>
        )}
      </div>
    </div>
  );
}
