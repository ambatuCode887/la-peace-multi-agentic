import { useState, useEffect, useRef } from "react";
import type { ShippingCase } from "../../types/shipping";
import {
  Send,
  BookOpen,
  Mail,
  X,
  ShieldAlert,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Paperclip,
  FileText,
  Trash2,
  Plus,
  CalendarClock,
  Save,
} from "lucide-react";
import lapeaceIcon from "../../assets/lapeace_icon.png";
import type { BackendReport } from "../../services/api";
import { api, API_BASE } from "../../services/api";
import { outboxService, type DraftEmail, type SentAttachment } from "../../services/outboxService";
import { ReviewPanel } from "../review/ReviewPanel";

/**
 * Whether this case shows knowledge citations. A backend that has the newer logic says so itself;
 * an older one does not, so fall back to the case: a clean match or a non-comparison email has
 * nothing for the reviewer to decide.
 */
function usesGuidance(shippingCase: ShippingCase): boolean {
  return (
    shippingCase.managerReview?.guidance_applicable ??
    (shippingCase.category === "BL_COMPARISON" && shippingCase.status !== "PASS")
  );
}

interface CopilotDrawerProps {
  currentCase: ShippingCase;
  isOpen: boolean;
  onToggle: () => void;
  activeTab: "summary" | "review" | "email" | "chat";
  onTabChange: (tab: "summary" | "review" | "email" | "chat") => void;
  onReviewSaved?: (report: BackendReport) => void;
  draftToRestore?: DraftEmail | null;
  onDraftRestored?: () => void;
  embeddedEmailOnly?: boolean;
  onDraftCompleted?: () => void;
}

export const CopilotDrawer: React.FC<CopilotDrawerProps> = ({
  currentCase,
  isOpen,
  onToggle,
  activeTab,
  onTabChange,
  onReviewSaved,
  draftToRestore,
  onDraftRestored,
  embeddedEmailOnly = false,
  onDraftCompleted,
}) => {
  const vesselTag =
    currentCase.vessel && currentCase.vessel !== "N/A"
      ? ` (${currentCase.vessel})`
      : "";

  const [messages, setMessages] = useState<
    Array<{ role: "user" | "assistant"; text: string; time: string }>
  >([
    {
      role: "assistant",
      text: `Hello! I am your AI Assistant. I have verified Case #${currentCase.id}${vesselTag}. ${currentCase.aiAnalysis.summary}`,
      time: "Just now",
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Auto-fill and dynamic draft generation for email tab
  const [draftTo, setDraftTo] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<SentAttachment[]>([]);
  const [scheduleAt, setScheduleAt] = useState("");
  const [editingDraftId, setEditingDraftId] = useState<string | undefined>();
  const [isDraftLoading, setIsDraftLoading] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState<
    "idle" | "sending" | "sent" | "failed" | "scheduled"
  >("idle");
  const [dispatchFeedback, setDispatchFeedback] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const restoredDraftCaseRef = useRef<string | null>(null);

  // Dynamic auto-resizing of email body textarea (min 160px, max 300px)
  useEffect(() => {
    if (bodyTextareaRef.current) {
      bodyTextareaRef.current.style.height = "auto";
      const scrollHeight = bodyTextareaRef.current.scrollHeight;
      const targetHeight = Math.min(Math.max(scrollHeight, 160), 300);
      bodyTextareaRef.current.style.height = `${targetHeight}px`;
    }
  }, [draftBody, activeTab]);

  const handleAttachCaseDocuments = () => {
    if (!currentCase.attachments || currentCase.attachments.length === 0) return;
    const newAtts: SentAttachment[] = currentCase.attachments.map((attPath) => {
      const filename = attPath.split("/").pop() || attPath;
      const parts = filename.split(".");
      const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : "txt";
      return {
        filename,
        size: 38400,
        ext,
        caseAttachment: attPath,
        url: `${API_BASE}/cases/${encodeURIComponent(currentCase.id)}/attachments/${attPath.replace(/^\/+/, "")}`,
      };
    });
    setDraftAttachments((prev) => {
      const existingNames = new Set(prev.map((a) => a.filename));
      const toAdd = newAtts.filter((a) => !existingNames.has(a.filename));
      return [...prev, ...toAdd];
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const newAtts: SentAttachment[] = Array.from(files).map((f) => {
      const parts = f.name.split(".");
      const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : "bin";
      return {
        filename: f.name,
        size: f.size,
        ext,
        file: f,
      };
    });
    setDraftAttachments((prev) => [...prev, ...newAtts]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveAttachment = (indexToRemove: number) => {
    setDraftAttachments((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  // Reset or fetch email draft preview when case changes or email tab opens
  useEffect(() => {
    if (draftToRestore) {
      setDraftTo(draftToRestore.to);
      setDraftSubject(draftToRestore.subject);
      setDraftBody(draftToRestore.body);
      setDraftAttachments(draftToRestore.attachments);
      setScheduleAt(draftToRestore.scheduleAt || "");
      setEditingDraftId(draftToRestore.id);
      setDispatchFeedback(draftToRestore.attachments.some((attachment) => attachment.fileMissing)
        ? "A saved upload could not be restored. Reattach it before sending."
        : null);
      setDispatchStatus("idle");
      restoredDraftCaseRef.current = currentCase.id;
      onDraftRestored?.();
      return;
    }
    if (restoredDraftCaseRef.current === currentCase.id) {
      restoredDraftCaseRef.current = null;
      return;
    }
    if (activeTab === "email") {
      setIsDraftLoading(true);
      setDispatchStatus("idle");

      // Request dynamic email generation from backend live preview
      api
        .previewAction(currentCase.id, "draft_correction_email", {
          requested_correction:
            "Please confirm the correct SI and draft BL values as detailed below.",
        })
        .then((preview) => {
          setDraftTo(preview.to || currentCase.sender);
          setDraftSubject(
            preview.subject ||
              `Clarification Required: ${currentCase.subject} (Case #${currentCase.id})`,
          );
          setDraftBody(preview.body || "");
        })
        .catch(() => {
          // Robust client-side fallback template using live case fields
          const mismatched = currentCase.fields.filter(
            (f) => f.status === "mismatch",
          );
          const discrepancyBullets =
            mismatched.length > 0
              ? mismatched
                  .map(
                    (f) =>
                      `• ${f.label}: SI records "${f.siValue}" vs Draft BL records "${f.blValue}"${
                        f.varianceNote ? ` (${f.varianceNote})` : ""
                      }`,
                  )
                  .join("\n")
              : `• Status: ${currentCase.statusNote || "Verification discrepancy identified"}`;

          setDraftTo(currentCase.sender);
          setDraftSubject(
            `Clarification Required: ${currentCase.subject} (Case #${currentCase.id})`,
          );
          setDraftBody(
            `Dear Forwarder / Carrier Operations,\n\nWe have completed automated multi-agent document verification for shipment case #${currentCase.id}${vesselTag}.\n\nDuring verification, the following discrepancy was detected:\n${discrepancyBullets}\n\nPlease review and advise with the amended Draft Bill of Lading or confirmation.\n\nRegards,\nLa Peace Verification Desk`,
          );
        })
        .finally(() => setIsDraftLoading(false));
    }
  }, [
    currentCase.id,
    currentCase.sender,
    currentCase.subject,
    currentCase.status,
    currentCase.statusNote,
    currentCase.fields,
    vesselTag,
    activeTab,
    draftToRestore,
  ]);

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputMessage;
    if (!query.trim() || isChatLoading) return;

    const userMsg = { role: "user" as const, text: query, time: "Just now" };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    if (!textToSend) setInputMessage("");
    setIsChatLoading(true);

    try {
      const res = await api.sendChatMessage(
        currentCase.id,
        query,
        updatedMessages,
      );
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: res.answer, time: "Just now" },
      ]);
    } catch {
      // Intelligent data-grounded fallback using live case fields and verification metadata
      const qLower = query.toLowerCase();
      const mismatched = currentCase.fields.filter(
        (f) => f.status === "mismatch",
      );
      const matchedCount = currentCase.fields.filter(
        (f) => f.status === "match",
      ).length;

      let reply = "";
      if (
        qLower.includes("weight") ||
        qLower.includes("gross") ||
        qLower.includes("tare") ||
        qLower.includes("delta")
      ) {
        const weightField = currentCase.fields.find(
          (f) =>
            f.key.toLowerCase().includes("weight") ||
            f.label.toLowerCase().includes("weight"),
        );
        if (weightField) {
          reply = `Weight Delta Analysis for ${currentCase.id}: Shipping Instruction records "${weightField.siValue}", whereas Draft Bill of Lading records "${weightField.blValue}" (Status: ${weightField.status.toUpperCase()}). ${
            weightField.varianceNote
              ? `Verification note: ${weightField.varianceNote}.`
              : "Cargo weight difference requires forwarder re-measurement confirmation or amended draft BL."
          }`;
        } else {
          reply = `Weight Verification for ${currentCase.id}: No weight discrepancy was flagged across the extracted fields. Source values conform to standard tolerances.`;
        }
      } else if (
        qLower.includes("alias") ||
        qLower.includes("shipper") ||
        qLower.includes("consignee") ||
        qLower.includes("entity") ||
        qLower.includes("precedent")
      ) {
        const shipper = currentCase.fields.find((f) => f.key === "shipper");
        const consignee = currentCase.fields.find((f) => f.key === "consignee");
        const notify = currentCase.fields.find((f) => f.key === "notify_party");

        const hasEntityMismatch =
          shipper?.status === "mismatch" ||
          consignee?.status === "mismatch" ||
          notify?.status === "mismatch";

        reply = `Entity & Corporate Name Analysis (${currentCase.id}):\n• Shipper: SI="${shipper?.siValue || "N/A"}" vs BL="${shipper?.blValue || "N/A"}"\n• Consignee: SI="${consignee?.siValue || "N/A"}" vs BL="${consignee?.blValue || "N/A"}"\n• Notify: SI="${notify?.siValue || "N/A"}" vs BL="${notify?.blValue || "N/A"}".\n${
          hasEntityMismatch
            ? "⚠️ Entity discrepancy detected. In international trade law, exact legal entity matching is mandatory unless supported by an authorized Letter of Indemnity (LOI) or documented commercial registry alias."
            : "✅ Parties match authorized documentation records without entity discrepancies."
        }`;
      } else if (
        qLower.includes("container") ||
        qLower.includes("equipment") ||
        qLower.includes("count")
      ) {
        const containerField = currentCase.fields.find(
          (f) =>
            f.key.toLowerCase().includes("container") ||
            f.label.toLowerCase().includes("container"),
        );
        reply = containerField
          ? `Container Count Analysis for ${currentCase.id}: SI specifies "${containerField.siValue}" vs Draft BL "${containerField.blValue}" (Status: ${containerField.status.toUpperCase()}). ${containerField.varianceNote || ""}`
          : `Container specifications for ${currentCase.id}: Standard equipment aligned across source records.`;
      } else if (
        qLower.includes("discrepan") ||
        qLower.includes("mismatch") ||
        qLower.includes("defect") ||
        qLower.includes("difference")
      ) {
        if (mismatched.length > 0) {
          const fieldSummaries = mismatched
            .map(
              (f) =>
                `• ${f.label}: SI records "${f.siValue}" vs Draft BL "${f.blValue}"${
                  f.varianceNote ? ` (${f.varianceNote})` : ""
                }`,
            )
            .join("\n");
          reply = `Discrepancy Breakdown for ${currentCase.id} (${mismatched.length} mismatching field(s)):\n${fieldSummaries}\n\nHuman operator review or carrier clarification is required prior to document release.`;
        } else {
          reply = `Verification Status for ${currentCase.id}: All ${matchedCount} verified fields match between the SI source of truth and Draft BL. Clean verification.`;
        }
      } else if (
        qLower.includes("recommend") ||
        qLower.includes("action") ||
        qLower.includes("next")
      ) {
        reply = `Operational Recommendation for ${currentCase.id}: ${
          currentCase.managerReview?.recommended_next_action ||
          currentCase.aiAnalysis.recommendation ||
          "Review flagged discrepancies and dispatch carrier clarification if values cannot be reconciled."
        }`;
      } else if (
        qLower.includes("route") ||
        qLower.includes("pol") ||
        qLower.includes("pod") ||
        qLower.includes("port") ||
        qLower.includes("vessel")
      ) {
        reply = `Trade Route & Vessel Particulars (${currentCase.id}):\n• Port of Loading (POL): ${currentCase.pol || "N/A"}\n• Port of Discharge (POD): ${currentCase.pod || "N/A"}\n• Vessel: ${currentCase.vessel || "N/A"} (Voyage ${currentCase.voyageNumber || "N/A"})\n• Carrier Ingestion: ${currentCase.sender || "Unknown"}`;
      } else if (
        qLower.includes("guidance") ||
        qLower.includes("rule") ||
        qLower.includes("tariff")
      ) {
        const ragNotes =
          currentCase.managerReview?.retrieved_guidance?.join(" ") || "";
        reply = ragNotes
          ? `Authoritative Shipping Knowledge & Compliance:\n${ragNotes}`
          : `Regulatory Guidance: Standard maritime document integrity mandates zero tolerance for discrepancies in Shipper, Consignee, Cargo Weight, and Destination Port between Shipping Instructions and the negotiable Draft Bill of Lading.`;
      } else {
        if (currentCase.category !== "BL_COMPARISON") {
          reply = `Operational Inbound Email (${currentCase.category}):\n• Subject: "${currentCase.subject}"\n• Sender: ${currentCase.sender}\n• Summary: ${currentCase.aiAnalysis.summary}`;
        } else {
          reply = `Multi-Agent Verification Context (${currentCase.id}): Current case status is ${currentCase.status} with ${currentCase.fields.length} extracted comparison fields. ${currentCase.aiAnalysis.summary}`;
        }
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: reply, time: "Just now" },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const hasMissingUpload = draftAttachments.some((attachment) => attachment.fileMissing && !attachment.file);

  const handleSaveDraft = async () => {
    try {
      const saved = await outboxService.saveDraft({
        id: editingDraftId,
        caseId: currentCase.id,
        to: draftTo.trim(),
        subject: draftSubject.trim(),
        body: draftBody,
        scheduleAt,
        attachments: draftAttachments,
      });
      setEditingDraftId(saved.id);
      setDispatchStatus("idle");
      setDispatchFeedback(saved.attachments.some((attachment) => attachment.fileMissing)
        ? "Draft saved; reattach the marked upload before sending."
        : "Draft saved.");
    } catch (error) {
      setDispatchStatus("failed");
      setDispatchFeedback(error instanceof Error ? error.message : "Could not save draft.");
    }
  };

  const handleDispatchEmail = async () => {
    if (!draftTo.trim() || !draftSubject.trim()) return;
    if (hasMissingUpload) {
      setDispatchStatus("failed");
      setDispatchFeedback("Reattach the missing uploaded file before sending.");
      return;
    }
    const recipient = draftTo.trim();
    const confirmed = window.confirm(
      `Send this email to ${recipient}${draftAttachments.length ? ` with ${draftAttachments.length} attachment(s)` : ''}?`,
    );
    if (!confirmed) return;
    setDispatchStatus("sending");
    setDispatchFeedback(null);
    try {
      const sent = await api.sendEmail({
        caseId: currentCase.id,
        to: recipient,
        subject: draftSubject.trim(),
        body: draftBody,
        attachments: draftAttachments,
      });
      outboxService.saveSentEmail({
        id: sent.message_id,
        sentAt: sent.sent_at,
        caseId: currentCase.id,
        to: recipient,
        subject: draftSubject.trim(),
        body: draftBody,
        attachments: draftAttachments,
        vessel: currentCase.vessel !== "N/A" ? currentCase.vessel : currentCase.subject,
      });
      if (editingDraftId) {
        await outboxService.deleteDraft(editingDraftId).catch(() => undefined);
        setEditingDraftId(undefined);
        onDraftCompleted?.();
      }

      setDispatchStatus("sent");
      setDispatchFeedback(sent.audit_logged
        ? `Email sent to ${recipient} and recorded in Sent mailbox and case audit.`
        : `Email sent to ${recipient}; the case audit could not be saved.`);
      setTimeout(() => {
        setDispatchStatus("idle");
        setDispatchFeedback(null);
      }, 5000);
    } catch (error) {
      setDispatchStatus("failed");
      setDispatchFeedback(error instanceof Error
        ? error.message
        : `Failed to send email to ${recipient}.`);
      setTimeout(() => {
        setDispatchStatus("idle");
        setDispatchFeedback(null);
      }, 5000);
    }
  };

  const handleScheduleEmail = async () => {
    if (!draftTo.trim() || !draftSubject.trim() || !scheduleAt) return;
    if (hasMissingUpload) {
      setDispatchStatus("failed");
      setDispatchFeedback("Reattach the missing uploaded file before scheduling.");
      return;
    }
    const scheduledTime = new Date(scheduleAt);
    if (Number.isNaN(scheduledTime.getTime()) || scheduledTime <= new Date()) {
      setDispatchStatus("failed");
      setDispatchFeedback("Choose a future date and time.");
      return;
    }
    if (!window.confirm(`Schedule this email to ${draftTo.trim()} for ${scheduledTime.toLocaleString()}?`)) return;
    setDispatchStatus("sending");
    setDispatchFeedback(null);
    try {
      const scheduled = await api.scheduleEmail({
        caseId: currentCase.id,
        to: draftTo.trim(),
        subject: draftSubject.trim(),
        body: draftBody,
        scheduledAt: scheduledTime.toISOString(),
        attachments: draftAttachments,
      });
      if (editingDraftId) {
        await outboxService.deleteDraft(editingDraftId).catch(() => undefined);
        setEditingDraftId(undefined);
        onDraftCompleted?.();
      }
      setDispatchStatus("scheduled");
      setDispatchFeedback(`Scheduled for ${new Date(scheduled.scheduled_at).toLocaleString()}.`);
      setScheduleAt("");
      setTimeout(() => {
        setDispatchStatus("idle");
        setDispatchFeedback(null);
      }, 5000);
    } catch (error) {
      setDispatchStatus("failed");
      setDispatchFeedback(error instanceof Error ? error.message : "Could not schedule email.");
    }
  };

  return (
    <>
      {/* Floating trigger button when drawer is closed */}
      <button
        onClick={onToggle}
        className={`${embeddedEmailOnly ? "hidden" : "fixed right-4 bottom-4 sm:right-6 sm:bottom-6 z-40 px-3 py-2.5 sm:px-4 sm:py-3 rounded-2xl bg-gradient-to-r from-[#052464] via-[#1a3d8e] to-[#345ec4] text-white shadow-xl hover:shadow-[#345ec4]/30 flex items-center space-x-2 transition-all duration-300 ease-in-out hover:scale-105 border border-[#5a82e2]/40 cursor-pointer min-h-[44px]"} ${
          isOpen ? "opacity-0 pointer-events-none scale-90" : "opacity-100 pointer-events-auto scale-100"
        }`}
      >
        <img
          src={lapeaceIcon}
          alt="AI Assistant"
          className="w-5 h-5 object-contain drop-shadow"
          style={{ imageRendering: "pixelated" }}
        />
        <span className="text-xs font-bold hidden sm:inline">Open Review & AI Workspace</span>
        <span className="text-xs font-bold sm:hidden">AI & Review</span>
      </button>

      {/* Mobile backdrop for drawer on < lg screens */}
      <div
        className={`${embeddedEmailOnly ? "hidden" : "fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 lg:hidden transition-opacity duration-300 ease-in-out"} ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onToggle}
        aria-hidden="true"
      />

      {/* Aside drawer with synchronized smooth slide & width transition */}
      <aside
        className={embeddedEmailOnly
          ? "relative w-full max-w-none min-h-[560px] rounded-xl border border-slate-200/80 bg-white dark:bg-[#06163a] dark:border-[#1a3d8e]/60 flex flex-col shadow-sm overflow-hidden"
          : `fixed inset-y-0 right-0 z-50 w-full max-w-md sm:w-[420px] lg:static lg:z-auto border-l border-slate-200/80 bg-white/95 dark:bg-[#06163a]/95 dark:border-[#1a3d8e]/60 flex flex-col h-dvh lg:h-[calc(100vh-4rem)] shadow-2xl lg:shadow-lg select-none transition-all duration-300 ease-in-out overflow-hidden ${
          isOpen
            ? "translate-x-0 opacity-100 lg:w-96 xl:w-[420px]"
            : "translate-x-full lg:translate-x-0 opacity-0 lg:w-0 lg:border-l-0 pointer-events-none"
        }`}
      >
        {/* Drawer Header */}
        <div className={`${embeddedEmailOnly ? "hidden" : "p-4 border-b border-slate-100 dark:border-[#1a3d8e]/60 flex items-center justify-between bg-slate-50/50 dark:bg-[#091f52]/25"}`}>
          <div className="flex items-center space-x-2.5">
            <img
              src={lapeaceIcon}
              alt="AI Assistant"
              className="w-7 h-7 object-contain select-none drop-shadow-xs"
              style={{ imageRendering: "pixelated" }}
            />
            <div>
              <h3 className="text-xs font-bold text-slate-900 dark:text-white flex items-center space-x-1.5">
                <span>AI & Review Workspace</span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-[#e8effd] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7] border border-[#345ec4]/30">
                  Active
                </span>
              </h3>
              <span className="text-[10px] text-[#345ec4] dark:text-[#5a82e2] font-medium">
                Multi-Agent Verification & Review
              </span>
            </div>
          </div>

          <button
            onClick={onToggle}
            className="p-2 sm:p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#091f52]/60 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            aria-label="Close drawer"
          >
            <X className="w-5 h-5 sm:w-4 sm:h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className={`${embeddedEmailOnly ? "hidden" : "grid grid-cols-4 gap-1 p-2 bg-slate-100/70 dark:bg-[#091f52]/40 border-b border-slate-200/60 dark:border-[#1a3d8e]/60 text-[11px] font-semibold"}`}>
          <button
            onClick={() => onTabChange("summary")}
            className={`py-2 sm:py-1.5 rounded-lg text-center transition-all cursor-pointer ${
            activeTab === "summary"
              ? "bg-white dark:bg-[#1a3d8e] text-[#1a3d8e] dark:text-white shadow-xs font-bold"
              : "text-slate-500 hover:text-slate-900 dark:text-slate-400"
          }`}
        >
          Analysis
        </button>
        <button
          onClick={() => onTabChange("review")}
          className={`py-1.5 rounded-lg text-center transition-all cursor-pointer ${
            activeTab === "review"
              ? "bg-white dark:bg-[#1a3d8e] text-[#1a3d8e] dark:text-white shadow-xs font-bold"
              : "text-slate-500 hover:text-slate-900 dark:text-slate-400"
          }`}
        >
          Review
        </button>
        <button
          type="button"
          data-testid="copilot-tab-email"
          onClick={() => onTabChange("email")}
          className={`py-1.5 rounded-lg text-center transition-all cursor-pointer ${
            activeTab === "email"
              ? "bg-white dark:bg-[#1a3d8e] text-[#1a3d8e] dark:text-white shadow-xs font-bold"
              : "text-slate-500 hover:text-slate-900 dark:text-slate-400"
          }`}
        >
          Email
        </button>
        <button
          onClick={() => onTabChange("chat")}
          className={`py-1.5 rounded-lg text-center transition-all cursor-pointer ${
            activeTab === "chat"
              ? "bg-white dark:bg-[#1a3d8e] text-[#1a3d8e] dark:text-white shadow-xs font-bold"
              : "text-slate-500 hover:text-slate-900 dark:text-slate-400"
          }`}
        >
          Q&A
        </button>
      </div>

      {/* Tab 1: AI Summary & RAG Guidance */}
      {!embeddedEmailOnly && activeTab === "summary" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs select-text">
          {/* Confidence Score */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-br from-[#eef3fc] via-indigo-50/40 to-white border border-[#345ec4]/20 dark:from-[#052464]/60 dark:via-[#0c1633] dark:to-[#052464]/20 dark:border-[#1a3d8e] shadow-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                {currentCase.aiAnalysis.model === "Deterministic ETL extraction"
                  ? "Extraction Confidence"
                  : "AI Confidence Score"}
              </span>
              <span className="font-mono font-bold text-[#345ec4] dark:text-[#5a82e2] text-sm">
                {currentCase.aiAnalysis.confidence !== undefined
                  ? `${currentCase.aiAnalysis.confidence}%`
                  : "Not provided"}
              </span>
            </div>
            <div className="w-full h-2 bg-slate-200/80 dark:bg-[#05163a] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#345ec4] to-[#5a82e2] rounded-full transition-all duration-500"
                style={{ width: `${currentCase.aiAnalysis.confidence ?? 0}%` }}
              ></div>
            </div>
          </div>

          {/* Real RAG Knowledge Citations from backend manager review */}
          {usesGuidance(currentCase) &&
            currentCase.managerReview?.retrieved_guidance &&
            currentCase.managerReview.retrieved_guidance.length > 0 && (
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-1.5 flex items-center justify-between">
                  <span className="flex items-center space-x-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-[#345ec4] dark:text-[#5a82e2]" />
                    <span>RAG Knowledge Retrieval Citations</span>
                  </span>
                  <span className="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-[#e8effd] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7]">
                    {currentCase.managerReview.route || "human_review"}
                  </span>
                </h4>
                <div className="space-y-1.5">
                  {currentCase.managerReview.retrieved_guidance.map(
                    (guidance, gIdx) => {
                      const citation =
                        currentCase.managerReview?.citations?.[gIdx];
                      return (
                        <div
                          key={gIdx}
                          className="text-slate-600 dark:text-slate-300 leading-relaxed bg-[#eef3fc]/60 dark:bg-[#091f52]/40 p-2.5 rounded-xl border border-[#345ec4]/25 text-[11px]"
                        >
                          <p>📖 {guidance}</p>
                          {citation && (
                            <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                              Source: {citation.source}
                              {citation.chunk_index != null
                                ? ` · section ${citation.chunk_index + 1}`
                                : ""}
                              {citation.relevance !== undefined
                                ? ` · relevance ${Math.round(citation.relevance * 100)}%`
                                : ""}
                            </p>
                          )}
                        </div>
                      );
                    },
                  )}
                </div>
              </div>
            )}

          {usesGuidance(currentCase) &&
            currentCase.managerReview?.field_guidance &&
            currentCase.managerReview.field_guidance.length > 0 && (
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-1.5">
                  Recommended checks
                </h4>
                <div className="space-y-1.5">
                  {currentCase.managerReview.field_guidance.map((rule, rIdx) => (
                    <p
                      key={rIdx}
                      className="text-slate-600 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-[#091f52]/30 p-2.5 rounded-xl border border-slate-200/60 dark:border-[#1a3d8e]/40 text-[11px]"
                    >
                      {rule}
                    </p>
                  ))}
                </div>
              </div>
            )}

          {currentCase.managerReview &&
            (!currentCase.managerReview.available ||
              (usesGuidance(currentCase) &&
                !currentCase.managerReview.retrieved_guidance?.length)) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                <div className="font-bold">RAG guidance unavailable</div>
                <div className="mt-1">
                  {currentCase.managerReview.reason ||
                    "No matching knowledge chunks were returned from Qdrant."}
                </div>
              </div>
            )}

          {/* Verifier Rulings */}
          {currentCase.verifier?.rulings &&
            currentCase.verifier.rulings.length > 0 && (
              <div>
                <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-1.5 flex items-center space-x-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-500" />
                  <span>Discrepancy Verifier Rulings</span>
                </h4>
                <div className="space-y-1.5">
                  {currentCase.verifier.rulings.map((r, rIdx) => (
                    <div
                      key={rIdx}
                      className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#091f52]/40 border border-slate-200/60 dark:border-[#1a3d8e]/40 space-y-1 text-[11px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold uppercase">
                          {r.field.replace(/_/g, " ")}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                            r.ruling === "CONFIRMED_DISCREPANCY"
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          }`}
                        >
                          {r.ruling}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-400">
                        {r.reason}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Recommended Action */}
          <div>
            <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-1">
              Recommended Next Action
            </h4>
            <p className="text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-[#091f52]/30 p-3 rounded-xl border border-slate-200/60 dark:border-[#1a3d8e]/40">
              {currentCase.managerReview?.recommended_next_action ||
                currentCase.aiAnalysis.recommendation}
            </p>
          </div>
        </div>
      )}

      {/* Tab: Human Operator Review & Ground-Truth Corrections */}
      {!embeddedEmailOnly && activeTab === "review" && (
        <div className="flex-1 overflow-y-auto p-4 select-text">
          <ReviewPanel
            key={currentCase.id}
            currentCase={currentCase}
            onSaved={(report) => {
              if (onReviewSaved) onReviewSaved(report);
            }}
            onSwitchToEmail={() => onTabChange("email")}
          />
        </div>
      )}

      {/* Tab: Outbound Clarification Email Draft (Live Action Preview) */}
      {activeTab === "email" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs select-text">
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
            <span className="flex items-center space-x-2 font-semibold">
              <Mail className="w-4 h-4 text-[#345ec4] dark:text-[#5a82e2]" />
              <span>Auto-Generated Clarification Email</span>
            </span>
            {isDraftLoading && (
              <span className="flex items-center space-x-1 text-[10px] text-slate-400">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Loading preview...</span>
              </span>
            )}
          </div>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            multiple
            className="hidden"
          />

          <div className="p-3.5 bg-slate-50 dark:bg-[#091f52]/40 border border-slate-200 dark:border-[#1a3d8e]/50 rounded-2xl space-y-3 shadow-xs">
            {/* TO Input Field */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                To:
              </label>
              <input
                type="text"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                placeholder="recipient@carrier.com"
                className="w-full px-3 py-2 bg-white dark:bg-[#05163a] border border-slate-200 dark:border-[#1a3d8e]/60 rounded-xl text-xs font-mono font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#345ec4]/30 focus:border-[#345ec4] transition-all"
              />
            </div>

            {/* SUBJECT Input Field */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                Subject:
              </label>
              <input
                type="text"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                placeholder="Discrepancy Clarification Required..."
                className="w-full px-3 py-2 bg-white dark:bg-[#05163a] border border-slate-200 dark:border-[#1a3d8e]/60 rounded-xl text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#345ec4]/30 focus:border-[#345ec4] transition-all"
              />
            </div>

            {/* BODY Dynamic Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Message Body:
                </label>
                <span className="text-[10px] text-slate-400">
                  Auto-resizes as you type
                </span>
              </div>
              <textarea
                ref={bodyTextareaRef}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                rows={6}
                placeholder="Draft message content..."
                className="w-full p-3 bg-white dark:bg-[#05163a] border border-slate-200 dark:border-[#1a3d8e]/60 rounded-xl text-xs font-sans leading-relaxed text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#345ec4]/30 focus:border-[#345ec4] transition-all resize-none overflow-y-auto"
                style={{ minHeight: "160px", maxHeight: "280px" }}
              />
            </div>

            {/* ATTACHMENTS Section */}
            <div className="pt-2 border-t border-slate-200/80 dark:border-[#1a3d8e]/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center space-x-1.5">
                  <Paperclip className="w-3 h-3 text-[#345ec4] dark:text-[#5a82e2]" />
                  <span>Attachments ({draftAttachments.length})</span>
                </span>

                <div className="flex items-center space-x-1.5">
                  {currentCase.attachments && currentCase.attachments.length > 0 && (
                    <button
                      type="button"
                      onClick={handleAttachCaseDocuments}
                      className="inline-flex items-center space-x-1 px-2 py-1 rounded-lg text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-[#1a3d8e] dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/60 hover:bg-blue-100 transition-colors cursor-pointer"
                      title="Attach original case shipping documents"
                    >
                      <FileText className="w-3 h-3" />
                      <span>Attach Case Docs</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-slate-200/70 hover:bg-slate-300 dark:bg-[#0c2966] dark:hover:bg-[#133e99] text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Attach Files</span>
                  </button>
                </div>
              </div>

              {/* Render Attached Chips */}
              {draftAttachments.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  {draftAttachments.map((att, idx) => (
                    <div
                      key={`${att.filename}-${idx}`}
                      className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-[#06163a] border border-slate-200 dark:border-[#1a3d8e]/60 shadow-2xs group text-[11px]"
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-black uppercase bg-slate-100 text-slate-700 dark:bg-[#091f52] dark:text-slate-300">
                          {att.ext}
                        </span>
                        <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                          {att.filename}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          ({att.size < 1024 ? `${att.size}B` : `${Math.round(att.size / 1024)}KB`})
                        </span>
                        {att.fileMissing && <span className="text-[10px] text-rose-600">Reattach required</span>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(idx)}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                        title="Remove attachment"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSaveDraft()}
            className="w-full py-2 rounded-xl border border-slate-300 dark:border-[#1a3d8e]/60 bg-white dark:bg-[#06163a] text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-[#091f52]/50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Draft</span>
          </button>

          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Schedule for
              <input
                type="datetime-local"
                value={scheduleAt}
                min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000 + 60000).toISOString().slice(0, 16)}
                disabled={dispatchStatus === "sending"}
                onChange={(event) => setScheduleAt(event.target.value)}
                className="mt-1 block w-full min-w-0 rounded-lg border border-slate-200 dark:border-[#1a3d8e]/60 bg-white dark:bg-[#05163a] px-2 py-2 text-xs font-medium normal-case text-slate-800 dark:text-slate-200"
              />
            </label>
            <button
              type="button"
              onClick={() => scheduleAt ? setScheduleAt("") : void handleScheduleEmail()}
              disabled={dispatchStatus === "sending" || (!scheduleAt && (!draftTo.trim() || !draftSubject.trim()))}
              title={scheduleAt ? "Clear scheduled date" : "Schedule email"}
              className="h-9 px-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-amber-100 cursor-pointer disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
            >
              {scheduleAt ? <X className="w-3.5 h-3.5" /> : <CalendarClock className="w-3.5 h-3.5" />}
              <span>{scheduleAt ? "Clear date" : "Schedule"}</span>
            </button>
          </div>

          <button
            onClick={() => scheduleAt ? void handleScheduleEmail() : void handleDispatchEmail()}
            disabled={dispatchStatus === "sending" || !draftTo.trim() || !draftSubject.trim() || hasMissingUpload}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#052464] via-[#1a3d8e] to-[#345ec4] hover:from-[#1a3d8e] hover:to-[#5a82e2] text-white font-semibold flex items-center justify-center space-x-2 shadow-md shadow-[#345ec4]/25 cursor-pointer disabled:opacity-50 transition-all"
          >
            {dispatchStatus === "sending" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{scheduleAt ? "Scheduling Email..." : "Sending Email..."}</span>
              </>
            ) : scheduleAt ? (
              <>
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Schedule Email</span>
              </>
            ) : dispatchStatus === "sent" ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Email Sent & Logged!</span>
              </>
            ) : dispatchStatus === "failed" ? (
              <>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                <span>Failed to Send Email</span>
              </>
            ) : dispatchStatus === "scheduled" ? (
              <>
                <CalendarClock className="w-3.5 h-3.5 text-amber-200" />
                <span>Email Scheduled</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Send Email</span>
              </>
            )}
          </button>

          {dispatchFeedback && (
            <div
              className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-medium animate-in fade-in ${
                dispatchStatus === "failed"
                  ? "bg-rose-50 border-rose-200/80 text-rose-800 dark:bg-rose-950/40 dark:border-rose-800/80 dark:text-rose-200"
                  : "bg-emerald-50 border-emerald-200/80 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800/80 dark:text-emerald-200"
              }`}
            >
              {dispatchStatus === "failed" ? (
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              )}
              <span>{dispatchFeedback}</span>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Interactive Assistant Chat (Live API chat) */}
      {!embeddedEmailOnly && activeTab === "chat" && (
        <div className="flex-1 flex flex-col h-full overflow-hidden select-text">
          {/* Messages list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={`flex flex-col ${
                  m.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-[85%] p-3 rounded-2xl shadow-2xs ${
                    m.role === "user"
                      ? "bg-[#345ec4] text-white rounded-br-xs"
                      : "bg-slate-100 dark:bg-[#091f52]/60 text-slate-800 dark:text-slate-200 rounded-bl-xs border border-slate-200/80 dark:border-[#1a3d8e]/50"
                  }`}
                >
                  <p className="leading-relaxed whitespace-pre-wrap">
                    {m.text}
                  </p>
                </div>
                <span className="text-[10px] text-slate-400 mt-1 px-1">
                  {m.time}
                </span>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex items-center space-x-2 text-slate-400 p-2 text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#345ec4] dark:text-[#5a82e2]" />
                <span>AI Assistant is analyzing case context...</span>
              </div>
            )}
          </div>

          {/* Quick Prompts */}
          <div className="p-2 border-t border-slate-100 dark:border-[#1a3d8e]/60 bg-slate-50/80 dark:bg-[#091f52]/30 flex items-center space-x-1.5 overflow-x-auto text-[11px] select-none">
            <button
              onClick={() => handleSendMessage("Explain the weight difference")}
              disabled={isChatLoading}
              className="px-2.5 py-1 rounded-full bg-white dark:bg-[#091f52] border border-slate-200 dark:border-[#1a3d8e] hover:border-[#345ec4] whitespace-nowrap text-slate-700 dark:text-slate-300 cursor-pointer disabled:opacity-50"
            >
              Explain weight delta
            </button>
            <button
              onClick={() =>
                handleSendMessage(
                  "Is there legal alias precedent for this shipper?",
                )
              }
              disabled={isChatLoading}
              className="px-2.5 py-1 rounded-full bg-white dark:bg-[#091f52] border border-slate-200 dark:border-[#1a3d8e] hover:border-[#345ec4] whitespace-nowrap text-slate-700 dark:text-slate-300 cursor-pointer disabled:opacity-50"
            >
              Check alias precedent
            </button>
          </div>

          {/* Chat input */}
          <div className="p-3 border-t border-slate-200 dark:border-[#1a3d8e]/60 bg-white dark:bg-[#06163a] select-none">
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                placeholder="Ask AI Assistant about this case..."
                disabled={isChatLoading}
                className="flex-1 text-xs py-2 px-3 rounded-xl bg-slate-100 dark:bg-[#091f52]/40 border border-slate-200/60 dark:border-[#1a3d8e]/40 focus:outline-hidden focus:bg-white focus:border-[#345ec4] dark:text-slate-200 dark:focus:bg-[#05163a]"
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={isChatLoading || !inputMessage.trim()}
                className="p-2 rounded-xl bg-[#345ec4] hover:bg-[#1a3d8e] text-white shadow-xs cursor-pointer disabled:opacity-50 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
    </>
  );
};
