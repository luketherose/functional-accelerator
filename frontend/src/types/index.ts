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
  riskScore: number;
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

/** Risk override record attached to a defect */
export interface RiskOverride {
  override_id: string;
  overridden_priority: 'Critical' | 'High' | 'Medium' | 'Low';
  override_reason: string;
  override_date: string;
}

/** Full override record returned by the project-level audit trail endpoint */
export interface AuditOverride {
  id: string;
  defect_id: string;
  original_priority: string;
  overridden_priority: string;
  reason: string;
  created_at: string;
  updated_at: string;
  external_id: string;
  title: string;
  application: string;
  module: string;
}

/** A defect row returned by the drill-down cluster endpoint */
export interface DefectRow {
  id: string;
  external_id: string;
  title: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low' | 'Unknown';
  status: string;
  application: string;
  module: string;
  description: string;
  resolution: string;
  detected_by: string;
  assigned_to: string;
  detected_date: string;
  closed_date: string;
  environment: string;
  classification_method: 'rule' | 'unclassified';
  matched_keywords: string;
  // override fields (null when no override)
  override_id: string | null;
  overridden_priority: 'Critical' | 'High' | 'Medium' | 'Low' | null;
  override_reason: string | null;
  override_date: string | null;
}

export interface UATAnalysisResult {
  executiveSummary: string;
  overallRiskLevel: 'high' | 'medium' | 'low';
  totalDefects: number;
  byApplication: UATApplicationStat[];
  byPriority: { priority: string; count: number; percentage: number }[];
  byModule: { module: string; count: number; criticalCount: number }[];
  topDefects: { id: string; title: string; priority: string; application: string; module: string; impact: string }[];
  recurringPatterns: { pattern: string; occurrences: number; applications: string[]; priority: 'high' | 'medium' | 'low' }[];
  riskAreas: { area: string; riskLevel: 'high' | 'medium' | 'low'; rationale: string; recommendation: string; relatedApplications: string[] }[];
  preventionActions: { action: string; priority: 'high' | 'medium' | 'low'; targetApplication: string; effort: 'low' | 'medium' | 'high' }[];
  qualityTrend: string;
  clusterSummaries: ClusterSummary[];
}

// ─── Cluster trend (cross-run time series) ───────────────────────────────────

export interface ClusterTrendRun {
  analysisId: string;
  versionName: string;
  date: string;
  totalDefects: number;
}

export interface ClusterTrendPoint {
  defectCount: number;
  riskScore: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
}

export interface ClusterTrendSeries {
  clusterKey: string;
  clusterName: string;
  points: ClusterTrendPoint[]; // one per run, aligned with ClusterTrendData.runs
}

export interface ClusterTrendData {
  runs: ClusterTrendRun[];
  clusters: ClusterTrendSeries[];
}

// ─── Taxonomy config (per-project) ───────────────────────────────────────────

export interface ClusterConfig {
  id: string | null;
  cluster_key: string;
  cluster_name: string;
  keywords: string[];
  sort_order: number;
}

// ─── Cluster suggestion (Phase 2D) ───────────────────────────────────────────

export interface SuggestedCluster {
  name: string;
  rationale: string;
  defectIds: string[];
  suggestedKeywords: string[];
}

export interface SuggestClustersResult {
  suggestions: SuggestedCluster[];
  otherCount: number;
  coveredCount: number;
}

// ─── Run comparison (Phase 3B) ───────────────────────────────────────────────

export interface RunSnapshot {
  id: string;
  versionName: string;
  date: string;
  defectCount: number;
  byPriority: Record<string, number>;
  clusters: {
    cluster_key: string;
    cluster_name: string;
    defect_count: number;
    risk_score: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  }[];
}

export interface ClusterDelta {
  clusterKey: string;
  clusterName: string;
  run1Count: number;
  run2Count: number;
  delta: number;
  run1RiskScore: number;
  run2RiskScore: number;
  riskDelta: number;
  run1Critical: number;
  run1High: number;
  run2Critical: number;
  run2High: number;
}

export interface RunComparisonData {
  run1: RunSnapshot;
  run2: RunSnapshot;
  delta: {
    defectCount: number;
    byPriority: Record<string, number>;
    clusterDeltas: ClusterDelta[];
  };
}

// ─── AI Defect Copilot (Phase 4) ─────────────────────────────────────────────

export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface OpenQuestionFeedback {
  id: string;
  analysis_id: string;
  question_text: string;
  sentiment: 'positive' | 'negative' | null;
  answer: string | null;
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

// ─── Functional Gap Analysis Engine Types ────────────────────────────────────

export type FunctionalComponentType =
  | 'process'
  | 'business_rule'
  | 'input'
  | 'output'
  | 'validation'
  | 'integration'
  | 'ui_element';

export type FunctionalExtractionStatus = 'pending' | 'extracting' | 'ready' | 'error';

export type FunctionalRunStatus =
  | 'pending'
  | 'extracting'
  | 'aligning'
  | 'detecting'
  | 'verifying'
  | 'done'
  | 'error';

export type GapType = 'unchanged' | 'modified' | 'missing' | 'new';

export type GapStatus = 'pending' | 'confirmed' | 'rejected';

export type RelationshipType = 'triggers' | 'produces' | 'validates' | 'calls' | 'depends_on';

export type MatchType = 'confirmed' | 'rejected' | 'unmatched_asis' | 'unmatched_tobe';

export interface DocumentVersion {
  id: string;
  file_id: string;
  version_number: number;
  version_label: string | null;
  status: FunctionalExtractionStatus;
  extracted_at: string | null;
  created_at: string;
  // joined fields from API
  original_name?: string;
  bucket?: string;
  mime_type?: string;
  component_count?: number;
}

export interface FunctionalComponent {
  id: string;
  document_version_id: string;
  type: FunctionalComponentType;
  title: string;
  description: string;
  condition_text: string | null;
  action_text: string | null;
  source_section: string;
  source_quote: string;
  confidence: number;
  created_at: string;
}

export interface ComponentRelationship {
  id: string;
  from_component_id: string;
  to_component_id: string;
  relationship_type: RelationshipType;
  source_quote: string;
  created_at: string;
}

export interface FieldDiff {
  field: string;
  as_is_value: string;
  to_be_value: string;
}

export interface FunctionalGap {
  id: string;
  run_id: string;
  alignment_pair_id: string;
  gap_type: GapType;
  status: GapStatus;
  field_diffs: FieldDiff[];
  as_is_quote: string | null;
  to_be_quote: string | null;
  as_is_section: string | null;
  to_be_section: string | null;
  explanation: string | null;
  confidence: number | null;
  verification_reason: string | null;
  created_at: string;
  // joined from alignment_pairs
  as_is_component_id?: string | null;
  to_be_component_id?: string | null;
}

export interface GapImpact {
  id: string;
  gap_id: string;
  affected_component_id: string;
  relationship_path: string[];
  impact_type: string;
  // joined from functional_components
  title?: string;
  type?: FunctionalComponentType;
  description?: string;
}

export interface CoverageReport {
  id: string;
  run_id: string;
  total_as_is_components: number;
  unchanged_count: number;
  modified_count: number;
  missing_count: number;
  new_count: number;
  coverage_score: number;
  created_at: string;
}

export interface FunctionalAnalysisRun {
  id: string;
  project_id: string;
  as_is_version_ids: string[];
  to_be_version_ids: string[];
  status: FunctionalRunStatus;
  progress_step: string | null;
  alignment_threshold: number;
  extraction_prompt_hash: string | null;
  created_at: string;
  completed_at: string | null;
  // joined fields
  confirmed_gap_count?: number;
  coverage_score?: number | null;
}

export interface FunctionalRunDetail extends FunctionalAnalysisRun {
  gaps: FunctionalGap[];
  coverage: CoverageReport | null;
  as_is_component_count: number;
  to_be_component_count: number;
}
