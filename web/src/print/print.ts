/**
 * Thermal print pipeline (tickets, receipts, reports):
 *   PrintDoc (blocks) → <canvas> rendered with the configured web fonts
 *   → monochrome ESC/POS raster (GS v 0) → printer.
 * Rendering to a bitmap keeps Thai / Google / uploaded fonts identical to the
 * on-screen preview even on printers without Thai code pages. QR codes and
 * barcodes are drawn pixel-aligned (integer module size) so they stay scannable.
 */
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { EscPos, PAPER_DOTS, toBase64 } from '@pp/shared/escpos';
import { ELEMENTS, fontStack, resolveTypography, type DesignConfig } from '@pp/shared/design/index';
import { api } from '../lib/api';
import { getLocalPrinter, writeLocal } from './localPrinter';

export type Align = 'left' | 'center' | 'right';

export type PrintBlock =
  | { type: 'text'; text: string; el?: string; size?: number; weight?: number; align?: Align; family?: string; italic?: boolean; invert?: boolean }
  | { type: 'row'; left: string; right: string; el?: string; size?: number; weight?: number }
  | { type: 'qr'; data: string; size?: number; caption?: string }
  | { type: 'barcode'; data: string; height?: number; format?: string; caption?: boolean }
  | { type: 'image'; url: string; width?: number }
  | { type: 'line'; dashed?: boolean }
  | { type: 'space'; height?: number };

export interface PrintDoc {
  paperWidth: '58' | '80';
  blocks: PrintBlock[];
  /** multiplier from CSS px (design config) to printer dots */
  fontScale?: number;
  cut?: boolean;
  openDrawer?: boolean;
}

const MARGIN = 8;

interface TextStyle {
  family: string;
  size: number;
  weight: number;
  italic: boolean;
  align: Align;
  letterSpacing: number;
}

function styleFor(b: { el?: string; size?: number; weight?: number; align?: Align; family?: string; italic?: boolean }, design: DesignConfig | null, scale: number): TextStyle {
  let family = 'Sarabun, sans-serif';
  let size = 16;
  let weight = 400;
  let italic = false;
  let align: Align = 'left';
  let letterSpacing = 0;
  if (design) {
    const def = b.el ? ELEMENTS.find((e) => e.path === b.el) : undefined;
    const st = resolveTypography(design, def ?? { path: b.el ?? 'receipt/x/x/x', label: '', role: 'receipt' }).style;
    family = fontStack(design, st.fontFamily);
    size = st.fontSize;
    weight = st.fontWeight;
    italic = st.fontStyle === 'italic';
    letterSpacing = st.letterSpacing;
    if (st.textAlign === 'center' || st.textAlign === 'right' || st.textAlign === 'left') align = st.textAlign;
  }
  return {
    family: b.family ?? family,
    size: (b.size ?? size) * scale,
    weight: b.weight ?? weight,
    italic: b.italic ?? italic,
    align: b.align ?? align,
    letterSpacing: letterSpacing * scale,
  };
}

function fontString(s: TextStyle) {
  return `${s.italic ? 'italic ' : ''}${s.weight} ${Math.round(s.size)}px ${s.family}`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    // Thai has no spaces between words: break on spaces when possible, else per grapheme.
    const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new (Intl as any).Segmenter('th', { granularity: 'word' }) : null;
    const words: string[] = seg ? Array.from(seg.segment(para), (x: any) => x.segment) : para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function ensureFonts(doc: PrintDoc, design: DesignConfig | null, scale: number) {
  if (!('fonts' in document)) return;
  const fonts = new Set<string>();
  for (const b of doc.blocks) if (b.type === 'text' || b.type === 'row') fonts.add(fontString(styleFor(b, design, scale)));
  await Promise.all([...fonts].map((f) => document.fonts.load(f, 'กขABC123').catch(() => undefined)));
}

/** Render to a canvas exactly as it will print. */
export async function renderDoc(doc: PrintDoc, design: DesignConfig | null): Promise<HTMLCanvasElement> {
  const width = PAPER_DOTS[doc.paperWidth];
  const scale = doc.fontScale ?? 1.5;
  await ensureFonts(doc, design, scale);
  const inner = width - MARGIN * 2;
  // First pass: measure; second pass: draw. Use a tall scratch canvas.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 6000;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  let y = MARGIN;

  for (const b of doc.blocks) {
    if (b.type === 'space') {
      y += b.height ?? 12;
    } else if (b.type === 'line') {
      ctx.save();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      if (b.dashed) ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(MARGIN, y + 6);
      ctx.lineTo(width - MARGIN, y + 6);
      ctx.stroke();
      ctx.restore();
      y += 14;
    } else if (b.type === 'text') {
      const s = styleFor(b, design, scale);
      ctx.font = fontString(s);
      (ctx as any).letterSpacing = `${s.letterSpacing}px`;
      const lh = Math.round(s.size * 1.3);
      for (const line of wrap(ctx, b.text, inner)) {
        const w = ctx.measureText(line).width;
        const x = s.align === 'center' ? (width - w) / 2 : s.align === 'right' ? width - MARGIN - w : MARGIN;
        if (b.invert) {
          ctx.fillRect(MARGIN, y - 2, inner, lh + 2);
          ctx.fillStyle = '#fff';
          ctx.fillText(line, x, y);
          ctx.fillStyle = '#000';
        } else ctx.fillText(line, x, y);
        y += lh;
      }
      (ctx as any).letterSpacing = '0px';
    } else if (b.type === 'row') {
      const s = styleFor({ ...b, align: 'left' }, design, scale);
      ctx.font = fontString(s);
      const lh = Math.round(s.size * 1.3);
      const rw = ctx.measureText(b.right).width;
      const leftLines = wrap(ctx, b.left, inner - rw - 12);
      leftLines.forEach((l, i) => {
        ctx.fillText(l, MARGIN, y);
        if (i === 0) ctx.fillText(b.right, width - MARGIN - rw, y);
        y += lh;
      });
    } else if (b.type === 'qr') {
      const target = Math.min(b.size ?? 240, inner);
      const qr = QRCode.create(b.data, { errorCorrectionLevel: 'M' });
      const n = qr.modules.size;
      const mod = Math.max(2, Math.floor(target / (n + 2))); // integer dots per module
      const size = mod * n;
      const x0 = Math.round((width - size) / 2);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) ctx.fillRect(x0 + c * mod, y + mod + r * mod, mod, mod);
      y += size + mod * 2;
      if (b.caption) {
        const s = styleFor({ el: 'parking-ticket/ticket/footer/text', align: 'center' }, design, scale);
        ctx.font = fontString(s);
        for (const line of wrap(ctx, b.caption, inner)) {
          const w = ctx.measureText(line).width;
          ctx.fillText(line, (width - w) / 2, y);
          y += Math.round(s.size * 1.3);
        }
      }
    } else if (b.type === 'barcode') {
      const bc = document.createElement('canvas');
      JsBarcode(bc, b.data, { format: b.format ?? 'CODE128', width: 2, height: b.height ?? 80, displayValue: b.caption ?? false, margin: 0, fontSize: 20 });
      let w = bc.width;
      let h = bc.height;
      if (w > inner) {
        // keep integer bar widths: fall back to width 1 if it does not fit
        JsBarcode(bc, b.data, { format: b.format ?? 'CODE128', width: 1, height: b.height ?? 80, displayValue: b.caption ?? false, margin: 0, fontSize: 18 });
        w = bc.width;
        h = bc.height;
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bc, Math.round((width - w) / 2), y);
      y += h + 8;
    } else if (b.type === 'image') {
      try {
        const img = await loadImage(b.url);
        const w = Math.min(b.width ?? 200, inner);
        const h = Math.round((img.height / img.width) * w);
        ctx.drawImage(img, Math.round((width - w) / 2), y, w, h);
        y += h + 6;
      } catch {
        /* missing logo should not block printing */
      }
    }
  }
  y += MARGIN * 2;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = Math.ceil(y);
  out.getContext('2d')!.drawImage(canvas, 0, 0);
  return out;
}

export function canvasToEscPos(canvas: HTMLCanvasElement, opts: { cut?: boolean; openDrawer?: boolean } = {}): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const p = new EscPos().init().align('left').raster(img.data, canvas.width, canvas.height, { threshold: 150 }).feed(3);
  if (opts.cut !== false) p.cut();
  if (opts.openDrawer) p.drawer();
  return p.bytes();
}

export interface PrinterTarget {
  id?: number;
  connection?: { mode?: 'lan' | 'edge' | 'bridge'; bridgeUrl?: string; paperWidth?: '58' | '80' };
}

/**
 * Send to a printer:
 *  - bridge: POST to the local Printer Bridge (edge agent on the kiosk PC)
 *  - lan/edge: POST to the server, which forwards to the printer / site edge
 *  - none: open the browser print dialog with the rendered image
 */
export async function printDoc(doc: PrintDoc, design: DesignConfig | null, printer?: PrinterTarget | null, opts: { device?: boolean; job?: string; ref?: string } = {}) {
  // A printer chosen on this computer (USB / serial / OS dialog) always wins.
  const local = getLocalPrinter();
  if (local) {
    const canvas = await renderDoc({ ...doc, paperWidth: local.paperWidth }, design);
    if (local.kind === 'browser') return browserPrint(canvas);
    await writeLocal(local, canvasToEscPos(canvas, { cut: doc.cut, openDrawer: doc.openDrawer }));
    return { ok: true, via: local.kind };
  }
  const canvas = await renderDoc(doc, design);
  if (!printer?.id && !printer?.connection?.bridgeUrl) return browserPrint(canvas);
  const bytes = canvasToEscPos(canvas, { cut: doc.cut, openDrawer: doc.openDrawer });
  const data = toBase64(bytes);
  if (printer.connection?.mode === 'bridge' || (!printer.id && printer.connection?.bridgeUrl)) {
    const url = (printer.connection?.bridgeUrl ?? 'http://127.0.0.1:9110').replace(/\/$/, '');
    const r = await fetch(`${url}/print`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data, job: opts.job, ref: opts.ref }) });
    if (!r.ok) throw new Error(`Printer bridge error ${r.status}`);
    return { ok: true, via: 'bridge' };
  }
  await api(`/api/devices/${printer.id}/print`, { method: 'POST', body: { data, job: opts.job, ref: opts.ref }, device: opts.device });
  return { ok: true, via: 'server' };
}

export function browserPrint(canvas: HTMLCanvasElement) {
  const url = canvas.toDataURL('image/png');
  const w = window.open('', '_blank', 'width=420,height=700');
  if (!w) return { ok: false, via: 'browser' };
  w.document.write(
    `<html><head><title>Print</title><style>@page{margin:0}body{margin:0}img{width:${canvas.width === 384 ? 58 : 80}mm;image-rendering:pixelated}</style></head><body><img src="${url}" onload="setTimeout(()=>{window.print();window.close()},200)"></body></html>`,
  );
  w.document.close();
  return { ok: true, via: 'browser' };
}

/** Data URL preview of a doc (for admin template editors). */
export async function previewDoc(doc: PrintDoc, design: DesignConfig | null) {
  return (await renderDoc(doc, design)).toDataURL('image/png');
}
