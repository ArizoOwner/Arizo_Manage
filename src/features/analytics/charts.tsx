// Custom SVG charts (no chart dependency: the CSP forbids remote assets and inline scripts, and these
// stay small). Every chart has a text alternative (role="img" + aria-label, plus a table in Analytics),
// blurs with the global privacy switch, and uses the AA-safe tokens. Scrubbing: pointer drag moves a
// crosshair + glass tooltip and fires haptic.tick() whenever the index changes; arrow keys do the same.
import { useReducedMotion } from 'framer-motion';
import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { usePrivacy } from '../../app/stores/privacy';
import { haptic } from '../../core/motion/motion';

const W = 340;

/** Map bigint values to y pixels. Display only: positions are floats, money is not. */
function scaleY(values: bigint[], h: number, pad = 8, fromZero = true) {
  let lo = fromZero ? 0n : (values[0] ?? 0n);
  let hi = fromZero ? 0n : (values[0] ?? 0n);
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi === lo) hi = lo + 1n;
  const span = Number(hi - lo);
  return { y: (v: bigint) => pad + (h - 2 * pad) * (1 - Number(v - lo) / span), zero: pad + (h - 2 * pad) * (1 - Number(-lo) / span) };
}

function useScrub(n: number, rtl: boolean) {
  const [i, setI] = useState<number | null>(null);
  const last = useRef<number | null>(null);
  const set = (next: number | null) => {
    if (next !== null && next !== last.current) haptic.tick();
    last.current = next;
    setI(next);
  };
  const fromPointer = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    let f = (e.clientX - r.left) / r.width;
    if (rtl) f = 1 - f;
    set(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
  };
  return {
    i,
    handlers: {
      onPointerDown: (e: PointerEvent<SVGSVGElement>) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        fromPointer(e);
      },
      onPointerMove: (e: PointerEvent<SVGSVGElement>) => {
        if (e.buttons || e.pointerType === 'mouse') fromPointer(e);
      },
      // A finger "leaves" the moment it lifts, so on touch the reading stays until the next tap.
      onPointerLeave: (e: PointerEvent<SVGSVGElement>) => e.pointerType === 'mouse' && set(null),
      onPointerCancel: () => set(null),
      onKeyDown: (e: KeyboardEvent<SVGSVGElement>) => {
        const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
        const back = rtl ? 'ArrowRight' : 'ArrowLeft';
        if (e.key !== fwd && e.key !== back && e.key !== 'Escape') return;
        e.preventDefault();
        if (e.key === 'Escape') return set(null);
        const cur = last.current ?? (e.key === fwd ? -1 : n);
        set(Math.max(0, Math.min(n - 1, cur + (e.key === fwd ? 1 : -1))));
      },
      onBlur: () => set(null),
    },
  };
}

/** Glass tooltip over the scrub position (x in visual px of the W-wide viewBox). */
function Tooltip({ x, children }: { x: number; children: ReactNode }) {
  const hidden = usePrivacy((s) => s.hidden);
  const left = Math.max(22, Math.min(78, (x / W) * 100));
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-2xl border border-specular bg-glass px-3 py-2 text-[12px] whitespace-nowrap shadow-[var(--arizo-shadow)] backdrop-blur-[20px] ${hidden ? 'blur-[10px]' : ''}`}
      style={{ left: `${left}%` }}
      data-testid="chart-tooltip"
    >
      {children}
    </div>
  );
}

/** Monotone cubic (Fritsch–Carlson): the spline never invents a dip or peak between points. */
export function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  const dx = xs.slice(1).map((x, k) => x - xs[k]!);
  const m = ys.slice(1).map((y, k) => (y - ys[k]!) / dx[k]!);
  const t = ys.map((_, k) => (k === 0 ? m[0]! : k === n - 1 ? m[n - 2]! : m[k - 1]! * m[k]! <= 0 ? 0 : (m[k - 1]! + m[k]!) / 2));
  for (let k = 0; k < n - 1; k++) {
    if (m[k] === 0) {
      t[k] = 0;
      t[k + 1] = 0;
      continue;
    }
    const a = t[k]! / m[k]!;
    const b = t[k + 1]! / m[k]!;
    const h = a * a + b * b;
    if (h > 9) {
      const s = 3 / Math.sqrt(h);
      t[k] = s * a * m[k]!;
      t[k + 1] = s * b * m[k]!;
    }
  }
  let d = `M${xs[0]!.toFixed(1)},${ys[0]!.toFixed(1)}`;
  for (let k = 0; k < n - 1; k++) {
    const h = dx[k]! / 3;
    d += ` C${(xs[k]! + h).toFixed(1)},${(ys[k]! + h * t[k]!).toFixed(1)} ${(xs[k + 1]! - h).toFixed(1)},${(ys[k + 1]! - h * t[k + 1]!).toFixed(1)} ${xs[k + 1]!.toFixed(1)},${ys[k + 1]!.toFixed(1)}`;
  }
  return d;
}

export interface BarGroup {
  label: string;
  income: bigint;
  expense: bigint;
  net: bigint;
  lines: [string, string, string];
}

/** Cashflow: grouped income/expense columns per month plus a savings (net) line, scrubbable. */
export function CashflowBars({ groups, label, rtl, legend }: { groups: BarGroup[]; label: string; rtl: boolean; legend: [string, string, string] }) {
  const H = 160;
  const { i, handlers } = useScrub(groups.length, rtl);
  const hidden = usePrivacy((s) => s.hidden);
  if (!groups.length) return null;
  const s = scaleY(groups.flatMap((g) => [g.income, g.expense, g.net]), H);
  const slot = W / groups.length;
  const bw = Math.min(16, slot / 3);
  const cx = (k: number) => slot * k + slot / 2;
  const net = groups.map((g, k) => `${k ? 'L' : 'M'}${cx(k).toFixed(1)},${s.y(g.net).toFixed(1)}`).join(' ');
  const bar = (x: number, v: bigint, fill: string) => {
    const y = s.y(v);
    const top = Math.min(y, s.zero);
    const h = Math.max(1, Math.abs(s.zero - y));
    return <path d={roundedEnd(x, top, bw, h, v >= 0n)} fill={fill} />;
  };
  const sel = i === null ? null : groups[i]!;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative pt-20">
        {sel && i !== null && (
          <Tooltip x={rtl ? W - cx(i) : cx(i)}>
            <div className="font-semibold text-ink">{sel.label}</div>
            {sel.lines.map((l, k) => (
              <div key={k} className="text-ink-2 tabular">
                {l}
              </div>
            ))}
          </Tooltip>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className={`block h-auto w-full touch-none outline-none focus-visible:outline-2 focus-visible:outline-azure ${rtl ? '-scale-x-100' : ''} ${hidden ? 'blur-[10px]' : ''}`} role="img" aria-label={label} tabIndex={0} data-testid="cashflow-chart" {...handlers}>
          {i !== null && <rect x={slot * i} y="0" width={slot} height={H} fill="var(--arizo-surface-3)" opacity="0.6" />}
          <line x1="0" x2={W} y1={s.zero} y2={s.zero} stroke="var(--arizo-border-highlight)" strokeWidth="1" />
          {groups.map((g, k) => (
            <g key={k}>
              {bar(cx(k) - bw - 1, g.income, 'var(--arizo-cta-primary)')}
              {bar(cx(k) + 1, g.expense, 'var(--arizo-cta-outflow)')}
            </g>
          ))}
          <path d={net} fill="none" stroke="var(--arizo-luxury-mark)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {groups.map((g, k) => (
            <circle key={k} cx={cx(k)} cy={s.y(g.net)} r="4" fill="var(--arizo-luxury-mark)" stroke="var(--arizo-surface-1)" strokeWidth="2" />
          ))}
        </svg>
      </div>
      <div className="flex text-[11px] text-ink-2" aria-hidden="true">
        {groups.map((g, k) => (
          <span key={k} className="min-w-0 flex-1 truncate text-center">
            {g.label}
          </span>
        ))}
      </div>
      <Legend items={[['var(--arizo-cta-primary)', legend[0]], ['var(--arizo-cta-outflow)', legend[1]], ['var(--arizo-luxury-mark)', legend[2]]]} />
    </div>
  );
}

/** Column with a 4px rounded data end, square at the baseline. */
function roundedEnd(x: number, y: number, w: number, h: number, up: boolean): string {
  const r = Math.min(4, w / 2, h);
  if (up) return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
  return `M${x},${y} V${y + h - r} Q${x},${y + h} ${x + r},${y + h} H${x + w - r} Q${x + w},${y + h} ${x + w},${y + h - r} V${y} Z`;
}

export function Legend({ items }: { items: [color: string, text: string][] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">
      {items.map(([c, t]) => (
        <li key={t} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />
          {t}
        </li>
      ))}
    </ul>
  );
}

export interface DonutSlice {
  id: string;
  value: bigint;
  color: string;
}

/** Donut with a 2px surface gap between slices; tapping a slice drills down (the legend rows do too). */
export function Donut({ slices, label, center, onSelect, selected }: { slices: DonutSlice[]; label: string; center: ReactNode; onSelect: (id: string) => void; selected: string | null }) {
  const total = slices.reduce((s, x) => s + x.value, 0n);
  const hidden = usePrivacy((s) => s.hidden);
  if (total <= 0n) return null;
  const R = 80;
  const r = 56;
  let acc = 0;
  const arcs = slices.map((x) => {
    const f = Number((x.value * 1_000_000n) / total) / 1_000_000;
    const a0 = acc * 2 * Math.PI;
    acc += f;
    return { ...x, a0, a1: acc * 2 * Math.PI };
  });
  const pt = (rad: number, a: number) => [(90 + rad * Math.sin(a)).toFixed(2), (90 - rad * Math.cos(a)).toFixed(2)] as const;
  return (
    <div className="relative mx-auto h-[180px] w-[180px]">
      <svg viewBox="0 0 180 180" className={`h-full w-full ${hidden ? 'blur-[10px]' : ''}`} role="img" aria-label={label} data-testid="donut">
        {arcs.map((x) => {
          const dim = selected && selected !== x.id ? 0.35 : 1;
          if (x.a1 - x.a0 >= 2 * Math.PI - 1e-6) return <circle key={x.id} cx="90" cy="90" r={(R + r) / 2} fill="none" stroke={x.color} strokeWidth={R - r} opacity={dim} />;
          const big = x.a1 - x.a0 > Math.PI ? 1 : 0;
          const [x0, y0] = pt(R, x.a0);
          const [x1, y1] = pt(R, x.a1);
          const [x2, y2] = pt(r, x.a1);
          const [x3, y3] = pt(r, x.a0);
          return (
            <path
              key={x.id}
              d={`M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3} Z`}
              fill={x.color}
              stroke="var(--arizo-surface-1)"
              strokeWidth="2"
              opacity={dim}
              className="cursor-pointer"
              onClick={() => {
                haptic.tick();
                onSelect(x.id);
              }}
            />
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center px-10 text-center">{center}</div>
    </div>
  );
}

export interface HeatCell {
  day: number | null;
  value: bigint;
  label: string;
  start: number;
}

/** Daily spending calendar: one sequential hue (coral), 4 shades on a square-root scale, blanks before day 1. */
export function Heatmap({ cells, weekdays, label, onPick, picked, digits }: { cells: HeatCell[]; weekdays: string[]; label: string; onPick: (c: HeatCell) => void; picked: number | null; digits: (n: number) => string }) {
  const hidden = usePrivacy((s) => s.hidden);
  let max = 0n;
  for (const c of cells) if (c.value > max) max = c.value;
  // Square-root steps: one rent day must not flatten every other day into the lightest shade (display only).
  const step = (v: bigint) => (v <= 0n || max === 0n ? 0 : Math.max(1, Math.ceil(4 * Math.sqrt(Number(v) / Number(max)))));
  const OPACITY = [0, 0.22, 0.42, 0.66, 1];
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5" data-testid="heatmap">
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-ink-2" aria-hidden="true">
        {weekdays.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((c, k) =>
          c.day === null ? (
            <span key={k} />
          ) : (
            <button
              key={k}
              type="button"
              aria-label={hidden ? digits(c.day) : c.label}
              aria-pressed={picked === c.start}
              onClick={() => {
                haptic.tick();
                onPick(c);
              }}
              className={`relative grid aspect-square min-h-9 place-items-center rounded-lg bg-surface-3 text-[11px] text-ink-2 focus-visible:outline-2 focus-visible:outline-azure ${picked === c.start ? 'ring-2 ring-gold-mark' : ''}`}
            >
              <span aria-hidden="true" className={`absolute inset-0 rounded-lg bg-coral ${hidden ? 'opacity-0!' : ''}`} style={{ opacity: OPACITY[step(c.value)] }} />
              <span className={`relative ${!hidden && step(c.value) >= 3 ? 'font-bold text-on-accent' : ''}`}>{digits(c.day)}</span>
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/** Burn-rate ring: fill = share used (cta → amber → danger), ticks on each alert threshold below 100. */
export function Ring({ pct, thresholds, size = 64, label, higherIsBetter }: { pct: number; thresholds: number[]; size?: number; label: string; higherIsBetter?: boolean }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const color = higherIsBetter
    ? pct >= 70
      ? 'var(--arizo-cta-primary)'
      : pct >= 40
        ? 'var(--arizo-accent-warning)'
        : 'var(--arizo-cta-outflow)'
    : pct >= 100
      ? 'var(--arizo-cta-outflow)'
      : pct >= 80
        ? 'var(--arizo-accent-warning)'
        : 'var(--arizo-cta-primary)';
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={label} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--arizo-surface-3)" strokeWidth="6" />
      {clamped > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${((clamped / 100) * c).toFixed(2)} ${c.toFixed(2)}`} />}
      {thresholds
        .filter((t) => t < 100)
        .map((t) => {
          const a = (t / 100) * 2 * Math.PI;
          return <line key={t} x1={size / 2 + (r - 4) * Math.cos(a)} y1={size / 2 + (r - 4) * Math.sin(a)} x2={size / 2 + (r + 4) * Math.cos(a)} y2={size / 2 + (r + 4) * Math.sin(a)} stroke="var(--arizo-surface-1)" strokeWidth="2" />;
        })}
    </svg>
  );
}

export interface WorthPoint {
  at: number;
  value: bigint;
}

/**
 * Net worth trajectory (rebuilt): y-axis labels, month ticks, the start level as a dashed baseline,
 * high and low markers, gain/loss tint, and a tooltip with that day's value and change vs the day before.
 * Display geometry is float; every number shown is formatted from the bigint by the caller.
 */
export function NetWorthChart({
  points,
  label,
  rtl,
  fmt,
  compact,
  dayLabel,
  tickLabel,
  testId,
}: {
  points: WorthPoint[];
  label: string;
  rtl: boolean;
  fmt: (v: bigint) => string;
  compact: (v: bigint) => string;
  dayLabel: (at: number) => string;
  /** Month name for an x tick, or null when `at` does not start a new month. */
  tickLabel: (prevAt: number | null, at: number) => string | null;
  testId?: string;
}) {
  const H = 190;
  const PAD = 14;
  const gid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { i, handlers } = useScrub(points.length, rtl);
  const reduce = useReducedMotion();
  const hidden = usePrivacy((s) => s.hidden);
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const s = scaleY(vals, H, PAD, false);
  const xs = points.map((_, k) => (k / (points.length - 1)) * W);
  const ys = points.map((p) => s.y(p.value));
  const d = monotonePath(xs, ys);
  let hiK = 0;
  let loK = 0;
  vals.forEach((v, k) => {
    if (v > vals[hiK]!) hiK = k;
    if (v < vals[loK]!) loK = k;
  });
  const up = vals.at(-1)! >= vals[0]!;
  const tone = up ? 'var(--arizo-accent-primary)' : 'var(--arizo-accent-outflow)';
  const baseY = ys[0]!;
  // Only real month boundaries, and none crowded against an edge (the labels would overlap).
  const ticks = points.map((p, k) => ({ k, t: k ? tickLabel(points[k - 1]!.at, p.at) : null })).filter((x) => x.t && xs[x.k]! > W * 0.08 && xs[x.k]! < W * 0.92);
  const gridVals = [0, 0.5, 1].map((f) => {
    const v = vals[loK]! + BigInt(Math.round(Number(vals[hiK]! - vals[loK]!) * f));
    return { v, y: s.y(v) };
  });
  const sel = i === null ? null : { x: xs[i]!, y: ys[i]!, p: points[i]!, prev: i > 0 ? points[i - 1]! : null };
  const vx = (x: number) => `${(((rtl ? W - x : x) / W) * 100).toFixed(2)}%`;
  const vy = (y: number) => `${y.toFixed(1)}px`;
  const dot = (x: number, y: number, cls: string, key: string) => (
    <span key={key} aria-hidden="true" className={`pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface-1 ${cls} ${hidden ? 'blur-[6px]' : ''}`} style={{ left: vx(x), top: vy(y) }} />
  );
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <div className="relative pt-16">
        {sel && (
          <Tooltip x={rtl ? W - sel.x : sel.x}>
            <div className="text-ink-2">{dayLabel(sel.p.at)}</div>
            <div className="text-[14px] font-bold text-ink tabular">{fmt(sel.p.value)}</div>
            {sel.prev && sel.p.value !== sel.prev.value && (
              <div className={`tabular ${sel.p.value > sel.prev.value ? 'text-emerald-text' : 'text-coral-text'}`} data-testid="networth-daydelta">
                {sel.p.value > sel.prev.value ? '▲ ' : '▼ '}
                {fmt(sel.p.value > sel.prev.value ? sel.p.value - sel.prev.value : sel.prev.value - sel.p.value)}
              </div>
            )}
          </Tooltip>
        )}
        <div className="relative" style={{ height: H }}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className={`absolute inset-0 block h-full w-full touch-none outline-none focus-visible:outline-2 focus-visible:outline-azure ${rtl ? '-scale-x-100' : ''} ${hidden ? 'blur-[10px]' : ''}`}
            role="img"
            aria-label={label}
            tabIndex={0}
            {...handlers}
          >
            <defs>
              <linearGradient id={`a${gid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
                <stop offset="100%" stopColor={tone} stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`l${gid}`} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--arizo-luxury-mark)" />
                <stop offset="100%" stopColor={tone} />
              </linearGradient>
            </defs>
            {gridVals.map((g) => (
              <line key={g.y} x1="0" x2={W} y1={g.y} y2={g.y} stroke="var(--arizo-border-subtle)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {ticks.map(({ k }) => (
              <line key={k} x1={xs[k]} x2={xs[k]} y1={PAD} y2={H} stroke="var(--arizo-border-subtle)" strokeWidth="1" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
            ))}
            <line x1="0" x2={W} y1={baseY} y2={baseY} stroke="var(--arizo-text-secondary)" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" data-testid="networth-baseline" />
            <path d={`${d} L${W},${H} L0,${H} Z`} fill={`url(#a${gid})`} className={reduce ? '' : 'arizo-fade'} />
            <path d={d} fill="none" stroke={`url(#l${gid})`} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" pathLength={1} className={reduce ? '' : 'arizo-draw'} />
            {sel && <line x1={sel.x} x2={sel.x} y1="0" y2={H} stroke="var(--arizo-text-secondary)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          </svg>
          {/* Markers and axis text live outside the stretched SVG so they stay round and readable. */}
          {hiK !== loK && dot(xs[hiK]!, ys[hiK]!, 'bg-emerald', 'hi')}
          {hiK !== loK && dot(xs[loK]!, ys[loK]!, 'bg-coral', 'lo')}
          {dot(sel ? sel.x : xs.at(-1)!, sel ? sel.y : ys.at(-1)!, `bg-gold-mark ${sel || reduce ? '' : 'arizo-pulse'}`, 'cur')}
          <div aria-hidden="true" className={`pointer-events-none absolute inset-y-0 start-0 flex flex-col text-[10px] text-ink-2 tabular ${hidden ? 'blur-[6px]' : ''}`}>
            {gridVals.map((g) => (
              <span key={g.y} className="absolute start-1 -translate-y-full whitespace-nowrap rounded bg-surface-1/70 px-1" style={{ top: vy(g.y) }}>
                {compact(g.v)}
              </span>
            ))}
          </div>
        </div>
        <div aria-hidden="true" className="relative h-4 text-[10px] text-ink-2">
          {ticks.map(({ k, t }) => (
            <span key={k} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: vx(xs[k]!) }}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
