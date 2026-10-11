/** Variant & modifier picker for a product (touch-first). */
import { useEffect, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { money } from '../../lib/format';
import { linePreview, type Product } from '../../components/pos/types';

export interface ItemChoice {
  variantName: string | null;
  modifiers: Array<{ group: string; name: string }>;
  qty: number;
}

export default function ItemModal({ product, onClose, onAdd }: { product: Product | null; onClose: () => void; onAdd: (p: Product, c: ItemChoice) => void }) {
  const [variant, setVariant] = useState<string | null>(null);
  const [mods, setMods] = useState<Array<{ group: string; name: string }>>([]);
  const [qty, setQty] = useState(1);
  useEffect(() => {
    if (!product) return;
    setVariant(product.variants[0]?.name ?? null);
    // Pre-select the first option of single-choice groups (e.g. sweetness).
    setMods(product.modifiers.filter((g) => !g.multi && g.options.length).map((g) => ({ group: g.group, name: g.options[0].name })));
    setQty(1);
  }, [product]);
  if (!product) return null;
  const toggle = (group: string, name: string, multi: boolean) =>
    setMods((m) => {
      const has = m.some((x) => x.group === group && x.name === name);
      if (multi) return has ? m.filter((x) => !(x.group === group && x.name === name)) : [...m, { group, name }];
      return [...m.filter((x) => x.group !== group), { group, name }];
    });
  const unit = linePreview(product, variant, mods);
  return (
    <Modal
      open
      size="lg"
      title={<span data-el="merchant-pos/sell/modal/title">{product.name}</span>}
      onClose={onClose}
      footer={
        <>
          <div className="row" style={{ marginRight: 'auto' }}>
            <div className="pos-line" style={{ border: 0, padding: 0 }}>
              <div className="qty">
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                  −
                </button>
                <span>{qty}</span>
                <button type="button" onClick={() => setQty((q) => q + 1)}>
                  +
                </button>
              </div>
            </div>
          </div>
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button variant="primary" size="lg" data-el="merchant-pos/sell/actions/button" onClick={() => onAdd(product, { variantName: variant, modifiers: mods, qty })}>
            เพิ่มลงตะกร้า · {money(unit * qty)}
          </Button>
        </>
      }
    >
      <div className="col" style={{ gap: 16 }}>
        {product.variants.length > 0 && (
          <div className="col">
            <strong>ตัวเลือก</strong>
            <div className="pos-opt-group">
              {product.variants.map((v) => (
                <button key={v.name} type="button" className={`pos-opt ${variant === v.name ? 'active' : ''}`} onClick={() => setVariant(v.name)}>
                  <span>{v.name}</span>
                  <small>{v.price ? `+${money(v.price)}` : money(product.price)}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {product.modifiers.map((g) => (
          <div key={g.group} className="col">
            <strong>
              {g.group} <span className="small muted">{g.multi ? '(เลือกได้หลายอย่าง)' : '(เลือก 1)'}</span>
            </strong>
            <div className="pos-opt-group">
              {g.options.map((o) => {
                const on = mods.some((m) => m.group === g.group && m.name === o.name);
                return (
                  <button key={o.name} type="button" className={`pos-opt ${on ? 'active' : ''}`} onClick={() => toggle(g.group, o.name, g.multi)}>
                    <span>{o.name}</span>
                    {o.price ? <small>+{money(o.price)}</small> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
