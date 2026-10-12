import { useEffect, useState, type ReactNode } from 'react';
import { SOURCE_TYPES } from '@pp/shared/plate';
import { useSettingsModule, useApplyPermissions, VersionHistory } from '../../components/config/settingsModule';
import { useLookups } from '../../components/config/common';
import { Button, Card, Check, Field, Input, MediaInput, Select, SettingsFooter, Tabs, TextArea, type ApplyTarget } from '../../components/ui';
import { uploadMedia } from '../../lib/upload';
import { useDesign } from '../../design/DesignProvider';
import { previewDoc } from '../../print/print';
import { ticketDoc } from '../../print/templates';

type Any = Record<string, any>;
type TabId = 'branding' | 'ticket' | 'receipt' | 'operation' | 'lpr' | 'payment' | 'pdpa';
const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'branding', label: 'ชื่อ โลโก้ & ภาษา' },
  { id: 'ticket', label: 'บัตรจอดรถ' },
  { id: 'receipt', label: 'ใบเสร็จค่าจอด' },
  { id: 'operation', label: 'การทำงานลานจอด' },
  { id: 'lpr', label: 'กล้อง LPR / OCR' },
  { id: 'payment', label: 'การชำระเงิน' },
  { id: 'pdpa', label: 'PDPA' },
];

function useTargets(tab: TabId): ApplyTarget[] {
  const lk = useLookups();
  const by = (...types: string[]) => lk.devicesOf(...types).map((d) => ({ id: String(d.id), label: d.name }));
  switch (tab) {
    case 'ticket':
      return by('ENTRY_KIOSK', 'PRINTER');
    case 'receipt':
    case 'payment':
      return by('PAYMENT_KIOSK', 'EXIT_KIOSK', 'COUNTER');
    case 'lpr':
      return by('CAMERA', 'EDGE');
    case 'branding':
      return [...by('ENTRY_KIOSK', 'EXIT_KIOSK', 'PAYMENT_KIOSK'), { id: 'customer-web', label: 'Customer Parking Website' }];
    default:
      return lk.sites.map((s) => ({ id: `site:${s.id}`, label: s.name }));
  }
}

const T = ({ label, v, on, ...rest }: { label: ReactNode; v: any; on: (x: string) => void; hint?: string; type?: string }) => (
  <Field label={label} hint={rest.hint}>
    <Input type={rest.type} value={v ?? ''} onChange={(e) => on(e.target.value)} />
  </Field>
);
const N = ({ label, v, on, hint }: { label: ReactNode; v: any; on: (x: number) => void; hint?: string }) => (
  <Field label={label} hint={hint}>
    <Input type="number" value={v ?? 0} onChange={(e) => on(Number(e.target.value))} />
  </Field>
);

function Branding({ v, p }: { v: Any; p: (x: Any) => void }) {
  return (
    <div className="grid grid-2">
      <T label="ชื่อสถานที่" v={v.siteName} on={(x) => p({ siteName: x })} />
      <T label="เบอร์โทรติดต่อเจ้าหน้าที่" v={v.supportPhone} on={(x) => p({ supportPhone: x })} />
      <MediaInput label="โลโก้" value={v.logoUrl} recommended="1000 × 1000 px (PNG พื้นใส)" upload={(f) => uploadMedia(f, 'branding')} onChange={(u) => p({ logoUrl: u })} />
      <MediaInput label="พื้นหลัง Kiosk" value={v.kioskBackgroundUrl} recommended="1080 × 1920 px (แนวตั้ง)" upload={(f) => uploadMedia(f, 'branding')} onChange={(u) => p({ kioskBackgroundUrl: u })} />
      <MediaInput label="พื้นหลังหน้าลูกค้า" value={v.customerBackgroundUrl} recommended="1080 × 1920 px" upload={(f) => uploadMedia(f, 'branding')} onChange={(u) => p({ customerBackgroundUrl: u })} />
      <Field label="ภาษาที่เปิดให้ลูกค้าเลือก">
        <div className="row">
          {(['th', 'en', 'zh'] as const).map((l) => (
            <Check key={l} label={{ th: 'ไทย', en: 'English', zh: '中文' }[l]} checked={v.languages?.includes(l)} onChange={(c) => p({ languages: c ? [...(v.languages ?? []), l] : v.languages.filter((x: string) => x !== l) })} />
          ))}
        </div>
      </Field>
      <Field label="ภาษาเริ่มต้น">
        <Select value={v.defaultLanguage} onChange={(e) => p({ defaultLanguage: e.target.value })} options={[{ value: 'th', label: 'ไทย' }, { value: 'en', label: 'English' }, { value: 'zh', label: '中文' }]} />
      </Field>
      <T label="ข้อความต้อนรับ (ทางเข้า)" v={v.messages?.entryWelcome} on={(x) => p({ messages: { ...v.messages, entryWelcome: x } })} />
      <T label="ข้อความขอบคุณ (ทางออก)" v={v.messages?.exitThanks} on={(x) => p({ messages: { ...v.messages, exitThanks: x } })} />
      <T label="ข้อความลานจอดเต็ม" v={v.messages?.lotFull} on={(x) => p({ messages: { ...v.messages, lotFull: x } })} />
      <T label="ข้อความเรียกเจ้าหน้าที่" v={v.messages?.callStaff} on={(x) => p({ messages: { ...v.messages, callStaff: x } })} />
      <Check label="เปิดเสียงแจ้งเตือน" checked={!!v.sounds?.enabled} onChange={(c) => p({ sounds: { ...v.sounds, enabled: c } })} />
    </div>
  );
}

function Ticket({ v, p }: { v: Any; p: (x: Any) => void }) {
  const design = useDesign();
  const [img, setImg] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      previewDoc(
        ticketDoc({ ...(v as any), plate: 'กข 1234', province: 'กรุงเทพมหานคร', parkingNo: 'PK202610120001', entryAt: new Date().toISOString(), freeTime: v.showFreeTime ? '2 ชม.' : null, rateText: v.showRate ? '20 บาท/ชั่วโมง' : null, qrUrl: `${location.origin}/p/sample-token-for-preview` }),
        design?.config ?? null,
      ).then(setImg);
    }, 300);
    return () => clearTimeout(t);
  }, [v, design?.config]);
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
      <div className="grid grid-2" style={{ alignContent: 'start' }}>
        <Field label="ขนาดกระดาษ">
          <Select value={v.paperWidth} onChange={(e) => p({ paperWidth: e.target.value })} options={[{ value: '80', label: '80 มม.' }, { value: '58', label: '58 มม.' }]} />
        </Field>
        <N label="จำนวน QR Code ที่พิมพ์" v={v.qrCount} on={(x) => p({ qrCount: Math.max(1, Math.min(3, x)) })} />
        <T label="หัวบัตร" v={v.title} on={(x) => p({ title: x })} />
        <T label="หัวรอง" v={v.subtitle} on={(x) => p({ subtitle: x })} />
        <MediaInput label="โลโก้บนบัตร" value={v.logoUrl} recommended="ขาว-ดำ กว้าง 400 px" upload={(f) => uploadMedia(f, 'branding')} onChange={(u) => p({ logoUrl: u })} />
        <N label="ขนาด QR (dots)" v={v.qrSize} on={(x) => p({ qrSize: x })} hint="แนะนำ 200–300" />
        <N label="สเกลตัวอักษร" v={v.fontScale} on={(x) => p({ fontScale: x })} hint="1 = มาตรฐาน (ฟอนต์ตั้งที่ Appearance → Print Fonts)" />
        <T label="ข้อความท้ายบัตร" v={v.footerText} on={(x) => p({ footerText: x })} />
        <Check label="แสดงจังหวัด" checked={v.showProvince} onChange={(c) => p({ showProvince: c })} />
        <Check label="แสดงเวลาจอดฟรี" checked={v.showFreeTime} onChange={(c) => p({ showFreeTime: c })} />
        <Check label="แสดงอัตราค่าจอด" checked={v.showRate} onChange={(c) => p({ showRate: c })} />
        <Field label="บรรทัดเพิ่มเติม (บรรทัดละข้อความ)" className="">
          <TextArea value={(v.extraLines ?? []).join('\n')} onChange={(e) => p({ extraLines: e.target.value.split('\n').filter(Boolean) })} />
        </Field>
      </div>
      <Card title="ตัวอย่างบัตร (bitmap ที่ส่งเข้าเครื่องพิมพ์)">
        {img ? <img src={img} alt="ticket preview" style={{ width: '100%', border: '1px solid var(--color-border)', imageRendering: 'pixelated' }} /> : 'กำลังสร้าง…'}
      </Card>
    </div>
  );
}

function Receipt({ v, p }: { v: Any; p: (x: Any) => void }) {
  return (
    <div className="grid grid-2">
      <Field label="ขนาดกระดาษ">
        <Select value={v.paperWidth} onChange={(e) => p({ paperWidth: e.target.value })} options={[{ value: '80', label: '80 มม.' }, { value: '58', label: '58 มม.' }]} />
      </Field>
      <T label="หัวใบเสร็จ" v={v.header} on={(x) => p({ header: x })} />
      <T label="ชื่อบริษัท (ผู้ออกใบเสร็จ/ใบกำกับภาษี)" v={v.companyName} on={(x) => p({ companyName: x })} />
      <T label="เลขประจำตัวผู้เสียภาษี" v={v.companyTaxId} on={(x) => p({ companyTaxId: x })} />
      <T label="สาขา" v={v.companyBranch} on={(x) => p({ companyBranch: x })} />
      <N label="VAT %" v={v.vatRate} on={(x) => p({ vatRate: x })} />
      <Field label="ที่อยู่บริษัท">
        <TextArea value={v.companyAddress ?? ''} onChange={(e) => p({ companyAddress: e.target.value })} />
      </Field>
      <Field label="ข้อความโปรโมชั่น">
        <TextArea value={v.promoText ?? ''} onChange={(e) => p({ promoText: e.target.value })} />
      </Field>
      <T label="ข้อความท้ายใบเสร็จ" v={v.footer} on={(x) => p({ footer: x })} />
      <Check label="แสดง VAT" checked={v.showVat} onChange={(c) => p({ showVat: c })} />
    </div>
  );
}

function Operation({ v, p }: { v: Any; p: (x: Any) => void }) {
  return (
    <div className="grid grid-2">
      <Check label="ออกบัตรอัตโนมัติเมื่ออ่านป้ายได้ (ไม่ต้องกดปุ่ม)" checked={v.autoIssueTicket} onChange={(c) => p({ autoIssueTicket: c })} />
      <Check label="อนุญาตออกบัตรแบบไม่ระบุทะเบียน เมื่ออ่านป้ายไม่ได้" checked={v.allowTicketWithoutPlate} onChange={(c) => p({ allowTicketWithoutPlate: c })} />
      <Field label="เมื่อพบรถที่ยังมีรายการจอดค้าง">
        <Select value={v.duplicateEntryPolicy} onChange={(e) => p({ duplicateEntryPolicy: e.target.value })} options={[{ value: 'FLAG', label: 'อนุญาตและแจ้งเตือน' }, { value: 'CLOSE_PREVIOUS', label: 'ปิดรายการเดิมอัตโนมัติ' }, { value: 'DENY', label: 'ไม่อนุญาตเข้า' }]} />
      </Field>
      <N label="แจ้งเตือนรถจอดนานเกิน (ชั่วโมง)" v={v.longStayHours} on={(x) => p({ longStayHours: x })} />
      <N label="QR ชำระเงินหมดอายุ (นาที)" v={v.pendingPaymentExpiryMinutes} on={(x) => p({ pendingPaymentExpiryMinutes: x })} />
      <Check label="ทางออกต้องตรงจังหวัดด้วย (ไม่ตรงส่งเจ้าหน้าที่)" checked={v.exitRequireProvinceMatch} onChange={(c) => p({ exitRequireProvinceMatch: c })} />
      <Field label="เมื่อระบบออฟไลน์ที่ทางออก">
        <Select value={v.offlineExitPolicy} onChange={(e) => p({ offlineExitPolicy: e.target.value })} options={[{ value: 'ALLOW_PAID_CACHE', label: 'เปิดเฉพาะรถที่ชำระแล้ว (จาก cache)' }, { value: 'ALLOW_ALL', label: 'เปิดทุกคัน (บันทึกไว้ซิงก์ภายหลัง)' }, { value: 'DENY', label: 'ไม่เปิด เรียกเจ้าหน้าที่' }]} />
      </Field>
      <Check label="ใช้สิทธิประโยชน์ Member Tier ในการคิดค่าจอด" checked={v.memberBenefitsEnabled} onChange={(c) => p({ memberBenefitsEnabled: c })} />
      <Field label="ประเภทรถ (รหัส=ชื่อ บรรทัดละ 1)">
        <TextArea
          value={(v.vehicleTypes ?? []).map((t: Any) => `${t.code}=${t.name}`).join('\n')}
          onChange={(e) => p({ vehicleTypes: e.target.value.split('\n').filter((l) => l.includes('=')).map((l) => ({ code: l.split('=')[0].trim().toUpperCase(), name: l.split('=').slice(1).join('=').trim() })) })}
        />
      </Field>
    </div>
  );
}

function Lpr({ v, p }: { v: Any; p: (x: Any) => void }) {
  const prio: string[] = v.priority ?? [];
  const move = (i: number, d: number) => {
    const n = [...prio];
    const j = i + d;
    if (j < 0 || j >= n.length) return;
    [n[i], n[j]] = [n[j], n[i]];
    p({ priority: n });
  };
  const missing = SOURCE_TYPES.filter((s) => s !== 'MANUAL_ENTRY' && !prio.includes(s));
  return (
    <div className="grid grid-2">
      <Card title="Confidence Threshold">
        <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', fontSize: 12, color: '#fff', marginBottom: 12 }}>
          <div style={{ width: `${v.kioskConfirmMin}%`, background: 'var(--color-danger)', display: 'grid', placeItems: 'center' }}>เจ้าหน้าที่ตรวจ</div>
          <div style={{ width: `${v.autoConfirmMin - v.kioskConfirmMin}%`, background: 'var(--color-warning)', display: 'grid', placeItems: 'center' }}>ยืนยันที่ Kiosk</div>
          <div style={{ flex: 1, background: 'var(--color-success)', display: 'grid', placeItems: 'center' }}>อัตโนมัติ</div>
        </div>
        <div className="grid grid-2">
          <N label="ยืนยันอัตโนมัติ เมื่อ ≥ (%)" v={v.autoConfirmMin} on={(x) => p({ autoConfirmMin: x })} />
          <N label="แสดงบน Kiosk ให้ตรวจ เมื่อ ≥ (%)" v={v.kioskConfirmMin} on={(x) => p({ kioskConfirmMin: x })} hint="ต่ำกว่านี้ส่งเจ้าหน้าที่ตรวจสอบ" />
        </div>
      </Card>
      <Card title="ลำดับความสำคัญของแหล่งข้อมูล (Priority)">
        {prio.map((s, i) => (
          <div key={s} className="row" style={{ marginBottom: 6 }}>
            <b style={{ width: 20 }}>{i + 1}.</b>
            <span className="mono" style={{ flex: 1 }}>{s}</span>
            <Button size="sm" onClick={() => move(i, -1)}>↑</Button>
            <Button size="sm" onClick={() => move(i, 1)}>↓</Button>
            <Button size="sm" variant="ghost" onClick={() => p({ priority: prio.filter((x) => x !== s) })}>✕</Button>
          </div>
        ))}
        {missing.map((s) => (
          <Button key={s} size="sm" onClick={() => p({ priority: [...prio, s] })}>+ {s}</Button>
        ))}
      </Card>
      <N label="แก้ชื่อจังหวัดอัตโนมัติเมื่อความคล้าย ≥ (0–1)" v={v.provinceAutoCorrectMinSimilarity} on={(x) => p({ provinceAutoCorrectMinSimilarity: x })} hint="ผล OCR ต้นฉบับถูกบันทึกเสมอ" />
      <N label="และ Confidence ของจังหวัด ≥ (%)" v={v.provinceAutoCorrectMinConfidence} on={(x) => p({ provinceAutoCorrectMinConfidence: x })} />
      <Check label="ต้องอ่านจังหวัดได้ มิฉะนั้นส่งเจ้าหน้าที่" checked={v.requireProvince} onChange={(c) => p({ requireProvince: c })} />
      <Field label="เมื่อพบทะเบียนหลายรายการไม่ตรงกัน (ป้ายจริง vs ป้ายกระดาษ)">
        <Select value={v.conflictPolicy} onChange={(e) => p({ conflictPolicy: e.target.value })} options={[{ value: 'PRIORITY', label: 'เลือกตาม Priority และแจ้งให้ตรวจ' }, { value: 'REVIEW', label: 'ส่งเจ้าหน้าที่ตรวจสอบทุกครั้ง' }]} />
      </Field>
    </div>
  );
}

function Payment({ v, p }: { v: Any; p: (x: Any) => void }) {
  const m = v.methods ?? {};
  return (
    <div className="grid grid-2">
      <Field label="ช่องทางชำระเงิน">
        <div className="col">
          <Check label="Thai QR / PromptPay" checked={!!m.promptpay} onChange={(c) => p({ methods: { ...m, promptpay: c } })} />
          <Check label="บัตรเครดิต / เดบิต" checked={!!m.card} onChange={(c) => p({ methods: { ...m, card: c } })} />
          <Check label="เงินสด" checked={!!m.cash} onChange={(c) => p({ methods: { ...m, cash: c } })} />
          <Check label="E-Wallet" checked={!!m.ewallet} onChange={(c) => p({ methods: { ...m, ewallet: c } })} />
        </div>
      </Field>
      <N label="เวลาให้นำรถออกหลังชำระ (นาที)" v={v.graceMinutes} on={(x) => p({ graceMinutes: x })} hint="อัตราค่าจอดแต่ละแบบกำหนดทับได้" />
      <N label="VAT ค่าจอด (%) — รวมในราคา" v={v.vatRate} on={(x) => p({ vatRate: x })} />
      <Check label="ออกใบกำกับภาษีได้" checked={v.issueTaxInvoice} onChange={(c) => p({ issueTaxInvoice: c })} />
    </div>
  );
}

function Pdpa({ v, p }: { v: Any; p: (x: Any) => void }) {
  return (
    <div className="grid grid-2">
      <N label="เก็บภาพรถ / ป้ายทะเบียน (วัน)" v={v.imageRetentionDays} on={(x) => p({ imageRetentionDays: x })} />
      <N label="ปกปิดทะเบียนรายการที่ปิดแล้วหลัง (วัน)" v={v.plateRetentionDays} on={(x) => p({ plateRetentionDays: x })} />
      <N label="เก็บ Audit Log (วัน)" v={v.auditRetentionDays} on={(x) => p({ auditRetentionDays: x })} />
      <Field label="ประกาศความเป็นส่วนตัว (แสดงต่อลูกค้า)">
        <TextArea value={v.privacyNotice ?? ''} onChange={(e) => p({ privacyNotice: e.target.value })} />
      </Field>
    </div>
  );
}

const FORMS: Record<TabId, (x: { v: Any; p: (x: Any) => void }) => ReactNode> = { branding: Branding, ticket: Ticket, receipt: Receipt, operation: Operation, lpr: Lpr, payment: Payment, pdpa: Pdpa };

function ModuleTab({ tab }: { tab: TabId }) {
  const m = useSettingsModule<Any>(tab);
  const targets = useTargets(tab);
  const perms = useApplyPermissions();
  if (m.error) return <Card>{m.error}</Card>;
  if (!m.value) return <Card>กำลังโหลด…</Card>;
  const Form = FORMS[tab];
  return (
    <>
      <Card>
        <Form v={m.value} p={m.patch} />
      </Card>
      <VersionHistory module={tab} version={m.version} targets={targets} onRolledBack={m.reload} />
      <SettingsFooter
        dirty={m.dirty}
        onCancel={m.reset}
        onSave={async () => void (await m.save())}
        onApply={async (sel, all) => void (await m.save(all ? 'ALL' : sel))}
        targets={targets}
        canApply={perms.canApply}
        canApplyAll={perms.canApplyAll}
      />
    </>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<TabId>('branding');
  return (
    <>
      <div className="page-header">
        <h1 data-el="admin/layout/header/title">ตั้งค่าระบบ</h1>
      </div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <ModuleTab key={tab} tab={tab} />
    </>
  );
}
