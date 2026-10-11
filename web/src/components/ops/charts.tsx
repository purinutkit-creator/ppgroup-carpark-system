/**
 * Hand-written inline SVG charts (no chart library): grouped columns, a line
 * with area, and an occupancy meter. Marks stay thin with rounded data-ends,
 * grids are recessive, every mark carries a <title> and a hover tooltip.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';

export interface Series {
  name: string;
  color: string;
}

/** Ticks at 1/2/5 × 10^n covering [0, max]. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

const compact = (n: number) =>
  Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="row small" style={{ gap: 14, marginBottom: 4 }}>
      {series.map((s) => (
        <span key={s.name} className="row" style={{ gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: 'inline-block' }} />
          <span className="muted">{s.name}</span>
        </span>
      ))}
    </div>
  );
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 60), width - 60);
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        left,
        top: y,
        transform: 'translate(-50%, calc(-100% - 8px))',
        background: 'var(--color-surface)',
        color: 'var(--color-text)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow)',
        borderRadius: 8,
        padding: '6px 10px',
        fontSize: 12,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 2,
      }}
    >
      {children}
    </div>
  );
}

const PAD = { top: 10, right: 8, bottom: 26, left: 44 };

/** Rounded top corners, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function ColumnChart({
  data,
  series,
  height = 220,
  format = (n: number) => n.toLocaleString('th-TH'),
  labelEvery = 1,
  ariaLabel,
}: {
  data: Array<{ label: string; tooltipLabel?: string; values: number[] }>;
  series: Series[];
  height?: number;
  format?: (n: number) => string;
  labelEvery?: number;
  ariaLabel: string;
}) {
  const width = 720;
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const max = Math.max(0, ...data.flatMap((d) => d.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const band = innerW / Math.max(1, data.length);
  const gap = 2;
  const barW = Math.min(24, Math.max(2, (band * 0.75 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const hd = hover != null ? data[hover] : null;
  const scale = wrap.current ? wrap.current.clientWidth / width : 1;

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <Legend series={series} />
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={ariaLabel} style={{ display: 'block', overflow: 'visible' }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : '2 4'} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)">
              {compact(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = PAD.left + i * band + (band - groupW) / 2;
          return (
            <g key={d.label + i}>
              {hover === i && <rect x={PAD.left + i * band} y={PAD.top} width={band} height={innerH} fill="var(--color-text)" opacity={0.04} />}
              {d.values.map((v, si) => (
                <path key={si} d={columnPath(x0 + si * (barW + gap), y(v), barW, PAD.top + innerH - y(v))} fill={series[si]?.color}>
                  <title>{`${d.tooltipLabel ?? d.label} · ${series[si]?.name}: ${format(v)}`}</title>
                </path>
              ))}
              {i % labelEvery === 0 && (
                <text x={PAD.left + i * band + band / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
                  {d.label}
                </text>
              )}
              <rect x={PAD.left + i * band} y={PAD.top} width={band} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hd && hover != null && (
        <Tooltip x={(PAD.left + hover * band + band / 2) * scale} y={(y(Math.max(...hd.values)) + 18) * scale} width={wrap.current?.clientWidth ?? width}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{hd.tooltipLabel ?? hd.label}</div>
          {series.map((s, si) => (
            <div key={s.name} className="row" style={{ gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
              <span>{s.name}</span>
              <span className="spacer" />
              <b>{format(hd.values[si] ?? 0)}</b>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

export function LineChart({
  data,
  color = 'var(--color-primary)',
  name,
  height = 220,
  format = (n: number) => n.toLocaleString('th-TH'),
  labelEvery = 5,
  ariaLabel,
}: {
  data: Array<{ label: string; tooltipLabel?: string; value: number }>;
  color?: string;
  name: string;
  height?: number;
  format?: (n: number) => string;
  labelEvery?: number;
  ariaLabel: string;
}) {
  const width = 720;
  const [hover, setHover] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const step = data.length > 1 ? innerW / (data.length - 1) : innerW;
  const x = (i: number) => PAD.left + (data.length > 1 ? i * step : innerW / 2);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const line = useMemo(() => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(''), [data, top]); // eslint-disable-line react-hooks/exhaustive-deps
  const area = data.length ? `${line}L${x(data.length - 1)},${PAD.top + innerH}L${x(0)},${PAD.top + innerH}Z` : '';
  const scale = wrap.current ? wrap.current.clientWidth / width : 1;
  const hd = hover != null ? data[hover] : null;
  const gradId = useMemo(() => `lg${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * width;
          const i = Math.round((px - PAD.left) / (step || 1));
          setHover(data.length ? Math.max(0, Math.min(data.length - 1, i)) : null);
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : '2 4'} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-muted)">
              {compact(t)}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={d.label + i}>
            {i % labelEvery === 0 && (
              <text x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
                {d.label}
              </text>
            )}
            <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 0} fill={color} stroke="var(--color-surface)" strokeWidth={2}>
              <title>{`${d.tooltipLabel ?? d.label}: ${format(d.value)}`}</title>
            </circle>
          </g>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--color-muted)" strokeWidth={1} strokeDasharray="3 3" />}
      </svg>
      {hd && hover != null && (
        <Tooltip x={x(hover) * scale} y={(y(hd.value) + 4) * scale} width={wrap.current?.clientWidth ?? width}>
          <div style={{ fontWeight: 600 }}>{hd.tooltipLabel ?? hd.label}</div>
          <div>
            {name}: <b>{format(hd.value)}</b>
          </div>
        </Tooltip>
      )}
    </div>
  );
}

/** Horizontal occupancy meter; turns warning ≥ 85 %, danger ≥ 100 %. */
export function OccupancyBar({ used, capacity, label, el }: { used: number; capacity: number; label: ReactNode; el?: string }) {
  const ratio = capacity > 0 ? used / capacity : 0;
  const color = ratio >= 1 ? 'var(--color-danger)' : ratio >= 0.85 ? 'var(--color-warning)' : 'var(--color-primary)';
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row small" style={{ gap: 8 }}>
        <span data-el={el}>{label}</span>
        <span className="spacer" />
        <span className="num">
          <b>{used.toLocaleString('th-TH')}</b>
          <span className="muted"> / {capacity ? capacity.toLocaleString('th-TH') : '∞'}</span>
          {capacity > 0 && <span className="muted"> · {Math.round(ratio * 100)}%</span>}
        </span>
      </div>
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={capacity || undefined}
        aria-valuenow={used}
        title={`${used} / ${capacity}`}
        style={{ height: 8, borderRadius: 999, background: 'color-mix(in srgb, var(--color-muted) 18%, transparent)', overflow: 'hidden' }}
      >
        <div style={{ width: `${Math.min(100, ratio * 100)}%`, height: '100%', background: color, borderRadius: 999, transition: 'width .3s' }} />
      </div>
    </div>
  );
}
