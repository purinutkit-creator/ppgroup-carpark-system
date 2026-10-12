/**
 * Merchant POS (touch-first): categories → products → cart → split payment →
 * receipt with PARKING VALIDATION QR. Prices are previews; the server re-prices
 * every sale and issues the immutable receipt number + verification token.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApprovalDialog, Badge, Button, Field, Input, Modal, errorText, useAsync, useToast } from '../../components/ui';
import { money, dateTime, time } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useDesign } from '../../design/DesignProvider';
import { posGet, posPost, linePreview, type Cart, type CartLine, type Category, type PosMe, type PrinterConfig, type Product, type ReceiptData, type Sale } from '../../components/pos/types';
import { SaleBody, SaleStatus, ValidationStatus } from '../../components/pos/common';
import { printPosReceipt } from '../../print/posReceipt';
import ItemModal, { type ItemChoice } from './ItemModal';
import PaymentModal, { type SaleResult } from './PaymentModal';
import { OpenShift, ShiftModal } from './ShiftPanel';
import '../../components/pos/pos.css';

const emptyCart = (): Cart => ({ lines: [], billDiscount: null, billDiscountPercent: null, memberPhone: '' });

function useWedgeScanner(onScan: (code: string) => void) {
  const buf = useRef('');
  const last = useRef(0);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const now = Date.now();
      if (now - last.current > 80) buf.current = '';
      last.current = now;
      if (e.key === 'Enter') {
        if (buf.current.length >= 4) onScan(buf.current);
        buf.current = '';
      } else if (e.key.length === 1) buf.current += e.key;
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onScan]);
}

export default function Pos() {
  const toast = useToast();
  const design = useDesign();
  const { user, logout } = useAuth();
  const me = useAsync(() => posGet<PosMe>('/api/pos/me'), []);
  const cats = useAsync(() => posGet<{ items: Category[] }>('/api/pos/categories'), []);
  const prods = useAsync(() => posGet<{ items: Product[] }>('/api/pos/products'), []);
  const [cat, setCat] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [picking, setPicking] = useState<Product | null>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<SaleResult | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [quote, setQuote] = useState<{ total: number; subtotal: number; discount: number; vat: number; serviceCharge: number; vatMode: string } | null>(null);

  const products = (prods.data?.items ?? []).filter((p) => p.active);
  const shown = products.filter((p) => (cat === 'all' || p.category_id === cat) && (!search || `${p.name} ${p.sku ?? ''} ${p.barcode ?? ''}`.toLowerCase().includes(search.toLowerCase())));

  const items = useMemo(
    () => cart.lines.map((l) => ({ productId: l.productId, variantName: l.variantName, modifiers: l.modifiers, qty: l.qty, discount: l.discount })),
    [cart.lines],
  );
  const billDiscount = cart.billDiscountPercent ? { percent: cart.billDiscountPercent } : cart.billDiscount;
  const payload = () => ({ items, billDiscount: billDiscount ?? undefined, memberPhone: cart.memberPhone || undefined });

  // Server-side price preview (VAT / service charge exactly as the receipt will show).
  useEffect(() => {
    if (!items.length) return setQuote(null);
    const t = setTimeout(() => {
      posPost('/api/pos/quote', { items, billDiscount })
        .then(setQuote)
        .catch(() => setQuote(null));
    }, 250);
    return () => clearTimeout(t);
  }, [items, billDiscount]);

  // Customer display mirror.
  useEffect(() => {
    const t = setTimeout(() => {
      posPost('/api/pos/display', { cart: { stage: 'CART', lines: cart.lines.map((l) => ({ name: l.name, qty: l.qty, price: l.unitPrice * l.qty, variant: l.variantName })), total: quote?.total ?? 0 } }).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [cart.lines, quote?.total]);

  const add = (p: Product, c: ItemChoice) => {
    const key = `${p.id}|${c.variantName}|${c.modifiers.map((m) => m.group + m.name).join(',')}`;
    setCart((cur) => {
      const ex = cur.lines.find((l) => l.key === key);
      const lines: CartLine[] = ex
        ? cur.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + c.qty } : l))
        : [...cur.lines, { key, productId: p.id, name: p.name, imageUrl: p.image_url, variantName: c.variantName, modifiers: c.modifiers, unitPrice: linePreview(p, c.variantName, c.modifiers), qty: c.qty, discount: null }];
      return { ...cur, lines };
    });
  };
  const tap = (p: Product) => (p.variants.length > 1 || p.modifiers.length ? setPicking(p) : add(p, { variantName: p.variants[0]?.name ?? null, modifiers: [], qty: 1 }));
  const qty = (key: string, d: number) => setCart((c) => ({ ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter((l) => l.qty > 0) }));

  useWedgeScanner(
    useCallback(
      (code: string) => {
        const p = products.find((x) => x.barcode === code || x.sku === code);
        if (p) tap(p);
        else toast(`ไม่พบสินค้า ${code}`, 'error');
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [products],
    ),
  );

  const hold = async () => {
    if (!cart.lines.length) return;
    try {
      await posPost('/api/pos/held', { cart, name: cart.memberPhone || undefined });
      setCart(emptyCart());
      me.reload();
      toast('พักบิลแล้ว', 'success');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const onSold = async (r: SaleResult) => {
    setPaying(false);
    setDone(r);
    setCart(emptyCart());
    posPost('/api/pos/display', { cart: { stage: 'DONE', total: r.sale.total, change: r.change, receiptNo: r.sale.receipt_no } }).catch(() => undefined);
    try {
      const hasCash = r.receipt.payments.some((p) => p.method === 'CASH');
      await printPosReceipt(r.receipt, design?.config ?? null, me.data?.device?.printer, { openDrawer: hasCash && !!me.data?.device?.cashDrawer });
    } catch (e) {
      toast(`พิมพ์ใบเสร็จไม่สำเร็จ: ${errorText(e)}`, 'error');
    }
  };

  if (me.error) return <div className="page-forbidden">{me.error}</div>;
  if (!me.data) return <div className="page-loading">กำลังโหลด POS…</div>;
  const m = me.data;
  if (!m.shift) {
    return (
      <div className="pos-shell" style={{ placeItems: 'center', display: 'grid' }}>
        <OpenShift name={user?.displayName ?? ''} onOpened={() => me.reload()} />
      </div>
    );
  }

  return (
    <div className="pos-shell">
      <div className="pos-top">
        <div className="store">
          {m.merchant.logo_url && <img src={m.merchant.logo_url} alt="" />}
          <b>{m.merchant.name}</b>
          <span className="chip">{m.merchant.code} · {m.branch.code}</span>
        </div>
        <span className="chip ok">กะเปิด {time(m.shift.opened_at)}</span>
        <span className="chip">{user?.displayName}</span>
        <span className="spacer" />
        <Button size="sm" onClick={() => setHeldOpen(true)}>บิลที่พักไว้ ({m.heldCount})</Button>
        <Button size="sm" onClick={() => setHistoryOpen(true)}>ใบเสร็จวันนี้</Button>
        <Button size="sm" onClick={() => setShiftOpen(true)}>กะ / เงินสด</Button>
        <Link className="btn btn-sm" to="/printer">🖨️ เครื่องพิมพ์</Link>
        {user?.permissions.includes('merchant.portal') && <Link className="btn btn-sm" to="/merchant">Portal</Link>}
        <Button size="sm" variant="ghost" onClick={logout}>ออก</Button>
      </div>
      <div className="pos-body">
        <div className="pos-left">
          <div className="pos-search">
            <Input placeholder="ค้นหา / สแกนบาร์โค้ด / SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="pos-cats">
            <button className={cat === 'all' ? 'active' : ''} onClick={() => setCat('all')}>ทั้งหมด</button>
            {(cats.data?.items ?? []).filter((c) => c.active).map((c) => (
              <button key={c.id} className={cat === c.id ? 'active' : ''} onClick={() => setCat(c.id)} data-el="merchant-pos/sell/categories/name">{c.name}</button>
            ))}
          </div>
          <div className="pos-grid">
            {shown.map((p) => (
              <button key={p.id} className="pos-tile" onClick={() => tap(p)}>
                <div className="img" style={p.image_url ? { backgroundImage: `url(${p.image_url})` } : undefined}>{p.image_url ? '' : '🛍️'}</div>
                <div className="meta">
                  <span data-el="merchant-pos/sell/products/name">{p.name}</span>
                  <span data-el="merchant-pos/sell/products/price">{money(p.price)}</span>
                  {(p.variants.length > 1 || p.modifiers.length > 0) && <span className="opts">มีตัวเลือก</span>}
                </div>
              </button>
            ))}
            {!shown.length && <div className="pos-empty">ไม่มีสินค้า — เพิ่มได้ที่ Merchant Portal → สินค้า</div>}
          </div>
        </div>
        <div className="pos-right">
          <div className="pos-cart">
            {!cart.lines.length && <div className="pos-empty">ยังไม่มีสินค้าในตะกร้า</div>}
            {cart.lines.map((l) => (
              <div key={l.key} className="pos-line">
                <div>
                  <div data-el="merchant-pos/sell/cart/item">{l.name}</div>
                  <div className="small muted">{[l.variantName, ...l.modifiers.map((x) => x.name)].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="right num">{money(l.unitPrice * l.qty)}</div>
                <div className="qty">
                  <button onClick={() => qty(l.key, -1)}>−</button>
                  <span>{l.qty}</span>
                  <button onClick={() => qty(l.key, 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
          <div className="pos-sum">
            <div className="row">
              <Input placeholder="เบอร์สมาชิก" value={cart.memberPhone} onChange={(e) => setCart({ ...cart, memberPhone: e.target.value })} style={{ flex: 1 }} />
              <Input type="number" placeholder="ส่วนลดบิล ฿" value={cart.billDiscount ?? ''} onChange={(e) => setCart({ ...cart, billDiscount: e.target.value ? Number(e.target.value) : null, billDiscountPercent: null })} style={{ width: 110 }} />
              <Input type="number" placeholder="%" value={cart.billDiscountPercent ?? ''} onChange={(e) => setCart({ ...cart, billDiscountPercent: e.target.value ? Number(e.target.value) : null, billDiscount: null })} style={{ width: 70 }} />
            </div>
            {quote && (
              <>
                <div className="r small"><span>รวม</span><span>{money(quote.subtotal)}</span></div>
                {quote.discount > 0 && <div className="r small"><span>ส่วนลด</span><span>−{money(quote.discount)}</span></div>}
                {quote.serviceCharge > 0 && <div className="r small"><span>Service charge</span><span>{money(quote.serviceCharge)}</span></div>}
                {quote.vat > 0 && <div className="r small muted"><span>VAT {quote.vatMode === 'INCLUDED' ? '(รวมในราคา)' : ''}</span><span>{money(quote.vat)}</span></div>}
              </>
            )}
            <div className="r"><b>ยอดชำระ</b><b data-el="merchant-pos/sell/cart/total">{money(quote?.total ?? 0)}</b></div>
          </div>
          <div className="pos-actions">
            <Button onClick={hold} disabled={!cart.lines.length}>พักบิล</Button>
            <Button onClick={() => setCart(emptyCart())} disabled={!cart.lines.length}>ล้าง</Button>
            <Button onClick={() => posPost('/api/pos/drawer', {}).then(() => toast('เปิดลิ้นชักแล้ว')).catch((e) => toast(errorText(e), 'error'))}>ลิ้นชัก</Button>
            <Button onClick={() => setHistoryOpen(true)}>Void/คืน</Button>
          </div>
          <div className="pos-pay">
            <Button variant="primary" disabled={!quote || !cart.lines.length} onClick={() => setPaying(true)} data-el="merchant-pos/sell/actions/button">
              ชำระเงิน {quote ? money(quote.total) : ''}
            </Button>
          </div>
        </div>
      </div>

      <ItemModal product={picking} onClose={() => setPicking(null)} onAdd={(p, c) => { add(p, c); setPicking(null); }} />
      <PaymentModal open={paying} due={quote?.total ?? 0} payload={payload} onClose={() => setPaying(false)} onDone={onSold} onDisplay={(s) => posPost('/api/pos/display', { cart: s }).catch(() => undefined)} />
      <ShiftModal open={shiftOpen} onClose={() => setShiftOpen(false)} onClosed={() => { setShiftOpen(false); me.reload(); }} />
      {heldOpen && <HeldBills onClose={() => setHeldOpen(false)} onResume={(c) => { setCart(c); setHeldOpen(false); me.reload(); }} />}
      {historyOpen && <TodaySales onClose={() => setHistoryOpen(false)} printer={m.device?.printer} />}

      <Modal open={!!done} title="ชำระเงินสำเร็จ" onClose={() => setDone(null)} footer={<Button variant="primary" onClick={() => setDone(null)}>บิลใหม่</Button>}>
        {done && (
          <div className="col center">
            <div className="muted">ใบเสร็จ</div>
            <div className="mono">{done.sale.receipt_no}</div>
            <div style={{ fontSize: 34, fontWeight: 700 }}>{money(done.sale.total)}</div>
            {done.change > 0 && <div style={{ fontSize: 22 }}>เงินทอน <b>{money(done.change)}</b></div>}
            {done.receipt.parking && <Badge tone="info">ใบเสร็จนี้ใช้รับสิทธิ์ส่วนลดค่าจอดรถได้</Badge>}
            <Button onClick={() => printPosReceipt(done.receipt, design?.config ?? null, m.device?.printer, { reprint: true })}>พิมพ์อีกครั้ง</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function HeldBills({ onClose, onResume }: { onClose: () => void; onResume: (c: Cart) => void }) {
  const toast = useToast();
  const list = useAsync(() => posGet<{ items: Array<{ id: number; name: string; created_at: string }> }>('/api/pos/held'), []);
  return (
    <Modal open title="บิลที่พักไว้" onClose={onClose}>
      {!list.data?.items.length && <div className="empty">ไม่มีบิลที่พักไว้</div>}
      {list.data?.items.map((h) => (
        <div key={h.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
          <b>{h.name}</b>
          <span className="small muted">{dateTime(h.created_at)}</span>
          <span className="spacer" />
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              try {
                const r = await posGet<{ cart: Cart }>(`/api/pos/held/${h.id}`);
                await posApiDelete(`/api/pos/held/${h.id}`);
                onResume({ ...emptyCart(), ...r.cart });
              } catch (e) {
                toast(errorText(e), 'error');
              }
            }}
          >
            เรียกคืน
          </Button>
          <Button size="sm" variant="ghost" onClick={() => posApiDelete(`/api/pos/held/${h.id}`).then(list.reload)}>ลบ</Button>
        </div>
      ))}
    </Modal>
  );
}

async function posApiDelete(path: string) {
  const { posApi } = await import('../../components/pos/types');
  return posApi(path, { method: 'DELETE' });
}

function TodaySales({ onClose, printer }: { onClose: () => void; printer: PrinterConfig | null | undefined }) {
  const toast = useToast();
  const design = useDesign();
  const list = useAsync(() => posGet<{ items: Sale[] }>('/api/pos/sales'), []);
  const [sel, setSel] = useState<{ sale: Sale; receipt: ReceiptData; refunds: any[]; parkingUsage: any } | null>(null);
  const [action, setAction] = useState<null | 'void' | 'refund'>(null);
  const [amount, setAmount] = useState('');
  const open = async (s: Sale) => setSel(await posGet(`/api/pos/sales/${s.id}`));
  return (
    <Modal open size="lg" title="ใบเสร็จวันนี้" onClose={onClose}>
      {!sel ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>เวลา</th><th>ใบเสร็จ</th><th className="right">ยอด</th><th>สถานะ</th><th>สิทธิ์จอดรถ</th></tr></thead>
            <tbody>
              {(list.data?.items ?? []).map((s) => (
                <tr key={s.id} className="clickable" onClick={() => open(s)}>
                  <td>{time(s.issued_at)}</td>
                  <td className="mono small">{s.receipt_no}</td>
                  <td className="right">{money(s.total)}</td>
                  <td><SaleStatus s={s} /></td>
                  <td><ValidationStatus s={s} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="col">
          <Button size="sm" onClick={() => setSel(null)}>← กลับ</Button>
          <SaleBody sale={sel.sale} refunds={sel.refunds} usage={sel.parkingUsage} />
          <div className="row">
            <Button onClick={async () => {
              try {
                const r = await posPost<{ receipt: ReceiptData }>(`/api/pos/sales/${sel.sale.id}/reprint`, {});
                await printPosReceipt(r.receipt, design?.config ?? null, printer, { reprint: true });
              } catch (e) {
                toast(errorText(e), 'error');
              }
            }}>พิมพ์ซ้ำ</Button>
            {sel.sale.status === 'PAID' && <Button variant="danger" onClick={() => setAction('void')}>Void</Button>}
            {['PAID', 'PARTIALLY_REFUNDED'].includes(sel.sale.status) && <Button onClick={() => setAction('refund')}>คืนเงิน</Button>}
          </div>
        </div>
      )}
      <ApprovalDialog
        open={!!action}
        title={action === 'void' ? 'Void ใบเสร็จ' : 'คืนเงิน'}
        description={sel?.sale.parking_validation_status === 'USED' ? 'ใบเสร็จนี้ถูกใช้ลดค่าจอดแล้ว — ระบบจะแจ้งลานจอดตามนโยบาย' : undefined}
        requireApprover={false}
        onClose={() => setAction(null)}
        onSubmit={async ({ reason, approval }) => {
          const url = `/api/pos/sales/${sel!.sale.id}/${action}`;
          await posPost(url, { reason, approval, amount: action === 'refund' && amount ? Number(amount) : undefined });
          toast('บันทึกแล้ว', 'success');
          await open(sel!.sale);
          list.reload();
        }}
      >
        {action === 'refund' && (
          <Field label={`จำนวนเงินที่คืน (เว้นว่าง = คืนทั้งหมด ${money((sel?.sale.total ?? 0) - (sel?.sale.refunded_amount ?? 0))})`}>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        )}
      </ApprovalDialog>
    </Modal>
  );
}
