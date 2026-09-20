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
} from '../types/shipping';

const API_BASE = '/api';

export interface BackendCaseSummary {
  email_id: string;
  category: string;
  status: string;
  review_reason: string | null;
  updated_at: string;
  deletable?: boolean;
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
}

export const api = {
  async checkBackend(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/cases`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  },

  async getCases(): Promise<BackendCaseSummary[]> {
    const res = await fetch(`${API_BASE}/cases`);
    if (!res.ok) throw new Error(`Failed to fetch cases: ${res.statusText}`);
    const data = await res.json();
    return data.cases || [];
  },

  async getCaseDetail(emailId: string): Promise<BackendReport> {
    const res = await fetch(`${API_BASE}/cases/${encodeURIComponent(emailId)}`);
    if (!res.ok) throw new Error(`Failed to fetch case ${emailId}: ${res.statusText}`);
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
      const res = await fetch(`${API_BASE}/cases/${encodeURIComponent(emailId)}/manager-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.manager_review || null;
    } catch (err) {
      console.warn('Manager review error:', err);
      return null;
    }
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
          status: isDefect ? 'mismatch' : 'match',
          siEvidence: siDocument?.evidence_details?.[key],
          blEvidence: blDocument?.evidence_details?.[key],
          siAlternateReadings: alternateReadings(siDocument),
          blAlternateReadings: alternateReadings(blDocument),
          siReaderAgreement: siDocument?.reader_agreement?.[key],
          blReaderAgreement: blDocument?.reader_agreement?.[key],
        };
      });
    } else if (existing?.fields && existing.fields.length > 0) {
      fields = existing.fields;
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
  let confidence =
    existing?.aiAnalysis?.confidence || (status === 'PASS' ? 99.4 : 92.5);

  if (report.ai_analysis?.text) {
    try {
      const parsed = JSON.parse(report.ai_analysis.text);
      if (parsed.summary) summary = parsed.summary;
      if (parsed.recommended_action) recommendation = parsed.recommended_action;
      if (parsed.confidence) {
        confidence =
          typeof parsed.confidence === 'number'
            ? parsed.confidence
            : parseFloat(parsed.confidence) || confidence;
      }
    } catch {
      summary = report.ai_analysis.text.slice(0, 200);
    }
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
    vessel: existing?.vessel || String(report.documents?.si?.fields?.vessel || 'N/A'),
    voyageNumber: existing?.voyageNumber || String(report.documents?.si?.fields?.voyage || 'N/A'),
    pol: existing?.pol || String(report.documents?.si?.fields?.port_of_loading || 'N/A'),
    pod: existing?.pod || String(report.documents?.si?.fields?.port_of_discharge || 'N/A'),
    fields,
    aiAnalysis: {
      confidence,
      summary,
      recommendation,
      carrierRule:
        managerReview?.recommended_next_action ||
        existing?.aiAnalysis?.carrierRule ||
        'Incoterms CFR standard document compliance.',
      model: report.ai_analysis?.provider || existing?.aiAnalysis?.model || 'Gemini 3 Flash',
    },
    managerReview: managerReview || existing?.managerReview || undefined,
    verifier: report.verifier,
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
    aiAnalysis: existing?.aiAnalysis || {
      confidence: 0,
      summary: 'AI review summary is available after opening the case detail.',
      recommendation: 'Open the case to inspect the deterministic result.',
      model: 'Unavailable',
    },
    managerReview: existing?.managerReview,
    verifier: existing?.verifier,
    auditTrail: existing?.auditTrail || [],
  };
}
