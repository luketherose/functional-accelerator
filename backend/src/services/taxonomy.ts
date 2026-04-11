/**
 * Defect Taxonomy & Classifier
 *
 * Defines a keyword-based cluster taxonomy and classifies defects
 * deterministically. Same defect always lands in the same cluster
 * unless the taxonomy changes — no randomness, no Claude involvement.
 *
 * Phase 2: taxonomy will be editable per-project via DB.
 */

export interface ClusterDef {
  key: string;
  name: string;
  /** Keywords checked against: title + description + module (lowercased, substring match) */
  keywords: string[];
}

/**
 * Default taxonomy applicable to most enterprise banking / delivery projects.
 * Order matters: first cluster with the most keyword matches wins.
 */
export const DEFAULT_TAXONOMY: ClusterDef[] = [
  {
    key: 'payment',
    name: 'Payment & Finance',
    keywords: [
      'payment', 'pagamento', 'bonifico', 'wire', 'sepa', 'iban', 'swift',
      'amount', 'importo', 'fee', 'commissione', 'interest', 'interesse',
      'rate', 'tasso', 'balance', 'saldo', 'calcolo', 'calculation',
      'invoice', 'fattura', 'debit', 'credit',
    ],
  },
  {
    key: 'kyc',
    name: 'KYC & Compliance',
    keywords: [
      'kyc', 'aml', 'compliance', 'regulatory', 'normativa', 'due diligence',
      'customer risk', 'rischio cliente', 'review', 'revisione', 'screening',
      'sanction', 'sanzione', 'pep', 'fatca', 'crs',
    ],
  },
  {
    key: 'auth',
    name: 'Authentication & Access',
    keywords: [
      'login', 'logout', 'session', 'sessione', 'password', 'authentication',
      'autenticazione', 'token', 'sso', '2fa', 'mfa', 'otp', 'permission',
      'autorizzazione', 'access', 'accesso', 'role', 'ruolo', 'unauthorized',
      'forbidden',
    ],
  },
  {
    key: 'integration',
    name: 'Integration & Sync',
    keywords: [
      'integration', 'integrazione', 'sync', 'sincronizzazione', 'api',
      'webservice', 'web service', 'connection', 'connessione', 'timeout',
      'oracle', 'sap', 'esi', 'aoo', 'kfc', 'interface', 'interfaccia',
      'exchange', 'scambio', 'mapping', 'transformation',
    ],
  },
  {
    key: 'data',
    name: 'Data Quality & Validation',
    keywords: [
      'validation', 'validazione', 'mandatory', 'obbligatorio', 'required',
      'campo obbligatorio', 'format', 'formato', 'null', 'empty', 'vuoto',
      'missing', 'mancante', 'incorrect value', 'valore errato', 'wrong value',
      'duplicate', 'duplicato', 'constraint',
    ],
  },
  {
    key: 'reporting',
    name: 'Reports & Export',
    keywords: [
      'report', 'export', 'esportazione', 'print', 'stampa', 'pdf',
      'excel', 'download', 'extract', 'estrazione', 'dashboard', 'chart',
      'grafico', 'extract', 'output file',
    ],
  },
  {
    key: 'performance',
    name: 'Performance',
    keywords: [
      'slow', 'lento', 'performance', 'hang', 'freeze', 'crash', 'loading',
      'caricamento', 'response time', 'tempo di risposta', 'memory', 'memoria',
      'cpu', 'timeout error', 'delay',
    ],
  },
  {
    key: 'ui',
    name: 'UI & Display',
    keywords: [
      'display', 'visualizzazione', 'screen', 'schermata', 'button', 'tasto',
      'label', 'etichetta', 'message', 'messaggio', 'layout', 'column',
      'colonna', 'filter', 'filtro', 'search', 'ricerca', 'pagination',
      'sorting', 'dropdown', 'modal', 'popup',
    ],
  },
];

export interface ClassificationResult {
  clusterKey: string;
  clusterName: string;
  method: 'rule' | 'unclassified';
  matchedKeywords: string[];
  confidence: number;
}

/**
 * Classify a single defect against the taxonomy.
 * Returns the cluster with the most keyword matches.
 * Ties broken by taxonomy order (more specific clusters are listed first).
 */
export function classifyDefect(defect: {
  title: string;
  description: string;
  module: string;
  application: string;
}): ClassificationResult {
  const text = `${defect.title} ${defect.description} ${defect.module}`.toLowerCase();

  let bestCluster: ClusterDef | null = null;
  let bestMatches: string[] = [];

  for (const cluster of DEFAULT_TAXONOMY) {
    const matched = cluster.keywords.filter(kw => text.includes(kw.toLowerCase()));
    if (matched.length > bestMatches.length) {
      bestCluster = cluster;
      bestMatches = matched;
    }
  }

  if (bestCluster && bestMatches.length > 0) {
    return {
      clusterKey: bestCluster.key,
      clusterName: bestCluster.name,
      method: 'rule',
      matchedKeywords: bestMatches,
      confidence: Math.min(0.5 + bestMatches.length * 0.1, 0.95),
    };
  }

  return {
    clusterKey: 'other',
    clusterName: 'Other',
    method: 'unclassified',
    matchedKeywords: [],
    confidence: 0,
  };
}

/**
 * Classify a batch of defects.
 * Returns one result per defect, in the same order.
 */
export function classifyDefects(defects: Array<{
  title: string;
  description: string;
  module: string;
  application: string;
}>): ClassificationResult[] {
  return defects.map(d => classifyDefect(d));
}
