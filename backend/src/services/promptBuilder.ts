import type { ProjectFile } from '../types';

// ─── Pipeline-internal types ────────────────────────────────────────────────

/** One logical functional area extracted from a single document side (AS-IS or TO-BE). */
export interface FunctionalArea {
  name: string;
  category: 'data' | 'process' | 'rule' | 'ui' | 'integration' | 'security' | 'other';
  description: string;
  keyFields: string[];
  businessRules: string[];
  sourceRefs: string[];
}

export interface FunctionalCatalog {
  areas: FunctionalArea[];
}

/** Evidence attached to a single side of a delta. */
export interface DeltaEvidence {
  section: string;
  quote: string;
  verified: boolean;
}

/** One detected functional change between AS-IS and TO-BE. */
export interface Delta {
  functionalArea: string;
  changeType: 'MODIFIED' | 'ADDED' | 'REMOVED' | 'UNCHANGED' | 'UNCERTAIN';
  asIsEvidence: DeltaEvidence | null;
  toBeEvidence: DeltaEvidence | null;
  deltaSummary: string;
  severity: 'high' | 'medium' | 'low';
  category: 'functional' | 'uiux' | 'businessRule' | 'screen' | 'integration';
  confidence: number;
  needsHumanReview: boolean;
}

export interface ComparisonResult {
  deltas: Delta[];
  coverageMetrics: {
    asisAreasFound: number;
    tobeAreasFound: number;
    alignedAreas: number;
    uncertainAreas: number;
    coverageWarning: string | null;
  };
}

export interface ImpactFeedback {
  impact_id: string;
  sentiment: 'positive' | 'negative';
  motivation: string | null;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

/**
 * Builds a structured, deterministic prompt for functional analysis.
 * Separates as-is context from to-be context.
 */
export async function buildAnalysisPrompt(
  project: { name: string; description: string },
  files: ProjectFile[],
  prevFeedback: ImpactFeedback[] = []
): Promise<string> {
  const asisFiles = files.filter(f => f.bucket === 'as-is');
  const tobeFiles = files.filter(f => f.bucket === 'to-be');
  const brFiles = files.filter(f => f.bucket === 'business-rules');

  const formatFileSection = (fileList: ProjectFile[], sectionTitle: string): string => {
    if (fileList.length === 0) return `### ${sectionTitle}\n_No documents uploaded._\n`;
    return `### ${sectionTitle}\n` + fileList.map(f => {
      const text = f.extracted_text
        ? `\n**File:** ${f.original_name}\n\`\`\`\n${f.extracted_text.slice(0, 30_000)}\n\`\`\``
        : `\n**File:** ${f.original_name} (${f.mime_type}) — [no extractable text, provided as reference]`;
      return text;
    }).join('\n\n---\n\n');
  };

  const brSection = brFiles.length > 0
    ? `${formatFileSection(brFiles, 'PROVIDED Business Rules (factum positum — treat as authoritative, do not modify or re-infer)')}`
    : '';

  const hasBrFiles = brFiles.length > 0;

  const feedbackSection = prevFeedback.length > 0 ? `
---

## FEEDBACK FROM PREVIOUS ANALYSIS (mandatory — read before producing output)

A human reviewer evaluated the previous analysis run and left the following corrections. You MUST take these into account:

${prevFeedback.map(f => {
    const label = f.sentiment === 'negative' ? '❌ INCORRECT — do NOT reproduce this impact' : '✅ CONFIRMED CORRECT';
    const reason = f.motivation ? `\n   Reviewer note: "${f.motivation}"` : '';
    return `- Impact **${f.impact_id}**: ${label}${reason}`;
  }).join('\n')}

Rules:
- Impacts marked ❌ INCORRECT must NOT appear in the new output, even if you find evidence for them in the documents.
- Impacts marked ✅ CONFIRMED CORRECT should be preserved (updated if new evidence warrants it, but not dropped without reason).
- If the reviewer left a note, use it to understand what was wrong or right and adjust accordingly.
` : '';

  return `You are an expert functional analyst and UI/UX architect.
You have been given documentation for a software project and must produce a thorough impact analysis.

## PROJECT CONTEXT
**Name:** ${project.name}
**Description:** ${project.description || 'No description provided.'}

---

## DOCUMENTATION PROVIDED

${formatFileSection(asisFiles, 'AS-IS Documentation (Current State)')}

${formatFileSection(tobeFiles, 'TO-BE Documentation (Target Requirements)')}

${brSection}
${feedbackSection}

---

## YOUR TASK

Produce a **DELTA analysis** — identify only what CHANGES when moving from the AS-IS state to the TO-BE requirements.

⚠️ CRITICAL DELTA RULE (strictly enforced):
- Every item in \`functionalImpacts\`, \`uiUxImpacts\`, \`affectedScreens\`, and \`proposedChanges\` MUST describe something that is **different** between AS-IS and TO-BE.
- Do NOT include features, behaviours, or screens that already exist in AS-IS and are NOT modified by TO-BE.
- Each impact description MUST explicitly state: what exists today (AS-IS) and what will change (TO-BE).
- If no TO-BE documentation is provided, state this clearly in \`executiveSummary\` and leave impact arrays empty — do not invent changes.

Return your response **exclusively as valid JSON** — no markdown code fences, no prose before or after, just the raw JSON object.

Use this exact schema:

{
  "executiveSummary": "string — 3-5 sentence summary of what changes and why${hasBrFiles ? '. Explicitly mention which business rules were provided vs inferred.' : ''}",
  "functionalImpacts": [
    { "id": "FI-01", "area": "string", "description": "string — must describe the delta: what changes from AS-IS to TO-BE", "severity": "high|medium|low" }
  ],
  "uiUxImpacts": [
    { "id": "UX-01", "area": "string", "description": "string — must describe the delta: what changes from AS-IS to TO-BE", "severity": "high|medium|low" }
  ],
  "affectedScreens": [
    {
      "name": "string",
      "currentBehavior": "string — what the screen does TODAY (AS-IS)",
      "proposedBehavior": "string — what the screen will do AFTER the change (TO-BE)",
      "changeType": "modified|new|removed"
    }
  ],
  "businessRulesExtracted": [
    { "id": "BR-01", "description": "string", "source": "${hasBrFiles ? 'provided|as-is|to-be|inferred' : 'as-is|to-be|inferred'}" }
  ],
  "proposedChanges": [
    { "screen": "string", "change": "string — the specific modification required, not existing behaviour", "priority": "high|medium|low" }
  ],
  "assumptions": ["string"],
  "openQuestions": ["string"]
}

Requirements:
- Only include impacts for genuine AS-IS → TO-BE changes; omit existing unchanged functionality
- Keep descriptions concise (2-3 sentences max per item)
${hasBrFiles ? '- For businessRulesExtracted: include ALL provided business rules with source "provided". Do NOT re-state them differently. Then add any ADDITIONAL rules you infer from context with source "inferred".\n' : ''}- If context is insufficient to identify real deltas, explain what is missing in \`openQuestions\`

Respond with JSON only.`;
}

/**
 * Builds a focused prompt for generating a per-impact UI prototype.
 * The image of the current (as-is) screen is attached as a vision block by the caller.
 */
export function buildImpactPrototypePrompt(
  impact: { area: string; description: string },
  projectName: string,
  userPrompt?: string
): string {
  const userGuidance = userPrompt?.trim()
    ? `\n## ADDITIONAL INSTRUCTIONS FROM USER\n${userPrompt.trim()}\n`
    : '';

  return `You are an expert UI/UX designer. You are given a screenshot of a screen from "${projectName}" and a specific UI/UX change to apply to it.

**Screen / Area:** ${impact.area}
**Change to implement:** ${impact.description}
${userGuidance}
## YOUR TASK
Reproduce the FULL screen as an HTML page, applying the described change. Then visually highlight the changed element(s) so they are immediately obvious.

## HIGHLIGHTING RULES (mandatory)
- Every element you added or modified MUST be highlighted with a red annotation
- Use a red dashed border: \`outline: 3px dashed #ef4444; outline-offset: 4px;\`
- Add a small red label badge positioned near the changed element:
  \`<span style="position:absolute;top:-22px;left:0;background:#ef4444;color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;white-space:nowrap;">NEW</span>\`
- Wrap the changed element in a \`position:relative\` container so the badge positions correctly
- Do NOT highlight unchanged elements

## HTML RULES
- Output ONLY raw HTML — no JSON, no markdown fences, no prose before or after
- Start directly with \`<!DOCTYPE html>\`
- Use a \`<style>\` block in \`<head>\` for all CSS — no inline styles except for the highlight annotations
- Do NOT use external fonts, CDN links, or images (use placeholder colored divs/icons if needed)
- Reproduce the full page layout: header/nav, sidebar if present, main content, footer
- Use realistic placeholder data (labels, names, amounts) consistent with the original screenshot
- Keep the visual style consistent with the original (colors, spacing, typography feel)`;
}

/**
 * Builds the system prompt for a per-impact deep-dive conversation.
 *
 * When `retrievedContext` is provided (RAG mode), its pre-retrieved chunks are used
 * as the documentation context instead of dumping full file texts.
 * Falls back to full file texts when no indexed chunks exist (legacy mode).
 */
export function buildDeepDiveSystemPrompt(
  project: { name: string; description: string },
  impact: { area: string; description: string },
  retrievedContext?: { asis: string; tobe: string; br: string },
  files?: ProjectFile[]
): string {
  let documentationBlock: string;

  if (retrievedContext) {
    // RAG mode: use pre-retrieved, impact-focused chunks
    documentationBlock = `## AS-IS — Relevant Passages

${retrievedContext.asis}

## TO-BE — Relevant Passages

${retrievedContext.tobe}${retrievedContext.br ? `\n\n## Business Rules — Relevant Passages\n\n${retrievedContext.br}` : ''}`;
  } else {
    // Fallback: full file texts (legacy, no indexed chunks)
    const asisFiles = (files ?? []).filter(f => f.bucket === 'as-is');
    const tobeFiles = (files ?? []).filter(f => f.bucket === 'to-be');
    const brFiles = (files ?? []).filter(f => f.bucket === 'business-rules');

    const formatFiles = (fileList: ProjectFile[], title: string): string => {
      if (fileList.length === 0) return `### ${title}\n_No documents uploaded._\n`;
      return `### ${title}\n` + fileList.map(f =>
        f.extracted_text
          ? `\n**${f.original_name}**\n\`\`\`\n${f.extracted_text.slice(0, 30_000)}\n\`\`\``
          : `\n**${f.original_name}** (${f.mime_type}) — [no extractable text]`
      ).join('\n\n');
    };

    const brSection = brFiles.length > 0 ? `\n${formatFiles(brFiles, 'Business Rules')}` : '';

    documentationBlock = `${formatFiles(asisFiles, 'AS-IS Documentation (Current State)')}

${formatFiles(tobeFiles, 'TO-BE Documentation (Target Requirements)')}${brSection}`;
  }

  return `You are an expert functional analyst for the project "${project.name}".${project.description ? `\nProject context: ${project.description}` : ''}

## YOUR SCOPE — READ THIS FIRST

You are in a focused deep-dive session on ONE specific impact:

**Impact area:** ${impact.area}
**Impact description:** ${impact.description}

⚠️ STRICT SCOPE RULE: Every answer you give MUST be limited exclusively to this impact area ("${impact.area}"). Do not discuss, reference, or expand into other functional areas, screens, or topics — even if they appear in the documentation. If the user's question drifts outside this scope, acknowledge it briefly and redirect back to "${impact.area}".

The documentation passages below have already been filtered to be relevant to "${impact.area}". Focus your analysis on these passages.

## PROJECT DOCUMENTATION

${documentationBlock}

## ANSWER GUIDELINES
- Cite the exact paragraph or passage from the documentation when possible (include the section title or page reference if available)
- Clearly distinguish between AS-IS (current state) and TO-BE (target state)
- If the documents do not contain enough information to answer, say so explicitly — do not invent or extrapolate
- Answer in the same language the user writes in
- Be concise and precise; avoid generic statements that would apply to any impact

## OUTPUT FORMAT (mandatory)
- Use markdown formatting throughout your response
- Use ## or ### headings for each logical section (e.g. ## AS-IS State, ## TO-BE Changes, ## Summary)
- Use **bold** to highlight key terms, field names, and important values
- Use bullet points or numbered lists for enumerations — never write them as prose
- Use markdown tables (with | column | syntax) whenever comparing AS-IS vs TO-BE side by side
- Use > blockquotes only for verbatim quotes from the source documents
- Do NOT use raw colons as pseudo-headings (e.g. "Section Name:") — use ## instead`;
}

// ─── Pipeline Step Prompts ───────────────────────────────────────────────────

const EXTRACTION_SYSTEM = `You are a deterministic functional extraction engine.
Your task is to read documentation and produce a structured catalog of every functional area described.

STRICT EXTRACTION RULES:
- Extract ONLY what is explicitly stated in the documents
- Do NOT infer, assume, or fill gaps in the documentation
- Do NOT compare with any other document or state — this is a standalone extraction
- Attach at least one source reference (section title or heading) to every area
- If a rule or field is only implied, do NOT include it
- Prefer precision over completeness: it is better to extract fewer, well-evidenced areas than many speculative ones
- Return ONLY raw JSON — no prose, no markdown fences`;

const COMPARISON_SYSTEM = `You are a deterministic functional comparison engine.
Your task is to compare an AS-IS functional catalog with a TO-BE functional catalog and identify only genuine, evidence-backed deltas.

STRICT COMPARISON RULES:
- Do NOT declare a change unless BOTH the AS-IS evidence AND the TO-BE evidence explicitly support it
- Do NOT speculate or infer undocumented behavior
- Do NOT assume that similar-sounding areas are the same unless clearly confirmed by the documents
- Do NOT assume similarity across countries, products, systems, or configurations
- If evidence for a change is incomplete, use changeType "UNCERTAIN" — never fabricate evidence
- If an area appears in both AS-IS and TO-BE with no documented difference, use "UNCHANGED"
- PREFER OMISSION OVER SPECULATION: it is better to miss a change than to invent one
- Quote exact passages from the source documents (verbatim or very close) for every piece of evidence
- Return ONLY raw JSON — no prose, no markdown fences

CATEGORY ASSIGNMENT GUIDE:
- "functional": business logic, rules, calculations, data processing, workflows
- "uiux": any change that affects a screen, form, field label, validation message, user flow step, button, table column, or page layout — even if the root cause is functional. If a functional change requires the user to interact differently with a screen, ALSO create a separate uiux-categorized delta for that screen interaction.
- "screen": new or removed screens / pages
- "businessRule": explicit constraints, thresholds, decision rules
- "integration": API, external system, data exchange changes
You MUST produce at least one delta with category "uiux" whenever the TO-BE documentation describes or implies changes to user-facing screens, forms, or workflows.`;

const SYNTHESIS_SYSTEM = `You are a functional analysis report generator.
You receive a list of verified functional deltas (with evidence) and must convert them into a structured analysis report.

RULES:
- Only include deltas with changeType MODIFIED, ADDED, or REMOVED (skip UNCHANGED and UNCERTAIN unless the uncertainty is important to flag)
- Preserve the evidence-backed nature: each impact description must state what changes from AS-IS to TO-BE
- UNCERTAIN deltas must appear in openQuestions, not in functional/UI impacts
- Keep descriptions concise (2-3 sentences max per item)
- businessRulesExtracted should include explicit rules from the TO-BE documentation
- Return ONLY raw JSON — no prose, no markdown fences

MANDATORY UI/UX RULE:
uiUxImpacts MUST contain at least 2 entries — always, with no exceptions.
If fewer than 2 deltas are tagged category="uiux", you MUST derive additional UI/UX impacts by reasoning about the screen-level consequences of the functional deltas:
- Which forms, fields, labels, or validation messages must change?
- Which user flows or navigation steps are affected?
- Which table columns, filters, or display formats must be updated?
- Are there new screens, modals, or confirmation dialogs required?
Use the functional deltas as input and describe the concrete UI/UX change a user would notice. Each uiUxImpacts entry must describe the AS-IS screen state vs the TO-BE screen state.`;

/**
 * System prompt for the AS-IS or TO-BE extraction step.
 */
export function buildExtractionSystemPrompt(): string {
  return EXTRACTION_SYSTEM;
}

/**
 * User prompt for extracting a functional catalog from one document side.
 */
export function buildExtractionUserPrompt(
  docType: 'AS-IS' | 'TO-BE',
  context: string
): string {
  return `Extract the complete functional catalog from the following ${docType} documentation.

For each functional area, extract:
- name: as it appears in the document (use the exact term, not a paraphrase)
- category: one of data | process | rule | ui | integration | security | other
- description: 1-2 sentences, staying close to the source wording
- keyFields: list of field names, parameters, flags, or data attributes explicitly mentioned
- businessRules: list of explicit constraints, validations, thresholds, or decision rules
- sourceRefs: list of section headings or titles where this area is documented

Return ONLY raw JSON with this exact schema:
{
  "areas": [
    {
      "name": "string",
      "category": "data|process|rule|ui|integration|security|other",
      "description": "string",
      "keyFields": ["string"],
      "businessRules": ["string"],
      "sourceRefs": ["string"]
    }
  ]
}

${docType} Documentation:
${context}`;
}

/**
 * System prompt for the comparison step.
 */
export function buildComparisonSystemPrompt(): string {
  return COMPARISON_SYSTEM;
}

/**
 * User prompt for comparing AS-IS and TO-BE catalogs and producing deltas with evidence.
 */
export function buildComparisonUserPrompt(
  asisCatalog: FunctionalCatalog,
  tobeCatalog: FunctionalCatalog,
  asisContext: string,
  tobeContext: string
): string {
  return `Compare the AS-IS functional catalog and the TO-BE functional catalog below.
Identify every functional delta — areas that are MODIFIED, ADDED, or REMOVED.
Also flag areas that clearly correspond but have no documented change (UNCHANGED).
For any area where the evidence is insufficient to determine the change type, use UNCERTAIN.

For each delta you MUST provide:
- The exact section name and a short verbatim (or near-verbatim) quote from the source document as evidence
- A confidence score between 0.0 (no confidence) and 1.0 (fully confirmed by both sides)
- needsHumanReview: true if confidence < 0.7 or changeType is UNCERTAIN

Return ONLY raw JSON with this exact schema:
{
  "deltas": [
    {
      "functionalArea": "string",
      "changeType": "MODIFIED|ADDED|REMOVED|UNCHANGED|UNCERTAIN",
      "asIsEvidence": { "section": "string", "quote": "string" } | null,
      "toBeEvidence": { "section": "string", "quote": "string" } | null,
      "deltaSummary": "string — 1-2 sentences describing what changes",
      "severity": "high|medium|low",
      "category": "functional|uiux|businessRule|screen|integration",
      "confidence": 0.0,
      "needsHumanReview": false
    }
  ],
  "coverageMetrics": {
    "asisAreasFound": ${asisCatalog.areas.length},
    "tobeAreasFound": ${tobeCatalog.areas.length},
    "alignedAreas": 0,
    "uncertainAreas": 0,
    "coverageWarning": null
  }
}

--- AS-IS FUNCTIONAL CATALOG ---
${JSON.stringify(asisCatalog, null, 2)}

--- TO-BE FUNCTIONAL CATALOG ---
${JSON.stringify(tobeCatalog, null, 2)}

--- AS-IS SOURCE PASSAGES (for evidence verification) ---
${asisContext}

--- TO-BE SOURCE PASSAGES (for evidence verification) ---
${tobeContext}`;
}

/**
 * System prompt for the synthesis step.
 */
export function buildSynthesisSystemPrompt(): string {
  return SYNTHESIS_SYSTEM;
}

export interface OQAnswer {
  question_text: string;
  sentiment: 'positive' | 'negative' | null;
  answer: string | null;
}

/**
 * User prompt to synthesize verified deltas into the final AnalysisResult schema.
 */
export function buildSynthesisUserPrompt(
  project: { name: string; description: string },
  deltas: Delta[],
  coverageWarning: string | null,
  prevFeedback: ImpactFeedback[] = [],
  prevOQAnswers: OQAnswer[] = []
): string {
  const feedbackSection = prevFeedback.length > 0 ? `
--- FEEDBACK FROM PREVIOUS ANALYSIS ---
${prevFeedback.map(f => {
    const label = f.sentiment === 'negative' ? 'INCORRECT — do NOT reproduce' : 'CONFIRMED CORRECT';
    const note = f.motivation ? ` (reviewer note: "${f.motivation}")` : '';
    return `- Impact ${f.impact_id}: ${label}${note}`;
  }).join('\n')}
` : '';

  const answeredQuestions = prevOQAnswers.filter(q => q.answer?.trim() || q.sentiment === 'negative');
  const oqSection = answeredQuestions.length > 0 ? `
--- OPEN QUESTIONS FROM PREVIOUS RUN — REVIEWER RESPONSES ---
${answeredQuestions.map(q => {
    if (q.sentiment === 'negative') return `- DISMISSED (no longer relevant): "${q.question_text}"`;
    const ans = q.answer?.trim() ? `\n  Reviewer answer: "${q.answer.trim()}"` : '';
    return `- ANSWERED: "${q.question_text}"${ans}`;
  }).join('\n')}

Rules for open questions:
- Do NOT re-raise questions marked DISMISSED.
- For ANSWERED questions: incorporate the answer into your analysis. Only keep them in openQuestions if still genuinely unresolved after considering the answer.
` : '';

  const coverageNote = coverageWarning
    ? `\n⚠️ Coverage warning: ${coverageWarning}\nInclude this warning in the executiveSummary and as an openQuestion.\n`
    : '';

  return `Convert the verified functional deltas below into the final analysis report for project "${project.name}".
${project.description ? `Project context: ${project.description}\n` : ''}
${feedbackSection}${oqSection}${coverageNote}
Rules:
- functionalImpacts: include deltas with category "functional" and changeType MODIFIED/ADDED/REMOVED
- uiUxImpacts: MANDATORY — include deltas with category "uiux". If fewer than 2 are available, derive additional entries from the functional deltas by describing the screen-level change the user would see (form fields, labels, validation messages, table columns, navigation flows). This array MUST have at least 2 entries.
- affectedScreens: derive from deltas with category "screen" or "uiux"
- businessRulesExtracted: include all business rules from MODIFIED/ADDED deltas (source = "to-be" or "provided")
- proposedChanges: one actionable change per significant delta
- assumptions: list any areas where evidence confidence < 0.8
- openQuestions: include all UNCERTAIN deltas; also include the coverage warning if present
- Impacts marked "INCORRECT — do NOT reproduce" must not appear even if evidence supports them
- Keep each description to 2-3 sentences

Return ONLY raw JSON with this exact schema:
{
  "executiveSummary": "string",
  "functionalImpacts": [
    { "id": "FI-01", "area": "string", "description": "string", "severity": "high|medium|low" }
  ],
  "uiUxImpacts": [
    { "id": "UX-01", "area": "string", "description": "string", "severity": "high|medium|low" }
  ],
  "affectedScreens": [
    {
      "name": "string",
      "currentBehavior": "string",
      "proposedBehavior": "string",
      "changeType": "modified|new|removed"
    }
  ],
  "businessRulesExtracted": [
    { "id": "BR-01", "description": "string", "source": "to-be|as-is|inferred" }
  ],
  "proposedChanges": [
    { "screen": "string", "change": "string", "priority": "high|medium|low" }
  ],
  "prototypeInstructions": "",
  "prototypeHtml": "",
  "assumptions": ["string"],
  "openQuestions": ["string"]
}

--- VERIFIED DELTAS ---
${JSON.stringify(deltas, null, 2)}`;
}

// ─── Functional Gap Analysis Prompts ─────────────────────────────────────────

export function buildFunctionalExtractionSystemPrompt(): string {
  return `You are a functional specification analyst. Your ONLY task is to extract explicitly stated functional components from the document text provided.

STRICT RULES:
1. Extract ONLY what is explicitly written in the text. Do NOT infer, assume, or complete.
2. For EVERY component you emit, you MUST provide source_quote: the verbatim sentence(s) from the document that directly state this component.
3. If you cannot provide a verbatim source_quote from the provided text, do NOT emit the component.
4. confidence must reflect how clearly the text states this component (0.0 = unclear, 1.0 = explicitly stated).
5. Reject components where confidence < 0.7.
6. Return raw JSON only. No markdown fences, no prose.

COMPONENT TYPES:
- process: A business process or workflow step
- business_rule: A named rule with condition/action (e.g. "If X, then Y")
- input: Data or information entering a process
- output: Data or information produced by a process
- validation: A constraint or check on data
- integration: An external system interaction
- ui_element: A screen, form, field, or UI component

OUTPUT SCHEMA:
{
  "components": [
    {
      "type": "process|business_rule|input|output|validation|integration|ui_element",
      "title": "Short canonical name (5-10 words max)",
      "description": "One sentence describing what this component does, based strictly on the text",
      "condition": "For business_rule only: the triggering condition (verbatim or near-verbatim)",
      "action": "For business_rule only: the resulting action (verbatim or near-verbatim)",
      "source_section": "The section heading where this was found",
      "source_quote": "The exact verbatim sentence(s) from the document that state this component",
      "confidence": 0.0
    }
  ]
}`;
}

export function buildFunctionalExtractionUserPrompt(sectionPath: string, chunkText: string): string {
  return `Extract all functional components from the following document section.

SECTION: ${sectionPath}

TEXT:
${chunkText}`;
}

export function buildRelationshipExtractionPrompt(componentsJson: string, chunkText: string): string {
  return `You are given a list of already-extracted functional components. Identify explicit relationships between them.

A relationship exists ONLY if the document text explicitly states or implies a dependency, trigger, or data flow between two components. Do not create relationships based on intuition.

OUTPUT SCHEMA:
{
  "relationships": [
    {
      "from_component_title": "exact title of source component",
      "to_component_title": "exact title of target component",
      "relationship_type": "triggers|produces|validates|calls|depends_on",
      "source_quote": "verbatim text establishing this relationship"
    }
  ]
}

COMPONENTS:
${componentsJson}

TEXT:
${chunkText}`;
}

export function buildAlignmentConfirmationPrompt(asIsJson: string, toBeJson: string): string {
  return `You are performing functional specification alignment. Determine if the AS-IS and TO-BE components describe the same functional concept.

RESPOND WITH ONLY: { "match": true|false, "confidence": 0.0-1.0, "reason": "one sentence" }

No additional text.

AS-IS COMPONENT:
${asIsJson}

TO-BE CANDIDATE:
${toBeJson}`;
}

export function buildVerificationPrompt(gapsJson: string): string {
  return `You are a quality reviewer for a functional gap analysis. Review each gap and determine if it is genuinely supported by the quoted evidence.

For each gap:
- If the as_is_quote and to_be_quote clearly demonstrate the stated gap_type: verdict = "confirmed"
- If the gap is NOT supported by the quotes, or quotes are missing/irrelevant: verdict = "rejected"
- Apply a strict standard. When in doubt, reject.

OUTPUT SCHEMA:
{
  "reviews": [
    { "gap_index": 0, "verdict": "confirmed|rejected", "reason": "one sentence" }
  ]
}

Return raw JSON only. No prose.

GAPS:
${gapsJson}`;
}
