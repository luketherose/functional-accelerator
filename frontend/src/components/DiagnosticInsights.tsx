/**
 * DiagnosticInsights
 *
 * Answers specific analytical questions directly from cluster trend data.
 * Each card states the question, gives a data-driven answer, and shows
 * a mini sparkline so the user can see the trajectory at a glance.
 *
 * Requires at least 2 completed runs to produce meaningful insights.
 */

import type { ClusterTrendData, ClusterTrendSeries } from '../types';
import { TrendingUp, TrendingDown, AlertTriangle, Zap, Target, Minus } from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lastDelta(series: ClusterTrendSeries): number {
  const pts = series.points;
  if (pts.length < 2) return 0;
  return pts[pts.length - 1].defectCount - pts[pts.length - 2].defectCount;
}

function totalDelta(series: ClusterTrendSeries): number {
  const pts = series.points;
  if (pts.length < 2) return 0;
  return pts[pts.length - 1].defectCount - pts[0].defectCount;
}

function latestCount(series: ClusterTrendSeries): number {
  return series.points[series.points.length - 1]?.defectCount ?? 0;
}

function latestRiskScore(series: ClusterTrendSeries): number {
  return series.points[series.points.length - 1]?.riskScore ?? 0;
}

/** Mini SVG sparkline — 48×20px */
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const W = 48, H = 20;
  const coords = points.map((v, i) => {
    const x = (i / (points.length - 1)) * W;
    const y = H - (v / max) * H;
    return `${x},${y}`;
  });
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* last point dot */}
      {(() => {
        const last = coords[coords.length - 1].split(',');
        return <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />;
      })()}
    </svg>
  );
}

// ─── Individual insight card ──────────────────────────────────────────────────

interface InsightCardProps {
  icon: React.ReactNode;
  question: string;
  clusterName: string;
  answer: string;
  detail?: string;
  sparkPoints: number[];
  sparkColor: string;
  accentClass: string; // tailwind border + bg class
}

function InsightCard({ icon, question, clusterName, answer, detail, sparkPoints, sparkColor, accentClass }: InsightCardProps) {
  return (
    <div className={`rounded-xl border p-3.5 flex flex-col gap-2 ${accentClass}`}>
      {/* Question header */}
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">
        {icon}
        {question}
      </div>

      {/* Answer */}
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-text-primary leading-tight truncate">{clusterName}</p>
          <p className="text-xs text-text-secondary mt-0.5">{answer}</p>
          {detail && <p className="text-[11px] text-text-muted mt-1">{detail}</p>}
        </div>
        <Sparkline points={sparkPoints} color={sparkColor} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DiagnosticInsightsProps {
  data: ClusterTrendData;
}

export default function DiagnosticInsights({ data }: DiagnosticInsightsProps) {
  const { runs, clusters } = data;

  // Need at least 2 runs for delta-based insights
  const hasDelta = runs.length >= 2;

  // Filter out "other" cluster and empty clusters
  const active = clusters.filter(c => c.clusterKey !== 'other' && latestCount(c) > 0);

  if (active.length === 0) return null;

  // ── Compute answers ────────────────────────────────────────────────────────

  // "Which area is getting worse?" — highest positive delta vs previous run
  const byLastDelta = [...active].sort((a, b) => lastDelta(b) - lastDelta(a));
  const worst = byLastDelta[0];
  const worstDelta = lastDelta(worst);

  // "Which area improved?" — most negative delta
  const byImprovement = [...active].sort((a, b) => lastDelta(a) - lastDelta(b));
  const best = byImprovement[0];
  const bestDelta = lastDelta(best);

  // "Where is risk concentrated?" — highest risk score in latest run
  const byRisk = [...active].sort((a, b) => latestRiskScore(b) - latestRiskScore(a));
  const riskiest = byRisk[0];

  // "What's newly emerged?" — largest proportional growth over all runs
  const byGrowth = [...active]
    .filter(c => c.points[0]?.defectCount === 0 || totalDelta(c) > 0)
    .sort((a, b) => {
      const growA = (c: ClusterTrendSeries) => c.points[0]?.defectCount === 0 ? Infinity : totalDelta(c) / (c.points[0]?.defectCount || 1);
      return growA(b) - growA(a);
    });
  const emerged = byGrowth[0];

  // ── Build cards ────────────────────────────────────────────────────────────

  const cards: InsightCardProps[] = [];

  // 1. Getting worse
  if (hasDelta && worstDelta > 0) {
    cards.push({
      icon: <TrendingUp size={11} />,
      question: 'Which area is getting worse?',
      clusterName: worst.clusterName,
      answer: `+${worstDelta} defect${worstDelta !== 1 ? 's' : ''} vs previous run`,
      detail: `Now at ${latestCount(worst)} total — highest growth this sprint`,
      sparkPoints: worst.points.map(p => p.defectCount),
      sparkColor: '#ef4444',
      accentClass: 'border-red-200 bg-red-50/60',
    });
  } else if (hasDelta && worstDelta === 0) {
    cards.push({
      icon: <Minus size={11} />,
      question: 'Which area is getting worse?',
      clusterName: 'No regression detected',
      answer: 'All clusters are stable or improving since last run',
      sparkPoints: active[0].points.map(p => p.defectCount),
      sparkColor: '#6b7280',
      accentClass: 'border-surface-border bg-surface-muted/40',
    });
  }

  // 2. Risk concentration
  if (riskiest) {
    const rs = latestRiskScore(riskiest);
    const level = rs > 20 ? 'HIGH' : rs > 8 ? 'MEDIUM' : 'LOW';
    const levelColor = rs > 20 ? 'text-red-700' : rs > 8 ? 'text-amber-700' : 'text-green-700';
    cards.push({
      icon: <Target size={11} />,
      question: 'Where is risk concentrated?',
      clusterName: riskiest.clusterName,
      answer: `Risk score ${rs} — ${level}`,
      detail: `${riskiest.points[riskiest.points.length - 1]?.criticalCount ?? 0} critical · ${riskiest.points[riskiest.points.length - 1]?.highCount ?? 0} high in latest run`,
      sparkPoints: riskiest.points.map(p => p.riskScore),
      sparkColor: rs > 20 ? '#ef4444' : rs > 8 ? '#f59e0b' : '#22c55e',
      accentClass: rs > 20 ? 'border-red-200 bg-red-50/60' : rs > 8 ? 'border-amber-200 bg-amber-50/60' : 'border-green-200 bg-green-50/60',
    });
    // Add invisible levelColor usage to avoid lint issue
    void levelColor;
  }

  // 3. Improved
  if (hasDelta && bestDelta < 0 && best !== worst) {
    cards.push({
      icon: <TrendingDown size={11} />,
      question: 'Which area improved?',
      clusterName: best.clusterName,
      answer: `${bestDelta} defect${Math.abs(bestDelta) !== 1 ? 's' : ''} vs previous run`,
      detail: `Down to ${latestCount(best)} — keep monitoring`,
      sparkPoints: best.points.map(p => p.defectCount),
      sparkColor: '#22c55e',
      accentClass: 'border-green-200 bg-green-50/60',
    });
  }

  // 4. Newly emerged / growing fastest
  if (emerged && emerged !== worst && runs.length >= 2) {
    const firstCount = emerged.points[0]?.defectCount ?? 0;
    const latestC = latestCount(emerged);
    const isNew = firstCount === 0;
    cards.push({
      icon: <Zap size={11} />,
      question: isNew ? "What's newly emerged?" : "What's growing fastest?",
      clusterName: emerged.clusterName,
      answer: isNew
        ? `Appeared with ${latestC} defect${latestC !== 1 ? 's' : ''} this run`
        : `Grew ${firstCount} → ${latestC} across ${runs.length} runs`,
      detail: isNew ? 'Was absent in previous runs — investigate root cause' : 'Fastest proportional growth across all runs',
      sparkPoints: emerged.points.map(p => p.defectCount),
      sparkColor: '#8b5cf6',
      accentClass: 'border-purple-200 bg-purple-50/60',
    });
  }

  // 5. Stable cluster (if no improvement found, show stability)
  if (!hasDelta || (bestDelta >= 0 && cards.length < 3)) {
    const stable = [...active].sort((a, b) => {
      const varA = Math.max(...a.points.map(p => p.defectCount)) - Math.min(...a.points.map(p => p.defectCount));
      const varB = Math.max(...b.points.map(p => p.defectCount)) - Math.min(...b.points.map(p => p.defectCount));
      return varA - varB;
    })[0];
    if (stable && !cards.find(c => c.clusterName === stable.clusterName)) {
      cards.push({
        icon: <AlertTriangle size={11} />,
        question: 'Which area to focus on?',
        clusterName: stable.clusterName,
        answer: `Risk score ${latestRiskScore(stable)} with ${latestCount(stable)} open defects`,
        detail: runs.length < 2 ? 'Run a second analysis to unlock delta insights' : 'Stable but still has open items',
        sparkPoints: stable.points.map(p => p.defectCount),
        sparkColor: '#f59e0b',
        accentClass: 'border-amber-200 bg-amber-50/60',
      });
    }
  }

  if (cards.length === 0) return null;

  return (
    <div>
      <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2.5">
        Diagnostic Insights
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {cards.map((card, i) => (
          <InsightCard key={i} {...card} />
        ))}
      </div>
      {!hasDelta && (
        <p className="text-[11px] text-text-muted mt-2 text-center">
          Run a second UAT analysis to unlock delta-based insights (getting worse / improved).
        </p>
      )}
    </div>
  );
}
