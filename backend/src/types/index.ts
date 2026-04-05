// Shared TypeScript types used across backend modules

export type ProjectStatus = 'draft' | 'ready' | 'analyzing' | 'done' | 'error';
export type FileBucket = 'as-is' | 'to-be' | 'business-rules';

export interface Project {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface ProjectFile {
  id: string;
  project_id: string;
  name: string;
  original_name: string;
  mime_type: string;
  size: number;
  bucket: FileBucket;
  path: string;
  extracted_text: string | null;
  created_at: string;
}

export interface Analysis {
  id: string;
  project_id: string;
  version_name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  input_summary: string | null;
  result_json: string | null;
  error_message: string | null;
  created_at: string;
}

// --- Analysis result schema returned by Claude ---

export interface Impact {
  id: string;
  area: string;
  description: string;
  severity: 'high' | 'medium' | 'low';
}

export interface AffectedScreen {
  name: string;
  currentBehavior: string;
  proposedBehavior: string;
  changeType: 'modified' | 'new' | 'removed';
}

export interface BusinessRule {
  id: string;
  description: string;
  source: string;
}

export interface ProposedChange {
  screen: string;
  change: string;
  priority: 'high' | 'medium' | 'low';
}

export interface RiskAssessment {
  id: string;
  project_id: string;
  version_name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  defect_count: number | null;
  result_json: string | null;
  error_message: string | null;
  progress_step: string | null;
  created_at: string;
}

export interface RiskAssessmentResult {
  summary: string;
  defectCategories: { name: string; count: number; percentage: number }[];
  priorityDistribution: { priority: string; count: number; percentage: number }[];
  topDefects: { title: string; count: number; priority: string; category: string }[];
  riskAreas: { area: string; riskLevel: 'high' | 'medium' | 'low'; rationale: string; recommendation: string }[];
  patterns: string[];
  overallRiskLevel: 'high' | 'medium' | 'low';
}

export interface AnalysisResult {
  executiveSummary: string;
  functionalImpacts: Impact[];
  uiUxImpacts: Impact[];
  affectedScreens: AffectedScreen[];
  businessRulesExtracted: BusinessRule[];
  proposedChanges: ProposedChange[];
  prototypeInstructions: string;
  prototypeHtml: string;
  assumptions: string[];
  openQuestions: string[];
}
