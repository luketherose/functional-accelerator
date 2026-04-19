import axios from 'axios';
import type { Project, ProjectDetail, ProjectFile, Analysis, AnalysisResult, RiskAssessment, ChatMessage, ImpactFeedback, OpenQuestionFeedback, UATAnalysis, UATAnalysisResult, DefectRow, ClusterTrendData, ClusterConfig, AuditOverride, SuggestClustersResult, RunComparisonData, AIChatMessage, DocumentVersion, FunctionalComponent, FunctionalAnalysisRun, FunctionalRunDetail, FunctionalGap, CoverageReport, GapImpact, GraphDomain, DomainSettings, DomainStats, EntityTypeConfig, GraphSuggestion, KGEntity, KGRelation, GovernanceMemory, GraphData } from '../types';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
});

// --- Projects ---
export const projectsApi = {
  list: () => api.get<Project[]>('/api/projects').then(r => r.data),
  get: (id: string) => api.get<ProjectDetail>(`/api/projects/${id}`).then(r => r.data),
  create: (name: string, description: string) =>
    api.post<Project>('/api/projects', { name, description }).then(r => r.data),
  update: (id: string, data: Partial<Project>) =>
    api.patch<Project>(`/api/projects/${id}`, data).then(r => r.data),
  delete: (id: string) => api.delete(`/api/projects/${id}`).then(r => r.data),
};

// --- Files ---
export const filesApi = {
  list: (projectId: string) =>
    api.get<ProjectFile[]>(`/api/files/${projectId}`).then(r => r.data),

  upload: (projectId: string, file: File, bucket: string, onProgress?: (pct: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    form.append('bucket', bucket);
    return api.post<ProjectFile>(`/api/files/${projectId}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60_000,
      onUploadProgress: (e) => {
        if (onProgress && e.total) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    }).then(r => r.data);
  },

  delete: (projectId: string, fileId: string) =>
    api.delete(`/api/files/${projectId}/${fileId}`).then(r => r.data),

  previewUrl: (projectId: string, fileId: string) =>
    `${BASE_URL}/api/files/${projectId}/${fileId}/preview`,

  indexStatus: (projectId: string) =>
    api.get<{ total: number; indexed: number; pending: number }>(`/api/files/${projectId}/index-status`).then(r => r.data),

  reindex: (projectId: string) =>
    api.post<{ message: string; total: number }>(`/api/files/${projectId}/reindex`).then(r => r.data),
};

// --- Analysis ---
export const analysisApi = {
  list: (projectId: string) =>
    api.get<Analysis[]>(`/api/analysis/${projectId}`).then(r => r.data),

  get: (projectId: string, analysisId: string) =>
    api.get<Analysis>(`/api/analysis/${projectId}/${analysisId}`).then(r => r.data),

  run: (projectId: string) =>
    api.post<{ analysisId: string; versionName: string; status: string }>(
      `/api/analysis/${projectId}/run`
    ).then(r => r.data),

  delete: (projectId: string, analysisId: string) =>
    api.delete(`/api/analysis/${projectId}/${analysisId}`).then(r => r.data),

  getImpactPrototype: (projectId: string, analysisId: string, impactId: string) =>
    api.get<{ id: string; impact_id: string; image_data: string; created_at: string }>(
      `/api/analysis/${projectId}/${analysisId}/impact-prototype/${encodeURIComponent(impactId)}`
    ).then(r => r.data),

  listFeedback: (projectId: string, analysisId: string) =>
    api.get<ImpactFeedback[]>(`/api/analysis/${projectId}/${analysisId}/feedback`).then(r => r.data),

  saveFeedback: (
    projectId: string,
    analysisId: string,
    impactId: string,
    sentiment: 'positive' | 'negative',
    motivation?: string
  ) =>
    api.post<ImpactFeedback>(`/api/analysis/${projectId}/${analysisId}/feedback`, { impactId, sentiment, motivation }).then(r => r.data),

  deleteFeedback: (projectId: string, analysisId: string, impactId: string) =>
    api.delete(`/api/analysis/${projectId}/${analysisId}/feedback/${encodeURIComponent(impactId)}`).then(r => r.data),

  listOQFeedback: (projectId: string, analysisId: string) =>
    api.get<OpenQuestionFeedback[]>(`/api/analysis/${projectId}/${analysisId}/open-question-feedback`).then(r => r.data),

  saveOQFeedback: (
    projectId: string,
    analysisId: string,
    questionText: string,
    sentiment: 'positive' | 'negative' | null,
    answer?: string | null
  ) =>
    api.post<OpenQuestionFeedback>(`/api/analysis/${projectId}/${analysisId}/open-question-feedback`, { questionText, sentiment, answer }).then(r => r.data),

  deleteOQFeedback: (projectId: string, analysisId: string, questionText: string) =>
    api.delete(`/api/analysis/${projectId}/${analysisId}/open-question-feedback`, { data: { questionText } }).then(r => r.data),

  impactDeepDive: (
    projectId: string,
    analysisId: string,
    impactArea: string,
    impactDescription: string,
    messages: ChatMessage[]
  ) =>
    api.post<{ response: string }>(
      `/api/analysis/${projectId}/${analysisId}/impact-deepdive`,
      { impactArea, impactDescription, messages },
      { timeout: 120_000 }
    ).then(r => r.data),

  generateImpactPrototype: (
    projectId: string,
    analysisId: string,
    impactId: string,
    impactArea: string,
    impactDescription: string,
    file: File,
    userPrompt?: string
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('impactId', impactId);
    form.append('impactArea', impactArea);
    form.append('impactDescription', impactDescription);
    if (userPrompt?.trim()) form.append('userPrompt', userPrompt.trim());
    return api.post<{ id: string; impact_id: string; image_data: string; created_at: string }>(
      `/api/analysis/${projectId}/${analysisId}/impact-prototype`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180_000 }
    ).then(r => r.data);
  },
};

// --- Risk Assessment ---
export const riskApi = {
  list: (projectId: string) =>
    api.get<RiskAssessment[]>(`/api/risk/${projectId}`).then(r => r.data),

  get: (projectId: string, assessmentId: string) =>
    api.get<RiskAssessment>(`/api/risk/${projectId}/${assessmentId}`).then(r => r.data),

  run: (projectId: string, file: File, sourceContext: string, targetContext: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('sourceContext', sourceContext);
    form.append('targetContext', targetContext);
    return api.post<{ assessmentId: string; versionName: string; status: string }>(
      `/api/risk/${projectId}/run`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30_000 }
    ).then(r => r.data);
  },

  delete: (projectId: string, assessmentId: string) =>
    api.delete(`/api/risk/${projectId}/${assessmentId}`).then(r => r.data),
};

// --- UAT Risk Analysis ---
export const uatApi = {
  list: (projectId: string) =>
    api.get<UATAnalysis[]>(`/api/uat/${projectId}`).then(r => r.data),

  get: (projectId: string, analysisId: string) =>
    api.get<UATAnalysis>(`/api/uat/${projectId}/${analysisId}`).then(r => r.data),

  run: (projectId: string, files: File | File[]) => {
    const form = new FormData();
    const list = Array.isArray(files) ? files : [files];
    for (const f of list) form.append('files', f);
    return api.post<{ analysisId: string; versionName: string; status: string; defectCount: number; fileCount: number; warnings?: string[] }>(
      `/api/uat/${projectId}/run`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30_000 }
    ).then(r => r.data);
  },

  delete: (projectId: string, analysisId: string) =>
    api.delete(`/api/uat/${projectId}/${analysisId}`).then(r => r.data),

  /** Aggregate cluster list for a completed analysis run */
  listClusters: (projectId: string, analysisId: string) =>
    api.get<{
      cluster_key: string;
      cluster_name: string;
      defect_count: number;
      critical_count: number;
      high_count: number;
      medium_count: number;
      low_count: number;
    }[]>(`/api/uat/${projectId}/${analysisId}/clusters`).then(r => r.data),

  /** Defects belonging to a specific cluster in an analysis run */
  listClusterDefects: (projectId: string, analysisId: string, clusterKey: string) =>
    api.get<DefectRow[]>(
      `/api/uat/${projectId}/${analysisId}/clusters/${encodeURIComponent(clusterKey)}/defects`
    ).then(r => r.data),

  /** All defects ever ingested for a project (across all runs) */
  listAllDefects: (projectId: string, limit = 500, offset = 0) =>
    api.get<{ defects: DefectRow[]; total: number; limit: number; offset: number }>(
      `/api/uat/${projectId}/defects/all`,
      { params: { limit, offset } }
    ).then(r => r.data),

  /** Per-cluster time series across all completed runs */
  clusterTrend: (projectId: string) =>
    api.get<ClusterTrendData>(`/api/uat/${projectId}/cluster-trend`).then(r => r.data),

  /** Get project taxonomy (DB config or defaults) */
  getTaxonomy: (projectId: string) =>
    api.get<ClusterConfig[]>(`/api/uat/${projectId}/taxonomy`).then(r => r.data),

  /** Save full taxonomy for a project */
  saveTaxonomy: (projectId: string, clusters: { cluster_key: string; cluster_name: string; keywords: string[] }[]) =>
    api.put<{ success: boolean; saved: number }>(`/api/uat/${projectId}/taxonomy`, clusters).then(r => r.data),

  /** Re-classify all defects using the current (possibly updated) taxonomy */
  recluster: (projectId: string) =>
    api.post<{ message: string; runs: number }>(`/api/uat/${projectId}/recluster`).then(r => r.data),

  /** Project-level audit trail: all risk overrides with defect context */
  listOverrides: (projectId: string) =>
    api.get<AuditOverride[]>(`/api/uat/${projectId}/overrides`).then(r => r.data),

  /** Set or update a risk override for a specific defect */
  setOverride: (projectId: string, defectId: string, overriddenPriority: string, reason: string) =>
    api.post(`/api/uat/${projectId}/defects/${defectId}/override`, { overriddenPriority, reason }).then(r => r.data),

  /** Remove the override for a specific defect (restores computed priority) */
  deleteOverride: (projectId: string, defectId: string) =>
    api.delete(`/api/uat/${projectId}/defects/${defectId}/override`).then(r => r.data),

  /** Phase 2D — discover hidden themes in unclassified ("Other") defects */
  suggestClusters: (projectId: string) =>
    api.post<SuggestClustersResult>(`/api/uat/${projectId}/suggest-clusters`, {}, { timeout: 120_000 }).then(r => r.data),

  /** Phase 3B — side-by-side comparison of two completed runs */
  compareRuns: (projectId: string, run1Id: string, run2Id: string) =>
    api.get<RunComparisonData>(`/api/uat/${projectId}/compare`, { params: { run1: run1Id, run2: run2Id } }).then(r => r.data),

  /** Phase 4 — AI Defect Copilot conversational chat */
  aiChat: (projectId: string, analysisId: string, message: string, history: AIChatMessage[]) =>
    api.post<{ response: string }>(
      `/api/uat/${projectId}/${analysisId}/ai-chat`,
      { message, history },
      { timeout: 120_000 }
    ).then(r => r.data),
};

function isUATAnalysisResult(obj: unknown): obj is UATAnalysisResult {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    'executiveSummary' in (obj as object) &&
    'totalDefects' in (obj as object)
  );
}

export function parseUATResult(analysis: UATAnalysis): UATAnalysisResult | null {
  if (!analysis.result_json) return null;
  try {
    const parsed = JSON.parse(analysis.result_json);
    return isUATAnalysisResult(parsed) ? parsed : null;
  } catch { return null; }
}

// Helper to parse result_json from an analysis record
export function parseAnalysisResult(analysis: Analysis): AnalysisResult | null {
  if (!analysis.result_json) return null;
  try {
    return JSON.parse(analysis.result_json) as AnalysisResult;
  } catch {
    return null;
  }
}

// ─── Functional Gap Analysis API ─────────────────────────────────────────────

export const functionalApi = {
  listVersions: (projectId: string) =>
    api.get<DocumentVersion[]>(`/api/functional/${projectId}/versions`).then(r => r.data),

  createVersion: (projectId: string, fileId: string, versionLabel?: string) =>
    api.post<DocumentVersion>(`/api/functional/${projectId}/versions`, { file_id: fileId, version_label: versionLabel }).then(r => r.data),

  listComponents: (projectId: string, versionId: string, type?: string) =>
    api.get<FunctionalComponent[]>(`/api/functional/${projectId}/versions/${versionId}/components`, { params: type ? { type } : undefined }).then(r => r.data),

  listRuns: (projectId: string) =>
    api.get<FunctionalAnalysisRun[]>(`/api/functional/${projectId}/runs`).then(r => r.data),

  createRun: (projectId: string, asIsVersionIds: string[], toBeVersionIds: string[]) =>
    api.post<FunctionalAnalysisRun>(`/api/functional/${projectId}/runs`, { as_is_version_ids: asIsVersionIds, to_be_version_ids: toBeVersionIds }).then(r => r.data),

  getRun: (projectId: string, runId: string) =>
    api.get<FunctionalRunDetail>(`/api/functional/${projectId}/runs/${runId}`).then(r => r.data),

  listGaps: (projectId: string, runId: string, filters?: { gap_type?: string; min_confidence?: number }) =>
    api.get<FunctionalGap[]>(`/api/functional/${projectId}/runs/${runId}/gaps`, { params: filters }).then(r => r.data),

  getCoverage: (projectId: string, runId: string) =>
    api.get<CoverageReport>(`/api/functional/${projectId}/runs/${runId}/coverage`).then(r => r.data),

  getGapImpacts: (projectId: string, runId: string, gapId: string) =>
    api.get<GapImpact[]>(`/api/functional/${projectId}/runs/${runId}/gaps/${gapId}/impacts`).then(r => r.data),

  deleteRun: (projectId: string, runId: string) =>
    api.delete(`/api/functional/${projectId}/runs/${runId}`).then(r => r.data),
};

// ─── Graph Governance API ────────────────────────────────────────────────────

export const graphApi = {
  getStats: (domain: GraphDomain, projectId: string) =>
    api.get<DomainStats>(`/api/graph/${domain}/${projectId}/stats`).then(r => r.data),

  getSettings: (domain: GraphDomain, projectId: string) =>
    api.get<DomainSettings>(`/api/graph/${domain}/${projectId}/settings`).then(r => r.data),

  setMode: (domain: GraphDomain, projectId: string, mode: 'manual' | 'assisted' | 'auto') =>
    api.put(`/api/graph/${domain}/${projectId}/settings`, { mode }).then(r => r.data),

  // Ontology
  getEntityTypes: (domain: GraphDomain, projectId: string) =>
    api.get<EntityTypeConfig[]>(`/api/graph/${domain}/${projectId}/entity-types`).then(r => r.data),

  addEntityType: (domain: GraphDomain, projectId: string, type_key: string, display_label: string, description?: string) =>
    api.post(`/api/graph/${domain}/${projectId}/entity-types`, { type_key, display_label, description }).then(r => r.data),

  updateEntityType: (domain: GraphDomain, projectId: string, typeKey: string, patch: Partial<{ display_label: string; description: string; discoverable: boolean; enabled: boolean }>) =>
    api.patch(`/api/graph/${domain}/${projectId}/entity-types/${encodeURIComponent(typeKey)}`, patch).then(r => r.data),

  // Suggestions
  getSuggestions: (domain: GraphDomain, projectId: string, status = 'pending') =>
    api.get<GraphSuggestion[]>(`/api/graph/${domain}/${projectId}/suggestions`, { params: { status } }).then(r => r.data),

  approveSuggestion: (domain: GraphDomain, projectId: string, id: string, overrides?: { name?: string; entity_type?: string }) =>
    api.post<{ ok: boolean; entity_id: string }>(`/api/graph/${domain}/${projectId}/suggestions/${id}/approve`, overrides ?? {}).then(r => r.data),

  rejectSuggestion: (domain: GraphDomain, projectId: string, id: string, alwaysIgnore = false) =>
    api.post(`/api/graph/${domain}/${projectId}/suggestions/${id}/reject`, { always_ignore: alwaysIgnore }).then(r => r.data),

  mergeSuggestion: (domain: GraphDomain, projectId: string, id: string, targetEntityId: string) =>
    api.post(`/api/graph/${domain}/${projectId}/suggestions/${id}/merge`, { target_entity_id: targetEntityId }).then(r => r.data),

  // Entity registry
  getEntities: (domain: GraphDomain, projectId: string, opts?: { type?: string; search?: string; limit?: number; offset?: number }) =>
    api.get<{ entities: KGEntity[]; total: number }>(`/api/graph/${domain}/${projectId}/entities`, { params: opts }).then(r => r.data),

  updateEntity: (domain: GraphDomain, projectId: string, entityId: string, patch: { name?: string; entity_type?: string; description?: string }) =>
    api.patch(`/api/graph/${domain}/${projectId}/entities/${entityId}`, patch).then(r => r.data),

  deleteEntity: (domain: GraphDomain, projectId: string, entityId: string) =>
    api.delete(`/api/graph/${domain}/${projectId}/entities/${entityId}`).then(r => r.data),

  mergeEntities: (domain: GraphDomain, projectId: string, sourceEntityId: string, targetEntityId: string) =>
    api.post(`/api/graph/${domain}/${projectId}/entities/${sourceEntityId}/merge`, { target_entity_id: targetEntityId }).then(r => r.data),

  // Relations
  getRelations: (domain: GraphDomain, projectId: string, opts?: { entityId?: string; limit?: number; offset?: number }) =>
    api.get<{ relations: KGRelation[]; total: number }>(`/api/graph/${domain}/${projectId}/relations`, { params: opts }).then(r => r.data),

  deleteRelation: (domain: GraphDomain, projectId: string, relationId: string) =>
    api.delete(`/api/graph/${domain}/${projectId}/relations/${relationId}`).then(r => r.data),

  // Graph visualization data
  getGraphData: (domain: GraphDomain, projectId: string, opts?: { typeFilter?: string[]; minConfidence?: number; limit?: number }) =>
    api.get<GraphData>(`/api/graph/${domain}/${projectId}/graph-data`, {
      params: { ...opts, typeFilter: opts?.typeFilter?.join(',') }
    }).then(r => r.data),

  // Governance memory
  getMemory: (domain: GraphDomain, projectId: string) =>
    api.get<GovernanceMemory[]>(`/api/graph/${domain}/${projectId}/memory`).then(r => r.data),
};

export default api;
