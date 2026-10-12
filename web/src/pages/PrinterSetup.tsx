/**
 * "เครื่องพิมพ์ของเครื่องนี้": find a USB / serial thermal printer from the
 * browser, choose paper width, print a test page. Saved per computer.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Field, Select, errorText, useToast } from '../components/ui';
import { authorizedUsbDevices, findSerialPrinter, findUsbPrinter, getLocalPrinter, setLocalPrinter, supportsSerial, supportsUsb, type LocalPrinter } from '../print/localPrinter';
import { printDoc } from '../print/print';
import { useDesign } from '../design/DesignProvider';

export default function PrinterSetup() {
  const toast = useToast();
  const design = useDesign();
  const [cur, setCur] = useState<LocalPrinter | null>(getLocalPrinter());
  const [paper, setPaper] = useState<'58' | '80'>(cur?.paperWidth ?? '80');
  const [known, setKnown] = useState<Awaited<ReturnType<typeof authorizedUsbDevices>>>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authorizedUsbDevices().then(setKnown).catch(() => undefined);
  }, [cur]);

  const save = (p: LocalPrinter | null) => {
    setLocalPrinter(p);
    setCur(p);
  };
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast(ok, 'success');
    } catch (e) {
      const msg = errorText(e);
      if (!/No device selected|cancel/i.test(msg)) toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };
  const test = () =>
    run(
      () =>
        printDoc(
          {
            paperWidth: paper,
            cut: true,
            blocks: [
              { type: 'text', text: 'SMART PARKING', align: 'center', weight: 700, size: 24 },
              { type: 'text', text: 'ทดสอบเครื่องพิมพ์ / Printer test', align: 'center' },
              { type: 'line' },
              { type: 'row', left: 'เครื่องพิมพ์', right: cur?.name ?? 'Browser' },
              { type: 'row', left: 'กระดาษ', right: `${paper} มม.` },
              { type: 'row', left: 'เวลา', right: new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) },
              { type: 'qr', data: location.origin, size: 200, caption: 'ภาษาไทย กขค ๑๒๓ ฿120.00' },
            ],
          },
          design?.config ?? null,
          null,
        ),
      'ส่งหน้าทดสอบแล้ว',
    );

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }} className="col">
      <div className="row">
        <h1 style={{ margin: 0 }}>🖨️ เครื่องพิมพ์ของเครื่องนี้</h1>
        <span className="spacer" />
        <Link to="/" className="btn btn-sm">หน้าแรก</Link>
      </div>
      <Card title="เครื่องพิมพ์ที่ใช้อยู่">
        {cur ? (
          <div className="row">
            <Badge tone="success">{cur.kind === 'webusb' ? 'USB' : cur.kind === 'webserial' ? 'Serial / Bluetooth' : 'หน้าต่างพิมพ์ของระบบ'}</Badge>
            <b>{cur.name}</b>
            <span className="muted">· {cur.paperWidth} มม.</span>
            <span className="spacer" />
            <Button onClick={test} loading={busy}>พิมพ์ทดสอบ</Button>
            <Button variant="ghost" onClick={() => save(null)}>เลิกใช้</Button>
          </div>
        ) : (
          <div className="muted">ยังไม่ได้เลือก — ระบบจะใช้เครื่องพิมพ์ที่ตั้งไว้ใน Admin หรือหน้าต่างพิมพ์ของเบราว์เซอร์</div>
        )}
      </Card>
      <Card title="ค้นหาเครื่องพิมพ์">
        <div className="col">
          <Field label="ขนาดกระดาษ">
            <Select value={paper} onChange={(e) => { const v = e.target.value as '58' | '80'; setPaper(v); if (cur) save({ ...cur, paperWidth: v }); }} options={[{ value: '80', label: '80 มม.' }, { value: '58', label: '58 มม.' }]} />
          </Field>
          <div className="row">
            <Button variant="primary" size="lg" disabled={!supportsUsb() || busy} onClick={() => run(async () => save(await findUsbPrinter(paper)), 'เชื่อมต่อเครื่องพิมพ์ USB แล้ว')}>
              🔍 ค้นหาเครื่องพิมพ์ USB
            </Button>
            <Button size="lg" disabled={!supportsSerial() || busy} onClick={() => run(async () => save(await findSerialPrinter(paper)), 'เชื่อมต่อแล้ว')}>
              ค้นหาเครื่องพิมพ์ Serial / Bluetooth
            </Button>
            <Button size="lg" onClick={() => { save({ kind: 'browser', name: 'หน้าต่างพิมพ์ของระบบ', paperWidth: paper }); toast('ใช้หน้าต่างพิมพ์ของระบบ', 'success'); }}>
              ใช้หน้าต่างพิมพ์ของระบบ
            </Button>
          </div>
          {!supportsUsb() && <div style={{ color: 'var(--color-warning)' }}>เบราว์เซอร์นี้ค้นหาเครื่องพิมพ์ USB ไม่ได้ — ใช้ Google Chrome หรือ Microsoft Edge บนคอมพิวเตอร์</div>}
          {known.length > 0 && (
            <div>
              <div className="small muted">อุปกรณ์ USB ที่เคยอนุญาตไว้:</div>
              {known.map((k) => (
                <div key={`${k.vendorId}:${k.productId}:${k.serialNumber}`} className="row" style={{ padding: '6px 0' }}>
                  <span>{k.name}</span>
                  <span className="spacer" />
                  <Button size="sm" onClick={() => save({ kind: 'webusb', name: k.name, paperWidth: paper, vendorId: k.vendorId, productId: k.productId, serialNumber: k.serialNumber })}>ใช้เครื่องนี้</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
      <Card title="คำแนะนำ">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>รองรับเครื่องพิมพ์ใบเสร็จ/บัตรความร้อน (ESC/POS) 58 และ 80 มม. — ข้อความภาษาไทยและฟอนต์ที่ตั้งไว้พิมพ์เป็นภาพ จึงไม่ต้องตั้งค่า Code page</li>
          <li>กด “ค้นหาเครื่องพิมพ์ USB” แล้วเลือกเครื่องพิมพ์ในหน้าต่างของเบราว์เซอร์ ระบบจะจำไว้สำหรับเครื่องคอมพิวเตอร์นี้</li>
          <li>Windows: ถ้าขึ้นว่าเข้าถึงไม่ได้ ต้องเปลี่ยนไดรเวอร์ของเครื่องพิมพ์เป็น WinUSB (เช่นด้วยโปรแกรม Zadig) หรือเลือก “ใช้หน้าต่างพิมพ์ของระบบ” แทน (ใช้ไดรเวอร์ของผู้ผลิต)</li>
          <li>macOS / Linux / ChromeOS / Android: ส่วนใหญ่ใช้ได้ทันที</li>
          <li>ต้องเปิดผ่าน https (เช่นลิงก์ onrender.com) เบราว์เซอร์จึงอนุญาตให้ใช้ USB</li>
        </ul>
      </Card>
    </div>
  );
}
