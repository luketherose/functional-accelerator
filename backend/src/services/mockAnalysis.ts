import { AnalysisResult } from '../types';

/**
 * Returns a realistic mock analysis for demo/development purposes.
 * Used when CLAUDE_MOCK=true.
 */
export function getMockAnalysis(): AnalysisResult {
  return {
    executiveSummary:
      'The proposed changes introduce a redesigned approval workflow for expense management, replacing the current linear single-approver process with a configurable multi-level approval chain. This significantly impacts the core submission, routing, and notification subsystems. The UI must be updated to surface the approval hierarchy and provide real-time status visibility to submitters and approvers alike.',

    functionalImpacts: [
      {
        id: 'FI-01',
        area: 'Approval Workflow',
        description: 'The single-approver model must be replaced with a configurable n-level approval chain. Each level can have one or more approvers with "any" or "all" approval logic.',
        severity: 'high',
      },
      {
        id: 'FI-02',
        area: 'Notification System',
        description: 'Email/in-app notifications must be extended to support per-level triggering, escalation reminders (configurable SLA), and final decision summaries.',
        severity: 'high',
      },
      {
        id: 'FI-03',
        area: 'Delegation & Absence',
        description: 'Approvers must be able to delegate their role to a substitute with a defined date range, without requiring admin intervention.',
        severity: 'medium',
      },
      {
        id: 'FI-04',
        area: 'Audit Trail',
        description: 'Every approval/rejection action at each level must be recorded with timestamp, actor, comments, and IP address for compliance purposes.',
        severity: 'high',
      },
      {
        id: 'FI-05',
        area: 'Expense Categorisation',
        description: 'Routing rules must allow conditional approval chains based on expense category, amount threshold, and submitter department.',
        severity: 'medium',
      },
    ],

    uiUxImpacts: [
      {
        id: 'UX-01',
        area: 'Submission Form',
        description: 'The submission form must display a preview of the approval chain that will be triggered, allowing submitters to understand who will review their request before submitting.',
        severity: 'high',
      },
      {
        id: 'UX-02',
        area: 'Status Tracking',
        description: 'A visual approval progress indicator (step-by-step timeline) must be added to the expense detail view, showing completed, pending, and upcoming approval steps.',
        severity: 'high',
      },
      {
        id: 'UX-03',
        area: 'Approver Dashboard',
        description: 'A dedicated approver inbox must be created, separating "awaiting my action" from "approved by me" and "escalated" items, with sortable columns and bulk actions.',
        severity: 'medium',
      },
      {
        id: 'UX-04',
        area: 'Mobile Responsiveness',
        description: 'Approval actions (approve/reject with comments) must be fully functional on mobile. Current UI is desktop-only.',
        severity: 'medium',
      },
    ],

    affectedScreens: [
      {
        name: 'Expense Submission Form',
        currentBehavior: 'User fills in amount, category, and description. Single submit button. No visibility into who approves.',
        proposedBehavior: 'Shows approval chain preview dynamically based on entered amount/category. Submit triggers multi-level routing.',
        changeType: 'modified',
      },
      {
        name: 'Expense Detail View',
        currentBehavior: 'Shows status as "Pending" or "Approved/Rejected" with a single approver name.',
        proposedBehavior: 'Shows step-by-step timeline: each approval level with approver name, status (pending/approved/rejected), and timestamp.',
        changeType: 'modified',
      },
      {
        name: 'Approver Inbox',
        currentBehavior: 'Items pending approval are listed in a generic notification list.',
        proposedBehavior: 'Dedicated inbox with tabs: "To Review", "Approved", "Escalated". Bulk approve/reject actions. SLA countdown badges.',
        changeType: 'modified',
      },
      {
        name: 'Admin — Approval Chain Configuration',
        currentBehavior: 'Does not exist.',
        proposedBehavior: 'New admin screen to define approval chains: add/remove levels, set approvers per level, configure routing rules by category/amount/department.',
        changeType: 'new',
      },
      {
        name: 'Delegation Management',
        currentBehavior: 'Does not exist.',
        proposedBehavior: 'New self-service screen for approvers to set up delegation periods, choose substitute, and view active delegations.',
        changeType: 'new',
      },
    ],

    businessRulesExtracted: [
      {
        id: 'BR-01',
        description: 'Expenses over €1,000 require a second level of approval (Finance Manager).',
        source: 'to-be',
      },
      {
        id: 'BR-02',
        description: 'Expenses over €5,000 require an additional CFO approval as final level.',
        source: 'to-be',
      },
      {
        id: 'BR-03',
        description: 'If no action is taken within 48 hours, an escalation email is sent to the approver\'s manager.',
        source: 'to-be',
      },
      {
        id: 'BR-04',
        description: 'Travel expenses have a dedicated approval chain regardless of amount.',
        source: 'inferred',
      },
      {
        id: 'BR-05',
        description: 'Rejected expenses must include a mandatory rejection reason comment of at least 10 characters.',
        source: 'as-is',
      },
    ],

    proposedChanges: [
      { screen: 'Expense Submission Form', change: 'Add dynamic approval chain preview component', priority: 'high' },
      { screen: 'Expense Detail View', change: 'Replace single-status badge with multi-step approval timeline', priority: 'high' },
      { screen: 'Approver Inbox', change: 'Redesign with tabbed inbox, bulk actions, and SLA badges', priority: 'high' },
      { screen: 'Admin Panel', change: 'Create new Approval Chains configuration module', priority: 'medium' },
      { screen: 'Profile / Settings', change: 'Add delegation management section for approvers', priority: 'medium' },
      { screen: 'Notification Templates', change: 'Extend email templates for per-level and escalation notifications', priority: 'low' },
    ],

    prototypeInstructions:
      'The primary screen to prototype is the redesigned Expense Detail View with the multi-level approval timeline. It should show: (1) expense header with amount/category/submitter; (2) a vertical step timeline showing each approval level; (3) each step showing approver avatar, name, role, status (approved/pending/rejected), timestamp, and optional comment; (4) action buttons for the current active approver. Clean, professional design using white cards on light grey background.',

    prototypeHtml: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Expense Detail — Approval Timeline</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f5f7; color: #172b4d; min-height: 100vh; }
  .app-bar { background: #3b0764; color: white; padding: 0 24px; height: 56px; display: flex; align-items: center; gap: 16px; }
  .app-bar h1 { font-size: 15px; font-weight: 600; opacity: .9; }
  .breadcrumb { font-size: 13px; opacity: .6; }
  .container { max-width: 900px; margin: 32px auto; padding: 0 24px; }
  .card { background: white; border-radius: 8px; border: 1px solid #e2e8f0; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  .expense-header { display: flex; justify-content: space-between; align-items: flex-start; }
  .expense-title { font-size: 20px; font-weight: 600; color: #172b4d; }
  .expense-meta { display: flex; gap: 16px; margin-top: 8px; font-size: 13px; color: #64748b; }
  .badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }
  .badge-pending { background: #fef3c7; color: #92400e; }
  .badge-approved { background: #d1fae5; color: #065f46; }
  .badge-rejected { background: #fee2e2; color: #991b1b; }
  .amount { font-size: 28px; font-weight: 700; color: #3b0764; }
  .section-title { font-size: 13px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 20px; }
  .timeline { position: relative; }
  .timeline::before { content: ''; position: absolute; left: 20px; top: 0; bottom: 0; width: 2px; background: #e2e8f0; }
  .step { display: flex; gap: 16px; margin-bottom: 28px; position: relative; }
  .step-icon { width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; font-weight: 700; z-index: 1; border: 2px solid white; }
  .step-icon-approved { background: #059669; color: white; }
  .step-icon-pending { background: white; color: #6366f1; border: 2px solid #6366f1; }
  .step-icon-waiting { background: #f1f5f9; color: #94a3b8; border: 2px solid #e2e8f0; }
  .step-content { flex: 1; }
  .step-header { display: flex; justify-content: space-between; align-items: center; }
  .step-name { font-weight: 600; font-size: 14px; }
  .step-role { font-size: 12px; color: #64748b; margin-top: 2px; }
  .step-time { font-size: 12px; color: #94a3b8; }
  .step-comment { margin-top: 8px; padding: 10px 12px; background: #f8fafc; border-radius: 6px; font-size: 13px; color: #475569; border-left: 3px solid #e2e8f0; }
  .step-comment.approved-comment { border-left-color: #059669; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
  .info-item label { font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: .05em; }
  .info-item p { font-size: 14px; color: #172b4d; margin-top: 4px; font-weight: 500; }
  .action-bar { display: flex; gap: 12px; justify-content: flex-end; padding-top: 20px; border-top: 1px solid #f1f5f9; margin-top: 24px; }
  .btn { padding: 9px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: opacity .15s; }
  .btn:hover { opacity: .85; }
  .btn-primary { background: #3b0764; color: white; }
  .btn-danger { background: white; color: #dc2626; border: 1px solid #dc2626; }
  .btn-secondary { background: white; color: #475569; border: 1px solid #e2e8f0; }
  .level-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 8px; }
</style>
</head>
<body>
<div class="app-bar">
  <div>
    <div class="breadcrumb">Expense Management / My Submissions</div>
    <h1>Expense Detail</h1>
  </div>
</div>

<div class="container">
  <!-- Expense Overview Card -->
  <div class="card">
    <div class="expense-header">
      <div>
        <div class="expense-title">Q1 Client Travel — Milan Conference</div>
        <div class="expense-meta">
          <span>EXP-2024-0892</span>
          <span>·</span>
          <span>Submitted by Marco Rossi</span>
          <span>·</span>
          <span>18 Mar 2024, 11:42</span>
        </div>
      </div>
      <span class="badge badge-pending">⏳ Pending Approval</span>
    </div>

    <div style="margin-top: 20px; display: flex; align-items: flex-end; gap: 8px;">
      <div class="amount">€ 2,340.00</div>
      <div style="font-size: 13px; color: #64748b; margin-bottom: 4px;">Travel & Accommodation</div>
    </div>

    <div class="info-grid" style="margin-top: 20px;">
      <div class="info-item">
        <label>Category</label>
        <p>Travel & Accommodation</p>
      </div>
      <div class="info-item">
        <label>Cost Centre</label>
        <p>IT — Digital Transformation</p>
      </div>
      <div class="info-item">
        <label>Payment Method</label>
        <p>Corporate Card *4521</p>
      </div>
    </div>
  </div>

  <!-- Approval Timeline Card -->
  <div class="card">
    <div class="section-title">Approval Progress</div>
    <div class="timeline">

      <!-- Level 1 — Approved -->
      <div class="step">
        <div class="step-icon step-icon-approved">✓</div>
        <div class="step-content">
          <div class="level-label">Level 1 — Direct Manager</div>
          <div class="step-header">
            <div>
              <div class="step-name">Giulia Ferrari</div>
              <div class="step-role">Engineering Manager</div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="badge badge-approved">Approved</span>
              <span class="step-time">19 Mar 2024, 09:15</span>
            </div>
          </div>
          <div class="step-comment approved-comment">"Confirmed attendance at the Milan conference. Costs are in line with travel policy."</div>
        </div>
      </div>

      <!-- Level 2 — Pending (current) -->
      <div class="step">
        <div class="step-icon step-icon-pending">2</div>
        <div class="step-content">
          <div class="level-label">Level 2 — Finance Manager <span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:6px;">Current</span></div>
          <div class="step-header">
            <div>
              <div class="step-name">Luca Bianchi</div>
              <div class="step-role">Finance Manager — EMEA</div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="badge badge-pending">⏳ Awaiting Review</span>
              <span class="step-time" style="color:#ea580c;">⚠ SLA: 22h remaining</span>
            </div>
          </div>
          <div class="step-comment" style="background: #fefce8; border-left-color: #d97706; color: #78350f;">Approval required because amount exceeds €1,000. SLA: 48 hours from receipt.</div>
        </div>
      </div>

      <!-- Level 3 — Waiting -->
      <div class="step" style="opacity: .5;">
        <div class="step-icon step-icon-waiting">3</div>
        <div class="step-content">
          <div class="level-label">Level 3 — CFO (if > €5,000)</div>
          <div class="step-header">
            <div>
              <div class="step-name">Not required</div>
              <div class="step-role">Amount below €5,000 threshold</div>
            </div>
            <span class="badge" style="background:#f1f5f9;color:#94a3b8;">Skipped</span>
          </div>
        </div>
      </div>

    </div>

    <div class="action-bar">
      <button class="btn btn-secondary">Add Comment</button>
      <button class="btn btn-danger">Reject</button>
      <button class="btn btn-primary">Approve</button>
    </div>
  </div>
</div>
</body>
</html>`,

    assumptions: [
      'The current system uses a relational database capable of supporting hierarchical approval records.',
      'User identity and role assignments already exist in the system (directory/LDAP integration assumed).',
      'Email notification infrastructure is already in place and extensible.',
      'The approval chain configuration is managed by admins, not individual users.',
    ],

    openQuestions: [
      'Should any approver at a level be able to approve (OR logic), or must all approvers at a level approve (AND logic)? This significantly impacts the data model.',
      'What happens if an approver is on leave and has not set a delegate? Should the request auto-escalate?',
      'Are there regulatory requirements that mandate a specific audit retention period for approval records?',
      'Should submitters be able to retract a submitted expense while it is pending approval?',
      'Is there a requirement for mobile push notifications in addition to email?',
    ],
  };
}
