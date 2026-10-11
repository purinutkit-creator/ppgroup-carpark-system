/**
 * Merchant-specific parking validation promotions (validation_rules with
 * scope MERCHANT). Save applies to this merchant; "Save & Apply to All
 * Merchants" creates one rule covering every ACTIVE merchant.
 */
import { useEffect, useState } from 'react';
import { del, get, post, put } from '../../lib/api';
import { minutesText, money } from '../../lib/format';
import { Badge, Button, Card, Check, Empty, Field, Input, NumberInput, Select, SettingsFooter, useAsync, useToast, errorText, ConfirmDialog } from '../ui';

type RewardType = 'AMOUNT' | 'MINUTES' | 'FULL';
interface Reward {
  type: RewardType;
  value?: number;
}
export interface Promotion {
  id?: number;
  name: string;
  kind: 'TIER' | 'STEP' | 'ANY_PURCHASE';
  tiers?: Array<{ minSpend: number; reward: Reward }>;
  step?: { every: number; reward: Reward; max?: number | null };
  anyPurchase?: { minSpend?: number; reward: Reward };
  priority: number;
  combinable: boolean;
  active: boolean;
  merchantIds?: number[];
}

const PRESETS: Array<{ label: string; p: Promotion }> = [
  { label: 'Supermarket: ทุก 500 = 1 ชม.', p: { name: 'ทุก 500 บาท = จอดฟรี 1 ชม.', kind: 'STEP', step: { every: 500, reward: { type: 'MINUTES', value: 60 }, max: null }, priority: 5, combinable: true, active: true } },
  { label: 'Cinema: ซื้อตั๋ว → ฟรี 4 ชั่วโมง', p: { name: 'ซื้อตั๋ว → จอดฟรี 4 ชั่วโมง', kind: 'ANY_PURCHASE', anyPurchase: { minSpend: 0, reward: { type: 'MINUTES', value: 240 } }, priority: 5, combinable: true, active: true } },
  { label: 'Restaurant: ≥1000 → ลด 100', p: { name: 'ยอดซื้อ 1,000 บาทขึ้นไป ลดค่าจอด 100 บาท', kind: 'TIER', tiers: [{ minSpend: 1000, reward: { type: 'AMOUNT', value: 100 } }], priority: 5, combinable: true, active: true } },
  { label: 'VIP Store: ซื้ออะไรก็ได้ → 2 ชั่วโมง', p: { name: 'ซื้อสินค้าใดก็ได้ → จอดฟรี 2 ชั่วโมง', kind: 'ANY_PURCHASE', anyPurchase: { minSpend: 0, reward: { type: 'MINUTES', value: 120 } }, priority: 5, combinable: true, active: true } },
];

const BLANK: Promotion = { name: '', kind: 'TIER', tiers: [{ minSpend: 500, reward: { type: 'MINUTES', value: 60 } }], priority: 5, combinable: true, active: true };

export function rewardText(r?: Reward) {
  if (!r) return '-';
  if (r.type === 'FULL') return 'จอดฟรีทั้งหมด';
  if (r.type === 'MINUTES') return `จอดฟรี ${minutesText(r.value ?? 0)}`;
  return `ลด ${money(r.value ?? 0)}`;
}

export function promotionSummary(p: Promotion) {
  if (p.kind === 'STEP' && p.step) return `ทุก ${money(p.step.every)} → ${rewardText(p.step.reward)}${p.step.max ? ` (สูงสุด ${p.step.max})` : ''}`;
  if (p.kind === 'ANY_PURCHASE' && p.anyPurchase) return `ซื้อ${p.anyPurchase.minSpend ? ` ≥ ${money(p.anyPurchase.minSpend)}` : 'สินค้าใดก็ได้'} → ${rewardText(p.anyPurchase.reward)}`;
  return (p.tiers ?? []).map((t) => `≥ ${money(t.minSpend)} → ${rewardText(t.reward)}`).join(' · ');
}

function RewardInput({ value, onChange, allowFull = true }: { value: Reward; onChange: (r: Reward) => void; allowFull?: boolean }) {
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <Select
        value={value.type}
        onChange={(e) => onChange({ type: e.target.value as RewardType, value: e.target.value === 'FULL' ? undefined : value.value ?? 60 })}
        options={[{ value: 'MINUTES', label: 'จอดฟรี (นาที)' }, { value: 'AMOUNT', label: 'ลดค่าจอด (บาท)' }, ...(allowFull ? [{ value: 'FULL', label: 'ฟรีทั้งหมด' }] : [])]}
      />
      {value.type !== 'FULL' && <NumberInput value={value.value ?? 0} min={1} onChange={(v) => onChange({ ...value, value: v ?? 0 })} style={{ width: 110 }} />}
    </div>
  );
}

function Editor({ value, onChange }: { value: Promotion; onChange: (p: Promotion) => void }) {
  const p = value;
  const set = (patch: Partial<Promotion>) => onChange({ ...p, ...patch });
  return (
    <div className="col">
      <div className="row">
        <span className="small muted">เทมเพลต:</span>
        {PRESETS.map((x) => (
          <Button key={x.label} size="sm" onClick={() => onChange({ ...x.p, id: p.id })}>
            {x.label}
          </Button>
        ))}
      </div>
      <div className="grid grid-2">
        <Field label="ชื่อโปรโมชั่น">
          <Input value={p.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />
        </Field>
        <Field label="รูปแบบ">
          <Select
            value={p.kind}
            onChange={(e) => {
              const kind = e.target.value as Promotion['kind'];
              set({
                kind,
                tiers: kind === 'TIER' ? p.tiers ?? [{ minSpend: 500, reward: { type: 'MINUTES', value: 60 } }] : undefined,
                step: kind === 'STEP' ? p.step ?? { every: 500, reward: { type: 'MINUTES', value: 60 }, max: null } : undefined,
                anyPurchase: kind === 'ANY_PURCHASE' ? p.anyPurchase ?? { minSpend: 0, reward: { type: 'MINUTES', value: 120 } } : undefined,
              });
            }}
            options={[
              { value: 'TIER', label: 'ขั้นบันได (ยอดซื้อขั้นต่ำ → รางวัล)' },
              { value: 'STEP', label: 'ทุก ๆ X บาท → รางวัล' },
              { value: 'ANY_PURCHASE', label: 'ซื้อสินค้าใดก็ได้ → รางวัล' },
            ]}
          />
        </Field>
      </div>
      {p.kind === 'TIER' && (
        <div className="col">
          {(p.tiers ?? []).map((t, i) => (
            <div key={i} className="row">
              <span className="small">ยอดซื้อ ≥</span>
              <NumberInput value={t.minSpend} min={0} onChange={(v) => set({ tiers: p.tiers!.map((x, j) => (j === i ? { ...x, minSpend: v ?? 0 } : x)) })} style={{ width: 120 }} />
              <span className="small">→</span>
              <RewardInput value={t.reward} onChange={(r) => set({ tiers: p.tiers!.map((x, j) => (j === i ? { ...x, reward: r } : x)) })} />
              <Button size="sm" variant="ghost" onClick={() => set({ tiers: p.tiers!.filter((_, j) => j !== i) })} disabled={(p.tiers ?? []).length <= 1}>
                ลบ
              </Button>
            </div>
          ))}
          <div>
            <Button size="sm" onClick={() => set({ tiers: [...(p.tiers ?? []), { minSpend: 1000, reward: { type: 'AMOUNT', value: 100 } }] })}>
              + เพิ่มขั้น
            </Button>
          </div>
        </div>
      )}
      {p.kind === 'STEP' && p.step && (
        <div className="row">
          <span className="small">ทุก ๆ</span>
          <NumberInput value={p.step.every} min={1} onChange={(v) => set({ step: { ...p.step!, every: v ?? 0 } })} style={{ width: 120 }} />
          <span className="small">บาท →</span>
          <RewardInput allowFull={false} value={p.step.reward} onChange={(r) => set({ step: { ...p.step!, reward: r } })} />
          <span className="small">สูงสุด</span>
          <NumberInput value={p.step.max ?? null} min={0} placeholder="ไม่จำกัด" onChange={(v) => set({ step: { ...p.step!, max: v } })} style={{ width: 110 }} />
        </div>
      )}
      {p.kind === 'ANY_PURCHASE' && p.anyPurchase && (
        <div className="row">
          <span className="small">ยอดซื้อขั้นต่ำ</span>
          <NumberInput value={p.anyPurchase.minSpend ?? 0} min={0} onChange={(v) => set({ anyPurchase: { ...p.anyPurchase!, minSpend: v ?? 0 } })} style={{ width: 120 }} />
          <span className="small">→</span>
          <RewardInput value={p.anyPurchase.reward} onChange={(r) => set({ anyPurchase: { ...p.anyPurchase!, reward: r } })} />
        </div>
      )}
      <div className="row">
        <Field label="Priority">
          <NumberInput value={p.priority} onChange={(v) => set({ priority: v ?? 0 })} style={{ width: 100 }} />
        </Field>
        <Check label="ใช้ร่วมกับโปรอื่นได้" checked={p.combinable} onChange={(v) => set({ combinable: v })} />
        <Check label="เปิดใช้งาน" checked={p.active} onChange={(v) => set({ active: v })} />
      </div>
      <div className="small muted">สรุป: {promotionSummary(p)}</div>
    </div>
  );
}

export function PromotionManager({ merchantId, canEdit }: { merchantId: number; canEdit: boolean }) {
  const toast = useToast();
  const list = useAsync(() => get<{ items: Promotion[] }>(`/api/merchants/${merchantId}/promotions`), [merchantId]);
  const active = useAsync(() => get<{ items: Array<{ id: number; name: string; code: string }> }>('/api/merchants?status=ACTIVE&limit=500'), []);
  const [edit, setEdit] = useState<Promotion | null>(null);
  const [removing, setRemoving] = useState<Promotion | null>(null);
  useEffect(() => setEdit(null), [merchantId]);
  const payload = (p: Promotion) => ({ name: p.name, kind: p.kind, tiers: p.tiers, step: p.step, anyPurchase: p.anyPurchase, priority: p.priority, combinable: p.combinable, active: p.active });
  const save = async () => {
    if (!edit) return;
    if (edit.id) await put(`/api/merchants/${merchantId}/promotions/${edit.id}`, payload(edit));
    else await post(`/api/merchants/${merchantId}/promotions`, payload(edit));
    setEdit(null);
    list.reload();
  };
  const targets = (active.data?.items ?? []).map((m) => ({ id: String(m.id), label: `${m.code ?? ''} ${m.name}` }));
  return (
    <Card
      title="โปรโมชั่นส่วนลดจอดรถเฉพาะร้าน"
      actions={canEdit && !edit ? (
        <Button size="sm" variant="primary" onClick={() => setEdit({ ...BLANK })}>
          + เพิ่มโปรโมชั่น
        </Button>
      ) : undefined}
    >
      {list.error && <div style={{ color: 'var(--color-danger)' }}>{list.error}</div>}
      {!list.data?.items.length ? (
        <Empty>ยังไม่มีโปรโมชั่นเฉพาะร้าน (ใช้กฎกลางของศูนย์)</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>ชื่อ</th>
                <th>เงื่อนไข</th>
                <th>ร้านที่ใช้</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="small">{promotionSummary(p)}</td>
                  <td className="small">{(p.merchantIds?.length ?? 0) > 1 ? `${p.merchantIds!.length} ร้าน (ใช้ร่วม)` : 'ร้านนี้'}</td>
                  <td>{p.active ? <Badge tone="success">ACTIVE</Badge> : <Badge>ปิด</Badge>}</td>
                  <td className="right nowrap">
                    {canEdit && (
                      <>
                        <Button size="sm" onClick={() => setEdit(p)}>
                          แก้ไข
                        </Button>{' '}
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(p)}>
                          ลบ
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit && (
        <div className="col" style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
          <strong>{edit.id ? 'แก้ไขโปรโมชั่น' : 'โปรโมชั่นใหม่'}</strong>
          <Editor value={edit} onChange={setEdit} />
          <SettingsFooter
            dirty
            onCancel={() => setEdit(null)}
            onSave={save}
            subject={edit.name || 'โปรโมชั่น'}
            targets={targets}
            applyAllLabel="Save & Apply to All Merchants"
            onApply={async (ids, all) => {
              if (all) {
                await post('/api/merchants/promotions/apply-all', { rule: payload(edit) });
              } else {
                // One merchant-scoped rule per selected shop.
                const errors: string[] = [];
                for (const id of ids) {
                  try {
                    await post(`/api/merchants/${id}/promotions`, payload(edit));
                  } catch (e) {
                    errors.push(`${id}: ${errorText(e)}`);
                  }
                }
                if (errors.length) throw new Error(errors.join('; '));
              }
              toast(all ? `ใช้กับร้านค้าที่ใช้งานทั้งหมด ${targets.length} ร้าน` : `ใช้กับ ${ids.length} ร้าน`, 'success');
              setEdit(null);
              list.reload();
            }}
          />
        </div>
      )}
      <ConfirmDialog
        open={!!removing}
        title="ลบโปรโมชั่น?"
        message={removing && ((removing.merchantIds?.length ?? 0) > 1 ? `“${removing.name}” ใช้ร่วมหลายร้าน — จะนำร้านนี้ออกจากโปรโมชั่นเท่านั้น` : `ปิดใช้งาน “${removing.name}”`)}
        danger
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          try {
            await del(`/api/merchants/${merchantId}/promotions/${removing!.id}`);
            list.reload();
          } catch (e) {
            toast(errorText(e), 'error');
          }
        }}
      />
    </Card>
  );
}
