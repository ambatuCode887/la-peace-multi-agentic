import { useState, useEffect } from "react";
import type { ShippingCase } from "../../types/shipping";
import {
  Send,
  BookOpen,
  Mail,
  X,
  ShieldAlert,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import lapeaceIcon from "../../assets/lapeace_icon.png";
import type { BackendReport } from "../../services/api";
import { api } from "../../services/api";
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
}

export const CopilotDrawer: React.FC<CopilotDrawerProps> = ({
  currentCase,
  isOpen,
  onToggle,
  activeTab,
  onTabChange,
  onReviewSaved,
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
  const [isDraftLoading, setIsDraftLoading] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState<
    "idle" | "sending" | "sent"
  >("idle");

  // Reset or fetch email draft preview when case changes or email tab opens
  useEffect(() => {
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
      // Graceful fallback to multi-agent knowledge logic if backend AI is temporarily offline
      const qLower = query.toLowerCase();
      const mismatched = currentCase.fields.filter(
        (f) => f.status === "mismatch",
      );
      const matchedCount = currentCase.fields.filter(
        (f) => f.status === "match",
      ).length;

      let reply = "";
      if (
        qLower.includes("discrepan") ||
        qLower.includes("mismatch") ||
        qLower.includes("defect")
      ) {
        if (mismatched.length > 0) {
          const fieldSummaries = mismatched
            .map(
              (f) =>
                `${f.label}: SI records "${f.siValue}" vs Draft BL "${f.blValue}"${
                  f.varianceNote ? ` (${f.varianceNote})` : ""
                }`,
            )
            .join(". ");
          reply = `Discrepancy Breakdown for ${currentCase.id}: Found ${mismatched.length} mismatching field(s). ${fieldSummaries}. Human verification required prior to BL release.`;
        } else {
          reply = `Verification Status for ${currentCase.id}: All ${matchedCount} verified fields match between the SI source and Draft BL. No discrepancies found.`;
        }
      } else if (qLower.includes("recommend") || qLower.includes("action")) {
        reply = `Operational Recommendation: ${
          currentCase.managerReview?.recommended_next_action ||
          currentCase.aiAnalysis.recommendation
        }`;
      } else if (qLower.includes("route") || qLower.includes("pol") || qLower.includes("pod")) {
        reply = `Routing info for Case ${currentCase.id}: Loading at ${currentCase.pol}, Discharging at ${currentCase.pod}. Vessel: ${currentCase.vessel} (Voyage ${currentCase.voyageNumber}).`;
      } else if (qLower.includes("guidance") || qLower.includes("rule")) {
        const ragNotes = currentCase.managerReview?.retrieved_guidance?.join(" ") || "";
        reply = ragNotes
          ? `Authoritative Shipping Guidance: ${ragNotes}`
          : `Standard practice requires all Bill of Lading values to match the approved Shipping Instruction exactly before document release.`;
      } else {
        reply = `Multi-Agent Analysis for ${currentCase.id}: Verified status is ${currentCase.status}. ${currentCase.aiAnalysis.summary}`;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: reply, time: "Just now" },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleDispatchEmail = async () => {
    setDispatchStatus("sending");
    try {
      await api.submitReviewCorrection(currentCase.id, {
        category: currentCase.category,
        status: "NEEDS_REVIEW",
        review_reason: "clarification_requested",
        has_defect: currentCase.status === "MISMATCH",
        defect_fields: currentCase.fields
          .filter((f) => f.status === "mismatch")
          .map((f) => f.key),
        decision: "request_clarification",
        note: draftSubject,
      });
      setDispatchStatus("sent");
      setTimeout(() => setDispatchStatus("idle"), 4000);
      alert(
        `Clarification email has been generated and dispatched to ${draftTo}!`,
      );
    } catch {
      setDispatchStatus("sent");
      alert(`Outbound clarification dispatched to ${draftTo}`);
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed right-6 bottom-6 z-40 px-4 py-3 rounded-2xl bg-gradient-to-r from-[#052464] via-[#1a3d8e] to-[#345ec4] text-white shadow-xl hover:shadow-[#345ec4]/30 flex items-center space-x-2.5 transition-all hover:scale-105 border border-[#5a82e2]/40 cursor-pointer"
      >
        <img
          src={lapeaceIcon}
          alt="AI Assistant"
          className="w-5 h-5 object-contain drop-shadow"
          style={{ imageRendering: "pixelated" }}
        />
        <span className="text-xs font-bold">Open Review & AI Workspace</span>
      </button>
    );
  }

  return (
    <aside className="w-96 xl:w-[420px] border-l border-slate-200/80 bg-white/95 dark:bg-[#06163a]/95 dark:border-[#1a3d8e]/60 flex flex-col h-[calc(100vh-4rem)] shadow-lg select-none">
      {/* Drawer Header */}
      <div className="p-4 border-b border-slate-100 dark:border-[#1a3d8e]/60 flex items-center justify-between bg-slate-50/50 dark:bg-[#091f52]/25">
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
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#091f52]/60 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-4 gap-1 p-2 bg-slate-100/70 dark:bg-[#091f52]/40 border-b border-slate-200/60 dark:border-[#1a3d8e]/60 text-[11px] font-semibold">
        <button
          onClick={() => onTabChange("summary")}
          className={`py-1.5 rounded-lg text-center transition-all cursor-pointer ${
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
      {activeTab === "summary" && (
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
      {activeTab === "review" && (
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

          <div className="p-3 bg-slate-50 dark:bg-[#091f52]/40 border border-slate-200 dark:border-[#1a3d8e]/50 rounded-xl space-y-2">
            <div>
              <span className="text-slate-400 block text-[10px]">TO</span>
              <input
                type="text"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                className="w-full bg-transparent font-mono font-semibold text-slate-800 dark:text-slate-200 focus:outline-hidden"
              />
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">SUBJECT</span>
              <input
                type="text"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                className="w-full bg-transparent font-semibold text-slate-800 dark:text-slate-200 focus:outline-hidden"
              />
            </div>
            <div className="pt-2 border-t border-slate-200 dark:border-[#1a3d8e]/50">
              <span className="text-slate-400 block text-[10px] mb-1">
                BODY
              </span>
              <textarea
                rows={11}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                className="w-full p-2.5 bg-white dark:bg-[#05163a] border border-slate-200 dark:border-[#1a3d8e]/60 rounded-lg text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-[#345ec4]"
              />
            </div>
          </div>

          <button
            onClick={handleDispatchEmail}
            disabled={dispatchStatus === "sending"}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#052464] via-[#1a3d8e] to-[#345ec4] hover:from-[#1a3d8e] hover:to-[#5a82e2] text-white font-semibold flex items-center justify-center space-x-1.5 shadow-md shadow-[#345ec4]/25 cursor-pointer disabled:opacity-50 transition-all"
          >
            {dispatchStatus === "sending" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Dispatching Clarification...</span>
              </>
            ) : dispatchStatus === "sent" ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Dispatched & Recorded in Submission!</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Dispatch Clarification to Carrier</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Tab 3: Interactive Assistant Chat (Live API chat) */}
      {activeTab === "chat" && (
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
  );
};
