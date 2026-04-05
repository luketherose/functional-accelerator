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
  return `You are an expert UI/UX designer. You are given a screenshot of a screen from "${projectName}" and a specific UI/UX change to apply to it.

**Screen / Area:** ${impact.area}
**Change to implement:** ${impact.description}

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
