/**
 * Print Fonts: typography of receipts, parking tickets and print templates
 * with a side-by-side thermal bitmap preview (58 mm / 80 mm).
 */
import { useEffect, useMemo, useState } from 'react';
import { elementsFor, type DesignConfig, type ElementDef, type SystemId } from '@pp/shared/design/index';
import { Card, Field, Select } from '../../../components/ui';
import { TypographyPanel, type ScopeLevel } from '../../../components/appearance/TypographyPanel';
import { ApplyFooter } from '../../../components/appearance/ApplyFooter';
import { previewDoc, type PrintBlock, type PrintDoc } from '../../../print/print';
import { parkingReceiptDoc, ticketDoc } from '../../../print/templates';
import { durationText, money } from '../../../lib/format';
import { copySystemTypography } from './VisualEditor';
import { isEqual, systemName, useAppearance, type DesignResponse } from './context';

const PRINT_SYSTEMS: SystemId[] = ['receipt', 'parking-ticket', 'print-templates'];
type DocKind = 'pos' | 'parking' | 'ticket' | 'templates';
const DOCS: Array<{ id: DocKind; label: string; prefix: string }> = [
  { id: 'pos', label: 'ใบเสร็จร้านค้า (POS Receipt)', prefix: 'receipt/pos/' },
  { id: 'parking', label: 'ใบเสร็จค่าจอดรถ (Parking Receipt)', prefix: 'receipt/parking/' },
  { id: 'ticket', label: 'บัตรจอดรถ (Parking Ticket)', prefix: 'parking-ticket/' },
  { id: 'templates', label: 'Print Templates (Validation / Shift / Tax)', prefix: 'print-templates/' },
];

const def = (path: string) => elementsFor(path.split('/')[0]).find((e) => e.path === path);
const sample = (path: string) => def(path)?.sample ?? '';
const label = (path: string) => def(path)?.label ?? '';

/** POS receipt laid out with the registered receipt/pos/* elements. */
function posReceiptDoc(paperWidth: '58' | '80', r: DesignResponse['print']['receipt']): PrintDoc {
  const b: PrintBlock[] = [
    { type: 'text', text: sample('receipt/pos/header/store'), el: 'receipt/pos/header/store' },
    { type: 'text', text: sample('receipt/pos/header/receiptNo'), el: 'receipt/pos/header/receiptNo' },
    { type: 'text', text: sample('receipt/pos/header/date'), el: 'receipt/pos/header/date' },
    { type: 'line' },
    { type: 'row', left: sample('receipt/pos/items/name'), right: sample('receipt/pos/items/price'), el: 'receipt/pos/items/name' },
    { type: 'row', left: label('receipt/pos/items/price'), right: sample('receipt/pos/items/price'), el: 'receipt/pos/items/price' },
    { type: 'line', dashed: true },
    { type: 'row', left: 'Total', right: sample('receipt/pos/totals/total'), el: 'receipt/pos/totals/total' },
    { type: 'space', height: 8 },
    { type: 'barcode', data: 'M000124B01000158' },
    { type: 'text', text: sample('receipt/pos/barcode/caption'), el: 'receipt/pos/barcode/caption' },
    { type: 'text', text: r.promoText || sample('receipt/pos/promo/text'), el: 'receipt/pos/promo/text' },
    { type: 'line' },
    { type: 'text', text: r.footer || sample('receipt/pos/footer/text'), el: 'receipt/pos/footer/text' },
  ];
  return { paperWidth, blocks: b, cut: true };
}

function templatesDoc(paperWidth: '58' | '80'): PrintDoc {
  const b: PrintBlock[] = [];
  for (const e of elementsFor('print-templates')) {
    b.push({ type: 'text', text: e.sample ?? e.label, el: e.path }, { type: 'row', left: e.label, right: '1,250.00', size: 15 }, { type: 'line', dashed: true });
  }
  return { paperWidth, blocks: b, cut: true };
}

function buildDoc(kind: DocKind, paperWidth: '58' | '80', data: DesignResponse): PrintDoc {
  const now = new Date();
  const entry = new Date(now.getTime() - (3 * 3600 + 25 * 60) * 1000).toISOString();
  const plate = sample('parking-ticket/ticket/vehicle/plate');
  const province = sample('parking-ticket/ticket/vehicle/province');
  if (kind === 'pos') return posReceiptDoc(paperWidth, data.print.receipt);
  if (kind === 'templates') return templatesDoc(paperWidth);
  if (kind === 'parking') {
    const r = data.print.receipt;
    return parkingReceiptDoc({
      paperWidth,
      companyName: r.companyName,
      companyTaxId: r.companyTaxId,
      companyAddress: r.companyAddress,
      header: r.header,
      footer: r.footer,
      docNo: 'RC-000158',
      parkingNo: 'P20261012-0042',
      plate,
      province,
      entryAt: entry,
      paidAt: now.toISOString(),
      durationText: durationText(3 * 3600 + 25 * 60),
      gross: 120,
      discount: 100,
      amount: 20,
      method: 'PromptPay',
      vatRate: r.vatRate,
      showVat: r.showVat,
      exitBefore: new Date(now.getTime() + 15 * 60_000).toISOString(),
    });
  }
  const t = data.print.ticket;
  return ticketDoc({
    paperWidth,
    title: t.title || data.branding.siteName,
    subtitle: t.subtitle,
    logoUrl: t.logoUrl || undefined,
    plate,
    province: t.showProvince ? province : null,
    parkingNo: 'P20261012-0042',
    entryAt: entry,
    freeTime: t.showFreeTime ? '15 นาที' : null,
    rateText: t.showRate ? `${money(20)}/ชม.` : null,
    qrUrl: `${location.origin}/p/preview`,
    qrCount: t.qrCount,
    qrSize: t.qrSize,
    footerText: t.footerText,
    extraLines: t.extraLines,
    fontScale: t.fontScale ? t.fontScale * 1.5 : 1.5,
  });
}

function useDocPreview(kind: DocKind, cfg: DesignConfig, data: DesignResponse) {
  const [imgs, setImgs] = useState<{ '58'?: string; '80'?: string; error?: string }>({});
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const [a, b] = await Promise.all([previewDoc(buildDoc(kind, '58', data), cfg), previewDoc(buildDoc(kind, '80', data), cfg)]);
        if (alive) setImgs({ '58': a, '80': b });
      } catch (e) {
        if (alive) setImgs({ error: (e as Error).message });
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [kind, cfg, data]);
  return imgs;
}

export function PrintFonts() {
  const { data, publish, perms } = useAppearance();
  const [draft, setDraft] = useState<DesignConfig>(data.config);
  const [kind, setKind] = useState<DocKind>('pos');
  const [sel, setSel] = useState<ElementDef | null>(null);
  const [scope, setScope] = useState<ScopeLevel>('element');
  useEffect(() => setDraft(data.config), [data.config]);
  const doc = DOCS.find((d) => d.id === kind)!;
  const els = useMemo(() => PRINT_SYSTEMS.flatMap((s) => elementsFor(s)).filter((e) => e.path.startsWith(doc.prefix)), [doc.prefix]);
  useEffect(() => setSel(els[0] ?? null), [els]);
  const imgs = useDocPreview(kind, draft, data);
  const dirty = !isEqual(draft, data.config);
  const touchesGlobal = !isEqual(draft.global, data.config.global);
  const targetSys = (sel?.path.split('/')[0] as SystemId) ?? 'receipt';

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card>
        <div className="filters">
          <Field label="เอกสาร">
            <Select value={kind} onChange={(e) => setKind(e.target.value as DocKind)} options={DOCS.map((d) => ({ value: d.id, label: d.label }))} />
          </Field>
          <span className="spacer" />
          <div className="small muted" style={{ maxWidth: 560 }}>
            เครื่องพิมพ์ ESC/POS จะได้รับ <b>ภาพ Bitmap</b> ที่เรนเดอร์จากฟอนต์ที่ตั้งค่าไว้ — ฟอนต์ภาษาไทย / Google / ฟอนต์ที่อัปโหลดจึงพิมพ์ออกมาเหมือนตัวอย่างทุกประการ แม้เครื่องพิมพ์ไม่มี Code Page ภาษาไทย ส่วน QR Code และ Barcode
            ถูกวาดแบบ pixel-exact (ขนาด module เป็นจำนวนเต็มจุด) จึงสแกนได้เสมอ
          </div>
        </div>
      </Card>
      <div className="ap-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr) 400px' }}>
        <Card title="Thermal Preview (203 dpi)">
          {imgs.error && <div className="error">{imgs.error}</div>}
          <div className="ap-print-previews">
            {(['58', '80'] as const).map((w) => (
              <div key={w} className="ap-print-col">
                <b>{w} mm</b>
                <span className="small muted">{w === '58' ? '384' : '576'} dots</span>
                {imgs[w] ? <img src={imgs[w]} alt={`${w}mm`} className="ap-print-img" style={{ width: w === '58' ? 232 : 348 }} /> : <div className="muted">กำลังเรนเดอร์…</div>}
              </div>
            ))}
          </div>
        </Card>
        <div className="col ap-sticky" style={{ gap: 12 }}>
          <Card title="Elements">
            <div className="ap-print-list">
              {els.map((e) => (
                <div key={e.path} className={`ap-print-item ${sel?.path === e.path ? 'active' : ''}`} onClick={() => setSel(e)}>
                  <span>{e.label}</span>
                  <span className="small muted mono">{e.path.split('/').slice(1).join('/')}</span>
                </div>
              ))}
            </div>
          </Card>
          {sel && (
            <Card>
              <TypographyPanel el={sel} config={draft} scope={scope} onScope={setScope} onChange={setDraft} disabled={!perms.edit} />
            </Card>
          )}
        </div>
      </div>
      <ApplyFooter
        dirty={dirty}
        onCancel={() => setDraft(data.config)}
        onSave={(note) => publish(draft, PRINT_SYSTEMS, note || 'Print Fonts')}
        saveLabel="Save (Print)"
        canSave={perms.edit && (touchesGlobal ? perms.applyAll : perms.apply)}
        onApply={(systems, _all, note) => publish(copySystemTypography(draft, targetSys, systems), [...new Set([...PRINT_SYSTEMS, ...systems])], note || `Copy print typography → ${systems.map(systemName).join(', ')}`)}
        canApply={perms.edit && perms.apply}
        canApplyAll={false}
        subject={`${systemName(targetSys)} typography`}
      />
    </div>
  );
}
