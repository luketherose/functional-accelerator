// Shared TypeScript types for the frontend

export type ProjectStatus = 'draft' | 'ready' | 'analyzing' | 'done' | 'error';
export type FileBucket = 'as-is' | 'to-be' | 'business-rules';
export type AnalysisStatus = 'pending' | 'running' | 'done' | 'error';
export type Severity = 'high' | 'medium' | 'low';
export type ChangeType = 'modified' | 'new' | 'removed';

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
  status: AnalysisStatus;
  input_summary: string | null;
  result_json: string | null;
  error_message: string | null;
  progress_step: string | null;
  created_at: string;
}

export interface ProjectDetail extends Project {
  files: ProjectFile[];
  analyses: Analysis[];
}

// Analysis result
export interface Impact {
  id: string;
  area: string;
  description: string;
  severity: Severity;
}

export interface AffectedScreen {
  name: string;
  currentBehavior: string;
  proposedBehavior: string;
  changeType: ChangeType;
}

export interface BusinessRule {
  id: string;
  description: string;
  source: string;
}

export interface ProposedChange {
  screen: string;
  change: string;
  priority: Severity;
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

export interface ImpactFeedback {
  id: string;
  analysis_id: string;
  impact_id: string;
  sentiment: 'positive' | 'negative';
  motivation: string | null;
  created_at: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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
