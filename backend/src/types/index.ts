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

export interface ClusterSummary {
  clusterKey: string;
  clusterName: string;
  defectCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  riskScore: number;
  riskLevel: 'high' | 'medium' | 'low';
  topApplications: string[];
  claudeSummary: string;
  businessImpact: string;
  recommendation: string;
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
  clusterSummaries: ClusterSummary[]; // deterministic taxonomy-based clusters
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

// ─── Functional Gap Analysis Engine Types ────────────────────────────────────
export type FunctionalComponentType = 'process'|'business_rule'|'input'|'output'|'validation'|'integration'|'ui_element';
export type FunctionalExtractionStatus = 'pending'|'extracting'|'ready'|'error';
export type FunctionalRunStatus = 'pending'|'extracting'|'aligning'|'detecting'|'verifying'|'done'|'error';
export type GapType = 'unchanged'|'modified'|'missing'|'new';
export type GapStatus = 'pending'|'confirmed'|'rejected';
export type RelationshipType = 'triggers'|'produces'|'validates'|'calls'|'depends_on';
export type MatchType = 'confirmed'|'rejected'|'unmatched_asis'|'unmatched_tobe';
export interface DocumentVersion { id: string; file_id: string; version_number: number; version_label: string|null; status: FunctionalExtractionStatus; extracted_at: string|null; created_at: string; }
export interface FunctionalComponent { id: string; document_version_id: string; type: FunctionalComponentType; title: string; description: string; condition_text: string|null; action_text: string|null; source_section: string; source_quote: string; confidence: number; created_at: string; }
export interface ComponentRelationship { id: string; from_component_id: string; to_component_id: string; relationship_type: RelationshipType; source_quote: string; created_at: string; }
export interface FunctionalAnalysisRun { id: string; project_id: string; as_is_version_ids: string[]; to_be_version_ids: string[]; status: FunctionalRunStatus; progress_step: string|null; alignment_threshold: number; extraction_prompt_hash: string|null; created_at: string; completed_at: string|null; }
export interface AlignmentPair { id: string; run_id: string; as_is_component_id: string|null; to_be_component_id: string|null; match_type: MatchType; confidence: number|null; match_reason: string|null; }
export interface FieldDiff { field: string; as_is_value: string; to_be_value: string; }
export interface FunctionalGap { id: string; run_id: string; alignment_pair_id: string; gap_type: GapType; status: GapStatus; field_diffs: FieldDiff[]; as_is_quote: string|null; to_be_quote: string|null; as_is_section: string|null; to_be_section: string|null; explanation: string|null; confidence: number|null; verification_reason: string|null; created_at: string; }
export interface GapImpact { id: string; gap_id: string; affected_component_id: string; relationship_path: string[]; impact_type: string; }
export interface CoverageReport { id: string; run_id: string; total_as_is_components: number; unchanged_count: number; modified_count: number; missing_count: number; new_count: number; coverage_score: number; created_at: string; }
export interface FunctionalRunDetail extends FunctionalAnalysisRun { gaps: FunctionalGap[]; coverage: CoverageReport|null; as_is_component_count: number; to_be_component_count: number; }
