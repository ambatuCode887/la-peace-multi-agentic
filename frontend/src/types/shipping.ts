export type VerificationStatus = 'PASS' | 'MISMATCH' | 'NEEDS_REVIEW' | 'INQUIRY';
export type EmailCategory = 'BL_COMPARISON' | 'SI_REQUEST' | 'INVOICE_QUERY' | 'SPAM' | 'GENERAL';

export interface FieldComparison {
  key: string;
  label: string;
  siValue: string;
  blValue: string;
  match: boolean;
  varianceNote?: string;
  status: 'match' | 'mismatch' | 'review';
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
}

export interface ShippingCase {
  id: string;
  subject: string;
  sender: string;
  timestamp: string;
  category: 'BL_COMPARISON' | 'SI_REQUEST' | 'INVOICE_QUERY' | 'SPAM' | 'GENERAL';
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
