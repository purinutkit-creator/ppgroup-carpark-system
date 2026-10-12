import { Link } from 'react-router-dom';
import { Card } from '../components/ui';

const LINKS = [
  { to: '/admin', title: 'Admin Dashboard', desc: 'ภาพรวม รายงาน การตั้งค่าทั้งหมด' },
  { to: '/counter', title: 'Information Counter', desc: 'สแกนบัตรจอด + ใบเสร็จ เพื่อให้ส่วนลด' },
  { to: '/pos', title: 'Merchant POS', desc: 'ระบบขายหน้าร้าน ออกใบเสร็จพร้อม Parking Validation' },
  { to: '/merchant', title: 'Merchant Portal', desc: 'หลังบ้านร้านค้า' },
  { to: '/merchant/register', title: 'ลงทะเบียนร้านค้า', desc: 'ขอใช้งาน POS ของศูนย์' },
  { to: '/kiosk/entry', title: 'Entry Kiosk', desc: 'ตู้ทางเข้า (ต้องตั้งค่า Device Key)' },
  { to: '/kiosk/exit', title: 'Exit Kiosk', desc: 'ตู้ทางออก' },
  { to: '/kiosk/pay', title: 'Payment Kiosk', desc: 'ตู้ชำระค่าจอดรถ' },
  { to: '/printer', title: 'เครื่องพิมพ์ (USB)', desc: 'ค้นหาและเลือกเครื่องพิมพ์ที่ต่อกับคอมพิวเตอร์เครื่องนี้' },
  { to: '/camera', title: 'กล้อง Webcam (อ่านป้าย)', desc: 'ใช้กล้องของคอมพิวเตอร์อ่านป้ายทะเบียนที่ทางเข้า/ออก' },
  { to: '/setup', title: 'ตั้งค่าอุปกรณ์', desc: 'ผูก Kiosk / Counter กับ Device Key' },
];

export default function Home() {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <h1>Smart Parking Management System</h1>
      <p className="muted">ระบบบริหารลานจอดรถอัจฉริยะ — LPR/OCR · Kiosk · QR Payment · Merchant POS & Parking Validation</p>
      <div className="grid grid-3 mt">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Card>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{l.title}</div>
              <div className="muted small">{l.desc}</div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
