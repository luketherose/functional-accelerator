import { useState, useEffect } from 'react';
import {
  Loader2,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Workflow,
  ArrowRight,
  ArrowLeft,
  Shield,
  Link,
  Monitor,
  HelpCircle,
  AlertCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FunctionalComponent, FunctionalComponentType } from '../types';
import { functionalApi } from '../services/api';

interface FunctionalMapViewProps {
  projectId: string;
  versionId: string;
}

type IconComponent = React.ComponentType<{ size?: number; className?: string }>;

interface TypeConfig {
  icon: IconComponent;
  color: string;
  bgColor: string;
}

const TYPE_CONFIG: Record<FunctionalComponentType, TypeConfig> = {
  process: {
    icon: Workflow,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 border-blue-200',
  },
  business_rule: {
    icon: BookOpen,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50 border-amber-200',
  },
  input: {
    icon: ArrowRight,
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50 border-emerald-200',
  },
  output: {
    icon: ArrowLeft,
    color: 'text-violet-600',
    bgColor: 'bg-violet-50 border-violet-200',
  },
  validation: {
    icon: Shield,
    color: 'text-red-600',
    bgColor: 'bg-red-50 border-red-200',
  },
  integration: {
    icon: Link,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50 border-indigo-200',
  },
  ui_element: {
    icon: Monitor,
    color: 'text-pink-600',
    bgColor: 'bg-pink-50 border-pink-200',
  },
};

const FALLBACK_CONFIG: TypeConfig = {
  icon: HelpCircle,
  color: 'text-text-muted',
  bgColor: 'bg-surface border-surface-border',
};

const COMPONENT_TYPES = Object.keys(TYPE_CONFIG) as FunctionalComponentType[];

function pillClass(active: boolean): string {
  return active
    ? 'bg-purple-deep text-white border-purple-deep'
    : 'bg-white border-surface-border text-text-secondary hover:border-purple-deep/50';
}

function ComponentCard({ component }: { component: FunctionalComponent }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const cfg = TYPE_CONFIG[component.type] ?? FALLBACK_CONFIG;
  const Icon = cfg.icon;

  const typeLabel = t(
    `knowledgeBase.componentTypes.${component.type}` as Parameters<typeof t>[0],
  );

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${cfg.bgColor} transition-all`}
      title={typeLabel}
    >
      <button
        className="w-full flex items-center gap-2 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <Icon size={13} className={`shrink-0 ${cfg.color}`} />
        <span className="flex-1 text-xs font-semibold text-text-primary truncate">
          {component.title}
        </span>
        <span className="text-[10px] text-text-muted shrink-0">
          {(component.confidence * 100).toFixed(0)}%
        </span>
        {expanded ? (
          <ChevronDown size={11} className="text-text-muted shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-text-muted shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5 pl-5">
          <p className="text-xs text-text-secondary leading-relaxed">
            {component.description}
          </p>
          {component.condition_text && (
            <p className="text-xs text-text-muted">
              <span className="font-medium">If:</span> {component.condition_text}
            </p>
          )}
          {component.action_text && (
            <p className="text-xs text-text-muted">
              <span className="font-medium">Then:</span> {component.action_text}
            </p>
          )}
          <blockquote className="border-l-2 border-purple-deep/30 pl-2 text-[11px] text-text-muted italic leading-snug">
            &ldquo;{component.source_quote}&rdquo;
            <span className="block not-italic text-[10px] mt-0.5">
              — {component.source_section}
            </span>
          </blockquote>
        </div>
      )}
    </div>
  );
}

function TypeGroup({
  type,
  components,
}: {
  type: FunctionalComponentType;
  components: FunctionalComponent[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const cfg = TYPE_CONFIG[type] ?? FALLBACK_CONFIG;
  const Icon = cfg.icon;
  const typeLabel = t(
    `knowledgeBase.componentTypes.${type}` as Parameters<typeof t>[0],
  );

  return (
    <div className="space-y-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left"
      >
        {open ? (
          <ChevronDown size={12} className="text-text-muted" />
        ) : (
          <ChevronRight size={12} className="text-text-muted" />
        )}
        <Icon size={13} className={cfg.color} />
        <span className="text-xs font-semibold text-text-primary">{typeLabel}</span>
        <span className="text-xs text-text-muted ml-1">({components.length})</span>
      </button>
      {open && (
        <div className="ml-4 space-y-1.5">
          {components.map(c => (
            <ComponentCard key={c.id} component={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FunctionalMapView({ projectId, versionId }: FunctionalMapViewProps) {
  const { t } = useTranslation();
  const [components, setComponents] = useState<FunctionalComponent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterType, setFilterType] = useState<FunctionalComponentType | ''>('');

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      try {
        const data = await functionalApi.listComponents(projectId, versionId, filterType || undefined);
        if (!cancelled) {
          setComponents(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void fetch();
    return () => { cancelled = true; };
  }, [projectId, versionId, filterType]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-text-muted gap-2">
        <Loader2 size={16} className="animate-spin text-purple-deep" />
        <span className="text-sm">{t('common.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-500 text-xs py-4">
        <AlertCircle size={13} /> {error}
      </div>
    );
  }

  if (components.length === 0) {
    return (
      <p className="text-xs text-text-muted py-4 text-center">
        {t('gapAnalysis.map.noComponents')}
      </p>
    );
  }

  const groupedComponents = COMPONENT_TYPES
    .map(type => ({ type, components: components.filter(c => c.type === type) }))
    .filter(g => g.components.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-text-muted">{t('gapAnalysis.map.filterByType')}:</span>
        <button
          onClick={() => setFilterType('')}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${pillClass(filterType === '')}`}
        >
          {t('gapAnalysis.map.allTypes')}
        </button>
        {COMPONENT_TYPES.map(type => {
          const cfg = TYPE_CONFIG[type];
          const Icon = cfg.icon;
          return (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 ${pillClass(filterType === type)}`}
            >
              <Icon size={10} />
              {t(`knowledgeBase.componentTypes.${type}` as Parameters<typeof t>[0])}
            </button>
          );
        })}
      </div>

      <div className="space-y-4 max-h-[32rem] overflow-y-auto pr-1">
        {filterType ? (
          <div className="space-y-1.5">
            {components.map(c => (
              <ComponentCard key={c.id} component={c} />
            ))}
          </div>
        ) : (
          groupedComponents.map(({ type, components: comps }) => (
            <TypeGroup key={type} type={type} components={comps} />
          ))
        )}
      </div>
    </div>
  );
}
