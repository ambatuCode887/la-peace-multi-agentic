export interface SentAttachment {
  filename: string;
  size: number;
  ext: string;
  url?: string;
}

export interface DispatchedEmail {
  id: string;
  caseId: string;
  to: string;
  subject: string;
  body: string;
  sentAt: string;
  attachments: SentAttachment[];
  vessel?: string;
  status: 'SENT' | 'DELIVERED';
}

const STORAGE_KEY = 'la_peace_sent_dispatches';

// Initial seed data so the Sent mailbox has realistic operational dispatches on first demo
const INITIAL_SENT_SEED: DispatchedEmail[] = [
  {
    id: 'sent_001',
    caseId: 'email_004',
    to: 'ops@evergreen-shipping.com',
    subject: 'Clarification Required: REQUEST BL DRAFT _ PO 26067_ COATED IVORY... (Case #email_004)',
    body: `Dear Forwarder / Carrier Operations,

We have completed automated multi-agent document verification for shipment case #email_004 (Vessel: 138MT).

During verification, the following discrepancy was detected:
• Gross Weight (KG): SI records "22,500 KG" vs Draft BL records "24,800 KG" (+2,300 kg delta).

Please review and advise with the amended Draft Bill of Lading or weight certificate.

Regards,
La Peace Verification Desk`,
    sentAt: new Date(Date.now() - 3600000 * 3.5).toISOString(),
    attachments: [
      {
        filename: 'PO_26067_Weight_Discrepancy.pdf',
        size: 145200,
        ext: 'pdf',
      },
    ],
    vessel: '138MT',
    status: 'DELIVERED',
  },
  {
    id: 'sent_002',
    caseId: 'email_002',
    to: 'nirmala@fujitogrp.com',
    subject: 'RE: LOCAL CHARGES FOB - KARGOSMAR - 5AKR-61849 - TELEX RELEASE CHARGES',
    body: `Dear Nirmala,

Thank you for your inquiry regarding local handling charges on booking 5AKR-61849.

Our documentation desk has reviewed your invoice breakdown request. The THC charges are invoiced per standard FOB ocean tariff terms. We have routed the line-item schedule to the Accounts Payable desk for immediate statement reconciliation.

Please find the booking confirmation sheet attached.

Kind regards,
Shipping Documentation Operations Desk`,
    sentAt: new Date(Date.now() - 3600000 * 7.2).toISOString(),
    attachments: [
      {
        filename: '5AKR-61849_Booking_Summary.xlsx',
        size: 68400,
        ext: 'xlsx',
      },
    ],
    vessel: 'TELEX RELEASE CHARGES',
    status: 'DELIVERED',
  },
];

class OutboxService {
  private listeners: Array<() => void> = [];

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SENT_SEED));
        }
      } catch (err) {
        console.warn('LocalStorage unavailable for outbox:', err);
      }
    }
  }

  public getSentEmails(): DispatchedEmail[] {
    if (typeof window === 'undefined') return INITIAL_SENT_SEED;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored) as DispatchedEmail[];
      }
    } catch (err) {
      console.warn('Failed to parse outbox storage:', err);
    }
    return INITIAL_SENT_SEED;
  }

  public saveSentEmail(email: Omit<DispatchedEmail, 'id' | 'sentAt' | 'status'> & { id?: string; sentAt?: string }): DispatchedEmail {
    const fullEmail: DispatchedEmail = {
      id: email.id || `sent_${Date.now()}`,
      caseId: email.caseId,
      to: email.to,
      subject: email.subject,
      body: email.body,
      sentAt: email.sentAt || new Date().toISOString(),
      attachments: email.attachments || [],
      vessel: email.vessel || 'N/A',
      status: 'SENT',
    };

    const current = this.getSentEmails();
    const updated = [fullEmail, ...current];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (err) {
      console.warn('Failed to persist sent email:', err);
    }

    this.notifyListeners();
    return fullEmail;
  }

  public getSentEmailById(id: string): DispatchedEmail | undefined {
    return this.getSentEmails().find((e) => e.id === id);
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    this.listeners.forEach((l) => l());
  }
}

export const outboxService = new OutboxService();
