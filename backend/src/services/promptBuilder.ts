import { ProjectFile } from '../types';

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
  files: ProjectFile[]
): Promise<string> {
  const asisFiles = files.filter(f => f.bucket === 'as-is');
  const tobeFiles = files.filter(f => f.bucket === 'to-be');
  const brFiles = files.filter(f => f.bucket === 'business-rules');

  const formatFileSection = (fileList: ProjectFile[], sectionTitle: string): string => {
    if (fileList.length === 0) return `### ${sectionTitle}\n_No documents uploaded._\n`;
    return `### ${sectionTitle}\n` + fileList.map(f => {
      const text = f.extracted_text
        ? `\n**File:** ${f.original_name}\n\`\`\`\n${f.extracted_text.slice(0, 10_000)}\n\`\`\``
        : `\n**File:** ${f.original_name} (${f.mime_type}) — [no extractable text, provided as reference]`;
      return text;
    }).join('\n\n---\n\n');
  };

  const brSection = brFiles.length > 0
    ? `${formatFileSection(brFiles, 'PROVIDED Business Rules (factum positum — treat as authoritative, do not modify or re-infer)')}`
    : '';

  const hasBrFiles = brFiles.length > 0;

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

---

## YOUR TASK

Analyze the provided documentation and produce a complete, structured functional analysis.

Return your response **exclusively as valid JSON** — no markdown code fences, no prose before or after, just the raw JSON object.

Use this exact schema:

{
  "executiveSummary": "string — 3-5 sentence summary of what changes and why${hasBrFiles ? '. Explicitly mention which business rules were provided vs inferred.' : ''}",
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
    { "id": "BR-01", "description": "string", "source": "${hasBrFiles ? 'provided|as-is|to-be|inferred' : 'as-is|to-be|inferred'}" }
  ],
  "proposedChanges": [
    { "screen": "string", "change": "string", "priority": "high|medium|low" }
  ],
  "assumptions": ["string"],
  "openQuestions": ["string"]
}

Requirements:
- functionalImpacts must have at least 3 items if there is enough context
- uiUxImpacts must have at least 2 items if there is enough context
- Keep descriptions concise (2-3 sentences max per item)
${hasBrFiles ? `- For businessRulesExtracted: include ALL provided business rules with source "provided". Do NOT re-state them differently. Then add any ADDITIONAL rules you infer from context with source "inferred".\n` : ''}- If minimal context is provided, still produce the best analysis possible with clear assumptions

Respond with JSON only.`;
}

/**
 * Builds a focused prompt for generating a per-impact UI prototype.
 * The image of the current (as-is) screen is attached as a vision block by the caller.
 */
export function buildImpactPrototypePrompt(
  impact: { area: string; description: string },
  projectName: string
): string {
  return `You are an expert UI/UX designer and frontend developer.

You have been given:
1. A screenshot of the CURRENT (as-is) screen: "${impact.area}" for the project "${projectName}"
2. A specific UI/UX impact that must be implemented on this screen

## IMPACT TO IMPLEMENT
**Screen / Area:** ${impact.area}
**Change Required:** ${impact.description}

## YOUR TASK
Generate a complete, self-contained HTML prototype of the MODIFIED version of this screen that implements the described change.

The prototype must:
- Visually incorporate the described change clearly
- Maintain the general layout and style of the original screen where not affected
- Use inline CSS only (no external dependencies, no CDN links)
- Be a complete HTML document with <html>, <head>, <body> tags
- Use a clean, professional design consistent with modern web applications
- Include realistic placeholder data and labels

Return your response **exclusively as valid JSON** with this exact schema:
{ "prototypeHtml": "string — complete self-contained HTML document" }

No prose, no markdown fences, just the raw JSON object.`;
}
