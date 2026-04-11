import { useState } from 'react';
import type {
  AnalysisResult, Impact, AffectedScreen, BusinessRule, ProposedChange
} from '../types';
import {
  FileText, Layers, Monitor, BookOpen,
  HelpCircle, Lightbulb, AlertTriangle, TrendingUp, ChevronDown, ChevronUp
} from 'lucide-react';
import ImpactPrototype from './ImpactPrototype';
import ImpactDeepDive from './ImpactDeepDive';

interface AnalysisTabsProps {
  result: AnalysisResult;
  projectId: string;
  analysisId: string;
}

type TabId = 'summary' | 'functional' | 'uiux' | 'screens' | 'questions';

const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: 'summary', label: 'Executive Summary', icon: FileText },
  { id: 'functional', label: 'Functional Impacts', icon: Layers },
  { id: 'uiux', label: 'UI/UX Impacts', icon: Monitor },
  { id: 'screens', label: 'Affected Screens', icon: TrendingUp },
  { id: 'questions', label: 'Open Questions', icon: HelpCircle },
];

function SeverityBadge({ severity }: { severity: string }) {
  const cls = severity === 'high' ? 'badge-high' : severity === 'medium' ? 'badge-medium' : 'badge-low';
  const label = severity.charAt(0).toUpperCase() + severity.slice(1);
  return <span className={`badge ${cls}`}>{label}</span>;
}

function ImpactCard({ impact }: { impact: Impact }) {
  return (
    <div className="card p-4 space-y-2 hover:shadow-card-hover transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-text-muted bg-surface px-1.5 py-0.5 rounded">{impact.id}</span>
          <span className="text-sm font-semibold text-text-primary">{impact.area}</span>
        </div>
        <SeverityBadge severity={impact.severity} />
      </div>
      <p className="text-sm text-text-secondary leading-relaxed">{impact.description}</p>
    </div>
  );
}

function ScreenCard({ screen }: { screen: AffectedScreen }) {
  const changeColors = {
    modified: 'bg-amber-50 text-amber-700 border-amber-100',
    new: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    removed: 'bg-red-50 text-red-700 border-red-100',
  };
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">{screen.name}</h4>
        <span className={`badge border ${changeColors[screen.changeType]}`}>
          {screen.changeType.charAt(0).toUpperCase() + screen.changeType.slice(1)}
        </span>
      </div>
      {screen.changeType !== 'new' && (
        <div>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Current Behavior</p>
          <p className="text-sm text-text-secondary">{screen.currentBehavior}</p>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Proposed Behavior</p>
        <p className="text-sm text-text-secondary">{screen.proposedBehavior}</p>
      </div>
    </div>
  );
}

export default function AnalysisTabs({ result, projectId, analysisId }: AnalysisTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('summary');
  const [expandedImpactId, setExpandedImpactId] = useState<string | null>(null);
  const [expandedFuncId, setExpandedFuncId] = useState<string | null>(null);

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
          <div className="space-y-6 max-w-3xl">
            <div className="card p-6">
              <h3 className="text-sm font-semibold text-text-muted uppercase tracking-wide mb-3">Overview</h3>
              <p className="text-text-secondary leading-relaxed">{result.executiveSummary}</p>
            </div>

            {/* Stats row */}
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

            {/* Assumptions */}
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

            {/* Business Rules */}
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
          <div className="space-y-3 max-w-3xl">
            <p className="text-sm text-text-muted">{result.functionalImpacts.length} functional impacts identified — click an impact to deep dive with Claude</p>
            {result.functionalImpacts.length === 0 ? (
              <div className="card p-8 text-center text-text-muted text-sm">No functional impacts recorded.</div>
            ) : (
              result.functionalImpacts.map(impact => {
                const isExpanded = expandedFuncId === impact.id;
                return (
                  <div key={impact.id} className="card overflow-hidden">
                    <button
                      className="w-full p-4 text-left hover:bg-surface-hover transition-colors"
                      onClick={() => setExpandedFuncId(isExpanded ? null : impact.id)}
                    >
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
                    </button>
                    <div className={isExpanded ? 'px-4 pb-4' : 'hidden'}>
                      <ImpactDeepDive impact={impact} projectId={projectId} analysisId={analysisId} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* UI/UX Impacts */}
        {activeTab === 'uiux' && (
          <div className="space-y-3 max-w-3xl">
            <p className="text-sm text-text-muted">{result.uiUxImpacts.length} UI/UX impacts identified — click an impact to generate a prototype</p>
            {result.uiUxImpacts.length === 0 ? (
              <div className="card p-8 text-center text-text-muted text-sm">No UI/UX impacts recorded.</div>
            ) : (
              result.uiUxImpacts.map((impact: Impact) => {
                const isExpanded = expandedImpactId === impact.id;
                return (
                  <div key={impact.id} className="card overflow-hidden">
                    <button
                      className="w-full p-4 text-left hover:bg-surface-hover transition-colors"
                      onClick={() => setExpandedImpactId(isExpanded ? null : impact.id)}
                    >
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
                    </button>
                    {/* Always mounted to preserve state during generation — hidden when collapsed */}
                    <div className={isExpanded ? 'px-4 pb-4' : 'hidden'}>
                      <ImpactPrototype impact={impact} projectId={projectId} analysisId={analysisId} />
                      <ImpactDeepDive impact={impact} projectId={projectId} analysisId={analysisId} />
                    </div>
                  </div>
                );
              })
            )}

            {/* Proposed changes table */}
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

        {/* Affected Screens */}
        {activeTab === 'screens' && (
          <div className="space-y-3 max-w-3xl">
            <p className="text-sm text-text-muted">{result.affectedScreens.length} screens affected</p>
            {result.affectedScreens.length === 0 ? (
              <div className="card p-8 text-center text-text-muted text-sm">No affected screens recorded.</div>
            ) : (
              result.affectedScreens.map((screen, i) => <ScreenCard key={i} screen={screen} />)
            )}
          </div>
        )}

        {/* Open Questions */}
        {activeTab === 'questions' && (
          <div className="space-y-3 max-w-2xl">
            {result.openQuestions.length === 0 ? (
              <div className="card p-8 text-center text-text-muted text-sm">No open questions.</div>
            ) : (
              result.openQuestions.map((q, i) => (
                <div key={i} className="card p-4 flex gap-3">
                  <div className="w-6 h-6 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0 mt-0.5">
                    <AlertTriangle size={12} className="text-amber-600" />
                  </div>
                  <p className="text-sm text-text-secondary leading-relaxed">{q}</p>
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </div>
  );
}
