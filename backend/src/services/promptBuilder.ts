import { ProjectFile } from '../types';
import { readImageAsBase64 } from './fileParsing';

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface PromptPayload {
  prompt: string;
  imageBlocks: ImageBlock[];
}

const MAX_IMAGES = 10; // Claude vision limit per request

/**
 * Builds a structured, deterministic prompt for functional analysis.
 * Separates as-is context, to-be context, and screenshots.
 */
export async function buildAnalysisPrompt(
  project: { name: string; description: string },
  files: ProjectFile[]
): Promise<PromptPayload> {
  const asisFiles = files.filter(f => f.bucket === 'as-is');
  const tobeFiles = files.filter(f => f.bucket === 'to-be');
  const screenshots = files.filter(f => f.bucket === 'screenshot').slice(0, MAX_IMAGES);

  const imageBlocks: ImageBlock[] = [];

  // Load screenshots as base64 vision blocks
  for (const img of screenshots) {
    try {
      const { data, mediaType } = readImageAsBase64(img.path, img.mime_type);
      imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
    } catch (err) {
      console.warn(`[promptBuilder] Could not load image ${img.original_name}:`, err);
    }
  }

  const formatFileSection = (fileList: ProjectFile[], sectionTitle: string): string => {
    if (fileList.length === 0) return `### ${sectionTitle}\n_No documents uploaded._\n`;
    return `### ${sectionTitle}\n` + fileList.map(f => {
      const text = f.extracted_text
        ? `\n**File:** ${f.original_name}\n\`\`\`\n${f.extracted_text.slice(0, 30_000)}\n\`\`\``
        : `\n**File:** ${f.original_name} (${f.mime_type}) — [no extractable text, provided as reference]`;
      return text;
    }).join('\n\n---\n\n');
  };

  const prompt = `You are an expert functional analyst and UI/UX architect.
You have been given documentation for a software project and must produce a thorough impact analysis.

## PROJECT CONTEXT
**Name:** ${project.name}
**Description:** ${project.description || 'No description provided.'}

---

## DOCUMENTATION PROVIDED

${formatFileSection(asisFiles, 'AS-IS Documentation (Current State)')}

${formatFileSection(tobeFiles, 'TO-BE Documentation (Target Requirements)')}

${screenshots.length > 0 ? `### Screenshots / UI References\n${screenshots.length} image(s) provided inline (see vision blocks above).` : '### Screenshots / UI References\n_No screenshots uploaded._'}

---

## YOUR TASK

Analyze the provided documentation and produce a complete, structured functional analysis.

Return your response **exclusively as valid JSON** — no markdown code fences, no prose before or after, just the raw JSON object.

Use this exact schema:

{
  "executiveSummary": "string — 3-5 sentence summary of what changes and why",
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
    { "id": "BR-01", "description": "string", "source": "as-is|to-be|inferred" }
  ],
  "proposedChanges": [
    { "screen": "string", "change": "string", "priority": "high|medium|low" }
  ],
  "prototypeInstructions": "string — textual description of the proposed UI layout, components, and interactions",
  "prototypeHtml": "string — a complete, self-contained HTML document (with inline CSS, no external dependencies) that visually represents the proposed new screen or interface. Must be a realistic wireframe/prototype that match the requirements. Use a clean, professional design with a light background, proper typography, and layout. Include realistic placeholder labels and fields.",
  "assumptions": ["string"],
  "openQuestions": ["string"]
}

Requirements:
- functionalImpacts must have at least 3 items if there is enough context
- uiUxImpacts must have at least 2 items if there is enough context
- prototypeHtml MUST be a real, renderable HTML document — not a description, not pseudo-HTML
- prototypeHtml should represent the MOST IMPORTANT changed screen identified
- If minimal context is provided, still produce the best analysis possible with clear assumptions

Respond with JSON only.`;

  return { prompt, imageBlocks };
}
