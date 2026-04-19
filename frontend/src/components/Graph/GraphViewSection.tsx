import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, ZoomIn, ZoomOut, Filter, Info } from 'lucide-react';
import type { GraphData, KGEntity, KGRelation, GraphDomain, EntityTypeConfig } from '../../types';
import { graphApi } from '../../services/api';

interface Props {
  domain: GraphDomain;
  projectId: string;
  entityTypes: EntityTypeConfig[];
}

interface NodePos {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  entity: KGEntity;
}

const COLORS: Record<string, string> = {
  screen: '#6366f1', form: '#8b5cf6', field: '#ec4899', api: '#f59e0b',
  process: '#10b981', business_rule: '#ef4444', workflow_step: '#3b82f6',
  batch_job: '#6b7280', data_entity: '#14b8a6', event: '#f97316',
  document: '#84cc16', risk: '#ef4444', control: '#3b82f6',
  requirement: '#8b5cf6', regulation: '#f59e0b', evidence: '#10b981',
  mitigation: '#06b6d4', process_risk: '#10b981', asset: '#f97316',
  data_class: '#ec4899', finding: '#ef4444', issue: '#dc2626',
};

function getColor(type: string): string {
  return COLORS[type] ?? '#6b7280';
}

function useForceLayout(nodes: KGEntity[], edges: KGRelation[], width: number, height: number) {
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(() => new Map());
  const iterRef = useRef(0);
  const posRef = useRef<NodePos[]>([]);

  useEffect(() => {
    if (nodes.length === 0) return;

    const cx = width / 2, cy = height / 2;
    posRef.current = nodes.map((n, i) => {
      const angle = (i / nodes.length) * 2 * Math.PI;
      const r = Math.min(width, height) * 0.35;
      return { id: n.id, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), vx: 0, vy: 0, entity: n };
    });

    iterRef.current = 0;

    function tick() {
      if (iterRef.current > 150) return;
      iterRef.current++;

      const ps = posRef.current;
      const idxMap = new Map(ps.map((p, i) => [p.id, i]));

      // Repulsion
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = ps[j].x - ps[i].x || 0.1;
          const dy = ps[j].y - ps[i].y || 0.1;
          const dist2 = dx * dx + dy * dy;
          const force = 8000 / dist2;
          const fx = force * dx / Math.sqrt(dist2);
          const fy = force * dy / Math.sqrt(dist2);
          ps[i].vx -= fx; ps[i].vy -= fy;
          ps[j].vx += fx; ps[j].vy += fy;
        }
      }

      // Attraction along edges
      for (const e of edges) {
        const si = idxMap.get(e.source_entity_id);
        const ti = idxMap.get(e.target_entity_id);
        if (si === undefined || ti === undefined) continue;
        const dx = ps[ti].x - ps[si].x;
        const dy = ps[ti].y - ps[si].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 120) * 0.04;
        const fx = force * dx / dist;
        const fy = force * dy / dist;
        ps[si].vx += fx; ps[si].vy += fy;
        ps[ti].vx -= fx; ps[ti].vy -= fy;
      }

      // Center gravity
      for (const p of ps) {
        p.vx += (cx - p.x) * 0.005;
        p.vy += (cy - p.y) * 0.005;
      }

      // Damping + apply
      for (const p of ps) {
        p.vx *= 0.85; p.vy *= 0.85;
        p.x += p.vx; p.y += p.vy;
        p.x = Math.max(20, Math.min(width - 20, p.x));
        p.y = Math.max(20, Math.min(height - 20, p.y));
      }

      setPositions(new Map(ps.map(p => [p.id, { x: p.x, y: p.y }])));
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }, [nodes, edges, width, height]);

  return positions;
}

export default function GraphViewSection({ domain, projectId, entityTypes }: Props) {
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [minConf, setMinConf] = useState(0.5);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<KGEntity | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, panX: 0, panY: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 700, H = 450;

  const visibleNodes = data ? data.nodes.filter(n => typeFilter.length === 0 || typeFilter.includes(n.entity_type)) : [];
  const visibleEdges = data ? data.edges.filter(e => {
    const sOk = visibleNodes.some(n => n.id === e.source_entity_id);
    const tOk = visibleNodes.some(n => n.id === e.target_entity_id);
    return sOk && tOk;
  }) : [];

  const positions = useForceLayout(visibleNodes, visibleEdges, W, H);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await graphApi.getGraphData(domain, projectId, {
        typeFilter: typeFilter.length > 0 ? typeFilter : undefined,
        minConfidence: minConf,
        limit: 150,
      });
      setData(result);
    } finally {
      setLoading(false);
    }
  }, [domain, projectId, typeFilter, minConf]);

  useEffect(() => { load(); }, [load]);

  function toggleTypeFilter(key: string) {
    setTypeFilter(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Graph View</h3>
          <p className="text-xs text-gray-500 mt-0.5">{visibleNodes.length} nodes · {visibleEdges.length} edges</p>
        </div>
        <button onClick={load} className="p-1.5 text-gray-400 hover:text-gray-600 rounded" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-1 text-xs text-gray-500">
          <Filter className="w-3.5 h-3.5" />
          <span>Filter types:</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {entityTypes.slice(0, 8).map(t => (
            <button
              key={t.type_key}
              onClick={() => toggleTypeFilter(t.type_key)}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${typeFilter.includes(t.type_key) ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}
              style={{ borderColor: typeFilter.includes(t.type_key) ? getColor(t.type_key) : undefined }}
            >
              {t.display_label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-gray-500">Min conf: {Math.round(minConf * 100)}%</label>
          <input
            type="range" min={0} max={100} step={5}
            value={Math.round(minConf * 100)}
            onChange={e => setMinConf(Number(e.target.value) / 100)}
            className="w-24"
          />
          <button onClick={() => setZoom(z => Math.min(z + 0.2, 3))} className="p-1 text-gray-500 hover:text-gray-700">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.3))} className="p-1 text-gray-500 hover:text-gray-700">
            <ZoomOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Graph canvas */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 z-10">
            <span className="text-sm text-gray-400">Loading graph…</span>
          </div>
        )}
        {!loading && visibleNodes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[300px] text-gray-400 gap-2">
            <Info className="w-8 h-8 opacity-40" />
            <p className="text-sm">No entities to display</p>
            <p className="text-xs">Approve suggestions to populate the graph</p>
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ height: 350 }}
          onMouseDown={e => { setDragging(true); setDragStart({ x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }); }}
          onMouseMove={e => {
            if (!dragging) return;
            setPan({ x: dragStart.panX + (e.clientX - dragStart.x) / zoom, y: dragStart.panY + (e.clientY - dragStart.y) / zoom });
          }}
          onMouseUp={() => setDragging(false)}
          onMouseLeave={() => setDragging(false)}
          className={dragging ? 'cursor-grabbing' : 'cursor-grab'}
        >
          <g transform={`scale(${zoom}) translate(${pan.x}, ${pan.y})`}>
            {/* Edges */}
            {visibleEdges.map(e => {
              const src = positions.get(e.source_entity_id);
              const tgt = positions.get(e.target_entity_id);
              if (!src || !tgt) return null;
              const mx = (src.x + tgt.x) / 2;
              const my = (src.y + tgt.y) / 2;
              return (
                <g key={e.id}>
                  <line
                    x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                    stroke="#d1d5db" strokeWidth={1.5 / zoom}
                    opacity={0.6}
                  />
                  <text x={mx} y={my} fontSize={9 / zoom} fill="#9ca3af" textAnchor="middle" dominantBaseline="middle">
                    {e.relation_type.replace(/_/g, ' ')}
                  </text>
                </g>
              );
            })}

            {/* Nodes */}
            {visibleNodes.map(n => {
              const pos = positions.get(n.id);
              if (!pos) return null;
              const color = getColor(n.entity_type);
              const isSelected = selected?.id === n.id;
              const r = 14 / zoom;
              return (
                <g key={n.id} onClick={() => setSelected(isSelected ? null : n)} className="cursor-pointer">
                  <circle
                    cx={pos.x} cy={pos.y} r={r + (isSelected ? 3 / zoom : 0)}
                    fill={color}
                    stroke={isSelected ? '#1e1b4b' : 'white'}
                    strokeWidth={isSelected ? 2 / zoom : 1.5 / zoom}
                    opacity={0.85}
                  />
                  <text
                    x={pos.x} y={pos.y + r + 12 / zoom}
                    fontSize={10 / zoom}
                    fill="#374151"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="select-none pointer-events-none"
                  >
                    {n.name.length > 20 ? n.name.slice(0, 18) + '…' : n.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Selected entity detail */}
      {selected && (
        <div className="bg-white border border-indigo-200 rounded-xl p-4 space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">{selected.name}</p>
              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                {entityTypes.find(t => t.type_key === selected.entity_type)?.display_label ?? selected.entity_type}
              </span>
            </div>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">×</button>
          </div>
          {selected.description && <p className="text-xs text-gray-600">{selected.description}</p>}
          {selected.source_quote && (
            <blockquote className="text-xs italic text-gray-500 border-l-2 border-gray-300 pl-2">"{selected.source_quote}"</blockquote>
          )}
          <div className="flex gap-4 text-xs text-gray-400">
            <span>Confidence: {Math.round(selected.confidence * 100)}%</span>
            <span>Relations: {selected.relation_count}</span>
            <span>Occurrences: {selected.occurrence_count}</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {entityTypes.slice(0, 10).map(t => (
          <div key={t.type_key} className="flex items-center gap-1 text-xs text-gray-500">
            <span className="inline-block w-3 h-3 rounded-full" style={{ background: getColor(t.type_key) }} />
            {t.display_label}
          </div>
        ))}
      </div>
    </div>
  );
}
