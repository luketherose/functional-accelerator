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

// ─── UAT Risk Analysis ────────────────────────────────────────────────────────

export interface UATAnalysis {
  id: string;
  project_id: string;
  version_name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  file_name: string | null;
  defect_count: number | null;
  result_json: string | null;
  error_message: string | null;
  progress_step: string | null;
  created_at: string;
}

export interface UATApplicationStat {
  application: string;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  riskScore: number; // computed: critical*4 + high*2 + medium*1
}

export interface UATDefectPattern {
  pattern: string;
  occurrences: number;
  applications: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface UATRiskArea {
  area: string;
  riskLevel: 'high' | 'medium' | 'low';
  rationale: string;
  recommendation: string;
  relatedApplications: string[];
}

export interface UATPreventionAction {
  action: string;
  priority: 'high' | 'medium' | 'low';
  targetApplication: string;
  effort: 'low' | 'medium' | 'high';
}

export interface UATAnalysisResult {
  executiveSummary: string;
  overallRiskLevel: 'high' | 'medium' | 'low';
  totalDefects: number;
  byApplication: UATApplicationStat[];
  byPriority: { priority: string; count: number; percentage: number }[];
  byModule: { module: string; count: number; criticalCount: number }[];
  topDefects: { id: string; title: string; priority: string; application: string; module: string; impact: string }[];
  recurringPatterns: UATDefectPattern[];
  riskAreas: UATRiskArea[];
  preventionActions: UATPreventionAction[];
  qualityTrend: string; // narrative about open vs closed, resolution patterns
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
