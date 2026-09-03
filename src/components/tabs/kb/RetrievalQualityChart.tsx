/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { EVAL_SETS } from '../../../constants/evalResults';

/**
 * Top-5 hit rate, hybrid vs keyword-only, per labelled eval set.
 *
 * Inline SVG on purpose: the app carries no charting library (see the absence of
 * any chart dep in package.json), and a single grouped bar chart does not justify
 * adding one. Colours come from the theme's CSS variables via Tailwind `fill-*`
 * utilities so the chart tracks light/dark like everything else.
 *
 * hit@5 is the metric shown because it is the one the eval write-up leads on: did
 * the right document land somewhere in the five results a user actually sees. The
 * gap between the two bars in each group is the case for semantic retrieval.
 */

const pct = (v: number) => `${Math.round(v * 100)}%`;

// viewBox geometry. Fixed user-space; the SVG scales to its container width.
const W = 460;
const H = 240;
const PAD = { top: 16, right: 12, bottom: 44, left: 34 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const BASELINE_Y = PAD.top + PLOT_H;
const BAR_W = 34;
const BAR_GAP = 8;

const GRID = [0, 0.25, 0.5, 0.75, 1];

export const RetrievalQualityChart: React.FC = () => {
  const groupW = PLOT_W / EVAL_SETS.length;
  const barsW = BAR_W * 2 + BAR_GAP;
  const barsOffset = (groupW - barsW) / 2;

  const y = (v: number) => BASELINE_Y - v * PLOT_H;

  const titleId = 'retrieval-quality-title';
  const descId = 'retrieval-quality-desc';
  const summary = EVAL_SETS.map(
    (s) => `${s.label}: hybrid ${pct(s.hybrid.hitAt5)}, keyword-only ${pct(s.lexical.hitAt5)}`
  ).join('. ');

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>Top-5 hit rate by retrieval mode, per eval set</title>
        <desc id={descId}>
          {`Share of queries whose expected document appears in the top 5 results. ${summary}.`}
        </desc>

        {/* Horizontal gridlines + y-axis percentage labels */}
        {GRID.map((g) => (
          <g key={g}>
            <line
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={y(g)}
              y2={y(g)}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 6}
              y={y(g)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-slate-400 dark:fill-slate-500"
              style={{ fontSize: 9, fontFamily: 'monospace' }}
            >
              {pct(g)}
            </text>
          </g>
        ))}

        {EVAL_SETS.map((set, i) => {
          const gx = PAD.left + i * groupW;
          const hybridX = gx + barsOffset;
          const lexicalX = hybridX + BAR_W + BAR_GAP;
          const bars = [
            { x: hybridX, v: set.hybrid.hitAt5, cls: 'fill-brand-600 dark:fill-brand-500' },
            { x: lexicalX, v: set.lexical.hitAt5, cls: 'fill-slate-300 dark:fill-slate-600' },
          ];
          return (
            <g key={set.id}>
              {bars.map((b, bi) => (
                <g key={bi}>
                  <rect
                    x={b.x}
                    y={y(b.v)}
                    width={BAR_W}
                    height={Math.max(0, BASELINE_Y - y(b.v))}
                    className={b.cls}
                    rx={1}
                  />
                  <text
                    x={b.x + BAR_W / 2}
                    y={y(b.v) - 4}
                    textAnchor="middle"
                    className="fill-slate-700 dark:fill-slate-200"
                    style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace' }}
                  >
                    {pct(b.v)}
                  </text>
                </g>
              ))}
              {/* Set label under the group */}
              <text
                x={gx + groupW / 2}
                y={BASELINE_Y + 15}
                textAnchor="middle"
                className="fill-slate-600 dark:fill-slate-300"
                style={{ fontSize: 10, fontWeight: 600 }}
              >
                {set.label}
              </text>
              <text
                x={gx + groupW / 2}
                y={BASELINE_Y + 28}
                textAnchor="middle"
                className="fill-slate-400 dark:fill-slate-500"
                style={{ fontSize: 8 }}
              >
                {`n=${set.queries}`}
              </text>
            </g>
          );
        })}

        {/* Baseline axis */}
        <line
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={BASELINE_Y}
          y2={BASELINE_Y}
          className="stroke-slate-300 dark:stroke-slate-700"
          strokeWidth={1}
        />
      </svg>

      {/* Legend — HTML for crisp text rendering */}
      <figcaption className="mt-2 flex items-center justify-center gap-5 text-3xs font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-xs bg-brand-600 dark:bg-brand-500" aria-hidden="true" />
          Hybrid (BM25 + vector)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-xs bg-slate-300 dark:bg-slate-600" aria-hidden="true" />
          Keyword-only
        </span>
      </figcaption>
    </figure>
  );
};
