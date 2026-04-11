import { useState, useEffect } from 'react';
import {
  CheckCircle2, Loader2, Clock,
  BookOpen, BookMarked, GitCompare, Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ─── Step definitions ─────────────────────────────────────────────────────────

interface StepDef {
  id: number;
  labelKey: string;
  descriptionKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  estimatedSeconds: number;
  color: string;
}

const STEPS: StepDef[] = [
  { id: 1, labelKey: 'pipeline.steps.readAsIs',  descriptionKey: 'pipeline.steps.readAsIsSub',   icon: BookOpen,   estimatedSeconds: 65,  color: 'bg-blue-500' },
  { id: 2, labelKey: 'pipeline.steps.readToBe',  descriptionKey: 'pipeline.steps.readToBeSub',   icon: BookMarked, estimatedSeconds: 65,  color: 'bg-violet-500' },
  { id: 3, labelKey: 'pipeline.steps.compare',   descriptionKey: 'pipeline.steps.compareSub',    icon: GitCompare, estimatedSeconds: 75,  color: 'bg-amber-500' },
  { id: 4, labelKey: 'pipeline.steps.synthesise',descriptionKey: 'pipeline.steps.synthesiseSub', icon: Sparkles,   estimatedSeconds: 110, color: 'bg-purple-deep' },
];

const TOTAL_SECONDS = STEPS.reduce((s, step) => s + step.estimatedSeconds, 0);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseStepNumber(progressStep: string | null): number {
  if (!progressStep) return 0;
  const m = progressStep.match(/Step (\d+)\/4/);
  return m ? parseInt(m[1], 10) : 0;
}

function fmtSeconds(s: number): string {
  if (s <= 0) return '0s';
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  progressStep: string | null;
}

export default function AnalysisProgress({ progressStep }: Props) {
  const { t } = useTranslation();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const mountedAt = Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - mountedAt) / 1000));
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const currentStep = parseStepNumber(progressStep);
  const remaining = Math.max(0, TOTAL_SECONDS - elapsed);
  const pct = Math.min(97, Math.round((elapsed / TOTAL_SECONDS) * 100));

  const elapsedBeforeCurrent = STEPS
    .filter(s => s.id < currentStep)
    .reduce((sum, s) => sum + s.estimatedSeconds, 0);
  const stepElapsed = Math.max(0, elapsed - elapsedBeforeCurrent);
  const currentStepDef = STEPS.find(s => s.id === currentStep);
  const stepPct = currentStepDef
    ? Math.min(95, Math.round((stepElapsed / currentStepDef.estimatedSeconds) * 100))
    : 0;

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-10 bg-gradient-to-b from-white to-surface/40">
      <div className="w-full max-w-md">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="text-center mb-8">
          <div className="relative w-16 h-16 mx-auto mb-5">
            <div className="absolute inset-0 rounded-2xl bg-purple-deep/10 animate-ping" style={{ animationDuration: '2s' }} />
            <div className="relative w-16 h-16 rounded-2xl bg-brand-50 border border-brand-200 flex items-center justify-center shadow-sm">
              <Loader2 size={24} className="animate-spin text-purple-deep" />
            </div>
          </div>

          <h2 className="text-base font-semibold text-text-primary">
            {t('pipeline.title')}
          </h2>
          <div className="flex items-center justify-center gap-3 mt-1.5 text-xs text-text-muted">
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {elapsed > 0 ? fmtSeconds(elapsed) : t('pipeline.starting')}
            </span>
            {remaining > 5 && currentStep > 0 && (
              <>
                <span className="w-px h-3 bg-surface-border" />
                <span>{t('pipeline.remaining', { time: fmtSeconds(remaining) })}</span>
              </>
            )}
          </div>
        </div>

        {/* ── Global progress bar ────────────────────────────── */}
        <div className="mb-6">
          <div className="flex justify-between text-[10px] text-text-muted mb-1.5">
            <span>{currentStep > 0 ? t('pipeline.stepOf', { current: currentStep, total: STEPS.length }) : t('pipeline.starting')}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 bg-surface rounded-full overflow-hidden border border-surface-border">
            <div
              className="h-full rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #6d28d9, #a855f7)' }}
            />
          </div>
        </div>

        {/* ── Step cards ─────────────────────────────────────── */}
        <div className="space-y-2.5">
          {STEPS.map((step) => {
            const isDone = currentStep > 0 && step.id < currentStep;
            const isActive = step.id === currentStep;
            const Icon = step.icon;

            return (
              <div
                key={step.id}
                className={`relative flex items-start gap-3 p-3.5 rounded-xl border transition-all duration-300 ${
                  isActive
                    ? 'border-purple-200 bg-brand-50 shadow-sm'
                    : isDone
                    ? 'border-emerald-100 bg-emerald-50/60'
                    : 'border-surface-border bg-white opacity-45'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                  isDone ? 'bg-emerald-500' : isActive ? step.color : 'bg-surface-border'
                }`}>
                  {isDone ? (
                    <CheckCircle2 size={16} className="text-white" />
                  ) : isActive ? (
                    <Loader2 size={16} className="animate-spin text-white" />
                  ) : (
                    <Icon size={16} className="text-text-muted" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold leading-tight ${
                    isDone ? 'text-emerald-700' : isActive ? 'text-purple-deep' : 'text-text-muted'
                  }`}>
                    {t(step.labelKey as Parameters<typeof t>[0])}
                  </p>
                  <p className="text-[10px] text-text-muted mt-0.5 leading-snug">
                    {t(step.descriptionKey as Parameters<typeof t>[0])}
                  </p>

                  {isActive && (
                    <div className="mt-2 h-1 bg-white rounded-full overflow-hidden border border-purple-100">
                      <div
                        className="h-full rounded-full bg-purple-deep/60 transition-all duration-1000 ease-out"
                        style={{ width: `${stepPct}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="shrink-0 text-[10px] font-medium mt-0.5">
                  {isDone ? (
                    <span className="text-emerald-600">{t('pipeline.steps.done')}</span>
                  ) : isActive ? (
                    <span className="text-purple-deep animate-pulse">{t('pipeline.steps.running')}</span>
                  ) : (
                    <span className="text-text-muted">~{fmtSeconds(step.estimatedSeconds)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer note ────────────────────────────────────── */}
        <p className="text-center text-[10px] text-text-muted mt-5 leading-relaxed">
          {t('pipeline.disclaimer')}
        </p>
      </div>
    </div>
  );
}
