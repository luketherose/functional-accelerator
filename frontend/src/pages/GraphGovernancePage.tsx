import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Network, GitBranch, Sparkles, List, BookOpen, Settings, BarChart2, AlertCircle } from 'lucide-react';
import type {
  GraphDomain, DomainStats, EntityTypeConfig, GraphSuggestion, KGEntity, GraphMode
} from '../types';
import { graphApi } from '../services/api';
import EntityModelSection from '../components/Graph/EntityModelSection';
import SuggestedDiscoveriesSection from '../components/Graph/SuggestedDiscoveriesSection';
import EntityRegistrySection from '../components/Graph/EntityRegistrySection';
import GraphViewSection from '../components/Graph/GraphViewSection';
import PageHeader from '../components/Layout/PageHeader';

// ─── Per-domain tab type ──────────────────────────────────────────────────────

type DomainTab = 'model' | 'suggestions' | 'registry' | 'graph';

// ─── Mode selector ────────────────────────────────────────────────────────────

function ModeSelector({ mode, onChange }: { mode: GraphMode; onChange: (m: GraphMode) => void }) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
      {(['manual', 'assisted', 'auto'] as GraphMode[]).map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          {m.charAt(0).toUpperCase() + m.slice(1)}
        </button>
      ))}
    </div>
  );
}

// ─── Domain panel ─────────────────────────────────────────────────────────────

function DomainPanel({ domain, projectId }: { domain: GraphDomain; projectId: string }) {
  const [activeTab, setActiveTab] = useState<DomainTab>('suggestions');
  const [stats, setStats] = useState<DomainStats | null>(null);
  const [entityTypes, setEntityTypes] = useState<EntityTypeConfig[]>([]);
  const [suggestions, setSuggestions] = useState<GraphSuggestion[]>([]);
  const [entities, setEntities] = useState<KGEntity[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, typesRes, suggsRes, entRes] = await Promise.all([
        graphApi.getStats(domain, projectId),
        graphApi.getEntityTypes(domain, projectId),
        graphApi.getSuggestions(domain, projectId, 'pending'),
        graphApi.getEntities(domain, projectId, { limit: 200 }),
      ]);
      setStats(statsRes);
      setEntityTypes(typesRes);
      setSuggestions(suggsRes);
      setEntities(entRes.entities);
    } finally {
      setLoading(false);
    }
  }, [domain, projectId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function handleModeChange(mode: GraphMode) {
    await graphApi.setMode(domain, projectId, mode);
    await loadAll();
  }

  const TABS: { key: DomainTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: 'suggestions', label: 'Discoveries', icon: <Sparkles className="w-3.5 h-3.5" />, badge: stats?.pendingSuggestions },
    { key: 'registry',    label: 'Registry',    icon: <List className="w-3.5 h-3.5" />,    badge: stats?.entityCount },
    { key: 'model',       label: 'Entity Model', icon: <BookOpen className="w-3.5 h-3.5" /> },
    { key: 'graph',       label: 'Graph View',   icon: <Network className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Domain header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {stats && (
            <div className="flex gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{stats.entityCount}</div>
                <div className="text-xs text-gray-500">entities</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{stats.relationCount}</div>
                <div className="text-xs text-gray-500">relations</div>
              </div>
              {stats.pendingSuggestions > 0 && (
                <div className="text-center">
                  <div className="text-2xl font-bold text-amber-600">{stats.pendingSuggestions}</div>
                  <div className="text-xs text-gray-500">pending</div>
                </div>
              )}
            </div>
          )}
        </div>
        {stats && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Settings className="w-3.5 h-3.5" />
              <span>Mode:</span>
            </div>
            <ModeSelector mode={stats.mode} onChange={handleModeChange} />
          </div>
        )}
      </div>

      {stats?.mode === 'manual' && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Manual mode — automatic entity discovery is disabled. Entities must be curated manually.</span>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={`text-xs rounded-full px-1.5 py-0.5 font-medium ${
                tab.key === 'suggestions' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Loading domain…</div>
      ) : (
        <div className="min-h-[400px]">
          {activeTab === 'model' && (
            <EntityModelSection
              domain={domain}
              projectId={projectId}
              types={entityTypes}
              onRefresh={loadAll}
            />
          )}
          {activeTab === 'suggestions' && (
            <SuggestedDiscoveriesSection
              domain={domain}
              projectId={projectId}
              suggestions={suggestions}
              entities={entities}
              entityTypes={entityTypes}
              onRefresh={loadAll}
            />
          )}
          {activeTab === 'registry' && (
            <EntityRegistrySection
              domain={domain}
              projectId={projectId}
              entityTypes={entityTypes}
              onEntitySelect={() => {}}
            />
          )}
          {activeTab === 'graph' && (
            <GraphViewSection
              domain={domain}
              projectId={projectId}
              entityTypes={entityTypes}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GraphGovernancePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [domain, setDomain] = useState<GraphDomain>('functional');

  if (!projectId) return null;

  const domainConfig: Record<GraphDomain, { label: string; description: string; icon: React.ReactNode; color: string }> = {
    functional: {
      label: 'Functional Graph',
      description: 'Entities and relations extracted from AS-IS / TO-BE functional analysis documents',
      icon: <GitBranch className="w-4 h-4" />,
      color: 'indigo',
    },
    risk: {
      label: 'Risk Graph',
      description: 'Entities and relations extracted from defect clusters and risk analysis data',
      icon: <BarChart2 className="w-4 h-4" />,
      color: 'rose',
    },
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
      <PageHeader
        title="Graph Governance"
        subtitle="Manage the semantic knowledge graphs for each analysis domain. Each domain has an isolated entity model, discovery queue, and governance memory."
      />

      {/* Domain selector */}
      <div className="grid grid-cols-2 gap-4">
        {(Object.entries(domainConfig) as [GraphDomain, typeof domainConfig[GraphDomain]][]).map(([key, cfg]) => (
          <button
            key={key}
            onClick={() => setDomain(key)}
            className={`flex items-start gap-4 p-5 rounded-2xl border-2 text-left transition-all ${
              domain === key
                ? key === 'functional'
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-rose-500 bg-rose-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className={`p-2 rounded-lg ${
              domain === key
                ? key === 'functional' ? 'bg-indigo-100 text-indigo-600' : 'bg-rose-100 text-rose-600'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {cfg.icon}
            </div>
            <div>
              <p className={`text-sm font-semibold ${domain === key ? (key === 'functional' ? 'text-indigo-900' : 'text-rose-900') : 'text-gray-700'}`}>
                {cfg.label}
              </p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{cfg.description}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Isolation notice */}
      <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
        <Network className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          The two domains are fully isolated. Entities, suggestions, and governance memory in the{' '}
          <strong>Functional</strong> graph never affect the <strong>Risk</strong> graph and vice versa.
        </span>
      </div>

      {/* Domain panel */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
          <div className={`p-2 rounded-lg ${domain === 'functional' ? 'bg-indigo-100 text-indigo-600' : 'bg-rose-100 text-rose-600'}`}>
            {domainConfig[domain].icon}
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">{domainConfig[domain].label}</h2>
            <p className="text-xs text-gray-500">{domainConfig[domain].description}</p>
          </div>
        </div>

        <DomainPanel key={domain} domain={domain} projectId={projectId} />
      </div>
    </div>
  );
}
