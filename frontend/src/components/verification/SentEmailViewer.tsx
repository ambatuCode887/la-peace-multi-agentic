import React, { useState, useRef } from "react";
import {
  Send,
  CheckCircle2,
  Paperclip,
  ExternalLink,
  Clock,
  ArrowLeft,
  Reply,
  Ship,
  Sparkles,
  Trash2,
  Loader2,
  MessageSquare,
  Check,
  FileText,
  X,
  User,
} from "lucide-react";
import {
  outboxService,
  type DispatchedEmail,
  type ThreadReply,
  type SentAttachment,
} from "../../services/outboxService";
import { formatMalaysiaTime } from "../../utils/formatTime";
import { AttachmentViewerModal, type OriginalAttachment } from "./AttachmentViewerModal";
import { api } from "../../services/api";

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

  // Reply Composer State
  const [isReplying, setIsReplying] = useState(false);
  const [replyRole, setReplyRole] = useState<"operator" | "recipient">("operator");
  const [replyBody, setReplyBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);
  const [replyAttachments, setReplyAttachments] = useState<SentAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyEndRef = useRef<HTMLDivElement>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };



  const allMessagesCount = 1 + (email.replies?.length || 0);

  // Smart Maritime Quick-Reply Suggestions
  const operatorSuggestions = [
    "Following up on pending discrepancy review prior to vessel departure.",
    "Discrepancy confirmed resolved. Please release Original Bill of Lading.",
    "Please provide the corrected container check digit per ISO 6346 Modulo-11.",
  ];

  const carrierSuggestions = [
    "Tare variance (+70 KG) confirmed under SOLAS VGM rules. Draft BL approved.",
    "Container number checksum verified: MSKU-918234-8. Revised draft attached.",
    "Discrepancy acknowledged. Booking amended to FREIGHT PREPAID per CIF terms.",
    "Dangerous Goods IMDG Class 3 / UN 1993 declaration confirmed attached.",
  ];

  const handleApplySuggestion = (text: string) => {
    setReplyBody((prev) => (prev ? `${prev}\n\n${text}` : text));
  };

  const handleAddAttachment = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    const newAttachments: SentAttachment[] = Array.from(files).map((file) => ({
      filename: file.name,
      size: file.size,
      ext: file.name.split(".").pop()?.toLowerCase() || "txt",
      file,
    }));
    setReplyAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveAttachment = (index: number) => {
    setReplyAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSendReply = async () => {
    if (!replyBody.trim()) return;
    setIsSending(true);
    setSendSuccess(false);

    try {
      const isOp = replyRole === "operator";
      const sender = isOp
        ? "Documentation Operations Desk <docs@shipping.com>"
        : email.to;
      const senderName = isOp
        ? "Documentation Desk (You)"
        : email.to.includes("@")
        ? email.to.split("@")[0].toUpperCase()
        : "Carrier Counterparty";
      const recipientTo = isOp ? email.to : "docs@shipping.com";

      // If operator reply, deliver end-to-end to backend SMTP/Mailpit
      if (isOp) {
        try {
          await api.sendEmail({
            caseId: email.caseId || "general",
            to: email.to,
            subject: `Re: ${email.subject}`,
            body: replyBody.trim(),
            attachments: replyAttachments.map((att) => ({
              filename: att.filename,
              file: att.file,
            })),
          });
        } catch (apiErr) {
          console.warn("Backend SMTP delivery note:", apiErr);
          // Still save into thread locally
        }
      }

      // Add to outbox service thread
      outboxService.addReplyToSentEmail(email.id, {
        sender,
        senderName,
        senderType: replyRole,
        to: recipientTo,
        body: replyBody.trim(),
        attachments: replyAttachments,
      });

      setSendSuccess(true);
      setReplyBody("");
      setReplyAttachments([]);
      setIsReplying(false);

      setTimeout(() => {
        setSendSuccess(false);
        replyEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 500);
    } catch (err) {
      console.error("Failed to send reply:", err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in select-text pb-10">
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
          <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#eef3fc] dark:bg-[#091f52] text-[#1a3d8e] dark:text-[#8ea9f7] border border-[#345ec4]/30">
            <MessageSquare className="w-3 h-3 mr-1" />
            <span>{allMessagesCount} {allMessagesCount === 1 ? "Message" : "Messages in Thread"}</span>
          </span>
        </div>

        <div className="flex items-center space-x-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center space-x-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-mono text-[11px]">
              Origin: {formatMalaysiaTime(email.sentAt)}
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

      {/* 2. THREAD CONTAINER: OUTBOUND EMAIL + STACKED REPLIES */}
      <div className="space-y-4">
        {/* MESSAGE 1: ORIGINAL OUTBOUND EMAIL */}
        <div className="rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs overflow-hidden">
          {/* Email Header */}
          <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-[#1a3d8e]/40 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                {email.subject}
              </h2>
              <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-[#eef3fc] dark:bg-[#091f52] text-[#1a3d8e] dark:text-[#8ea9f7] border border-[#345ec4]/30 shrink-0">
                <Send className="w-3 h-3 mr-1" />
                Original Dispatch
              </span>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs pt-1">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-800/80 flex items-center justify-center text-xs font-bold text-[#1a3d8e] dark:text-blue-300 shrink-0">
                  OP
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      From: Documentation Operations Desk &lt;docs@shipping.com&gt;
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    To: {email.to}
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

        {/* STACKED THREAD REPLIES */}
        {email.replies && email.replies.length > 0 && (
          <div className="space-y-4 pl-3 sm:pl-6 border-l-2 border-slate-200/80 dark:border-[#1a3d8e]/60">
            {email.replies.map((reply: ThreadReply, index: number) => {
              const isRecipient = reply.senderType === "recipient";
              return (
                <div
                  key={reply.id || index}
                  className={`rounded-2xl border shadow-xs overflow-hidden transition-all ${
                    isRecipient
                      ? "bg-white dark:bg-[#071942] border-emerald-200/80 dark:border-emerald-800/60"
                      : "bg-white dark:bg-[#06163a] border-blue-200/80 dark:border-[#1a3d8e]/60"
                  }`}
                >
                  {/* Reply Header */}
                  <div className="p-3.5 sm:p-4 border-b border-slate-100 dark:border-[#1a3d8e]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center space-x-3 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${
                          isRecipient
                            ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-700"
                            : "bg-blue-100 text-[#1a3d8e] border-blue-300 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-700"
                        }`}
                      >
                        {isRecipient ? <Ship className="w-4 h-4" /> : <User className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-slate-900 dark:text-white truncate">
                            {reply.senderName || reply.sender}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                              isRecipient
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300/40"
                                : "bg-blue-50 text-blue-700 dark:bg-blue-950/80 dark:text-blue-300 border border-blue-300/40"
                            }`}
                          >
                            {isRecipient ? "Counterparty Reply" : "Operator Follow-up"}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          To: {reply.to}
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 shrink-0">
                      {formatMalaysiaTime(reply.timestamp)}
                    </div>
                  </div>

                  {/* Reply Body */}
                  <div className="p-4 sm:p-5 space-y-3">
                    <div className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed font-normal whitespace-pre-wrap font-sans">
                      {reply.body}
                    </div>

                    {/* Reply Attachments if any */}
                    {reply.attachments && reply.attachments.length > 0 && (
                      <div className="pt-3 border-t border-slate-100 dark:border-[#1a3d8e]/30 flex flex-wrap gap-2">
                        {reply.attachments.map((att: SentAttachment, attIdx: number) => (
                          <span
                            key={attIdx}
                            className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-100 dark:bg-[#091f52] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#1a3d8e]/50 font-mono"
                          >
                            <FileText className="w-3 h-3 text-[#345ec4] dark:text-[#5a82e2]" />
                            <span>{att.filename}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div ref={replyEndRef} />

        {/* 3. GMAIL-INSPIRED INTERACTIVE REPLY SECTION */}
        {!isReplying ? (
          /* Collapsed Gmail Quick-Action Pill Bar */
          <div className="rounded-2xl border border-slate-200/80 dark:border-[#1a3d8e]/60 bg-white dark:bg-[#06163a] p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setIsReplying(true);
                setReplyRole("operator");
              }}
              className="flex items-center space-x-2 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 flex-1 text-left py-2 px-3 rounded-xl hover:bg-slate-100/70 dark:hover:bg-[#091f52]/50 transition-colors cursor-pointer"
            >
              <Reply className="w-4 h-4 text-[#345ec4] dark:text-[#5a82e2]" />
              <span>Reply to {email.to}...</span>
            </button>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsReplying(true);
                  setReplyRole("operator");
                }}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#eef3fc] text-[#1a3d8e] border border-[#345ec4]/30 dark:bg-[#091f52] dark:text-[#8ea9f7] hover:bg-[#dfeafd] transition-colors cursor-pointer"
                title="Send follow-up clarification as Documentation Desk"
              >
                <Reply className="w-3.5 h-3.5" />
                <span>Desk Follow-up</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsReplying(true);
                  setReplyRole("recipient");
                }}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-300/60 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 transition-colors cursor-pointer"
                title="Simulate incoming reply from carrier / counterparty for pitch demonstration"
              >
                <Ship className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Simulate Carrier Reply</span>
              </button>
            </div>
          </div>
        ) : (
          /* Expanded Gmail Composer Card */
          <div className="rounded-2xl border-2 border-[#345ec4] dark:border-[#5a82e2] bg-white dark:bg-[#06163a] shadow-lg overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
            {/* Composer Role Selector & Header */}
            <div className="p-3.5 px-4 bg-slate-50/80 dark:bg-[#040f2b] border-b border-slate-200/80 dark:border-[#1a3d8e]/60 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 mr-1">
                  Reply As:
                </span>
                <button
                  type="button"
                  onClick={() => setReplyRole("operator")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    replyRole === "operator"
                      ? "bg-[#345ec4] text-white shadow-xs"
                      : "bg-white dark:bg-[#06163a] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-[#1a3d8e]/50 hover:bg-slate-100"
                  }`}
                >
                  Operator Follow-up
                </button>
                <button
                  type="button"
                  onClick={() => setReplyRole("recipient")}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    replyRole === "recipient"
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "bg-white dark:bg-[#06163a] text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-[#1a3d8e]/50 hover:bg-slate-100"
                  }`}
                >
                  Carrier / Counterparty
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {replyRole === "operator" ? `To: ${email.to}` : "To: docs@shipping.com"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setIsReplying(false);
                    setReplyBody("");
                    setReplyAttachments([]);
                  }}
                  className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-[#091f52] text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  title="Discard response draft"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Smart Suggested Chips */}
            <div className="p-3 px-4 bg-slate-50/40 dark:bg-[#06163a]/40 border-b border-slate-100 dark:border-[#1a3d8e]/30 space-y-1.5">
              <div className="flex items-center space-x-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                <Sparkles className="w-3 h-3 text-amber-500" />
                <span>
                  Quick Maritime Suggestions ({replyRole === "operator" ? "Desk Actions" : "Carrier Responses"}):
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(replyRole === "operator" ? operatorSuggestions : carrierSuggestions).map(
                  (suggestion, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleApplySuggestion(suggestion)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white dark:bg-[#091f52] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#1a3d8e]/50 hover:bg-blue-50 hover:border-blue-300 dark:hover:bg-[#0f2e7a] transition-all cursor-pointer text-left"
                    >
                      {suggestion}
                    </button>
                  ),
                )}
              </div>
            </div>

            {/* Composer Textarea */}
            <div className="p-4 space-y-3">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void handleSendReply();
                  }
                }}
                rows={4}
                autoFocus
                placeholder={
                  replyRole === "operator"
                    ? "Type your follow-up message to the carrier... (Ctrl+Enter to send)"
                    : "Simulate carrier response (e.g., tare acknowledgment, revised BL issued)..."
                }
                className="w-full text-xs text-slate-800 dark:text-slate-100 bg-transparent border-0 focus:ring-0 p-0 resize-none font-sans leading-relaxed focus:outline-none"
              />

              {/* Attached Files List */}
              {replyAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-[#1a3d8e]/40">
                  {replyAttachments.map((att, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs bg-slate-100 dark:bg-[#091f52] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#1a3d8e]/60"
                    >
                      <Paperclip className="w-3 h-3 text-[#345ec4]" />
                      <span className="font-mono text-[11px]">{att.filename}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        className="text-slate-400 hover:text-rose-500 cursor-pointer ml-1"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Composer Action Toolbar */}
            <div className="p-3 px-4 bg-slate-50/80 dark:bg-[#040f2b] border-t border-slate-200/80 dark:border-[#1a3d8e]/60 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleAddAttachment}
                  multiple
                  className="hidden"
                  id="reply-file-upload"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-[#091f52] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors cursor-pointer"
                  title="Attach documents"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  End-to-End Delivery: SMTP / Audit Trail Persisted
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsReplying(false);
                    setReplyBody("");
                    setReplyAttachments([]);
                  }}
                  className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                  title="Discard Draft"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => void handleSendReply()}
                  disabled={!replyBody.trim() || isSending}
                  className={`inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all cursor-pointer ${
                    !replyBody.trim() || isSending
                      ? "bg-slate-400 dark:bg-slate-700 cursor-not-allowed opacity-60"
                      : replyRole === "operator"
                      ? "bg-[#345ec4] hover:bg-[#274aa3] shadow-md hover:shadow-lg"
                      : "bg-emerald-600 hover:bg-emerald-700 shadow-md hover:shadow-lg"
                  }`}
                >
                  {isSending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Sending...</span>
                    </>
                  ) : sendSuccess ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Dispatched!</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5 mr-1" />
                      <span>Send Reply</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
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
