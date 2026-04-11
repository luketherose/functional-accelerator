import axios from 'axios';
import type { Project, ProjectDetail, ProjectFile, Analysis, AnalysisResult, RiskAssessment, ChatMessage, ImpactFeedback, OpenQuestionFeedback, UATAnalysis, UATAnalysisResult, DefectRow, ClusterTrendData, ClusterConfig } from '../types';

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

  run: (projectId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<{ analysisId: string; versionName: string; status: string; defectCount: number }>(
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
};

export function parseUATResult(analysis: UATAnalysis): UATAnalysisResult | null {
  if (!analysis.result_json) return null;
  try { return JSON.parse(analysis.result_json) as UATAnalysisResult; } catch { return null; }
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

export default api;
