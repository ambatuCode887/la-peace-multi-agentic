export type VerificationStatus = 'PASS' | 'MISMATCH' | 'NEEDS_REVIEW' | 'INQUIRY';
export type EmailCategory = 'BL_COMPARISON' | 'DOCUMENT_CHASE' | 'SI_REQUEST' | 'INVOICE_QUERY' | 'SPAM' | 'GENERAL';

export interface FieldComparison {
  key: string;
  label: string;
  siValue: string;
  blValue: string;
  match: boolean;
  varianceNote?: string;
  status: 'match' | 'mismatch' | 'review';
  siEvidence?: EvidenceDetail;
  blEvidence?: EvidenceDetail;
  siAlternateReadings?: ReaderReading[];
  blAlternateReadings?: ReaderReading[];
  siReaderAgreement?: string;
  blReaderAgreement?: string;
}

export interface EvidenceDetail {
  attachment?: string;
  page?: number | null;
  source_text?: string | null;
  coordinates?: Record<string, number> | null;
  method?: string;
}

export interface ReaderReading {
  reader: string;
  value: string | number | null;
}

export interface AIAnalysis {
  confidence: number;
  summary: string;
  recommendation: string;
  carrierRule?: string;
  draftClarification?: string;
  model: string;
}

export interface ManagerReview {
  available: boolean;
  route?: string;
  deterministic_status?: string;
  defects?: string[];
  retrieved_guidance?: string[];
  recommended_next_action?: string;
}

export interface VerifierRuling {
  field: string;
  ruling: 'CONFIRMED_DISCREPANCY' | 'FORMATTING_OR_NORMALIZATION_ISSUE' | 'UNCERTAIN_REQUIRES_HUMAN';
  reason: string;
  si_value?: any;
  bl_value?: any;
}

export interface VerifierResult {
  available: boolean;
  provider?: string;
  partial?: boolean;
  rulings?: VerifierRuling[];
  reason?: string;
}

export interface ActionPreview {
  action: string;
  requires_confirmation?: boolean;
  sent?: boolean;
  to?: string;
  subject?: string;
  body?: string;
  proposed_status?: string;
  defect_fields?: string[];
  note?: string;
  field?: string;
  request?: string;
  changes?: Array<{ document: string; field: string; before: any; after: any }>;
  si_fields?: Record<string, any>;
  bl_fields?: Record<string, any>;
  explanation?: string;
}

export interface ShippingCase {
  id: string;
  subject: string;
  sender: string;
  body?: string;
  timestamp: string;
  category: EmailCategory;
  status: VerificationStatus;
  statusNote?: string;
  vessel: string;
  voyageNumber: string;
  pol: string;
  pod: string;
  fields: FieldComparison[];
  aiAnalysis: AIAnalysis;
  managerReview?: ManagerReview;
  verifier?: VerifierResult;
  auditTrail: {
    time: string;
    action: string;
    actor: string;
  }[];
}
