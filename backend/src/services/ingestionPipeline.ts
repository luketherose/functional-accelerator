import db from '../db';
import { parseFile } from './fileParsing';
import type { FunctionalRunDetail } from '../types';

export type ProgressCallback = (step: string) => void;

// Lazy imports with fallbacks for parallel development
async function getExtractor() {
  try { return await import('./functionalExtractor'); }
  catch { return { extractFunctionalComponents: async () => [], extractComponentRelationships: async () => [] }; }
}
async function getAligner() {
  try { return await import('./alignmentEngine'); }
  catch { return { alignComponents: async () => [] }; }
}
async function getDetector() {
  try { return await import('./gapDetector'); }
  catch { return { detectGaps: () => [] }; }
}
async function getPropagator() {
  try { return await import('./impactPropagator'); }
  catch { return { propagateImpacts: () => [] }; }
}
async function getVerifier() {
  try { return await import('./verificationPass'); }
  catch { return { runVerificationPass: async () => {} }; }
}
async function getReporter() {
  try { return await import('./functionalReporter'); }
  catch {
    return {
      buildRunReport: () => ({
        id: '',
        project_id: '',
        as_is_version_ids: [],
        to_be_version_ids: [],
        status: 'done' as const,
        progress_step: null,
        alignment_threshold: 0.75,
        extraction_prompt_hash: null,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        gaps: [],
        coverage: null,
        as_is_component_count: 0,
        to_be_component_count: 0,
      }),
    };
  }
}

function updateVersionStatus(versionId: string, status: string, extractedAt?: string) {
  if (extractedAt) {
    db.prepare('UPDATE document_versions SET status = ?, extracted_at = ? WHERE id = ?').run(status, extractedAt, versionId);
  } else {
    db.prepare('UPDATE document_versions SET status = ? WHERE id = ?').run(status, versionId);
  }
}

function updateRunStatus(runId: string, status: string, progressStep?: string, completedAt?: string) {
  if (completedAt) {
    db.prepare('UPDATE functional_analysis_runs SET status = ?, progress_step = ?, completed_at = ? WHERE id = ?').run(status, progressStep ?? null, completedAt, runId);
  } else if (progressStep !== undefined) {
    db.prepare('UPDATE functional_analysis_runs SET status = ?, progress_step = ? WHERE id = ?').run(status, progressStep, runId);
  } else {
    db.prepare('UPDATE functional_analysis_runs SET status = ? WHERE id = ?').run(status, runId);
  }
}

export async function runExtractionPipeline(
  projectId: string,
  fileId: string,
  versionId: string,
  onProgress: ProgressCallback = () => {}
): Promise<void> {
  updateVersionStatus(versionId, 'extracting');

  try {
    const fileRow = db.prepare('SELECT path, mime_type, original_name, bucket FROM files WHERE id = ?').get(fileId) as
      | { path: string; mime_type: string; original_name: string; bucket: string }
      | undefined;
    if (!fileRow) throw new Error(`File not found: ${fileId}`);

    onProgress('Step 1/4: Parsing document');
    const text = await parseFile(fileRow.path, fileRow.mime_type);
    if (!text || text.trim().length < 10) {
      throw new Error('Could not extract text from document. Please check the file format.');
    }

    onProgress('Step 2/4: Extracting functional components');
    const { extractFunctionalComponents, extractComponentRelationships } = await getExtractor();
    const components = await extractFunctionalComponents(
      versionId,
      text,
      fileRow.original_name,
      fileRow.bucket as 'as-is' | 'to-be' | 'business-rules'
    );

    onProgress('Step 3/4: Extracting component relationships');
    await extractComponentRelationships(versionId, components, text);

    onProgress('Step 4/4: Saving functional model');
    updateVersionStatus(versionId, 'ready', new Date().toISOString());
  } catch (err) {
    console.error('[ingestionPipeline] Extraction failed:', err);
    updateVersionStatus(versionId, 'error');
    throw err;
  }
}

export async function runGapAnalysisPipeline(
  runId: string,
  onProgress: ProgressCallback = () => {}
): Promise<FunctionalRunDetail> {
  updateRunStatus(runId, 'aligning', 'Step 1/6: Loading component models');

  try {
    const run = db.prepare('SELECT * FROM functional_analysis_runs WHERE id = ?').get(runId) as
      | { as_is_version_ids: string; to_be_version_ids: string; alignment_threshold: number }
      | undefined;
    if (!run) throw new Error(`Run not found: ${runId}`);

    const asIsVersionIds: string[] = JSON.parse(run.as_is_version_ids);
    const toBeVersionIds: string[] = JSON.parse(run.to_be_version_ids);

    onProgress('Step 2/6: Aligning AS-IS ↔ TO-BE components');
    updateRunStatus(runId, 'aligning', 'Step 2/6: Aligning components');
    const { alignComponents } = await getAligner();
    await alignComponents(runId, asIsVersionIds, toBeVersionIds, run.alignment_threshold);

    onProgress('Step 3/6: Detecting functional gaps');
    updateRunStatus(runId, 'detecting', 'Step 3/6: Detecting gaps');
    const { detectGaps } = await getDetector();
    detectGaps(runId);

    onProgress('Step 4/6: Propagating impacts');
    updateRunStatus(runId, 'detecting', 'Step 4/6: Propagating impacts');
    const { propagateImpacts } = await getPropagator();
    propagateImpacts(runId);

    onProgress('Step 5/6: Verifying gap evidence');
    updateRunStatus(runId, 'verifying', 'Step 5/6: Verifying gaps');
    const { runVerificationPass } = await getVerifier();
    await runVerificationPass(runId);

    onProgress('Step 6/6: Assembling final report');
    const { buildRunReport } = await getReporter();
    const report = buildRunReport(runId);

    updateRunStatus(runId, 'done', 'Step 6/6: Complete', new Date().toISOString());
    return report;
  } catch (err) {
    console.error('[ingestionPipeline] Gap analysis failed:', err);
    updateRunStatus(runId, 'error', `Error: ${(err as Error).message}`);
    throw err;
  }
}
