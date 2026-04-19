/**
 * Graph Governance API
 *
 * Base path: /api/graph/:domain/:projectId
 *
 * domain must be 'functional' or 'risk'.
 * All endpoints are domain-isolated — no cross-domain mutations can occur.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getDomainSettings,
  setDomainMode,
  getDomainStats,
  getEntityTypeConfig,
  upsertEntityTypeConfig,
  addEntityTypeConfig,
  getSuggestions,
  approveSuggestion,
  rejectSuggestion,
  mergeSuggestion,
  getEntities,
  updateEntity,
  deleteEntity,
  mergeEntities,
  getRelations,
  deleteRelation,
  getGraphData,
  getGovernanceMemory,
  type GraphDomain,
  type GraphMode,
} from '../services/graphDomainService';

const router = Router({ mergeParams: true });

// ─── Typed param helpers ──────────────────────────────────────────────────────

function p(v: string | string[]): string {
  return Array.isArray(v) ? v[0] : v;
}

function domainMiddleware(req: Request, res: Response, next: () => void) {
  const domain = p(req.params.domain);
  if (domain !== 'functional' && domain !== 'risk') {
    res.status(400).json({ error: 'domain must be "functional" or "risk"' });
    return;
  }
  next();
}

// ─── Stats ────────────────────────────────────────────────────────────────────

// GET /api/graph/:domain/:projectId/stats
router.get('/:domain/:projectId/stats', domainMiddleware, (req, res) => {
  try {
    const stats = getDomainStats(p(req.params.projectId), p(req.params.domain) as GraphDomain);
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Domain settings ──────────────────────────────────────────────────────────

// GET /api/graph/:domain/:projectId/settings
router.get('/:domain/:projectId/settings', domainMiddleware, (req, res) => {
  try {
    const settings = getDomainSettings(p(req.params.projectId), p(req.params.domain) as GraphDomain);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PUT /api/graph/:domain/:projectId/settings
router.put('/:domain/:projectId/settings', domainMiddleware, (req, res) => {
  const { mode } = req.body as { mode: GraphMode };
  if (!['manual', 'assisted', 'auto'].includes(mode)) {
    res.status(400).json({ error: 'mode must be manual | assisted | auto' });
    return;
  }
  try {
    setDomainMode(p(req.params.projectId), p(req.params.domain) as GraphDomain, mode);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Entity type config (ontology) ────────────────────────────────────────────

// GET /api/graph/:domain/:projectId/entity-types
router.get('/:domain/:projectId/entity-types', domainMiddleware, (req, res) => {
  try {
    const types = getEntityTypeConfig(p(req.params.projectId), p(req.params.domain) as GraphDomain);
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/graph/:domain/:projectId/entity-types — add a new type
router.post('/:domain/:projectId/entity-types', domainMiddleware, (req, res) => {
  const { type_key, display_label, description } = req.body as {
    type_key: string; display_label: string; description?: string;
  };
  if (!type_key || !display_label) {
    res.status(400).json({ error: 'type_key and display_label are required' });
    return;
  }
  try {
    addEntityTypeConfig(p(req.params.projectId), p(req.params.domain) as GraphDomain, type_key, display_label, description);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /api/graph/:domain/:projectId/entity-types/:typeKey
router.patch('/:domain/:projectId/entity-types/:typeKey', domainMiddleware, (req, res) => {
  const patch = req.body as { display_label?: string; description?: string; discoverable?: boolean; enabled?: boolean };
  try {
    upsertEntityTypeConfig(p(req.params.projectId), p(req.params.domain) as GraphDomain, p(req.params.typeKey), patch);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Suggestions ──────────────────────────────────────────────────────────────

// GET /api/graph/:domain/:projectId/suggestions?status=pending
router.get('/:domain/:projectId/suggestions', domainMiddleware, (req, res) => {
  const status = (req.query.status as string) || 'pending';
  try {
    const suggestions = getSuggestions(
      p(req.params.projectId),
      p(req.params.domain) as GraphDomain,
      status as 'pending' | 'approved' | 'rejected' | 'merged' | 'ignored'
    );
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/graph/:domain/:projectId/suggestions/:id/approve
router.post('/:domain/:projectId/suggestions/:id/approve', domainMiddleware, (req, res) => {
  const overrides = req.body as { name?: string; entity_type?: string } | undefined;
  try {
    const entityId = approveSuggestion(
      p(req.params.id),
      p(req.params.projectId),
      p(req.params.domain) as GraphDomain,
      overrides
    );
    res.json({ ok: true, entity_id: entityId });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// POST /api/graph/:domain/:projectId/suggestions/:id/reject
router.post('/:domain/:projectId/suggestions/:id/reject', domainMiddleware, (req, res) => {
  const { always_ignore } = req.body as { always_ignore?: boolean };
  try {
    rejectSuggestion(p(req.params.id), p(req.params.projectId), p(req.params.domain) as GraphDomain, always_ignore ?? false);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// POST /api/graph/:domain/:projectId/suggestions/:id/merge
router.post('/:domain/:projectId/suggestions/:id/merge', domainMiddleware, (req, res) => {
  const { target_entity_id } = req.body as { target_entity_id: string };
  if (!target_entity_id) {
    res.status(400).json({ error: 'target_entity_id is required' });
    return;
  }
  try {
    mergeSuggestion(p(req.params.id), p(req.params.projectId), p(req.params.domain) as GraphDomain, target_entity_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// ─── Entity registry ──────────────────────────────────────────────────────────

// GET /api/graph/:domain/:projectId/entities?type=&search=&limit=&offset=
router.get('/:domain/:projectId/entities', domainMiddleware, (req, res) => {
  const opts = {
    type: req.query.type as string | undefined,
    search: req.query.search as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  };
  try {
    const result = getEntities(p(req.params.projectId), p(req.params.domain) as GraphDomain, opts);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /api/graph/:domain/:projectId/entities/:entityId
router.patch('/:domain/:projectId/entities/:entityId', domainMiddleware, (req, res) => {
  const patch = req.body as { name?: string; entity_type?: string; description?: string };
  try {
    updateEntity(p(req.params.entityId), p(req.params.projectId), p(req.params.domain) as GraphDomain, patch);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

// DELETE /api/graph/:domain/:projectId/entities/:entityId
router.delete('/:domain/:projectId/entities/:entityId', domainMiddleware, (req, res) => {
  try {
    deleteEntity(p(req.params.entityId), p(req.params.projectId), p(req.params.domain) as GraphDomain);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/graph/:domain/:projectId/entities/:entityId/merge
router.post('/:domain/:projectId/entities/:entityId/merge', domainMiddleware, (req, res) => {
  const { target_entity_id } = req.body as { target_entity_id: string };
  if (!target_entity_id) {
    res.status(400).json({ error: 'target_entity_id is required' });
    return;
  }
  try {
    mergeEntities(p(req.params.entityId), target_entity_id, p(req.params.projectId), p(req.params.domain) as GraphDomain);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ─── Relations ────────────────────────────────────────────────────────────────

// GET /api/graph/:domain/:projectId/relations?entityId=&limit=&offset=
router.get('/:domain/:projectId/relations', domainMiddleware, (req, res) => {
  const opts = {
    entityId: req.query.entityId as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
  };
  try {
    const result = getRelations(p(req.params.projectId), p(req.params.domain) as GraphDomain, opts);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// DELETE /api/graph/:domain/:projectId/relations/:relationId
router.delete('/:domain/:projectId/relations/:relationId', domainMiddleware, (req, res) => {
  try {
    deleteRelation(p(req.params.relationId), p(req.params.projectId), p(req.params.domain) as GraphDomain);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Graph data for visualization ─────────────────────────────────────────────

// GET /api/graph/:domain/:projectId/graph-data?typeFilter=&minConfidence=&limit=
router.get('/:domain/:projectId/graph-data', domainMiddleware, (req, res) => {
  const typeFilter = req.query.typeFilter
    ? (req.query.typeFilter as string).split(',').filter(Boolean)
    : undefined;
  const minConfidence = req.query.minConfidence ? parseFloat(req.query.minConfidence as string) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

  try {
    const data = getGraphData(p(req.params.projectId), p(req.params.domain) as GraphDomain, { typeFilter, minConfidence, limit });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ─── Governance memory ────────────────────────────────────────────────────────

// GET /api/graph/:domain/:projectId/memory
router.get('/:domain/:projectId/memory', domainMiddleware, (req, res) => {
  try {
    const memory = getGovernanceMemory(p(req.params.projectId), p(req.params.domain) as GraphDomain);
    res.json(memory);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
