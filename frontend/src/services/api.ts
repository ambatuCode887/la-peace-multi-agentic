import type {
  ShippingCase,
  VerificationStatus,
  EmailCategory,
  FieldComparison,
  ManagerReview,
  VerifierResult,
  ActionPreview,
  EvidenceDetail,
  ReaderReading,
  OcrDistortionAnalysis,
} from '../types/shipping';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');
export type ExportFormat = 'csv' | 'json' | 'pdf';

export interface BackendCaseSummary {
  email_id: string;
  category: string;
  status: string;
  review_reason: string | null;
  updated_at: string;
  deletable?: boolean;
}

export interface RuleCorrectionChange {
  field: string;
  document: 'si' | 'bl';
  before: string | number;
  after: string | number;
  reason: string;
}

export interface RuleCorrectionProposal {
  email_id: string;
  subject: string;
  defect_fields: string[];
  changes: RuleCorrectionChange[];
  unresolved_fields: string[];
  ready: boolean;
  source_evidence: Record<string, { si: string; bl: string }>;
  si_fields: Record<string, any>;
  bl_fields: Record<string, any>;
}

export interface CasesPage {
  cases: BackendCaseSummary[];
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface VerificationUpload {
  emailId: string;
  sender: string;
  subject: string;
  body: string;
  attachments: File[];
}

export interface BackendReport {
  email_id: string;
  category: string;
  sender: string;
  subject: string;
  body?: string;
  attachments: string[];
  documents?: {
    si?: {
      attachment: string;
      fields: Record<string, any>;
      missing_fields?: string[];
      evidence?: Record<string, string>;
      evidence_details?: Record<string, EvidenceDetail>;
      confidence?: Record<string, string>;
      reader_fields?: Record<string, Record<string, any>>;
      reader_agreement?: Record<string, string>;
    };
    bl?: {
      attachment: string;
      fields: Record<string, any>;
      missing_fields?: string[];
      evidence?: Record<string, string>;
      evidence_details?: Record<string, EvidenceDetail>;
      confidence?: Record<string, string>;
      reader_fields?: Record<string, Record<string, any>>;
      reader_agreement?: Record<string, string>;
    };
  };
  status: 'OK' | 'MISMATCH' | 'NEEDS_REVIEW' | 'UNPROCESSED';
  review_reason: string | null;
  defect_fields: string[];
  prompt_injection_detected?: boolean;
  prompt_injection_matches?: Array<{ source: string; text: string }>;
  differences?: Record<string, { si: any; bl: any }>;
  ai_analysis?: {
    text?: string;
    provider?: string;
    available?: boolean;
    reason?: string;
  };
  verifier?: VerifierResult;
  review_note?: string;
  manager_review?: ManagerReview;
  routing_telemetry?: {
    total_fields?: number;
    resolved_by_rules?: number;
    sent_to_llm?: number;
    rule_latency_ms?: number;
    llm_latency_ms?: number;
    llm_calls?: number;
    estimated_cost_usd?: number;
    full_document_cost_usd?: number;
    scalability_summary?: string;
    ambiguous_fields?: string[];
    field_resolutions?: Record<string, { source: 'rule' | 'llm' | 'human'; reason: string }>;
  };
  ocr_distortion_analysis?: OcrDistortionAnalysis[];
  created_at?: string;
  updated_at?: string;
  review_decisions?: Array<Record<string, any>>;
  correction_history?: Array<Record<string, any>>;
  audit_events?: Array<Record<string, any>>;
}

export interface EvaluationSnapshot {
  label: string;
  created_at: string;
  evaluated: number;
  disagreement_count: number;
  false_positives: number;
  false_negatives: number;
  precision: number;
  recall: number;
}

export interface EvaluationResult {
  evaluated: number;
  available_reports: number;
  matched: number;
  disagreement_count: number;
  status_counts: {
    reference: Record<string, number>;
    actual: Record<string, number>;
  };
  confusion: Record<string, Record<string, number>>;
  mismatch: {
    true_positive: number;
    false_positive: number;
    false_negative: number;
    precision: number;
    recall: number;
  };
  disagreements: Array<{
    email_id: string;
    expected: { category?: string; status: string; review_reason?: string | null; defect_fields: string[] };
    actual: { category?: string; status: string; review_reason?: string | null; defect_fields: string[] } | null;
    reason: string;
  }>;
  ground_truth_path: string;
  snapshots: EvaluationSnapshot[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// A hosted backend that has been idle (e.g. Render's free plan) can answer 502/503 or hang while it wakes up.
async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 25000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(input: string, init: RequestInit = {}, retries = 1, delayMs = 2000): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.status < 502 || attempt >= retries) return res;
    } catch (error) {
      if (attempt >= retries) throw error;
    }
    await sleep(delayMs);
  }
}

async function downloadResponse(response: Response, fallbackName: string): Promise<void> {
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const api = {
  async downloadCaseExport(emailId: string, format: ExportFormat): Promise<void> {
    const res = await fetch(`${API_BASE}/cases/${encodeURIComponent(emailId)}/export?format=${format}`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      const detail = typeof error.detail === 'string' ? error.detail : error.detail?.message;
      throw new Error(detail || 'Draft BL export failed');
    }
    await downloadResponse(res, `${emailId}-draft-bl.${format}`);
  },

  async downloadBatchExport(emailIds: string[], format: ExportFormat): Promise<void> {
    const res = await fetch(`${API_BASE}/exports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_ids: emailIds, format }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      const detail = typeof error.detail === 'string' ? error.detail : error.detail?.message;
      const failed = error.detail?.failed_email_ids;
      throw new Error(
        failed?.length ? `${detail || 'Draft BL export failed'} (${failed.join(', ')})` : detail || 'Draft BL export failed',
      );
    }
    await downloadResponse(res, `draft-bl-export.${format}`);
  },

  async checkBackendWithRetry(attempts = 4, delayMs = 3000): Promise<boolean> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await api.checkBackend()) return true;
      if (attempt < attempts - 1) await sleep(delayMs);
    }
    return false;
  },

  async checkBackend(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/cases`, { method: 'GET' });
      if (!res.ok) return false;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return false;
      const data = await res.json();
      return Boolean(data && Array.isArray(data.cases));
    } catch {
      return false;
    }
  },

  async getCases(page = 1, pageSize = 40): Promise<CasesPage> {
    const res = await fetchWithTimeout(`${API_BASE}/cases?page=${page}&page_size=${pageSize}`);
    if (!res.ok) throw new Error(`Failed to fetch cases: ${res.statusText}`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Invalid response format from API (received ${contentType || 'non-JSON'}).`);
    }
    const data = await res.json();
    return {
      cases: data.cases || [],
      page: data.page || page,
      page_size: data.page_size || pageSize,
      has_more: Boolean(data.has_more),
    };
  },

  async syncMailpit(): Promise<{ imported: number }> {
    const res = await fetch(`${API_BASE}/inbox/mailpit/sync`, { method: 'POST' });
    if (!res.ok) throw new Error(`Mailpit sync failed: ${res.statusText}`);
    return res.json();
  },

  async getCaseDetail(emailId: string): Promise<BackendReport> {
    const res = await fetch(`${API_BASE}/cases/${encodeURIComponent(emailId)}`);
    if (!res.ok) throw new Error(`Failed to fetch case ${emailId}: ${res.statusText}`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`Invalid response format from API.`);
    }
    const data = await res.json();
    return data.report;
  },

  async verifyUpload(upload: VerificationUpload): Promise<BackendReport> {
    const form = new FormData();
    form.append('email_id', upload.emailId);
    form.append('sender', upload.sender);
    form.append('subject', upload.subject);
    form.append('body', upload.body);
    upload.attachments.forEach((attachment) => form.append('attachments', attachment));
    const res = await fetch(`${API_BASE}/verify`, { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Verification failed');
    }
    const data = await res.json();
    return data.report;
  },

  async processInbox(dataRoot?: string, includeAi = false): Promise<{ processed: number; failed: number }> {
    const res = await fetch(`${API_BASE}/inbox/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(dataRoot ? { data_root: dataRoot } : {}), include_ai: includeAi }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Inbox processing failed');
    }
    return res.json();
  },

  async retryCase(emailId: string): Promise<BackendReport> {
    const res = await fetch(`${API_BASE}/cases/${encodeURIComponent(emailId)}/retry`, { method: 'POST' });
    if (!res.ok) throw new Error(`Retry failed: ${res.statusText}`);
    const data = await res.json();
    return data.report;
  },

  async deleteCase(emailId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/cases/${encodeURIComponent(emailId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Delete failed');
    }
  },


  async getManagerReview(emailId: string): Promise<ManagerReview | null> {
    try {
      const res = await fetchWithRetry(`${API_BASE}/cases/${encodeURIComponent(emailId)}/manager-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: res.statusText }));
        return {
          available: false,
          route: 'human_review',
          reason: error.detail || `Manager review failed: ${res.statusText}`,
        };
      }
      const data = await res.json();
      return data.manager_review || {
        available: false,
        route: 'human_review',
        reason: 'The backend returned no manager-review result.',
      };
    } catch (err) {
      console.warn('Manager review error:', err);
      return {
        available: false,
        route: 'human_review',
        reason: err instanceof Error ? err.message : 'Manager review request failed.',
      };
    }
  },

  async getEvaluation(): Promise<EvaluationResult> {
    const res = await fetch(`${API_BASE}/evaluation`);
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(error.detail || 'Evaluation data unavailable');
    }
    const data = await res.json();
    return data.evaluation;
  },

  async saveEvaluationSnapshot(label: string): Promise<EvaluationSnapshot> {
    const res = await fetch(`${API_BASE}/evaluation/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(error.detail || 'Could not save evaluation snapshot');
    }
    const data = await res.json();
    return data.snapshot;
  },

  async previewAction(
    emailId: string,
    action: 'draft_correction_email' | 'false_alarm' | 'targeted_reread' | 'ai_field_correction',
    extra: Record<string, any> = {}
  ): Promise<ActionPreview> {
    const res = await fetch(`${API_BASE}/cases/${encodeURIComponent(emailId)}/action-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Action preview failed');
    }
    const data = await res.json();
    return data.preview;
  },

  async sendChatMessage(
    emailId: string,
    message: string,
    history: Array<{ role: 'user' | 'assistant'; text: string }> = []
  ): Promise<{ answer: string; provider: string }> {
    const formattedHistory = history.map((h) => ({
      role: h.role,
      content: h.text,
    }));

    const res = await fetch(`${API_BASE}/chat/${encodeURIComponent(emailId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: formattedHistory }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Chat request failed');
    }
    return res.json();
  },

  async previewBatchRuleCorrections(): Promise<{
    total: number;
    ready: number;
    results: RuleCorrectionProposal[];
  }> {
    const res = await fetch(`${API_BASE}/reviews/batch-rule-corrections/preview`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Rule-based batch preview failed');
    }
    return res.json();
  },

  async submitReviewCorrection(
    emailId: string,
    payload: {
      category: string;
      status: 'OK' | 'MISMATCH' | 'NEEDS_REVIEW';
      review_reason?: string | null;
      has_defect: boolean;
      defect_fields: string[];
      decision: 'accept' | 'confirm_mismatch' | 'false_alarm' | 'request_clarification';
      note?: string;
      supporting_evidence?: string;
      si_fields?: Record<string, any>;
      bl_fields?: Record<string, any>;
    }
  ): Promise<any> {
    const res = await fetch(`${API_BASE}/reviews/${encodeURIComponent(emailId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        review_reason: payload.review_reason ?? null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Review correction failed');
    }
    return res.json();
  },
};

const FIELD_LABELS: Record<string, string> = {
  shipper: 'Shipper',
  consignee: 'Consignee',
  notify_party: 'Notify Party',
  port_of_loading: 'Port of Loading',
  port_of_discharge: 'Port of Discharge',
  container_count: 'Container Count',
  gross_weight_kg: 'Gross Weight (KG)',
};

function deriveExtractionConfidence(report: BackendReport): number | undefined {
  const documents = [report.documents?.si, report.documents?.bl].filter(Boolean);
  const scores = documents.flatMap((document) =>
    Object.values(document?.confidence || {}).map((level) =>
      level === 'high' ? 1 : level === 'medium' ? 0.7 : 0,
    ),
  );
  if (scores.length === 0) return undefined;
  return Math.round(
    (scores.reduce((total: number, score: number) => total + score, 0) / scores.length) * 100,
  );
}

export function mapReportToShippingCase(
  report: BackendReport,
  existing?: ShippingCase,
  managerReview?: ManagerReview | null
): ShippingCase {
  const category: EmailCategory =
    existing?.category || (report.category as EmailCategory) || 'BL_COMPARISON';
  const isBl = category === 'BL_COMPARISON';

  // Only BL_COMPARISON cases have paired SI vs BL fields
  let fields: FieldComparison[] = [];
  if (isBl) {
    const defectSet = new Set(report.defect_fields || []);
    const differences = report.differences || {};
    const routing = report.routing_telemetry;
    const fieldResolutions = routing?.field_resolutions || {};
    const ocrAnalyses = report.ocr_distortion_analysis || [];

    const siFields = report.documents?.si?.fields || {};
    const blFields = report.documents?.bl?.fields || {};
    const hasDocFields =
      Object.keys(siFields).length > 0 || Object.keys(blFields).length > 0;

    if (hasDocFields) {
      fields = Object.keys(FIELD_LABELS).map((key) => {
        const siDocument = report.documents?.si;
        const blDocument = report.documents?.bl;
        const siVal =
          siFields[key] !== undefined
            ? String(siFields[key])
            : existing?.fields?.find((f) => f.key === key)?.siValue || 'N/A';
        const blVal =
          blFields[key] !== undefined
            ? String(blFields[key])
            : existing?.fields?.find((f) => f.key === key)?.blValue || 'N/A';
        const isDefect = defectSet.has(key);
        const resolution = fieldResolutions[key];
        const ocrAnalysis = ocrAnalyses.find((analysis) => analysis.field === key);
        const alternateReadings = (
          document: typeof siDocument
        ): ReaderReading[] => Object.entries(document?.reader_fields || {})
          .filter(([, readerFields]) => readerFields[key] !== undefined)
          .map(([reader, readerFields]) => ({ reader, value: readerFields[key] }));

        let varianceNote: string | undefined;
        if (isDefect) {
          if (differences[key]) {
            varianceNote = `Discrepancy: SI records "${differences[key].si}", BL records "${differences[key].bl}"`;
          } else {
            varianceNote = `Field marked as discrepancy between documents`;
          }
        }

        return {
          key,
          label: FIELD_LABELS[key] || key,
          siValue: siVal,
          blValue: blVal,
          match: !isDefect,
          varianceNote,
          status: isDefect
            ? 'mismatch'
            : resolution?.source === 'llm' || resolution?.source === 'human'
              ? 'review'
              : 'match',
          resolutionSource: resolution?.source,
          resolutionReason: resolution?.reason,
          distortionNote: ocrAnalysis?.is_ocr_distortion ? ocrAnalysis.explanation : undefined,
          siEvidence: siDocument?.evidence_details?.[key],
          blEvidence: blDocument?.evidence_details?.[key],
          siAlternateReadings: alternateReadings(siDocument),
          blAlternateReadings: alternateReadings(blDocument),
          siReaderAgreement: siDocument?.reader_agreement?.[key],
          blReaderAgreement: blDocument?.reader_agreement?.[key],
        };
      });
    }
  }

  // Preserve ground truth status unless explicitly updated
  let status: VerificationStatus = existing?.status || 'PASS';
  if (!isBl) {
    status = existing?.status || 'INQUIRY';
  } else if (report.status === 'MISMATCH') {
    status = 'MISMATCH';
  } else if (report.status === 'NEEDS_REVIEW') {
    status = 'NEEDS_REVIEW';
  } else if (report.status === 'OK') {
    status = 'PASS';
  }

  let statusNote =
    existing?.statusNote || 'All verified fields match Shipping Instruction with 100% precision.';
  if (!isBl) {
    statusNote =
      existing?.statusNote || 'No Bill of Lading comparison required for this email category.';
  } else if (status === 'MISMATCH') {
    statusNote = `Discrepancy detected in ${
      report.defect_fields?.join(', ') || 'verified fields'
    }.`;
  } else if (status === 'NEEDS_REVIEW') {
    statusNote = report.review_reason
      ? `Review reason: ${report.review_reason.replace(/_/g, ' ')}`
      : existing?.statusNote || 'Flagged for human operator confirmation.';
  }

  // Parse AI summary if available
  let summary = existing?.aiAnalysis?.summary || statusNote;
  let recommendation =
    existing?.aiAnalysis?.recommendation ||
    (status === 'PASS' ? 'Auto-approve clean document.' : 'Send clarification to carrier.');
  let confidence = existing?.aiAnalysis?.confidence;
  let confidenceModel = report.ai_analysis?.provider || existing?.aiAnalysis?.model;

  if (report.ai_analysis?.text) {
    try {
      const parsed = JSON.parse(report.ai_analysis.text);
      if (parsed.summary) summary = parsed.summary;
      if (parsed.recommended_action) recommendation = parsed.recommended_action;
      if (parsed.confidence !== undefined && parsed.confidence !== null) {
        const parsedConfidence =
          typeof parsed.confidence === 'number'
            ? parsed.confidence
            : parseFloat(String(parsed.confidence));
        if (Number.isFinite(parsedConfidence)) {
          confidence = parsedConfidence <= 1 ? parsedConfidence * 100 : parsedConfidence;
        }
      }
    } catch {
      summary = report.ai_analysis.text.slice(0, 200);
    }
  }
  if (confidence === undefined) {
    confidence = deriveExtractionConfidence(report);
    if (confidence !== undefined) confidenceModel = 'Deterministic ETL extraction';
  }

  return {
    id: report.email_id || existing?.id || '',
    subject: report.subject || existing?.subject || `Shipping Case ${report.email_id}`,
    sender: report.sender || existing?.sender || 'ops@shipping.com',
    body: report.body ?? existing?.body,
    timestamp: existing?.timestamp || 'Today',
    category,
    status,
    statusNote,
    promptInjectionDetected: report.prompt_injection_detected,
    promptInjectionMatches: report.prompt_injection_matches,
    vessel: existing?.vessel || String(report.documents?.si?.fields?.vessel || 'N/A'),
    voyageNumber: existing?.voyageNumber || String(report.documents?.si?.fields?.voyage || 'N/A'),
    pol: existing?.pol || String(report.documents?.si?.fields?.port_of_loading || 'N/A'),
    pod: existing?.pod || String(report.documents?.si?.fields?.port_of_discharge || 'N/A'),
    fields,
    attachments: report.attachments || existing?.attachments || [],
    aiAnalysis: {
      confidence,
      summary,
      recommendation,
      carrierRule:
        managerReview?.recommended_next_action ||
        existing?.aiAnalysis?.carrierRule ||
        'Incoterms CFR standard document compliance.',
      model: confidenceModel || 'Unavailable',
    },
    managerReview: managerReview || existing?.managerReview || undefined,
    verifier: report.verifier,
    routingTelemetry: report.routing_telemetry
      ? {
          totalFields: report.routing_telemetry.total_fields || 0,
          resolvedByRules: report.routing_telemetry.resolved_by_rules || 0,
          sentToLlm: report.routing_telemetry.sent_to_llm || 0,
          ruleLatencyMs: report.routing_telemetry.rule_latency_ms || 0,
          llmLatencyMs: report.routing_telemetry.llm_latency_ms || 0,
          llmCalls: report.routing_telemetry.llm_calls || 0,
          estimatedCostUsd: report.routing_telemetry.estimated_cost_usd || 0,
          fullDocumentCostUsd: report.routing_telemetry.full_document_cost_usd || 0,
          scalabilitySummary: report.routing_telemetry.scalability_summary,
          ambiguousFields: report.routing_telemetry.ambiguous_fields || [],
          fieldResolutions: report.routing_telemetry.field_resolutions || {},
        }
      : existing?.routingTelemetry,
    ocrDistortionAnalysis: report.ocr_distortion_analysis || existing?.ocrDistortionAnalysis,
    auditTrail: existing?.auditTrail || [
      {
        time: 'Just now',
        action: `Case verified: ${status}`,
        actor: 'Multi-Agent Verification Engine',
      },
    ],
  };
}

export function mapSummaryToShippingCase(
  summary: BackendCaseSummary,
  existing?: ShippingCase,
): ShippingCase {
  const category = (summary.category as EmailCategory) || existing?.category || 'GENERAL';
  const status: VerificationStatus =
    summary.status === 'OK'
      ? 'PASS'
      : summary.status === 'MISMATCH'
        ? 'MISMATCH'
        : summary.status === 'NEEDS_REVIEW'
          ? 'NEEDS_REVIEW'
          : existing?.status || 'INQUIRY';

  return {
    id: summary.email_id,
    subject: existing?.subject || summary.email_id,
    sender: existing?.sender || 'Unknown sender',
    body: existing?.body,
    timestamp: summary.updated_at || existing?.timestamp || 'Unknown',
    category,
    status,
    statusNote: summary.review_reason || existing?.statusNote || 'Backend case awaiting detail review.',
    vessel: existing?.vessel || 'N/A',
    voyageNumber: existing?.voyageNumber || 'N/A',
    pol: existing?.pol || 'N/A',
    pod: existing?.pod || 'N/A',
    fields: existing?.fields || [],
    attachments: existing?.attachments || [],
    promptInjectionDetected: existing?.promptInjectionDetected,
    promptInjectionMatches: existing?.promptInjectionMatches,
    aiAnalysis: {
      summary: 'AI review summary is available after opening the case detail.',
      recommendation: 'Open the case to inspect the deterministic result.',
      model: 'Unavailable',
    },
    managerReview: existing?.managerReview,
    verifier: existing?.verifier,
    auditTrail: existing?.auditTrail || [],
  };
}
