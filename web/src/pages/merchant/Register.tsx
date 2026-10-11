import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button, Card, Check, Field, Input, Select, TextArea, errorText } from '../../components/ui';
import { CopyButton } from '../../components/pos/common';
import { MERCHANT_CATEGORIES } from '../../components/pos/types';
import '../../components/pos/pos.css';

interface Form {
  name: string;
  category: string;
  unitNo: string;
  zone: string;
  floor: string;
  address: string;
  taxId: string;
  ownerFirstName: string;
  ownerLastName: string;
  phone: string;
  email: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  contactLine: string;
  receiptHeader: string;
  receiptFooter: string;
  vatRegistered: boolean;
  receiptTaxId: string;
  branchName: string;
}

const EMPTY: Form = {
  name: '', category: 'CAFE', unitNo: '', zone: '', floor: '', address: '', taxId: '',
  ownerFirstName: '', ownerLastName: '', phone: '', email: '',
  contactName: '', contactPhone: '', contactEmail: '', contactLine: '',
  receiptHeader: '', receiptFooter: 'ขอบคุณที่ใช้บริการ', vatRegistered: false, receiptTaxId: '', branchName: '',
};

const MAX_IMAGE = 15 * 1024 * 1024;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <div className="card-title" data-el="merchant-portal/register/form/section">
        {title}
      </div>
      {children}
    </Card>
  );
}

function ImagePick({ label, hint, file, onFile, shape }: { label: string; hint: string; file: File | null; onFile: (f: File | null) => void; shape: 'logo' | 'store' }) {
  const [url, setUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<string | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      setDims(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    const img = new Image();
    img.onload = () => setDims(`${img.naturalWidth}×${img.naturalHeight}px`);
    img.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <Field label={label} hint={`Recommended Size: ${hint} · JPG / PNG / WebP ไม่เกิน 15MB`}>
      <div className="reg-preview">
        <div className={`ph ${shape}`} style={url ? { backgroundImage: `url(${url})`, border: 0 } : undefined}>
          {!url && hint}
        </div>
        <div className="col">
          <label className="btn btn-sm">
            {file ? 'เปลี่ยนรูป' : 'เลือกรูป'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > MAX_IMAGE) {
                  alert('ไฟล์ใหญ่เกิน 15MB');
                  return;
                }
                onFile(f);
                e.target.value = '';
              }}
            />
          </label>
          {file && (
            <>
              <span className="small muted">
                {file.name} {dims && `· ${dims}`}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onFile(null)}>
                ลบ
              </Button>
            </>
          )}
        </div>
      </div>
    </Field>
  );
}

export default function MerchantRegister() {
  const [f, setF] = useState<Form>(EMPTY);
  const [logo, setLogo] = useState<File | null>(null);
  const [storefront, setStorefront] = useState<File | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string } | null>(null);
  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const text = (k: keyof Form) => ({ value: f[k] as string, onChange: (e: { target: { value: string } }) => set(k)(e.target.value as never) });

  const submit = async () => {
    setErr(null);
    const missing = (['name', 'ownerFirstName', 'ownerLastName', 'phone', 'email'] as const).filter((k) => !f[k].trim());
    if (missing.length) return setErr('กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) return setErr('อีเมลไม่ถูกต้อง');
    if (f.taxId && f.taxId.replace(/\D/g, '').length !== 13) return setErr('เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก');
    if (!agree) return setErr('กรุณายอมรับเงื่อนไขและนโยบายความเป็นส่วนตัว');
    const fd = new FormData();
    for (const k of ['name', 'category', 'unitNo', 'zone', 'floor', 'address', 'taxId', 'ownerFirstName', 'ownerLastName', 'phone', 'email'] as const) if (f[k]) fd.append(k, f[k]);
    fd.append('contact', JSON.stringify({ name: f.contactName, phone: f.contactPhone, email: f.contactEmail, lineId: f.contactLine }));
    fd.append('receipt', JSON.stringify({ header: f.receiptHeader || f.name, footer: f.receiptFooter, vatRegistered: f.vatRegistered, taxId: f.receiptTaxId || f.taxId, branchName: f.branchName }));
    if (logo) fd.append('logo', logo);
    if (storefront) fd.append('storefront', storefront);
    setBusy(true);
    try {
      const r = await api<{ reference: string }>('/api/merchants/register', { method: 'POST', body: fd });
      setDone(r);
      window.scrollTo(0, 0);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="reg-page">
        <Card className="reg-success">
          <div style={{ fontSize: 56 }}>✅</div>
          <h1 data-el="merchant-portal/register/form/title">ส่งคำขอสมัครเรียบร้อย</h1>
          <div className="muted">หมายเลขอ้างอิงของคุณ</div>
          <div data-el="merchant-portal/register/success/reference" className="num">
            {done.reference}
          </div>
          <CopyButton text={done.reference} label="คัดลอกหมายเลขอ้างอิง" />
          <p className="muted" style={{ maxWidth: 520 }}>
            ฝ่ายบริหารศูนย์จะตรวจสอบข้อมูลและแจ้งผลการอนุมัติ พร้อม Merchant ID ชื่อผู้ใช้ และรหัสผ่านชั่วคราวทางโทรศัพท์ / อีเมลที่ลงทะเบียนไว้
          </p>
          <Link to="/login" className="btn">
            ไปหน้าเข้าสู่ระบบ
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="reg-page">
      <div>
        <h1 data-el="merchant-portal/register/form/title">สมัครร้านค้า (Merchant Registration)</h1>
        <div className="muted">ร้านค้าที่ได้รับอนุมัติจะได้ระบบ POS และใบเสร็จที่ลูกค้านำไปรับสิทธิ์ส่วนลดค่าจอดรถได้</div>
      </div>

      <Section title="ข้อมูลร้านค้า">
        <div className="grid grid-2">
          <Field label="ชื่อร้าน *">
            <Input {...text('name')} maxLength={120} />
          </Field>
          <Field label="ประเภทร้าน">
            <Select value={f.category} onChange={(e) => set('category')(e.target.value)} options={MERCHANT_CATEGORIES} />
          </Field>
          <Field label="เลขที่ห้อง / ยูนิต">
            <Input {...text('unitNo')} placeholder="เช่น G-12" maxLength={30} />
          </Field>
          <div className="grid grid-2">
            <Field label="โซน">
              <Input {...text('zone')} maxLength={30} />
            </Field>
            <Field label="ชั้น">
              <Input {...text('floor')} maxLength={30} />
            </Field>
          </div>
          <Field label="เลขประจำตัวผู้เสียภาษี (ถ้ามี)">
            <Input {...text('taxId')} inputMode="numeric" maxLength={13} />
          </Field>
          <Field label="ที่อยู่ (สำหรับออกใบกำกับภาษี)" className="">
            <TextArea {...text('address')} rows={2} maxLength={500} />
          </Field>
        </div>
      </Section>

      <Section title="เจ้าของร้าน">
        <div className="grid grid-2">
          <Field label="ชื่อ *">
            <Input {...text('ownerFirstName')} maxLength={80} />
          </Field>
          <Field label="นามสกุล *">
            <Input {...text('ownerLastName')} maxLength={80} />
          </Field>
          <Field label="เบอร์โทรศัพท์ *">
            <Input {...text('phone')} inputMode="tel" maxLength={20} />
          </Field>
          <Field label="อีเมล *" hint="ใช้เป็นชื่อผู้ใช้เริ่มต้นของเจ้าของร้าน">
            <Input {...text('email')} type="email" maxLength={120} />
          </Field>
        </div>
      </Section>

      <Section title="ผู้ติดต่อหลัก">
        <div className="grid grid-2">
          <Field label="ชื่อผู้ติดต่อ">
            <Input {...text('contactName')} maxLength={120} />
          </Field>
          <Field label="เบอร์โทรผู้ติดต่อ">
            <Input {...text('contactPhone')} inputMode="tel" maxLength={20} />
          </Field>
          <Field label="อีเมลผู้ติดต่อ">
            <Input {...text('contactEmail')} type="email" maxLength={120} />
          </Field>
          <Field label="LINE ID">
            <Input {...text('contactLine')} maxLength={60} />
          </Field>
        </div>
      </Section>

      <Section title="ข้อมูลใบเสร็จ">
        <div className="grid grid-2">
          <Field label="หัวใบเสร็จ" hint="ว่างไว้ = ใช้ชื่อร้าน">
            <Input {...text('receiptHeader')} maxLength={300} />
          </Field>
          <Field label="ท้ายใบเสร็จ">
            <Input {...text('receiptFooter')} maxLength={300} />
          </Field>
          <Field label="ชื่อสาขา (พิมพ์บนใบเสร็จ)">
            <Input {...text('branchName')} maxLength={120} />
          </Field>
          <div className="col">
            <Check label="จดทะเบียนภาษีมูลค่าเพิ่ม (VAT)" checked={f.vatRegistered} onChange={set('vatRegistered')} />
            {f.vatRegistered && (
              <Field label="เลขประจำตัวผู้เสียภาษีบนใบเสร็จ">
                <Input {...text('receiptTaxId')} inputMode="numeric" maxLength={13} placeholder={f.taxId} />
              </Field>
            )}
          </div>
        </div>
      </Section>

      <Section title="รูปภาพ">
        <div className="grid grid-2">
          <ImagePick label="โลโก้ร้าน" hint="1000×1000" file={logo} onFile={setLogo} shape="logo" />
          <ImagePick label="รูปหน้าร้าน" hint="1600×900" file={storefront} onFile={setStorefront} shape="store" />
        </div>
      </Section>

      <Card>
        <div className="col">
          <Check label="ข้าพเจ้ายืนยันว่าข้อมูลถูกต้อง และยินยอมให้ศูนย์ฯ เก็บและใช้ข้อมูลเพื่อพิจารณาและให้บริการ (PDPA)" checked={agree} onChange={setAgree} />
          {err && <div style={{ color: 'var(--color-danger)' }}>{err}</div>}
          <div className="row">
            <span className="spacer" />
            <Button variant="primary" size="lg" loading={busy} onClick={submit}>
              ส่งคำขอสมัคร
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
