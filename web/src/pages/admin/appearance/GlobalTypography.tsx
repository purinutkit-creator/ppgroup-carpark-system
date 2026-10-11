/**
 * Admin → Appearance → Global Typography: font roles, per-language fonts and
 * fallback stack — for Global or one system.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  applyToSystems,
  DEFAULT_DESIGN,
  FONT_ROLES,
  fontStack,
  resolveFonts,
  SYSTEMS,
  type DesignConfig,
  type FontRole,
  type SystemId,
} from '@pp/shared/design/index';
import { Button, Card, Check, Field, Input, Select } from '../../../components/ui';
import { FontPicker, setAssetWeights, withFontAsset } from '../../../components/appearance/FontPicker';
import { ApplyFooter } from '../../../components/appearance/ApplyFooter';
import { ensurePreview, useFontSources } from '../../../components/appearance/fonts';
import { ALL_SYSTEM_IDS, isEqual, systemName, useAppearance } from './context';

type Scope = 'global' | SystemId;

const ROLE_HINT: Record<FontRole, string> = {
  primary: 'ข้อความทั่วไปทุกหน้าจอ',
  heading: 'หัวข้อ / ชื่อหน้า',
  number: 'ตัวเลข ยอดเงิน เวลา',
  button: 'ปุ่มกด',
  receipt: 'ใบเสร็จ / บัตรจอด (พิมพ์)',
  kiosk: 'ข้อความบนตู้ Kiosk',
  plate: 'ป้ายทะเบียนรถ',
};

const LANG_SAMPLE = { th: 'ภาษาไทย กขฃค 0123456789', en: 'English ABC abc 0123456789', zh: '中文 智能停车 欢迎光临' };

export function GlobalTypography() {
  const { data, publish, perms } = useAppearance();
  const [scope, setScope] = useState<Scope>('global');
  const [draft, setDraft] = useState<DesignConfig>(data.config);
  useEffect(() => setDraft(data.config), [data.config]);
  const dirty = !isEqual(draft, data.config);
  const { system: sysFonts } = useFontSources('');

  const sys = scope === 'global' ? null : scope;
  const effective = useMemo(() => (sys ? resolveFonts(draft, sys) : draft.global.fonts), [draft, sys]);
  const published = useMemo(() => (sys ? resolveFonts(data.config, sys) : data.config.global.fonts), [data.config, sys]);
  useEffect(() => {
    Object.values(effective).forEach((f) => ensurePreview(f, draft));
    if (draft.global.languageFonts.enabled) [draft.global.languageFonts.th, draft.global.languageFonts.en, draft.global.languageFonts.zh].forEach((f) => ensurePreview(f, draft));
  }, [effective, draft]);

  const sourceOf = (role: FontRole) => {
    if (sys) return draft.systems[sys]?.fonts?.[role] ? 'System' : 'Global';
    return draft.global.fonts[role] === DEFAULT_DESIGN.global.fonts[role] ? 'Default' : 'Global';
  };

  const setRole = (role: FontRole, family: string, base: DesignConfig) => {
    const next = structuredClone(base);
    if (!sys) next.global.fonts[role] = family;
    else {
      const o = (next.systems[sys] = next.systems[sys] ?? {});
      const fonts = { ...(o.fonts ?? {}) };
      if (family) fonts[role] = family;
      else delete fonts[role];
      o.fonts = fonts;
    }
    setDraft(next);
  };

  const changedRoles = FONT_ROLES.filter((r) => effective[r.id] !== published[r.id]).map((r) => r.id);
  const patchFonts = Object.fromEntries((changedRoles.length ? changedRoles : FONT_ROLES.map((r) => r.id)).map((r) => [r, effective[r]])) as Partial<Record<FontRole, string>>;
  const subject = changedRoles.length ? effective[changedRoles[0]] : effective.primary;

  const save = (note: string) => publish(draft, sys ? [sys] : undefined, note || `Global Typography (${sys ? systemName(sys) : 'Global'})`);
  const apply = (systems: SystemId[], _all: boolean, note: string) => {
    const next = applyToSystems(draft, systems, { fonts: patchFonts }, ALL_SYSTEM_IDS);
    const targets = [...new Set([...(sys ? [sys] : []), ...systems])];
    return publish(next, targets, note || `Apply fonts (${Object.values(patchFonts).join(', ')}) → ${systems.length === ALL_SYSTEM_IDS.length ? 'All' : systems.map(systemName).join(', ')}`);
  };

  const lf = draft.global.languageFonts;
  const setLf = (patch: Partial<typeof lf>, base = draft) => setDraft({ ...base, global: { ...base.global, languageFonts: { ...base.global.languageFonts, ...patch } } });
  const canEdit = perms.edit && (sys ? perms.apply : perms.applyAll);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="small muted">Admin → Appearance → Global Typography</div>
      <Card
        title="ฟอนต์หลักของระบบ"
        actions={
          <Field label="ขอบเขต (Scope)">
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              options={[{ value: 'global', label: 'Global (ทุกระบบ)' }, ...SYSTEMS.map((s) => ({ value: s.id, label: `System: ${s.name}` }))]}
            />
          </Field>
        }
      >
        {!canEdit && <div className="small" style={{ color: 'var(--color-warning)', marginBottom: 8 }}>คุณไม่มีสิทธิ์เผยแพร่การตั้งค่าในขอบเขตนี้ ({sys ? 'configuration.apply' : 'configuration.apply_all'}) — ดูได้อย่างเดียว</div>}
        <div className="ap-roles">
          {FONT_ROLES.map((r) => {
            const src = sourceOf(r.id);
            const asset = draft.fonts.find((f) => f.family === effective[r.id]);
            return (
              <div key={r.id} className={`ap-role ${src === 'System' || (src === 'Global' && !sys) ? 'overridden' : ''}`}>
                <div className="ap-role-head">
                  <b>{r.label}</b>
                  <span className="spacer" />
                  <span className={`ap-src ${(sys && src === 'System') || (!sys && src === 'Global') ? 'here' : ''}`}>Inherited from: {src}</span>
                </div>
                <div className="small muted">{ROLE_HINT[r.id]}</div>
                <FontPicker
                  config={draft}
                  value={effective[r.id]}
                  disabled={!canEdit}
                  allowEmpty={!!sys}
                  emptyLabel={`ใช้ค่า Global (${draft.global.fonts[r.id]})`}
                  onChange={(family, a) => setRole(r.id, family, withFontAsset(draft, a))}
                  onWeights={asset?.source === 'GOOGLE' ? (w) => setDraft(setAssetWeights(draft, asset.family, w)) : undefined}
                />
                {sys && src === 'System' && (
                  <Button size="sm" variant="ghost" onClick={() => setRole(r.id, '', draft)} disabled={!canEdit}>
                    ↺ กลับไปใช้ค่า Global
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-2">
        <Card title="ฟอนต์ตามภาษา (Per-language fonts)">
          {sys && <div className="small muted mb">ตั้งค่าได้ที่ระดับ Global เท่านั้น (ใช้ร่วมกันทุกระบบ)</div>}
          <Check label="เปิดใช้ฟอนต์แยกตามภาษา (ไทย / English / 中文)" checked={lf.enabled} disabled={!!sys || !perms.applyAll} onChange={(v) => setLf({ enabled: v })} />
          <div className="col mt">
            {(['th', 'en', 'zh'] as const).map((k) => (
              <Field key={k} label={{ th: 'Thai Font', en: 'English Font', zh: 'Chinese Font' }[k]}>
                <FontPicker config={draft} value={lf[k]} previewText={LANG_SAMPLE[k]} disabled={!!sys || !perms.applyAll || !lf.enabled} showWeights={false} onChange={(f, a) => setLf({ [k]: f }, withFontAsset(draft, a))} />
              </Field>
            ))}
          </div>
          <div className="small muted mt">เมื่อเปิดใช้ ระบบจะเรียงฟอนต์ English → Thai → Chinese ต่อจากฟอนต์หลัก เพื่อให้ตัวอักษรแต่ละภาษาแสดงด้วยฟอนต์ที่กำหนด</div>
        </Card>
        <Card title="Fallback Stack">
          <Field label="ลำดับฟอนต์สำรอง (CSS font-family)" hint="ใช้เมื่อโหลดฟอนต์หลักไม่ได้ (เช่น ออฟไลน์)">
            <Input value={draft.global.fallback} disabled={!!sys || !perms.applyAll} onChange={(e) => setDraft({ ...draft, global: { ...draft.global, fallback: e.target.value } })} />
          </Field>
          <div className="row mt" style={{ gap: 4 }}>
            {sysFonts.map((f) => (
              <Button
                key={f.family}
                size="sm"
                variant="ghost"
                disabled={!!sys || !perms.applyAll || draft.global.fallback.includes(f.family)}
                title={f.note}
                onClick={() => {
                  const q = /\s/.test(f.family) ? `"${f.family}"` : f.family;
                  const parts = draft.global.fallback.split(',').map((s) => s.trim()).filter(Boolean);
                  const generic = parts.findIndex((p) => /^(sans-serif|serif|monospace)$/.test(p));
                  if (generic >= 0) parts.splice(generic, 0, q);
                  else parts.push(q);
                  setDraft({ ...draft, global: { ...draft.global, fallback: parts.join(', ') } });
                }}
              >
                + {f.family}
              </Button>
            ))}
          </div>
          <div className="divider" />
          <div className="field-label">ตัวอย่าง (ฟอนต์ที่ใช้งานจริง{sys ? ` · ${systemName(sys)}` : ''})</div>
          <div className="col" style={{ gap: 4 }}>
            {FONT_ROLES.map((r) => (
              <div key={r.id} className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                <span className="small muted" style={{ width: 120, flex: 'none' }}>
                  {r.label}
                </span>
                <span style={{ fontFamily: fontStack(draft, effective[r.id]), fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>SMART PARKING กข 1234 ฿120.00 智能停车</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <ApplyFooter
        dirty={dirty}
        onCancel={() => setDraft(data.config)}
        onSave={save}
        saveLabel={sys ? `Save (${systemName(sys)})` : 'Save (Global)'}
        saveHint={`Design Configuration v${data.version.versionNo}`}
        canSave={canEdit}
        onApply={apply}
        canApply={perms.edit && perms.apply}
        canApplyAll={perms.edit && perms.applyAll}
        subject={subject}
      />
    </div>
  );
}
