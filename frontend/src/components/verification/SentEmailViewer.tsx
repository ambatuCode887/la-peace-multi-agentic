import React, { useState } from "react";
import {
  Send,
  CheckCircle2,
  Paperclip,
  ExternalLink,
  Clock,
  ArrowLeft,
} from "lucide-react";
import type { DispatchedEmail } from "../../services/outboxService";
import { formatMalaysiaTime } from "../../utils/formatTime";
import { AttachmentViewerModal, type OriginalAttachment } from "./AttachmentViewerModal";

interface SentEmailViewerProps {
  email: DispatchedEmail;
  onNavigateToCase?: (caseId: string) => void;
  onBackToInbox?: () => void;
}

export const SentEmailViewer: React.FC<SentEmailViewerProps> = ({
  email,
  onNavigateToCase,
  onBackToInbox,
}) => {
  const [selectedAttachment, setSelectedAttachment] = useState<OriginalAttachment | null>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getRecipientInitials = (toStr: string): string => {
    const raw = toStr.split("<")[0].trim() || toStr.split("@")[0] || "TO";
    const parts = raw.split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return raw.slice(0, 2).toUpperCase();
  };

  return (
    <div className="space-y-4 animate-in fade-in select-text">
      {/* 1. TOP DISPATCH STATUS BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 px-4 rounded-xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs">
        <div className="flex items-center space-x-2.5">
          {onBackToInbox && (
            <button
              type="button"
              onClick={onBackToInbox}
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-[#091f52] dark:hover:bg-[#133e99] text-slate-700 dark:text-slate-200 transition-colors cursor-pointer mr-1"
              title="Return to Inbound Inbox"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-0.5" />
              <span>Inbox</span>
            </button>
          )}
          <span className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold border bg-emerald-50 text-emerald-800 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            DISPATCHED
          </span>
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            Recorded in Audit Trail
          </span>
        </div>

        <div className="flex items-center space-x-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center space-x-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-mono text-[11px]">
              Sent: {formatMalaysiaTime(email.sentAt)}
            </span>
          </div>
          {email.caseId && onNavigateToCase && (
            <>
              <span>•</span>
              <button
                type="button"
                onClick={() => onNavigateToCase(email.caseId)}
                className="inline-flex items-center space-x-1 font-mono text-[11px] font-bold text-[#345ec4] dark:text-[#8ea9f7] hover:underline cursor-pointer"
                title={`Open originating case ${email.caseId}`}
              >
                <span>Case #{email.caseId}</span>
                <ExternalLink className="w-3 h-3 ml-0.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 2. GMAIL / OUTLOOK STYLE SENT EMAIL MESSAGE CARD */}
      <div className="rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs overflow-hidden">
        {/* Email Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-[#1a3d8e]/40 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
              {email.subject}
            </h2>
            <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#eef3fc] dark:bg-[#091f52] text-[#1a3d8e] dark:text-[#8ea9f7] border border-[#345ec4]/30 shrink-0">
              <Send className="w-3 h-3 mr-1" />
              Outbound Clarification
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs pt-1">
            <div className="flex items-center space-x-3 min-w-0">
              {/* Recipient Avatar */}
              <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-800/80 flex items-center justify-center text-xs font-bold text-[#1a3d8e] dark:text-blue-300 shrink-0">
                {getRecipientInitials(email.to)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                    To: {email.to}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500 truncate">
                  From: Documentation Operations Desk &lt;docs@shipping.com&gt;
                </div>
              </div>
            </div>

            <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 shrink-0">
              {formatMalaysiaTime(email.sentAt)}
            </div>
          </div>
        </div>

        {/* Email Body */}
        <div className="p-4 sm:p-6 space-y-4">
          <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-normal whitespace-pre-wrap font-sans">
            {email.body}
          </div>

          {/* Attachments Section */}
          {email.attachments && email.attachments.length > 0 && (
            <div className="pt-4 border-t border-slate-100 dark:border-[#1a3d8e]/40 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <div className="flex items-center space-x-1.5 font-semibold text-slate-700 dark:text-slate-200">
                  <Paperclip className="w-3.5 h-3.5 text-[#345ec4] dark:text-[#5a82e2]" />
                  <span>Attachments ({email.attachments.length})</span>
                </div>
                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  Click document chip to preview
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {email.attachments.map((att, idx) => (
                  <button
                    key={`${att.filename}-${idx}`}
                    type="button"
                    onClick={() => {
                      if (att.url) {
                        setSelectedAttachment({
                          filename: att.filename,
                          ext: att.ext,
                          url: att.url,
                        });
                      }
                    }}
                    className="flex items-center space-x-3 p-2.5 sm:p-3 rounded-xl border border-slate-200/80 dark:border-[#1a3d8e]/60 bg-slate-50/70 hover:bg-blue-50/60 dark:bg-[#091f52]/40 dark:hover:bg-[#0c286d] text-left transition-all group cursor-pointer shadow-2xs hover:border-blue-300 dark:hover:border-blue-600"
                  >
                    <div className="w-9 h-9 rounded-lg bg-white dark:bg-[#06163a] border border-slate-200 dark:border-[#1a3d8e]/60 flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
                      {att.ext === "pdf" ? (
                        <span className="text-[9px] font-black tracking-tighter text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-1 py-0.5 rounded">
                          PDF
                        </span>
                      ) : ["xlsx", "xls"].includes(att.ext) ? (
                        <span className="text-[9px] font-black tracking-tighter text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1 py-0.5 rounded">
                          XLS
                        </span>
                      ) : (
                        <span className="text-[9px] font-black tracking-tighter text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-1 py-0.5 rounded">
                          {att.ext.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate group-hover:text-[#345ec4] dark:group-hover:text-[#8ea9f7] transition-colors">
                        {att.filename}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {formatFileSize(att.size)} • Dispatched
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Attachment viewer lightbox modal if clicked */}
      <AttachmentViewerModal
        isOpen={Boolean(selectedAttachment)}
        onClose={() => setSelectedAttachment(null)}
        attachment={selectedAttachment}
      />
    </div>
  );
};
