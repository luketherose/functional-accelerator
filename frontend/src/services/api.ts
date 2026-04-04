import axios from 'axios';
import type { Project, ProjectDetail, ProjectFile, Analysis, AnalysisResult } from '../types';

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
    api.get<{ id: string; impact_id: string; html: string; created_at: string }>(
      `/api/analysis/${projectId}/${analysisId}/impact-prototype/${encodeURIComponent(impactId)}`
    ).then(r => r.data),

  generateImpactPrototype: (
    projectId: string,
    analysisId: string,
    impactId: string,
    impactArea: string,
    impactDescription: string,
    file: File
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('impactId', impactId);
    form.append('impactArea', impactArea);
    form.append('impactDescription', impactDescription);
    return api.post<{ id: string; impact_id: string; html: string; created_at: string }>(
      `/api/analysis/${projectId}/${analysisId}/impact-prototype`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 }
    ).then(r => r.data);
  },
};

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
