'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Chart primitives, drawn as plain SVG.
 *
 * No charting library on purpose. This project already dropped deck.gl from
 * the map for bundle weight, and the three forms this dashboard needs —
 * columns, grouped columns, a stacked track — are a few dozen lines of path
 * maths each. Recharts would add ~100kB gzipped (it carries d3-scale, -shape,
 * -array) to buy layout code we would then have to fight to meet the mark
 * specs below: capped bar thickness, 2px surface gaps, hairline grid, labels
 * that are selective rather than on every point.
 *
 * ── Conventions every chart here obeys ──────────────────────────────────
 *
 *  · **Categories run right → left.** The interface is Arabic, so the reading
 *    order is RTL and the *earliest* month sits at the right edge. A time axis
 *    running left→right inside an RTL page reads backwards.
 *  · **Marks carry the colour; text never does.** Series hues live on bars and
 *    swatches; every label, tick and value uses the app's own text tokens. A
 *    mid-lightness hue is illegible as text on either surface.
 *  · **Bars are capped at 24px** and the band's leftover width is air.
 *  · **2px gaps in the surface colour** separate touching marks — never a
 *    stroke drawn around them.
 *  · **Grid and axis are solid hairlines** one step off the surface, never
 *    dashed, and they sit behind the data.
 *  · **Every chart has a table twin.** The tooltip enhances; it never gates a
 *    value. `ChartCard` renders the toggle and the table.
 */

/** Measures the container so the SVG renders at true pixel size — text in a
 *  scaled `viewBox` would grow and shrink with the card. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/**
 * Axis ticks on round numbers (0 / 20 / 40), never on the data's own maxima.
 *
 * The ticks carry every value that is not directly labelled, so they have to
 * be numbers a reader can hold in their head.
 */
function niceTicks(max: number, count = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];

  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step =
    (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;

  /**
   * The axis is extended to the first round step **at or above** `max`, not
   * to the last one below it.
   *
   * Stopping at `max` is the subtle version of this bug: with a max of
   * 25,000,000 and a step of 10,000,000 the ticks ran 0 / 10M / 20M, the top
   * of the scale came out *below* the tallest value, and that column rendered
   * 250px tall inside a 200px plot — straight over the card's header. The
   * scale has to contain the data, so the ceiling is computed from the step
   * rather than discovered by the loop.
   */
  const top = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  // The epsilon keeps the final tick from being dropped by floating-point
  // drift, which would truncate the axis by one step.
  for (let value = 0; value <= top + step * 1e-9; value += step) ticks.push(value);
  return ticks;
}

/** A column: rounded at the data end, square where it meets the baseline. */
function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const radius = Math.min(r, w / 2, h);
  return [
    `M${x},${y + h}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + w - radius},${y}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `L${x + w},${y + h}`,
    'Z',
  ].join(' ');
}

const MAX_BAR = 24;
const PLOT_H = 200;
const AXIS_H = 30;
/** Radix-free hover card, positioned against the chart's own box. */
interface HoverState {
  x: number;
  y: number;
  title: string;
  rows: Array<{ label: string; value: string; color?: string }>;
}

function ChartTooltip({ hover, width }: { hover: HoverState | null; width: number }) {
  if (!hover) return null;
  // Clamped so a tooltip on the first or last band does not hang off the card.
  const left = Math.min(Math.max(hover.x, 78), Math.max(width - 78, 78));
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
      style={{ left, top: Math.max(hover.y - 10, 4), minWidth: '9rem' }}
    >
      <p className="mb-1 font-semibold text-popover-foreground">{hover.title}</p>
      <ul className="space-y-1">
        {hover.rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              {row.color ? (
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: row.color }}
                />
              ) : null}
              {row.label}
            </span>
            <span className="font-medium tabular-nums text-popover-foreground">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface SeriesKey {
  label: string;
  color: string;
}

/**
 * The card every chart sits in: title, optional legend, the plot, and the
 * table twin.
 *
 * The table is not a nicety — it is the WCAG-clean equivalent of the plot, and
 * the reason a hover tooltip is allowed to be the *convenient* way to read a
 * value rather than the only one. It is collapsed by default so it costs no
 * space until asked for, and it is real markup, so it is reachable by keyboard
 * and readable by a screen reader.
 */
export function ChartCard({
  title,
  description,
  icon: Icon,
  series,
  table,
  children,
  className,
}: {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** Omit for a single-series chart — the title already names what is plotted. */
  series?: SeriesKey[];
  table: { columns: string[]; rows: Array<Array<string>> };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex flex-col rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md',
        className,
      )}
    >
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="flex items-center gap-2 font-semibold">
            {Icon ? <Icon className="size-4 shrink-0 text-primary" aria-hidden /> : null}
            {title}
          </h3>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>

        {/* A legend whenever there is more than one series — identity is never
            left to colour-matching alone. One series gets none: the title
            already says what is plotted, and a lone swatch just restates it. */}
        {series && series.length > 1 ? (
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {series.map((entry) => (
              <li
                key={entry.label}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: entry.color }}
                />
                {entry.label}
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <div className="min-w-0 flex-1">{children}</div>

      <details className="group mt-4 border-t pt-3">
        <summary className="cursor-pointer list-none text-xs text-muted-foreground transition-colors hover:text-foreground">
          <span className="group-open:hidden">عرض البيانات كجدول</span>
          <span className="hidden group-open:inline">إخفاء الجدول</span>
        </summary>
        <div className="mt-3 max-h-56 overflow-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-muted-foreground">
                {table.columns.map((column) => (
                  <th key={column} scope="col" className="p-2 text-start font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row[0]} className="border-b last:border-0">
                  {row.map((cell, index) => (
                    <td
                      key={index}
                      className={cn('p-2', index > 0 && 'tabular-nums text-muted-foreground')}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export interface ColumnDatum {
  /** Axis tick text. */
  label: string;
  value: number;
  /** Long-form name used by the tooltip and the table. */
  title?: string;
}

/**
 * Single-series columns — the form for "compare magnitude across an ordered
 * set of buckets".
 *
 * Every column wears the *same* hue. Colouring them by their own height would
 * spend the identity channel re-encoding what the bar length already shows,
 * and a ramp across the lightness band fails the palette checks by design.
 */
export function ColumnChart({
  data,
  color,
  formatValue,
  emphasise = 'max',
  yLabel,
}: {
  data: ColumnDatum[];
  color: string;
  formatValue: (value: number) => string;
  /** Which single column gets a direct label. Labelling all of them is noise. */
  emphasise?: 'max' | 'none';
  yLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  const padStart = 44;
  const padEnd = 8;
  const plotW = Math.max(width - padStart - padEnd, 0);

  const max = Math.max(...data.map((d) => d.value), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const band = data.length > 0 ? plotW / data.length : 0;
  const barW = Math.min(MAX_BAR, Math.max(band - 10, 4));
  // Guarded on length: reducing an empty array with `data[0]` as the seed
  // yields `undefined`, which is not `null` and would throw on `.label` below.
  const peak =
    emphasise === 'max' && data.length > 0
      ? data.reduce((a, b) => (b.value > a.value ? b : a), data[0])
      : null;

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <>
          <svg
            width={width}
            height={PLOT_H + AXIS_H}
            role="img"
            aria-label={yLabel}
            className="overflow-visible"
          >
            {/* Grid first, so the data always sits on top of its chrome. */}
            {ticks.map((tick) => {
              const y = PLOT_H - (tick / top) * PLOT_H;
              return (
                <g key={tick}>
                  <line
                    x1={padEnd}
                    x2={padEnd + plotW}
                    y1={y}
                    y2={y}
                    stroke="hsl(var(--border))"
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    // Ticks sit at the right edge: RTL, so the value axis is
                    // on the side the reader starts from.
                    x={width - 6}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px] tabular-nums"
                  >
                    {formatValue(tick)}
                  </text>
                </g>
              );
            })}

            {data.map((datum, index) => {
              // Right-anchored: index 0 is the rightmost band.
              const bandX = padEnd + plotW - (index + 1) * band;
              const x = bandX + (band - barW) / 2;
              const h = top > 0 ? (datum.value / top) * PLOT_H : 0;
              const y = PLOT_H - h;
              const isPeak = peak !== null && datum.label === peak.label && datum.value > 0;

              return (
                <g key={datum.label}>
                  <path d={columnPath(x, y, barW, h)} fill={color} />

                  {/* Direct label on the one column that carries the story. */}
                  {isPeak ? (
                    <text
                      x={x + barW / 2}
                      y={y - 6}
                      textAnchor="middle"
                      className="fill-foreground text-[10px] font-semibold tabular-nums"
                    >
                      {formatValue(datum.value)}
                    </text>
                  ) : null}

                  <text
                    x={bandX + band / 2}
                    y={PLOT_H + 18}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {datum.label}
                  </text>

                  {/* The hit target is the whole band, not the bar: a 6px-tall
                      column is impossible to hover, and a target smaller than
                      ~24px is a miss waiting to happen. */}
                  <rect
                    x={bandX}
                    y={0}
                    width={Math.max(band, 1)}
                    height={PLOT_H}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${datum.title ?? datum.label}: ${formatValue(datum.value)}`}
                    onMouseEnter={() =>
                      setHover({
                        x: bandX + band / 2,
                        y,
                        title: datum.title ?? datum.label,
                        rows: [{ label: yLabel ?? 'القيمة', value: formatValue(datum.value), color }],
                      })
                    }
                    onFocus={() =>
                      setHover({
                        x: bandX + band / 2,
                        y,
                        title: datum.title ?? datum.label,
                        rows: [{ label: yLabel ?? 'القيمة', value: formatValue(datum.value), color }],
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                    onBlur={() => setHover(null)}
                    className="cursor-pointer outline-none focus-visible:fill-foreground/5"
                  />
                </g>
              );
            })}

            <line
              x1={padEnd}
              x2={padEnd + plotW}
              y1={PLOT_H}
              y2={PLOT_H}
              stroke="hsl(var(--border))"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          </svg>
          <ChartTooltip hover={hover} width={width} />
        </>
      ) : (
        <div style={{ height: PLOT_H + AXIS_H }} />
      )}
    </div>
  );
}

export interface GroupedDatum {
  label: string;
  title?: string;
  values: number[];
}

/**
 * Grouped columns — two series sharing **one** y-axis.
 *
 * One axis is not a stylistic choice: both series here are amounts in the same
 * currency, so they are directly comparable. Two y-scales would let the chart
 * invent a relationship the data does not contain, which is the single most
 * common way a dashboard chart misleads.
 */
export function GroupedColumnChart({
  data,
  series,
  formatValue,
  formatTick,
  yLabel,
}: {
  data: GroupedDatum[];
  series: SeriesKey[];
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
  yLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  const padStart = 44;
  const padEnd = 8;
  const plotW = Math.max(width - padStart - padEnd, 0);

  const max = Math.max(...data.flatMap((d) => d.values), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const band = data.length > 0 ? plotW / data.length : 0;

  // The 2px surface gap between the two bars of a pair is what separates them;
  // never a stroke around each bar.
  const GAP = 2;
  const pairW = Math.min(MAX_BAR * series.length + GAP, Math.max(band - 12, 8));
  const barW = Math.max((pairW - GAP) / series.length, 2);

  return (
    <div ref={ref} className="relative">
      {width > 0 ? (
        <>
          <svg width={width} height={PLOT_H + AXIS_H} role="img" aria-label={yLabel}>
            {ticks.map((tick) => {
              const y = PLOT_H - (tick / top) * PLOT_H;
              return (
                <g key={tick}>
                  <line
                    x1={padEnd}
                    x2={padEnd + plotW}
                    y1={y}
                    y2={y}
                    stroke="hsl(var(--border))"
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={width - 6}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px] tabular-nums"
                  >
                    {formatTick(tick)}
                  </text>
                </g>
              );
            })}

            {data.map((group, index) => {
              const bandX = padEnd + plotW - (index + 1) * band;
              const groupX = bandX + (band - pairW) / 2;

              return (
                <g key={group.label}>
                  {group.values.map((value, seriesIndex) => {
                    const h = top > 0 ? (value / top) * PLOT_H : 0;
                    const y = PLOT_H - h;
                    // Series order mirrors too, so the first series stays on
                    // the reader's starting (right) side within each pair.
                    const x =
                      groupX + (series.length - 1 - seriesIndex) * (barW + GAP);
                    return (
                      <path
                        key={seriesIndex}
                        d={columnPath(x, y, barW, h)}
                        fill={series[seriesIndex].color}
                      />
                    );
                  })}

                  <text
                    x={bandX + band / 2}
                    y={PLOT_H + 18}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {group.label}
                  </text>

                  <rect
                    x={bandX}
                    y={0}
                    width={Math.max(band, 1)}
                    height={PLOT_H}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${group.title ?? group.label}: ${group.values
                      .map((value, i) => `${series[i].label} ${formatValue(value)}`)
                      .join('، ')}`}
                    onMouseEnter={() =>
                      setHover({
                        x: bandX + band / 2,
                        y: PLOT_H - (Math.max(...group.values) / top) * PLOT_H,
                        title: group.title ?? group.label,
                        rows: group.values.map((value, i) => ({
                          label: series[i].label,
                          value: formatValue(value),
                          color: series[i].color,
                        })),
                      })
                    }
                    onFocus={() =>
                      setHover({
                        x: bandX + band / 2,
                        y: PLOT_H - (Math.max(...group.values) / top) * PLOT_H,
                        title: group.title ?? group.label,
                        rows: group.values.map((value, i) => ({
                          label: series[i].label,
                          value: formatValue(value),
                          color: series[i].color,
                        })),
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                    onBlur={() => setHover(null)}
                    className="cursor-pointer outline-none focus-visible:fill-foreground/5"
                  />
                </g>
              );
            })}

            <line
              x1={padEnd}
              x2={padEnd + plotW}
              y1={PLOT_H}
              y2={PLOT_H}
              stroke="hsl(var(--border))"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          </svg>
          <ChartTooltip hover={hover} width={width} />
        </>
      ) : (
        <div style={{ height: PLOT_H + AXIS_H }} />
      )}
    </div>
  );
}

export interface StackSegment {
  label: string;
  value: number;
  color: string;
  /** Rendered beside the label in the breakdown list — status never colour-alone. */
  icon?: React.ComponentType<{ className?: string }>;
}

/**
 * A horizontal part-to-whole track, with its breakdown listed beneath.
 *
 * Chosen over a doughnut deliberately. The categories here are Arabic status
 * names — «قيد المراجعة», «تم التحقق» — which do not fit around a ring without
 * leader lines, and the reader's actual job is comparing segment sizes, which
 * a pie makes harder than a bar for anything but the most lopsided splits. The
 * track doubles as the progress meter the brief asked for.
 *
 * Segments are separated by a 2px gap in the surface colour and the whole
 * track is clipped to one rounded rectangle, so the ends are round and the
 * joins are clean without a stroke around any segment.
 */
export function StackedTrack({
  segments,
  total,
  formatValue,
}: {
  segments: StackSegment[];
  total: number;
  formatValue: (value: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = React.useState<HoverState | null>(null);

  const H = 28;
  const GAP = 2;
  const shown = segments.filter((segment) => segment.value > 0);
  const clipId = React.useId();

  /**
   * Whether the segments actually account for the whole.
   *
   * When they do, the last one runs to the far edge so the accumulated 2px
   * gaps come out of the segments rather than leaving a stub of empty track.
   * When they *don't* — a status outside the known set, a total counted from a
   * different query — the remainder has to stay visible as bare track. Letting
   * the last segment absorb an unexplained difference would silently
   * misreport it as belonging to that category.
   */
  const accounted = shown.reduce((sum, segment) => sum + segment.value, 0);
  const complete = total > 0 && accounted === total;

  let cursor = 0;
  const placed = shown.map((segment, index) => {
    const raw = total > 0 ? (segment.value / total) * width : 0;
    const isLast = index === shown.length - 1;
    const w = isLast && complete ? Math.max(width - cursor, 0) : Math.max(raw - GAP, 0);
    // Right-anchored, matching every other chart on this page.
    const x = width - cursor - w;
    cursor += w + GAP;
    return { ...segment, x, w };
  });

  return (
    <div className="space-y-4">
      <div ref={ref} className="relative">
        {width > 0 ? (
          <>
            <svg width={width} height={H} role="img" aria-label="توزيع حالات الطلبات">
              <defs>
                <clipPath id={clipId}>
                  <rect x={0} y={0} width={width} height={H} rx={6} />
                </clipPath>
              </defs>
              <g clipPath={`url(#${clipId})`}>
                <rect x={0} y={0} width={width} height={H} className="fill-muted" />
                {placed.map((segment) => (
                  <rect
                    key={segment.label}
                    x={segment.x}
                    y={0}
                    width={segment.w}
                    height={H}
                    fill={segment.color}
                  />
                ))}
              </g>

              {/* Hit targets sit above the clip so a 3px segment is still
                  reachable — each is widened to a usable minimum. */}
              {placed.map((segment) => {
                const hitW = Math.max(segment.w, 24);
                const hitX = Math.min(segment.x, width - hitW);
                return (
                  <rect
                    key={`hit-${segment.label}`}
                    x={Math.max(hitX, 0)}
                    y={0}
                    width={hitW}
                    height={H}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${segment.label}: ${formatValue(segment.value)}`}
                    onMouseEnter={() =>
                      setHover({
                        x: segment.x + segment.w / 2,
                        y: 0,
                        title: segment.label,
                        rows: [
                          { label: 'العدد', value: formatValue(segment.value), color: segment.color },
                          {
                            label: 'النسبة',
                            value: `${total > 0 ? Math.round((segment.value / total) * 100) : 0}%`,
                          },
                        ],
                      })
                    }
                    onMouseLeave={() => setHover(null)}
                    onBlur={() => setHover(null)}
                    className="cursor-pointer outline-none"
                  />
                );
              })}
            </svg>
            <ChartTooltip hover={hover} width={width} />
          </>
        ) : (
          <div style={{ height: H }} />
        )}
      </div>

      {/*
        The breakdown doubles as the legend and as the direct labels the track
        itself has no room for — an interior segment has no free end to hang a
        label off, so the value lives here instead of being clipped inside a
        3px sliver.
      */}
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {segments.map((segment) => {
          const Icon = segment.icon;
          return (
            <li key={segment.label} className="flex items-center justify-between gap-3 text-sm">
              <span className="inline-flex min-w-0 items-center gap-2 text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: segment.color }}
                />
                {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
                <span className="truncate">{segment.label}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {formatValue(segment.value)}
                <span className="ms-1.5 text-xs text-muted-foreground">
                  {total > 0 ? Math.round((segment.value / total) * 100) : 0}%
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
