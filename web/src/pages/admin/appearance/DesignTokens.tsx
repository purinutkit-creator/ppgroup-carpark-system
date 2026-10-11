/**
 * Design Tokens: colours, radius, border, shadow, spacing and component
 * styles — global or per system — with a live component preview.
 */
import { useEffect, useMemo, useState } from 'react';
import { applyToSystems, DARK_TOKENS, DEFAULT_TOKENS, resolveTokens, SYSTEMS, type DesignConfig, type DesignTokens as Tokens, type SystemId } from '@pp/shared/design/index';
import { Button, Card, Field, Select } from '../../../components/ui';
import { DesignProvider } from '../../../design/DesignProvider';
import { ApplyFooter } from '../../../components/appearance/ApplyFooter';
import { ALL_SYSTEM_IDS, isEqual, systemName, useAppearance } from './context';

type Scope = 'global' | SystemId;
type ColorKey = 'primary' | 'secondary' | 'accent' | 'background' | 'surface' | 'text' | 'textMuted' | 'buttonBg' | 'buttonText' | 'border' | 'success' | 'warning' | 'danger';

const COLORS: Array<[ColorKey, string]> = [
  ['primary', 'Primary'],
  ['secondary', 'Secondary'],
  ['accent', 'Accent'],
  ['background', 'Background'],
  ['surface', 'Surface / Card'],
  ['text', 'Text'],
  ['textMuted', 'Text (Muted)'],
  ['buttonBg', 'Button'],
  ['buttonText', 'Button Text'],
  ['border', 'Border'],
  ['success', 'Success'],
  ['warning', 'Warning'],
  ['danger', 'Danger'],
];

const CHOICES = {
  shadow: ['none', 'sm', 'md', 'lg'],
  iconStyle: ['outline', 'filled'],
  inputStyle: ['outline', 'filled', 'underline'],
  modalStyle: ['center', 'sheet'],
  cardStyle: ['flat', 'outlined', 'elevated'],
  theme: ['light', 'dark'],
} as const;
type ChoiceKey = keyof typeof CHOICES;
const CHOICE_LABEL: Record<ChoiceKey, string> = { shadow: 'Shadow', iconStyle: 'Icon Style', inputStyle: 'Input Style', modalStyle: 'Modal Style', cardStyle: 'Card Style', theme: 'Theme (Light / Dark)' };

export function DesignTokens() {
  const { data, publish, perms } = useAppearance();
  const [scope, setScope] = useState<Scope>('global');
  const [previewSys, setPreviewSys] = useState<SystemId>('payment-kiosk');
  const [draft, setDraft] = useState<DesignConfig>(data.config);
  useEffect(() => setDraft(data.config), [data.config]);
  const sys = scope === 'global' ? null : scope;
  useEffect(() => {
    if (sys) setPreviewSys(sys);
  }, [sys]);
  const dirty = !isEqual(draft, data.config);
  const effective = useMemo(() => (sys ? resolveTokens(draft, sys) : draft.global.tokens), [draft, sys]);
  const publishedEff = useMemo(() => (sys ? resolveTokens(data.config, sys) : data.config.global.tokens), [data.config, sys]);
  const overridden = (k: keyof Tokens) => (sys ? draft.systems[sys]?.tokens?.[k] !== undefined : draft.global.tokens[k] !== DEFAULT_TOKENS[k]);
  const canEdit = perms.edit && (sys ? perms.apply : perms.applyAll);

  const setTok = (patch: Partial<Tokens>) => {
    const next = structuredClone(draft);
    if (!sys) next.global.tokens = { ...next.global.tokens, ...patch };
    else next.systems[sys] = { ...(next.systems[sys] ?? {}), tokens: { ...(next.systems[sys]?.tokens ?? {}), ...patch } };
    setDraft(next);
  };
  const clearTok = (k: keyof Tokens) => {
    const next = structuredClone(draft);
    if (!sys) (next.global.tokens as unknown as Record<string, unknown>)[k] = DEFAULT_TOKENS[k];
    else if (next.systems[sys]?.tokens) delete next.systems[sys]!.tokens![k];
    setDraft(next);
  };
  const setTheme = (theme: 'light' | 'dark') => setTok(theme === 'dark' ? { ...DARK_TOKENS } : { theme: 'light', background: DEFAULT_TOKENS.background, surface: DEFAULT_TOKENS.surface, text: DEFAULT_TOKENS.text, textMuted: DEFAULT_TOKENS.textMuted, border: DEFAULT_TOKENS.border });

  const changed = (Object.keys(effective) as Array<keyof Tokens>).filter((k) => k !== 'backgroundImage' && k !== 'logoImage' && effective[k] !== publishedEff[k]);
  const patch = Object.fromEntries((changed.length ? changed : (Object.keys(effective) as Array<keyof Tokens>).filter((k) => k !== 'backgroundImage' && k !== 'logoImage')).map((k) => [k, effective[k]])) as Partial<Tokens>;

  const Src = ({ k }: { k: keyof Tokens }) => (
    <span className={`ap-src ${overridden(k) ? 'here' : ''}`} title={overridden(k) ? 'คลิกเพื่อรีเซ็ต' : undefined} onClick={() => overridden(k) && canEdit && clearTok(k)} style={{ cursor: overridden(k) ? 'pointer' : undefined }}>
      {sys ? (overridden(k) ? 'System ↺' : 'Global') : overridden(k) ? 'Global ↺' : 'Default'}
    </span>
  );

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ap-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <div className="col" style={{ gap: 16 }}>
          <Card
            title="Design Tokens"
            actions={
              <Select value={scope} onChange={(e) => setScope(e.target.value as Scope)} options={[{ value: 'global', label: 'Global (ทุกระบบ)' }, ...SYSTEMS.map((s) => ({ value: s.id, label: `System: ${s.name}` }))]} />
            }
          >
            <div className="field-label mb">สี (Colors)</div>
            <div className="ap-token-grid">
              {COLORS.map(([k, label]) => (
                <div key={k} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <input type="color" className="ap-swatch" disabled={!canEdit} value={/^#[0-9a-f]{6}$/i.test(effective[k]) ? effective[k] : '#000000'} onChange={(e) => setTok({ [k]: e.target.value })} />
                  <div className="col" style={{ gap: 2, minWidth: 0 }}>
                    <span className="small">{label}</span>
                    <span className="row" style={{ gap: 4 }}>
                      <span className="mono small muted">{effective[k]}</span>
                      <Src k={k} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="divider" />
            <div className="grid grid-3">
              {(
                [
                  ['radius', 'Border Radius (px)', 0, 32],
                  ['borderWidth', 'Border Width (px)', 0, 6],
                  ['spacing', 'Spacing base (px)', 4, 16],
                ] as const
              ).map(([k, label, min, max]) => (
                <Field key={k} label={<span className="row" style={{ gap: 6 }}>{label} <Src k={k} /></span>}>
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                    <input type="range" min={min} max={max} disabled={!canEdit} value={effective[k]} onChange={(e) => setTok({ [k]: Number(e.target.value) })} style={{ flex: 1 }} />
                    <span className="mono small">{effective[k]}</span>
                  </div>
                </Field>
              ))}
              {(Object.keys(CHOICES) as ChoiceKey[]).map((k) => (
                <Field key={k} label={<span className="row" style={{ gap: 6 }}>{CHOICE_LABEL[k]} <Src k={k} /></span>}>
                  <Select
                    disabled={!canEdit}
                    value={effective[k]}
                    onChange={(e) => (k === 'theme' ? setTheme(e.target.value as 'light' | 'dark') : setTok({ [k]: e.target.value } as Partial<Tokens>))}
                    options={CHOICES[k].map((v) => ({ value: v, label: v }))}
                  />
                </Field>
              ))}
            </div>
          </Card>
        </div>
        <Card
          title="Live Component Preview"
          className="ap-sticky"
          actions={!sys && <Select value={previewSys} onChange={(e) => setPreviewSys(e.target.value as SystemId)} options={SYSTEMS.filter((s) => s.id !== 'admin').map((s) => ({ value: s.id, label: s.name }))} />}
        >
          <TokenPreview config={draft} system={sys ?? previewSys} />
        </Card>
      </div>
      <ApplyFooter
        dirty={dirty}
        onCancel={() => setDraft(data.config)}
        onSave={(note) => publish(draft, sys ? [sys] : undefined, note || `Design Tokens (${sys ? systemName(sys) : 'Global'})`)}
        saveLabel={sys ? `Save (${systemName(sys)})` : 'Save (Global)'}
        canSave={canEdit}
        onApply={(systems, _all, note) =>
          publish(applyToSystems(draft, systems, { tokens: patch }, ALL_SYSTEM_IDS), [...new Set([...(sys ? [sys] : []), ...systems])], note || `Apply tokens (${Object.keys(patch).join(', ')})`)
        }
        canApply={perms.edit && perms.apply}
        canApplyAll={perms.edit && perms.applyAll}
        subject={changed.length ? `${changed.length} design tokens` : 'design tokens'}
      />
    </div>
  );
}

function TokenPreview({ config, system }: { config: DesignConfig; system: SystemId }) {
  const t = resolveTokens(config, system);
  const [tab, setTab] = useState(0);
  return (
    <DesignProvider system={system} config={config} live={false} className="ap-preview-root">
      <div className="ap-tp ap-frame">
        <div className="row">
          <Button variant="primary">ชำระเงิน</Button>
          <Button variant="secondary">Secondary</Button>
          <Button>ยกเลิก</Button>
          <Button variant="danger">ลบ</Button>
          <span className="badge badge-success">PAID</span>
          <span className="badge badge-warning">UNPAID</span>
          <span className="badge badge-info">ACTIVE</span>
        </div>
        <div className={`card ${t.cardStyle}`}>
          <div className="card-title">
            <span>{t.iconStyle === 'filled' ? '●' : '○'} บัตรจอดรถ</span>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>ทะเบียนรถ</label>
              <input className={`input ${t.inputStyle}`} defaultValue="กข 1234" />
            </div>
            <div className="field">
              <label>จังหวัด</label>
              <select className={`input ${t.inputStyle}`} defaultValue="กรุงเทพมหานคร">
                <option>กรุงเทพมหานคร</option>
              </select>
            </div>
          </div>
          <div className="pill-tabs mt">
            {['วันนี้', 'สัปดาห์', 'เดือน'].map((x, i) => (
              <button key={x} type="button" className={tab === i ? 'active' : ''} onClick={() => setTab(i)}>
                {x}
              </button>
            ))}
          </div>
        </div>
        <div className={`ap-tp-modal ${t.modalStyle}`}>
          <div className="modal-header">ยืนยันการชำระเงิน</div>
          <div className="modal-body">
            ยอดชำระ <b className="num" style={{ color: 'var(--color-primary)', fontSize: 22 }}>฿120.00</b>
          </div>
          <div className="modal-footer">
            <Button>ยกเลิก</Button>
            <Button variant="primary">ยืนยัน</Button>
          </div>
        </div>
        <div className="small muted">
          Preview: {systemName(system)} · theme {t.theme} · modal {t.modalStyle}
        </div>
      </div>
    </DesignProvider>
  );
}
