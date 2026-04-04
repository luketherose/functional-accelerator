import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisResult } from '../types';
import type { ImageBlock } from './promptBuilder';
import { getMockAnalysis } from './mockAnalysis';

const MOCK_MODE = process.env.CLAUDE_MOCK === 'true';
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
const TIMEOUT_MS = 120_000; // 2 minute timeout

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Set CLAUDE_MOCK=true for mock mode.');
    client = new Anthropic({ apiKey });
  }
  return client;
}

/**
 * Calls Claude with the full analysis prompt (text only).
 * Falls back to mock mode if CLAUDE_MOCK=true.
 */
export async function callClaude(prompt: string): Promise<AnalysisResult> {
  if (MOCK_MODE) {
    console.log('[claude] Mock mode enabled — returning fixture data');
    await new Promise(r => setTimeout(r, 1500));
    return getMockAnalysis();
  }

  const anthropic = getClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const rawText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    return parseClaudeResponse(rawText);
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Claude API request timed out after 2 minutes');
    }
    throw err;
  }
}

/**
 * Calls Claude with a focused prompt + a single image, returning only the generated HTML string.
 * Used for per-impact prototype generation.
 */
export async function callClaudeForHtml(prompt: string, imageBlock: ImageBlock): Promise<string> {
  if (MOCK_MODE) {
    console.log('[claude] Mock mode — returning fixture impact prototype HTML');
    await new Promise(r => setTimeout(r, 1000));
    return getMockImpactHtml();
  }

  const anthropic = getClient();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const content: Anthropic.MessageParam['content'] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageBlock.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: imageBlock.source.data,
      },
    },
    { type: 'text', text: prompt },
  ];

  try {
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 8192,
        messages: [{ role: 'user', content }],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const rawText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
    }

    const parsed = JSON.parse(cleaned) as { prototypeHtml?: string };
    if (!parsed.prototypeHtml) throw new Error('Claude did not return prototypeHtml');
    return parsed.prototypeHtml;
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('Claude API request timed out after 2 minutes');
    }
    throw err;
  }
}

/**
 * Parses Claude's JSON response with graceful error handling.
 */
function parseClaudeResponse(raw: string): AnalysisResult {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    return normalizeResult(parsed);
  } catch {
    console.error('[claude] Failed to parse JSON response:', cleaned.slice(0, 500));
    throw new Error('Claude returned an invalid JSON response. Try again.');
  }
}

function normalizeResult(raw: Record<string, unknown>): AnalysisResult {
  return {
    executiveSummary: String(raw.executiveSummary || 'No summary provided.'),
    functionalImpacts: Array.isArray(raw.functionalImpacts) ? raw.functionalImpacts : [],
    uiUxImpacts: Array.isArray(raw.uiUxImpacts) ? raw.uiUxImpacts : [],
    affectedScreens: Array.isArray(raw.affectedScreens) ? raw.affectedScreens : [],
    businessRulesExtracted: Array.isArray(raw.businessRulesExtracted) ? raw.businessRulesExtracted : [],
    proposedChanges: Array.isArray(raw.proposedChanges) ? raw.proposedChanges : [],
    prototypeInstructions: String(raw.prototypeInstructions || ''),
    prototypeHtml: String(raw.prototypeHtml || ''),
    assumptions: Array.isArray(raw.assumptions) ? raw.assumptions.map(String) : [],
    openQuestions: Array.isArray(raw.openQuestions) ? raw.openQuestions.map(String) : [],
  };
}

function getMockImpactHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Impact Prototype</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8f9fc; color: #0f172a; }
  .header { background: #3b0764; color: white; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 18px; font-weight: 600; }
  .badge { background: rgba(255,255,255,0.2); font-size: 11px; padding: 2px 8px; border-radius: 12px; }
  .container { max-width: 800px; margin: 32px auto; padding: 0 24px; }
  .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { font-size: 14px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 16px; }
  .approval-chain { display: flex; align-items: center; gap: 0; }
  .step { display: flex; flex-direction: column; align-items: center; flex: 1; }
  .step-dot { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; color: white; }
  .step-dot.done { background: #059669; }
  .step-dot.current { background: #3b0764; box-shadow: 0 0 0 4px rgba(59,7,100,0.15); }
  .step-dot.pending { background: #cbd5e1; }
  .step-label { font-size: 11px; color: #64748b; margin-top: 6px; text-align: center; }
  .step-connector { flex: 1; height: 2px; background: #e2e8f0; margin-bottom: 20px; }
  .step-connector.done { background: #059669; }
  .field { margin-bottom: 16px; }
  .field label { display: block; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
  .field-value { font-size: 14px; color: #0f172a; padding: 10px 12px; background: #f8f9fc; border: 1px solid #e2e8f0; border-radius: 8px; }
  .highlight { border-left: 3px solid #3b0764; background: #f5f3ff; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 16px; font-size: 13px; color: #4c1d95; }
  .btn { display: inline-flex; align-items: center; gap-8px; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; }
  .btn-primary { background: #3b0764; color: white; }
  .btn-secondary { background: white; color: #475569; border: 1px solid #e2e8f0; }
  .actions { display: flex; gap: 12px; margin-top: 8px; }
</style>
</head>
<body>
  <div class="header">
    <h1>Expense Submission</h1>
    <span class="badge">Modified Screen — Prototype</span>
  </div>
  <div class="container">
    <div class="highlight">
      ✨ <strong>New:</strong> Multi-level approval chain preview shown before submission
    </div>
    <div class="card">
      <h2>Expense Details</h2>
      <div class="field"><label>Description</label><div class="field-value">Q1 Client Dinner — Milan</div></div>
      <div class="field"><label>Amount</label><div class="field-value">€ 342.00</div></div>
      <div class="field"><label>Category</label><div class="field-value">Entertainment / Client</div></div>
      <div class="field"><label>Date</label><div class="field-value">2026-04-04</div></div>
    </div>
    <div class="card">
      <h2>Approval Chain Preview</h2>
      <div class="approval-chain">
        <div class="step">
          <div class="step-dot current">1</div>
          <div class="step-label">Line Manager<br><strong>M. Rossi</strong></div>
        </div>
        <div class="step-connector"></div>
        <div class="step">
          <div class="step-dot pending">2</div>
          <div class="step-label">Finance<br><strong>L. Bianchi</strong></div>
        </div>
        <div class="step-connector"></div>
        <div class="step">
          <div class="step-dot pending">3</div>
          <div class="step-label">CFO<br><strong>Auto-approve</strong></div>
        </div>
      </div>
    </div>
    <div class="actions">
      <button class="btn btn-primary">Submit for Approval</button>
      <button class="btn btn-secondary">Save Draft</button>
    </div>
  </div>
</body>
</html>`;
}
