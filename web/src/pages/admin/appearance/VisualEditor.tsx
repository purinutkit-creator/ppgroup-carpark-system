/**
 * Visual Font Editor: pick a system + page, click any text in the live
 * preview and edit its typography at Element / Component / Page / System /
 * Global scope. The preview re-renders from the draft before saving.
 */
import { useEffect, useMemo, useState } from 'react';
import { ELEMENTS, elementsFor, splitPath, SYSTEMS, type DesignConfig, type ElementDef, type LevelOverride, type SystemId } from '@pp/shared/design/index';
import { Card, Field, Select } from '../../../components/ui';
import { SystemPreview, pagesOf, layoutFor, LAYOUT_LABEL } from '../../../components/appearance/SystemPreview';
import { TypographyPanel, type ScopeLevel } from '../../../components/appearance/TypographyPanel';
import { ApplyFooter } from '../../../components/appearance/ApplyFooter';
import { isEqual, systemName, useAppearance } from './context';

/**
 * Copy the typography of `from` (system text/fonts, page/component/element
 * overrides) onto other systems wherever an equivalent path is registered.
 */
export function copySystemTypography(cfg: DesignConfig, from: SystemId, to: SystemId[]): DesignConfig {
  const next = structuredClone(cfg);
  const has = (prefix: string) => ELEMENTS.some((e) => e.path === prefix || e.path.startsWith(prefix + '/'));
  const swap = (key: string, t: SystemId) => t + key.slice(from.length);
  for (const t of to) {
    if (t === from) continue;
    const src = next.systems[from];
    if (src?.text || src?.fonts) {
      const o: LevelOverride = (next.systems[t] = { ...(next.systems[t] ?? {}) });
      if (src.text) o.text = { ...src.text };
      if (src.fonts) o.fonts = { ...(o.fonts ?? {}), ...src.fonts };
    }
    for (const bucket of ['pages', 'components'] as const) {
      for (const [k, v] of Object.entries(next[bucket])) {
        if (!k.startsWith(from + '/') || !v.text) continue;
        const nk = swap(k, t);
        if (has(nk)) next[bucket][nk] = { ...(next[bucket][nk] ?? {}), text: { ...v.text } };
      }
    }
    for (const [k, v] of Object.entries(next.elements)) {
      if (!k.startsWith(from + '/')) continue;
      const nk = swap(k, t);
      if (has(nk)) next.elements[nk] = { ...v };
    }
  }
  return next;
}

export function VisualEditor() {
  const { data, publish, perms } = useAppearance();
  const [system, setSystem] = useState<SystemId>('payment-kiosk');
  const pages = useMemo(() => pagesOf(system), [system]);
  const [page, setPage] = useState<string>('');
  const [draft, setDraft] = useState<DesignConfig>(data.config);
  const [sel, setSel] = useState<ElementDef | null>(null);
  const [scope, setScope] = useState<ScopeLevel>('element');
  useEffect(() => setDraft(data.config), [data.config]);
  useEffect(() => {
    setPage('');
    setSel(null);
  }, [system]);
  const dirty = !isEqual(draft, data.config);
  const touchesGlobal = !isEqual(draft.global, data.config.global);
  const canSave = perms.edit && (touchesGlobal ? perms.applyAll : perms.apply);

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card>
        <div className="filters">
          <Field label="ระบบ (System)">
            <Select value={system} onChange={(e) => setSystem(e.target.value as SystemId)} options={SYSTEMS.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <Field label="หน้า (Page)">
            <Select value={page} onChange={(e) => setPage(e.target.value)} placeholder="ทุกหน้า" options={pages.map((p) => ({ value: p, label: p.split('/')[1] }))} />
          </Field>
          <span className="spacer" />
          <span className="small muted">
            {LAYOUT_LABEL[layoutFor(system)]} · {elementsFor(system).length} text elements · คลิกที่ข้อความเพื่อแก้ไข
          </span>
        </div>
      </Card>
      <div className="ap-layout">
        <div className="ap-stage" onClick={() => setSel(null)}>
          <SystemPreview system={system} pageKey={page || null} config={draft} selected={sel?.path} onSelect={(el) => setSel(el)} />
        </div>
        <Card className="ap-sticky">
          {sel ? (
            <TypographyPanel el={sel} config={draft} scope={scope} onScope={setScope} onChange={setDraft} disabled={!perms.edit} />
          ) : (
            <div className="col">
              <div className="card-title">Edit Typography</div>
              <div className="muted">คลิกข้อความใดก็ได้ในตัวอย่างด้านซ้ายเพื่อแก้ไข Font Family, Size, Weight, Line Height, Color ฯลฯ</div>
              <div className="field-label mt">Elements ในหน้านี้</div>
              {elementsFor(system)
                .filter((e) => !page || splitPath(e.path).pageKey === page)
                .map((e) => (
                  <button key={e.path} type="button" className="btn btn-ghost btn-sm" style={{ justifyContent: 'space-between' }} onClick={() => setSel(e)}>
                    <span>{e.label}</span>
                    <span className="small muted mono">{e.path.split('/').slice(1).join('/')}</span>
                  </button>
                ))}
            </div>
          )}
        </Card>
      </div>
      <ApplyFooter
        dirty={dirty}
        onCancel={() => setDraft(data.config)}
        onSave={(note) => publish(draft, [system], note || `Visual Font Editor (${systemName(system)})`)}
        saveLabel={`Save (${systemName(system)})`}
        saveHint={`แก้ไขแล้วจะเห็นผลในตัวอย่างทันที — กด Save เพื่อเผยแพร่ไปยัง ${systemName(system)}`}
        canSave={canSave}
        onApply={(systems, _all, note) => publish(copySystemTypography(draft, system, systems), [...new Set([system, ...systems])], note || `Copy typography ${systemName(system)} → ${systems.map(systemName).join(', ')}`)}
        canApply={perms.edit && perms.apply}
        canApplyAll={perms.edit && perms.applyAll}
        subject={sel ? `${sel.label} typography` : `${systemName(system)} typography`}
      />
    </div>
  );
}
