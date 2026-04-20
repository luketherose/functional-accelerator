import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  Network, GitBranch, Sparkles, List, BookOpen, Settings, BarChart2,
  AlertCircle, ArrowLeft
} from 'lucide-react';
import type {
  GraphDomain, DomainStats, EntityTypeConfig, GraphSuggestion, KGEntity, GraphMode
} from '../types';
import { graphApi } from '../services/api';
import EntityModelSection from '../components/Graph/EntityModelSection';
import SuggestedDiscoveriesSection from '../components/Graph/SuggestedDiscoveriesSection';
import EntityRegistrySection from '../components/Graph/EntityRegistrySection';
import GraphViewSection from '../components/Graph/GraphViewSection';

type DomainTab = 'model' | 'suggestions' | 'registry' | 'graph';

const DOMAIN_META: Record<GraphDomain, {
  label: string;
  description: string;
  icon: React.ReactNode;
  accentBg: string;
  accentText: string;
  accentBorder: string;
  activeBorder: string;
}> = {
  functional: {
    label: 'Functional Graph',
    description: 'Entities and relations extracted from AS-IS / TO-BE functional analysis documents.',
    icon: <GitBranch className="w-4 h-4" />,
    accentBg: 'bg-indigo-100',
    accentText: 'text-indigo-600',
    accentBorder: 'border-indigo-100',
    activeBorder: 'border-indigo-600 text-indigo-600',
  },
  risk: {
    label: 'Risk Graph',
    description: 'Entities and relations extracted from defect clusters and risk analysis data.',
    icon: <BarChart2 className="w-4 h-4" />,
    accentBg: 'bg-rose-100',
    accentText: 'text-rose-600',
    accentBorder: 'border-rose-100',
    activeBorder: 'border-rose-600 text-rose-600',
  },
};

function ModeSelector({ mode, onChange }: { mode: GraphMode; onChange: (m: GraphMode) => void }) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
      {(['manual', 'assisted', 'auto'] as GraphMode[]).map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
            mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {m.charAt(0).toUpperCase() + m.slice(1)}
        </button>
      ))}
    </div>
  );
}

function DomainPage({ domain, projectId }: { domain: GraphDomain; projectId: string }) {
  const meta = DOMAIN_META[domain];
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to={`/projects/${projectId}`}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              title="Back to project"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className={`p-2 rounded-lg ${meta.accentBg} ${meta.accentText}`}>
              {meta.icon}
            </div>
            <div>
              <h1 className="text-base font-semibold text-gray-900">{meta.label}</h1>
              <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            {stats && (
              <div className="flex gap-5">
                <div className="text-center">
                  <div className="text-xl font-bold text-gray-900">{stats.entityCount}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">entities</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-gray-900">{stats.relationCount}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">relations</div>
                </div>
                {stats.pendingSuggestions > 0 && (
                  <div className="text-center">
                    <div className="text-xl font-bold text-amber-600">{stats.pendingSuggestions}</div>
                    <div className="text-[10px] text-gray-500 uppercase tracking-wide">pending</div>
                  </div>
                )}
              </div>
            )}
            {stats && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Settings className="w-3.5 h-3.5" />
                  <span>Mode:</span>
                </div>
                <ModeSelector mode={stats.mode} onChange={handleModeChange} />
              </div>
            )}
          </div>
        </div>

        {stats?.mode === 'manual' && (
          <div className="flex items-start gap-2 mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Manual mode — automatic entity discovery is disabled. Entities must be curated manually.</span>
          </div>
        )}

        {/* Sub-tabs */}
        <div className="flex gap-1 mt-3 -mb-px">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? meta.activeBorder
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">Loading…</div>
        ) : (
          <>
            {activeTab === 'model' && (
              <EntityModelSection domain={domain} projectId={projectId} types={entityTypes} onRefresh={loadAll} />
            )}
            {activeTab === 'suggestions' && (
              <SuggestedDiscoveriesSection
                domain={domain} projectId={projectId}
                suggestions={suggestions} entities={entities}
                entityTypes={entityTypes} onRefresh={loadAll}
              />
            )}
            {activeTab === 'registry' && (
              <EntityRegistrySection domain={domain} projectId={projectId} entityTypes={entityTypes} onEntitySelect={() => {}} />
            )}
            {activeTab === 'graph' && (
              <GraphViewSection domain={domain} projectId={projectId} entityTypes={entityTypes} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function GraphGovernancePage() {
  const { id: projectId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const domain = (searchParams.get('domain') as GraphDomain | null) ?? 'functional';

  if (!projectId) return null;

  return <DomainPage domain={domain} projectId={projectId} />;
}
