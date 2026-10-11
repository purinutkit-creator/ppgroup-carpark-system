/**
 * Media & Images: per-system background images / banner / logo stored as
 * design tokens (backgroundImage, logoImage), with size guidance and preview.
 */
import { useEffect, useState } from 'react';
import { changedSystems, type DesignConfig, type SystemId } from '@pp/shared/design/index';
import { Card, MediaInput } from '../../../components/ui';
import { ApplyFooter } from '../../../components/appearance/ApplyFooter';
import { uploadMedia } from '../../../lib/upload';
import { ALL_SYSTEM_IDS, isEqual, systemName, useAppearance } from './context';

interface Slot {
  key: string;
  label: string;
  system: SystemId | 'global';
  token: 'backgroundImage' | 'logoImage';
  size: string;
  ratio: string;
}

const SLOTS: Slot[] = [
  { key: 'entry', label: 'Entry Kiosk Background', system: 'entry-kiosk', token: 'backgroundImage', size: '1080×1920 px (9:16 แนวตั้ง)', ratio: '9 / 16' },
  { key: 'exit', label: 'Exit Kiosk Background', system: 'exit-kiosk', token: 'backgroundImage', size: '1080×1920 px (9:16 แนวตั้ง)', ratio: '9 / 16' },
  { key: 'pay', label: 'Payment Kiosk Background', system: 'payment-kiosk', token: 'backgroundImage', size: '1080×1920 px (9:16 แนวตั้ง)', ratio: '9 / 16' },
  { key: 'web', label: 'Customer Website Background', system: 'customer-web', token: 'backgroundImage', size: '1080×1920 px (9:16)', ratio: '9 / 16' },
  { key: 'display', label: 'Customer Display Background', system: 'customer-display', token: 'backgroundImage', size: '1920×1080 px (16:9 แนวนอน)', ratio: '16 / 9' },
  { key: 'pos', label: 'POS Banner', system: 'merchant-pos', token: 'backgroundImage', size: '1920×480 px (4:1)', ratio: '4 / 1' },
  { key: 'logo', label: 'Logo (ทุกระบบ)', system: 'global', token: 'logoImage', size: '1000×1000 px (1:1, PNG พื้นโปร่งใส)', ratio: '1 / 1' },
];

export function MediaImages() {
  const { data, publish, perms } = useAppearance();
  const [draft, setDraft] = useState<DesignConfig>(data.config);
  useEffect(() => setDraft(data.config), [data.config]);
  const dirty = !isEqual(draft, data.config);
  const touchesGlobal = !isEqual(draft.global, data.config.global);

  const get = (s: Slot) => (s.system === 'global' ? draft.global.tokens[s.token] : draft.systems[s.system]?.tokens?.[s.token]) ?? '';
  const set = (s: Slot, url: string) => {
    const next = structuredClone(draft);
    if (s.system === 'global') next.global.tokens = { ...next.global.tokens, [s.token]: url };
    else {
      const o = (next.systems[s.system] = next.systems[s.system] ?? {});
      const tokens = { ...(o.tokens ?? {}) };
      if (url) tokens[s.token] = url;
      else delete tokens[s.token];
      o.tokens = tokens;
    }
    setDraft(next);
  };
  const targets = changedSystems(data.config, draft, ALL_SYSTEM_IDS);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="grid grid-3">
        {SLOTS.map((s) => {
          const v = get(s);
          return (
            <Card key={s.key} title={s.label} actions={<span className="small muted">{s.system === 'global' ? 'Global' : systemName(s.system)}</span>}>
              <MediaInput label="รูปภาพ" value={v} recommended={s.size} upload={(f) => uploadMedia(f, 'design')} onChange={(url) => set(s, url)} />
              <div className="field-label mt">Preview (สัดส่วน {s.ratio.replace(/ /g, '')})</div>
              <div
                className="ap-media-preview"
                style={{
                  aspectRatio: s.ratio,
                  maxHeight: 300,
                  width: s.ratio === '9 / 16' ? 168 : '100%',
                  backgroundImage: v ? `url("${v}")` : undefined,
                  backgroundSize: s.token === 'logoImage' ? 'contain' : 'cover',
                }}
              >
                {!v && <div className="empty small">ยังไม่ได้ตั้งค่า</div>}
              </div>
              {v !== ((s.system === 'global' ? data.config.global.tokens[s.token] : data.config.systems[s.system]?.tokens?.[s.token]) ?? '') && <div className="small" style={{ color: 'var(--color-warning)' }}>● ยังไม่ได้บันทึก</div>}
            </Card>
          );
        })}
      </div>
      <div className="small muted">พื้นหลังใช้ผ่าน CSS variable --bg-image และโลโก้ผ่าน --logo-image ของแต่ละระบบ · รองรับ JPG / PNG / WEBP / SVG (สูงสุด 15 MB)</div>
      <ApplyFooter
        dirty={dirty}
        onCancel={() => setDraft(data.config)}
        onSave={(note) => publish(draft, touchesGlobal ? undefined : targets, note || `Media & Images (${targets.map(systemName).join(', ')})`)}
        canSave={perms.edit && (touchesGlobal ? perms.applyAll : perms.apply)}
        saveHint={dirty ? undefined : 'อัปโหลดแล้วดูตัวอย่างก่อนกด Save'}
      />
    </div>
  );
}
