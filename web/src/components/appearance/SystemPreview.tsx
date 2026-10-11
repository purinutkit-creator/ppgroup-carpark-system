/**
 * Faithful preview of one system page built from the element registry.
 * Rendered inside <DesignProvider config={draft}> so every text gets its style
 * from the real CSS pipeline (buildSystemCss → [data-el="…"]).
 */
import type { ReactNode } from 'react';
import { elementsFor, splitPath, type DesignConfig, type ElementDef, type SystemId } from '@pp/shared/design/index';
import { DesignProvider } from '../../design/DesignProvider';

type Layout = 'kiosk' | 'phone' | 'display' | 'pos' | 'paper' | 'a4' | 'desktop';

export function layoutFor(system: SystemId): Layout {
  if (system === 'entry-kiosk' || system === 'exit-kiosk' || system === 'payment-kiosk') return 'kiosk';
  if (system === 'customer-web') return 'phone';
  if (system === 'customer-display') return 'display';
  if (system === 'merchant-pos') return 'pos';
  if (system === 'receipt' || system === 'parking-ticket' || system === 'print-templates') return 'paper';
  if (system === 'reports') return 'a4';
  return 'desktop';
}

export const LAYOUT_LABEL: Record<Layout, string> = {
  kiosk: 'Kiosk (แนวตั้ง 1080×1920)',
  phone: 'Customer Phone',
  display: 'Customer Display (1920×1080)',
  pos: 'POS (Grid)',
  paper: 'กระดาษ Thermal',
  a4: 'A4 Report',
  desktop: 'Desktop',
};

export function pagesOf(system: SystemId) {
  const keys: string[] = [];
  for (const e of elementsFor(system)) {
    const k = splitPath(e.path).pageKey;
    if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

interface Group {
  key: string;
  name: string;
  els: ElementDef[];
}

function groups(els: ElementDef[]): Group[] {
  const out: Group[] = [];
  for (const e of els) {
    const key = splitPath(e.path).componentKey;
    let g = out.find((x) => x.key === key);
    if (!g) out.push((g = { key, name: key.split('/')[2], els: [] }));
    g.els.push(e);
  }
  return out;
}

const PAIRS: Array<[string, string]> = [
  ['label', 'value'],
  ['name', 'price'],
];

export function SystemPreview({
  system,
  pageKey,
  config,
  selected,
  onSelect,
  scale = 1,
}: {
  system: SystemId;
  pageKey?: string | null;
  config: DesignConfig;
  selected?: string | null;
  onSelect?: (el: ElementDef) => void;
  scale?: number;
}) {
  const els = elementsFor(system).filter((e) => !pageKey || splitPath(e.path).pageKey === pageKey);
  const gs = groups(els);
  const layout = layoutFor(system);

  const Text = ({ el, repeat }: { el: ElementDef; repeat?: number }) => {
    const leaf = el.path.split('/')[3];
    const cls = `ap-el ${selected === el.path ? 'ap-sel' : ''}`;
    const click = onSelect
      ? (e: React.MouseEvent) => {
          e.stopPropagation();
          onSelect(el);
        }
      : undefined;
    const sample = el.sample ?? el.label;
    const title = `${el.label} — ${el.path}`;
    if (el.role === 'button')
      return (
        <button type="button" className={`btn btn-primary ${layout === 'kiosk' ? 'btn-xl btn-block' : layout === 'phone' ? 'btn-lg btn-block' : ''} ${cls}`} data-el={el.path} onClick={click} title={title}>
          {sample}
        </button>
      );
    if (el.role === 'plate' && leaf === 'plate')
      return (
        <div className={`ap-plate ${cls}`} data-el={el.path} onClick={click} title={title} data-repeat={repeat}>
          {sample}
        </div>
      );
    return (
      <div className={cls} data-el={el.path} onClick={click} title={title}>
        {sample}
      </div>
    );
  };

  const renderGroup = (g: Group, opts: { repeat?: number } = {}): ReactNode => {
    const pair = PAIRS.find(([a, b]) => g.els.some((e) => e.path.endsWith('/' + a)) && g.els.some((e) => e.path.endsWith('/' + b)));
    const n = opts.repeat ?? 1;
    let body: ReactNode;
    if (pair) {
      const a = g.els.find((e) => e.path.endsWith('/' + pair[0]))!;
      const b = g.els.find((e) => e.path.endsWith('/' + pair[1]))!;
      const rest = g.els.filter((e) => e !== a && e !== b);
      body = (
        <>
          {Array.from({ length: layout === 'pos' && g.name === 'products' ? 1 : Math.max(n, 2) }, (_, i) => (
            <div key={i} className="ap-pair">
              <Text el={a} />
              <Text el={b} />
            </div>
          ))}
          {rest.map((e) => (
            <Text key={e.path} el={e} />
          ))}
        </>
      );
    } else body = g.els.map((e) => <Text key={e.path} el={e} />);
    return (
      <div key={g.key} className={`ap-comp ap-comp-${g.name}`} data-label={g.name}>
        {body}
      </div>
    );
  };

  let content: ReactNode;
  if (layout === 'kiosk') {
    const header = gs.find((g) => g.name === 'header');
    const actions = gs.filter((g) => g.name === 'actions');
    const body = gs.filter((g) => g !== header && !actions.includes(g));
    content = (
      <div className="ap-frame ap-kiosk kiosk">
        {header && <div className="kiosk-header ap-kiosk-header">{renderGroup(header)}</div>}
        <div className="ap-kiosk-body">
          <div className="card ap-kiosk-card">{body.map((g) => renderGroup(g))}</div>
        </div>
        <div className="ap-kiosk-actions">{actions.map((g) => renderGroup(g))}</div>
      </div>
    );
  } else if (layout === 'pos') {
    const left = gs.filter((g) => g.name === 'categories' || g.name === 'products');
    const right = gs.filter((g) => !left.includes(g));
    const cats = left.find((g) => g.name === 'categories');
    const prods = left.find((g) => g.name === 'products');
    content = (
      <div className="ap-frame ap-pos">
        <div className="ap-pos-left">
          {cats && (
            <div className="ap-pos-cats ap-comp" data-label="categories">
              {Array.from({ length: 4 }, (_, i) => (
                <span key={i} className="ap-pos-cat">
                  {cats.els.map((e) => (
                    <Text key={e.path} el={e} />
                  ))}
                </span>
              ))}
            </div>
          )}
          {prods && (
            <div className="ap-pos-grid ap-comp" data-label="products">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="card ap-pos-tile">
                  <div className="ap-pos-img" />
                  {prods.els.map((e) => (
                    <Text key={e.path} el={e} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card ap-pos-right">{right.map((g) => renderGroup(g))}</div>
      </div>
    );
  } else if (layout === 'paper' || layout === 'a4') {
    content = <div className={`ap-frame ${layout === 'a4' ? 'ap-a4' : 'ap-paper'}`}>{gs.map((g, i) => [i > 0 && <div key={'d' + i} className="ap-dash" />, renderGroup(g)])}</div>;
  } else if (layout === 'phone') {
    content = (
      <div className="ap-phone">
        <div className="ap-frame ap-phone-screen">{gs.map((g) => (g.name === 'header' || g.name === 'actions' ? renderGroup(g) : <div key={g.key} className="card">{renderGroup(g)}</div>))}</div>
      </div>
    );
  } else if (layout === 'display') {
    content = (
      <div className="ap-frame ap-display">
        {gs.map((g) => (
          <div key={g.key} className="card">
            {renderGroup(g, { repeat: 3 })}
          </div>
        ))}
      </div>
    );
  } else {
    content = (
      <div className="ap-frame ap-desktop">
        {gs.map((g) => (
          <div key={g.key} className="card">
            {renderGroup(g, { repeat: 2 })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <DesignProvider system={system} config={config} live={false} className="ap-preview-root">
      <div className="ap-preview-scale" style={scale !== 1 ? { zoom: scale } : undefined}>
        {els.length ? content : <div className="empty">ไม่มี element ที่ลงทะเบียนสำหรับหน้านี้</div>}
      </div>
    </DesignProvider>
  );
}
