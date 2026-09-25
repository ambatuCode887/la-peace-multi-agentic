export interface SentAttachment {
  filename: string;
  size: number;
  ext: string;
  url?: string;
  file?: File;
  caseAttachment?: string;
  fileMissing?: boolean;
  fileStored?: boolean;
}

export interface ThreadReply {
  id: string;
  sender: string;
  senderName: string;
  senderType: 'recipient' | 'operator';
  to: string;
  timestamp: string;
  body: string;
  attachments?: SentAttachment[];
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
  replies?: ThreadReply[];
}

export interface DraftEmail {
  id: string;
  caseId: string;
  to: string;
  subject: string;
  body: string;
  savedAt: string;
  scheduleAt?: string;
  attachments: SentAttachment[];
}

const STORAGE_KEY = 'la_peace_sent_dispatches_v2';
const DRAFT_STORAGE_KEY = 'la_peace_email_drafts_v1';
const DRAFT_DB_NAME = 'la-peace-email-drafts';
const DRAFT_DB_STORE = 'attachments';

const DEFAULT_SENT_EMAILS: DispatchedEmail[] = [
  {
    id: "sent_seed_001",
    caseId: "email_edge_001",
    to: "operations@evergreen-marine.com",
    subject: "CLARIFICATION REQUEST: SOLAS VGM Tare Tolerance Check _ EVER GIVEN V.0421E",
    body: "Dear Evergreen Operations Desk,\n\nWe are reviewing the draft Bill of Lading and Shipping Instruction for booking 5RSG-9901 aboard EVER GIVEN V.0421E. Our multi-tier verification flagged a 70 KG weighbridge variance between documents (26,450 KG SI vs 26,520 KG BL).\n\nUnder SOLAS Chapter VI Reg 2 guidelines, this 0.26% difference is within physical dunnage tare tolerance. Please verify if terminal timber dunnage was applied during container stuffing so we may authorize release.\n\nBest Regards,\nDocumentation Operations Desk\nLa Peace Shipping Systems",
    sentAt: new Date(Date.now() - 3600000 * 3).toISOString(),
    attachments: [
      {
        filename: "5RSG-9901_SOLAS_Tare_Analysis.pdf",
        size: 142850,
        ext: "pdf",
      },
    ],
    vessel: "EVER GIVEN",
    status: "DELIVERED",
    replies: [
      {
        id: "reply_seed_001",
        sender: "operations@evergreen-marine.com",
        senderName: "Capt. H. Tanaka (Evergreen Marine)",
        senderType: "recipient",
        to: "docs@shipping.com",
        timestamp: new Date(Date.now() - 3600000 * 1.5).toISOString(),
        body: "Good day Operations Desk,\n\nConfirmed. The +70 KG variance corresponds to certified timber dunnage added during terminal stuffing at Tanjung Pelepas under SOLAS VGM rules. The Draft BL gross weight of 26,520 KG is correct and approved. Please proceed with final document release.\n\nBest Regards,\nCapt. H. Tanaka\nEvergreen Marine Operations Desk",
      },
    ],
  },
];

class OutboxService {
  private listeners: Array<() => void> = [];

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SENT_EMAILS));
        }
      } catch (err) {
        console.warn('LocalStorage unavailable for outbox:', err);
      }
    }
  }

  public getSentEmails(): DispatchedEmail[] {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as DispatchedEmail[];
        if (parsed.length > 0) return parsed;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SENT_EMAILS));
      return DEFAULT_SENT_EMAILS;
    } catch (err) {
      console.warn('Failed to parse outbox storage:', err);
    }
    return DEFAULT_SENT_EMAILS;
  }

  public saveSentEmail(email: Omit<DispatchedEmail, 'id' | 'sentAt' | 'status'> & { id?: string; sentAt?: string }): DispatchedEmail {
    const fullEmail: DispatchedEmail = {
      id: email.id || `sent_${Date.now()}`,
      caseId: email.caseId,
      to: email.to,
      subject: email.subject,
      body: email.body,
      sentAt: email.sentAt || new Date().toISOString(),
      attachments: (email.attachments || []).map(({ file, caseAttachment, fileMissing, fileStored, ...attachment }) => attachment),
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

  public getSentCount(): number {
    return this.getSentEmails().length;
  }

  public addReplyToSentEmail(
    emailId: string,
    reply: Omit<ThreadReply, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
  ): DispatchedEmail | undefined {
    const list = this.getSentEmails();
    const target = list.find((e) => e.id === emailId);
    if (!target) return undefined;

    const fullReply: ThreadReply = {
      id: reply.id || `reply_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sender: reply.sender,
      senderName: reply.senderName,
      senderType: reply.senderType,
      to: reply.to,
      timestamp: reply.timestamp || new Date().toISOString(),
      body: reply.body,
      attachments: reply.attachments || [],
    };

    if (!target.replies) target.replies = [];
    target.replies.push(fullReply);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (err) {
      console.warn('Failed to persist thread reply:', err);
    }
    this.notifyListeners();
    return target;
  }

  public getDrafts(): DraftEmail[] {
    if (typeof window === 'undefined') return [];
    try {
      return JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || '[]') as DraftEmail[];
    } catch (err) {
      console.warn('Failed to parse draft storage:', err);
      return [];
    }
  }

  public async getDraft(id: string): Promise<DraftEmail | undefined> {
    const draft = this.getDrafts().find((item) => item.id === id);
    if (!draft) return undefined;
    const files = await this.readDraftFiles(id, draft.attachments).catch(() => new Map<number, File>());
    return {
      ...draft,
      attachments: draft.attachments.map((attachment, index) => {
        if (!attachment.fileMissing && !attachment.fileStored) return attachment;
        const file = files.get(index);
        return file
          ? { ...attachment, file, fileMissing: false, fileStored: true }
          : { ...attachment, fileMissing: true, fileStored: false };
      }),
    };
  }

  public async saveDraft(
    input: Omit<DraftEmail, 'id' | 'savedAt'> & { id?: string },
  ): Promise<DraftEmail> {
    const id = input.id || `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const attachments = input.attachments;
    const storedFiles = attachments.some((attachment) => attachment.file)
      ? await this.writeDraftFiles(id, attachments).catch(() => false)
      : true;
    const draft: DraftEmail = {
      id,
      caseId: input.caseId,
      to: input.to,
      subject: input.subject,
      body: input.body,
      savedAt: new Date().toISOString(),
      scheduleAt: input.scheduleAt,
      attachments: attachments.map(({ file, ...attachment }) => ({
        ...attachment,
        fileStored: file ? storedFiles : Boolean(attachment.fileStored),
        fileMissing: file ? !storedFiles : Boolean(attachment.fileMissing),
      })),
    };
    const drafts = this.getDrafts().filter((item) => item.id !== id);
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify([draft, ...drafts]));
    } catch (err) {
      console.warn('Failed to persist draft:', err);
      throw new Error('Could not save this draft in browser storage');
    }
    this.notifyListeners();
    return draft;
  }

  public async deleteDraft(id: string): Promise<void> {
    const drafts = this.getDrafts().filter((item) => item.id !== id);
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(drafts));
    await this.deleteDraftFiles(id).catch(() => undefined);
    this.notifyListeners();
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

  private openDraftDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      const request = indexedDB.open(DRAFT_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DRAFT_DB_STORE)) {
          request.result.createObjectStore(DRAFT_DB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async writeDraftFiles(id: string, attachments: SentAttachment[]): Promise<boolean> {
    const database = await this.openDraftDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DRAFT_DB_STORE, 'readwrite');
      const store = transaction.objectStore(DRAFT_DB_STORE);
      const keysRequest = store.getAllKeys();
      keysRequest.onsuccess = () => {
        keysRequest.result
          .filter((key): key is string => typeof key === 'string' && key.startsWith(`${id}:`))
          .forEach((key) => store.delete(key));
        attachments.forEach((attachment, index) => {
          if (attachment.file) store.put(attachment.file, `${id}:${index}`);
        });
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(true);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    });
  }

  private async readDraftFiles(id: string, attachments: SentAttachment[]): Promise<Map<number, File>> {
    const database = await this.openDraftDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DRAFT_DB_STORE, 'readonly');
      const store = transaction.objectStore(DRAFT_DB_STORE);
      const files = new Map<number, File>();
      for (let index = 0; index < attachments.length; index += 1) {
        const request = store.get(`${id}:${index}`);
        request.onsuccess = () => {
          if (request.result instanceof Blob) {
            files.set(index, new File([request.result], attachments[index].filename, {
              type: request.result.type,
            }));
          }
        };
      }
      transaction.oncomplete = () => {
        database.close();
        resolve(files);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    });
  }

  private async deleteDraftFiles(id: string): Promise<void> {
    const database = await this.openDraftDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(DRAFT_DB_STORE, 'readwrite');
      const store = transaction.objectStore(DRAFT_DB_STORE);
      const keysRequest = store.getAllKeys();
      keysRequest.onsuccess = () => {
        keysRequest.result
          .filter((key): key is string => typeof key === 'string' && key.startsWith(`${id}:`))
          .forEach((key) => store.delete(key));
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    });
  }
}

export const outboxService = new OutboxService();
