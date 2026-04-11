import { useState, useEffect } from 'react';
import type {
  AnalysisResult, Impact, BusinessRule, ProposedChange, ImpactFeedback, OpenQuestionFeedback
} from '../types';
import {
  FileText, Layers, Monitor, BookOpen,
  HelpCircle, Lightbulb, AlertTriangle, ChevronDown, ChevronUp,
  ThumbsUp, ThumbsDown, MessageSquarePlus, CheckCircle2, XCircle
} from 'lucide-react';
import ImpactPrototype from './ImpactPrototype';
import ImpactDeepDive from './ImpactDeepDive';
import { analysisApi } from '../services/api';

interface AnalysisTabsProps {
  result: AnalysisResult;
  projectId: string;
  analysisId: string;
}

type TabId = 'summary' | 'functional' | 'uiux' | 'questions';

const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: 'summary', label: 'Executive Summary', icon: FileText },
  { id: 'functional', label: 'Functional Impacts', icon: Layers },
  { id: 'uiux', label: 'UI/UX Impacts', icon: Monitor },
  { id: 'questions', label: 'Open Questions', icon: HelpCircle },
];

function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === 'high' ? 'badge-high' : severity === 'medium' ? 'badge-medium' : 'badge-low';
  return <span className={`badge ${cls}`}>{severity.charAt(0).toUpperCase() + severity.slice(1)}</span>;
}

// --- Feedback thumb buttons ---
interface FeedbackBarProps {
  impactId: string;
  projectId: string;
  analysisId: string;
  feedback: ImpactFeedback | undefined;
  onSaved: (f: ImpactFeedback) => void;
  onDeleted: (impactId: string) => void;
}

function FeedbackBar({ impactId, projectId, analysisId, feedback, onSaved, onDeleted }: FeedbackBarProps) {
  const [showMotivation, setShowMotivation] = useState(false);
  const [motivation, setMotivation] = useState(feedback?.motivation ?? '');
  const [saving, setSaving] = useState(false);

  async function handleThumb(sentiment: 'positive' | 'negative') {
    if (feedback?.sentiment === sentiment) {
      // toggle off
      await analysisApi.deleteFeedback(projectId, analysisId, impactId);
      onDeleted(impactId);
      setShowMotivation(false);
      return;
    }
    setShowMotivation(sentiment === 'negative');
    if (sentiment === 'positive') {
      setSaving(true);
      const saved = await analysisApi.saveFeedback(projectId, analysisId, impactId, 'positive', undefined);
      onSaved(saved);
      setSaving(false);
    }
  }

  async function handleSaveMotivation() {
    setSaving(true);
    const saved = await analysisApi.saveFeedback(projectId, analysisId, impactId, 'negative', motivation || undefined);
    onSaved(saved);
    setSaving(false);
    setShowMotivation(false);
  }

  const isPositive = feedback?.sentiment === 'positive';
  const isNegative = feedback?.sentiment === 'negative';

  return (
    <div className="mt-3 space-y-2" onClick={e => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted">Feedback:</span>
        <button
          onClick={() => handleThumb('positive')}
          disabled={saving}
          title="Mark as correct"
          className={`p-1.5 rounded-lg border transition-colors ${isPositive ? 'bg-emerald-50 border-emerald-300 text-emerald-600' : 'border-surface-border text-text-muted hover:text-emerald-600 hover:border-emerald-200'}`}
        >
          <ThumbsUp size={13} />
        </button>
        <button
          onClick={() => handleThumb('negative')}
          disabled={saving}
          title="Mark as incorrect"
          className={`p-1.5 rounded-lg border transition-colors ${isNegative ? 'bg-red-50 border-red-300 text-red-500' : 'border-surface-border text-text-muted hover:text-red-500 hover:border-red-200'}`}
        >
          <ThumbsDown size={13} />
        </button>
        {isNegative && feedback?.motivation && (
          <span className="text-xs text-text-muted italic truncate max-w-xs">"{feedback.motivation}"</span>
        )}
        {isPositive && <span className="text-xs text-emerald-600">Confirmed correct</span>}
      </div>
      {showMotivation && (
        <div className="flex gap-2 items-end">
          <textarea
            className="input text-xs resize-none flex-1"
            rows={2}
            placeholder="Why is this impact wrong or inaccurate? (optional — but helps the next re-run)"
            value={motivation}
            onChange={e => setMotivation(e.target.value)}
          />
          <button onClick={handleSaveMotivation} disabled={saving} className="btn-primary text-xs py-1.5 px-3 shrink-0 self-end">
            Save
          </button>
        </div>
      )}
    </div>
  );
}

// --- Expandable impact card (shared for both functional and UI/UX) ---
interface ExpandableImpactCardProps {
  impact: Impact;
  projectId: string;
  analysisId: string;
  isExpanded: boolean;
  onToggle: () => void;
  feedback: ImpactFeedback | undefined;
  onFeedbackSaved: (f: ImpactFeedback) => void;
  onFeedbackDeleted: (impactId: string) => void;
  children?: React.ReactNode;
}

function ExpandableImpactCard({
  impact, projectId, analysisId, isExpanded, onToggle,
  feedback, onFeedbackSaved, onFeedbackDeleted, children
}: ExpandableImpactCardProps) {
  const borderColor = feedback?.sentiment === 'positive'
    ? 'border-l-4 border-l-emerald-400'
    : feedback?.sentiment === 'negative'
    ? 'border-l-4 border-l-red-400'
    : '';

  return (
    <div className={`card overflow-hidden ${borderColor}`}>
      <button className="w-full p-4 text-left hover:bg-surface-hover transition-colors" onClick={onToggle}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-text-muted bg-surface px-1.5 py-0.5 rounded">{impact.id}</span>
            <span className="text-sm font-semibold text-text-primary">{impact.area}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SeverityBadge severity={impact.severity} />
            {isExpanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
          </div>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed mt-2">{impact.description}</p>
        <FeedbackBar
          impactId={impact.id}
          projectId={projectId}
          analysisId={analysisId}
          feedback={feedback}
          onSaved={onFeedbackSaved}
          onDeleted={onFeedbackDeleted}
        />
      </button>
      <div className={isExpanded ? 'px-4 pb-4' : 'hidden'}>
        {children}
      </div>
    </div>
  );
}


// --- Open Question Card with feedback ---
interface OpenQuestionCardProps {
  question: string;
  projectId: string;
  analysisId: string;
  feedback: OpenQuestionFeedback | undefined;
  onSaved: (f: OpenQuestionFeedback) => void;
  onDeleted: (questionText: string) => void;
}

function OpenQuestionCard({ question, projectId, analysisId, feedback, onSaved, onDeleted }: OpenQuestionCardProps) {
  const [showAnswer, setShowAnswer] = useState(!!feedback?.answer);
  const [answer, setAnswer] = useState(feedback?.answer ?? '');
  const [saving, setSaving] = useState(false);

  const isDismissed = feedback?.sentiment === 'negative';
  const isConfirmed = feedback?.sentiment === 'positive';

  async function handleSentiment(sentiment: 'positive' | 'negative') {
    if (feedback?.sentiment === sentiment) {
      await analysisApi.deleteOQFeedback(projectId, analysisId, question);
      onDeleted(question);
      return;
    }
    setSaving(true);
    const saved = await analysisApi.saveOQFeedback(projectId, analysisId, question, sentiment, feedback?.answer ?? null);
    onSaved(saved);
    setSaving(false);
  }

  async function handleSaveAnswer() {
    setSaving(true);
    const saved = await analysisApi.saveOQFeedback(projectId, analysisId, question, feedback?.sentiment ?? null, answer || null);
    onSaved(saved);
    setSaving(false);
    setShowAnswer(false);
  }

  const borderLeft = isDismissed
    ? 'border-l-4 border-l-slate-300'
    : isConfirmed
    ? 'border-l-4 border-l-emerald-400'
    : feedback?.answer
    ? 'border-l-4 border-l-blue-400'
    : '';

  return (
    <div className={`card p-4 space-y-3 ${borderLeft} ${isDismissed ? 'opacity-60' : ''}`}>
      <div className="flex gap-3">
        <div className="w-6 h-6 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0 mt-0.5">
          {isDismissed
            ? <XCircle size={12} className="text-slate-400" />
            : isConfirmed
            ? <CheckCircle2 size={12} className="text-emerald-500" />
            : <AlertTriangle size={12} className="text-amber-600" />}
        </div>
        <p className={`text-sm leading-relaxed flex-1 ${isDismissed ? 'line-through text-text-muted' : 'text-text-secondary'}`}>{question}</p>
      </div>

      {/* Existing answer preview */}
      {feedback?.answer && !showAnswer && (
        <div className="ml-9 bg-blue-50/60 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-800">
          <span className="font-semibold">Risposta: </span>{feedback.answer}
        </div>
      )}

      {/* Answer input */}
      {showAnswer && (
        <div className="ml-9 flex gap-2 items-end">
          <textarea
            className="input text-xs resize-none flex-1"
            rows={2}
            placeholder="Scrivi una risposta o annotazione per raffinare la prossima analisi…"
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            autoFocus
          />
          <button onClick={handleSaveAnswer} disabled={saving} className="btn-primary text-xs py-1.5 px-3 shrink-0 self-end">
            Salva
          </button>
          <button onClick={() => setShowAnswer(false)} className="btn-secondary text-xs py-1.5 px-3 shrink-0 self-end">
            Annulla
          </button>
        </div>
      )}

      {/* Action bar */}
      <div className="ml-9 flex items-center gap-2">
        <span className="text-xs text-text-muted">Feedback:</span>
        <button
          onClick={() => handleSentiment('positive')}
          disabled={saving}
          title="Domanda ancora aperta / rilevante"
          className={`p-1.5 rounded-lg border transition-colors text-xs flex items-center gap-1 ${isConfirmed ? 'bg-emerald-50 border-emerald-300 text-emerald-600' : 'border-surface-border text-text-muted hover:text-emerald-600 hover:border-emerald-200'}`}
        >
          <ThumbsUp size={11} />
        </button>
        <button
          onClick={() => handleSentiment('negative')}
          disabled={saving}
          title="Chiudi / non rilevante"
          className={`p-1.5 rounded-lg border transition-colors text-xs flex items-center gap-1 ${isDismissed ? 'bg-red-50 border-red-300 text-red-500' : 'border-surface-border text-text-muted hover:text-red-500 hover:border-red-200'}`}
        >
          <ThumbsDown size={11} />
        </button>
        <button
          onClick={() => { setShowAnswer(true); setAnswer(feedback?.answer ?? ''); }}
          disabled={saving}
          title="Aggiungi risposta"
          className="p-1.5 rounded-lg border border-surface-border text-text-muted hover:text-blue-600 hover:border-blue-200 transition-colors"
        >
          <MessageSquarePlus size={11} />
        </button>
        {isDismissed && <span className="text-xs text-slate-400 ml-1">Chiusa</span>}
        {isConfirmed && !isDismissed && <span className="text-xs text-emerald-600 ml-1">Confermata aperta</span>}
      </div>
    </div>
  );
}

export default function AnalysisTabs({ result, projectId, analysisId }: AnalysisTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('summary');
  const [expandedFuncIds, setExpandedFuncIds] = useState<Set<string>>(new Set());
  const [expandedUiIds, setExpandedUiIds] = useState<Set<string>>(new Set());
  const [feedbackMap, setFeedbackMap] = useState<Map<string, ImpactFeedback>>(new Map());
  const [oqFeedbackMap, setOqFeedbackMap] = useState<Map<string, OpenQuestionFeedback>>(new Map());

  useEffect(() => {
    analysisApi.listFeedback(projectId, analysisId)
      .then(list => setFeedbackMap(new Map(list.map(f => [f.impact_id, f]))))
      .catch(() => {});
    analysisApi.listOQFeedback(projectId, analysisId)
      .then(list => setOqFeedbackMap(new Map(list.map(f => [f.question_text, f]))))
      .catch(() => {});
  }, [projectId, analysisId]);

  function toggleFunc(id: string) {
    setExpandedFuncIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleUi(id: string) {
    setExpandedUiIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function handleFeedbackSaved(f: ImpactFeedback) {
    setFeedbackMap(prev => new Map(prev).set(f.impact_id, f));
  }
  function handleFeedbackDeleted(impactId: string) {
    setFeedbackMap(prev => { const next = new Map(prev); next.delete(impactId); return next; });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tabs header */}
      <div className="flex border-b border-surface-border bg-white overflow-x-auto shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`tab flex items-center gap-2 ${activeTab === tab.id ? 'tab-active' : ''}`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 p-6 overflow-y-auto animate-fade-in">

        {/* Executive Summary */}
        {activeTab === 'summary' && (
          <div className="space-y-6 w-full">
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">Overview</h3>
              <p className="text-text-secondary leading-relaxed">{result.executiveSummary}</p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Functional Impacts', value: result.functionalImpacts.length, color: 'text-blue-600' },
                { label: 'UI/UX Impacts', value: result.uiUxImpacts.length, color: 'text-violet-600' },
                { label: 'Affected Screens', value: result.affectedScreens.length, color: 'text-amber-600' },
                { label: 'Open Questions', value: result.openQuestions.length, color: 'text-red-500' },
              ].map(stat => (
                <div key={stat.label} className="card p-4 text-center">
                  <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-text-muted mt-1">{stat.label}</div>
                </div>
              ))}
            </div>

            {result.assumptions.length > 0 && (
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb size={15} className="text-amber-500" />
                  <h3 className="text-sm font-semibold text-text-primary">Assumptions</h3>
                </div>
                <ul className="space-y-2">
                  {result.assumptions.map((a, i) => (
                    <li key={i} className="flex gap-2 text-sm text-text-secondary">
                      <span className="text-text-muted shrink-0 mt-0.5">·</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.businessRulesExtracted.length > 0 && (
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <BookOpen size={15} className="text-purple-deep" />
                  <h3 className="text-sm font-semibold text-text-primary">Extracted Business Rules</h3>
                </div>
                <div className="space-y-2">
                  {result.businessRulesExtracted.map((br: BusinessRule) => (
                    <div key={br.id} className="flex gap-3 items-start">
                      <span className="font-mono text-xs text-text-muted bg-surface px-1.5 py-0.5 rounded shrink-0 mt-0.5">{br.id}</span>
                      <span className="text-sm text-text-secondary">{br.description}</span>
                      <span className="text-xs text-text-muted bg-surface px-2 py-0.5 rounded-full ml-auto shrink-0">{br.source}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Functional Impacts */}
        {activeTab === 'functional' && (
          <div className="space-y-3 w-full">
            <p className="text-sm text-text-muted">
              {result.functionalImpacts.length} functional impacts identified — click to expand, thumbs to give feedback
            </p>
            {result.functionalImpacts.length === 0 ? (
              <div className="card p-8 text-center text-text-muted text-sm">No functional impacts recorded.</div>
            ) : (
              result.functionalImpacts.map(impact => (
                <ExpandableImpactCard
                  key={impact.id}
                  impact={impact}
                  projectId={projectId}
                  analysisId={analysisId}
                  isExpanded={expandedFuncIds.has(impact.id)}
                  onToggle={() => toggleFunc(impact.id)}
                  feedback={feedbackMap.get(impact.id)}
                  onFeedbackSaved={handleFeedbackSaved}
                  onFeedbackDeleted={handleFeedbackDeleted}
                >
                  <ImpactDeepDive impact={impact} projectId={projectId} analysisId={analysisId} />
                </ExpandableImpactCard>
              ))
            )}
          </div>
        )}

        {/* UI/UX Impacts */}
        {activeTab === 'uiux' && (
          <div className="space-y-3 w-full">
            <p className="text-sm text-text-muted">
              {result.uiUxImpacts.length} UI/UX impacts identified — click to expand prototype + deep dive
            </p>
            {result.uiUxImpacts.length === 0 ? (
              <div className="card p-8 text-center text-text-muted text-sm">No UI/UX impacts recorded.</div>
            ) : (
              result.uiUxImpacts.map((impact: Impact) => (
                <ExpandableImpactCard
                  key={impact.id}
                  impact={impact}
                  projectId={projectId}
                  analysisId={analysisId}
                  isExpanded={expandedUiIds.has(impact.id)}
                  onToggle={() => toggleUi(impact.id)}
                  feedback={feedbackMap.get(impact.id)}
                  onFeedbackSaved={handleFeedbackSaved}
                  onFeedbackDeleted={handleFeedbackDeleted}
                >
                  <ImpactPrototype impact={impact} projectId={projectId} analysisId={analysisId} />
                  <ImpactDeepDive impact={impact} projectId={projectId} analysisId={analysisId} />
                </ExpandableImpactCard>
              ))
            )}

            {result.proposedChanges.length > 0 && (
              <div className="card overflow-hidden mt-6">
                <div className="px-4 py-3 border-b border-surface-border">
                  <h3 className="text-sm font-semibold text-text-primary">Proposed Screen Changes</h3>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-surface">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Screen</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Change</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-text-muted">Priority</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border">
                    {result.proposedChanges.map((pc: ProposedChange, i) => (
                      <tr key={i} className="hover:bg-surface-hover transition-colors">
                        <td className="px-4 py-3 font-medium text-text-primary">{pc.screen}</td>
                        <td className="px-4 py-3 text-text-secondary">{pc.change}</td>
                        <td className="px-4 py-3"><SeverityBadge severity={pc.priority} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}



        {/* Open Questions */}
        {activeTab === 'questions' && (
          <div className="space-y-3 w-full">
            <p className="text-sm text-text-muted">Annota o rispondi alle domande aperte — il feedback verrà considerato nella prossima analisi.</p>
            {result.openQuestions.length === 0 ? (
              <div className="card p-8 text-center text-text-muted text-sm">Nessuna domanda aperta.</div>
            ) : (
              result.openQuestions.map((q, i) => (
                <OpenQuestionCard
                  key={i}
                  question={q}
                  projectId={projectId}
                  analysisId={analysisId}
                  feedback={oqFeedbackMap.get(q)}
                  onSaved={f => setOqFeedbackMap(prev => new Map(prev).set(f.question_text, f))}
                  onDeleted={qt => setOqFeedbackMap(prev => { const next = new Map(prev); next.delete(qt); return next; })}
                />
              ))
            )}
          </div>
        )}

      </div>
    </div>
  );
}
