// Shared TypeScript types for the frontend

export type ProjectStatus = 'draft' | 'ready' | 'analyzing' | 'done' | 'error';
export type FileBucket = 'as-is' | 'to-be' | 'screenshot';
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
