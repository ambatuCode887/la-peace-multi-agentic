import { useState } from "react";
import type { BackendReport } from "../../services/api";
import type { ActionPreview, ShippingCase } from "../../types/shipping";
import { api } from "../../services/api";
import {
  Check,
  ChevronDown,
  Loader2,
  Save,
  Send,
  SlidersHorizontal,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";

export interface ReviewPanelProps {
  currentCase: ShippingCase;
  onSaved: (report: BackendReport) => void;
  onSwitchToEmail?: () => void;
}

export type ReviewDecision =
  | "accept"
  | "confirm_mismatch"
  | "false_alarm"
  | "request_clarification";

export function ReviewPanel({
  currentCase,
  onSaved,
  onSwitchToEmail,
}: ReviewPanelProps) {
  const [showFields, setShowFields] = useState(false);
  const [siFields, setSiFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      currentCase.fields.map((field) => [field.key, field.siValue]),
    ),
  );
  const [blFields, setBlFields] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      currentCase.fields.map((field) => [field.key, field.blValue]),
    ),
  );
  const [note, setNote] = useState("");
  const [supportingEvidence, setSupportingEvidence] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>(() =>
    currentCase.status === "MISMATCH" ? "confirm_mismatch" : "accept",
  );
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [aiPreview, setAiPreview] = useState<ActionPreview | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const requestAiSuggestion = async () => {
    setSuggesting(true);
    setMessage(null);
    try {
      const preview = await api.previewAction(
        currentCase.id,
        "ai_field_correction",
        {
          request:
            "Suggest corrections for the extracted SI and BL field values.",
        },
      );
      setAiPreview(preview);
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "AI suggestion could not be prepared.",
      });
    } finally {
      setSuggesting(false);
    }
  };

  const applyAiSuggestion = () => {
    if (!aiPreview) return;
    for (const change of aiPreview.changes ?? []) {
      const nextValue = change.after == null ? "" : String(change.after);
      if (change.document === "si") {
        setSiFields((previous) => ({ ...previous, [change.field]: nextValue }));
      }
      if (change.document === "bl") {
        setBlFields((previous) => ({ ...previous, [change.field]: nextValue }));
      }
    }
    setAiPreview(null);
    setMessage({
      type: "success",
      text: "AI suggestion applied to the editable fields. Save the review to record it.",
    });
  };

  const saveReview = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await api.submitReviewCorrection(currentCase.id, {
        category: currentCase.category,
        status:
          decision === "accept" || decision === "false_alarm"
            ? "OK"
            : decision === "confirm_mismatch"
              ? "MISMATCH"
              : "NEEDS_REVIEW",
        review_reason:
          decision === "request_clarification"
            ? "clarification_requested"
            : null,
        has_defect: decision === "confirm_mismatch",
        defect_fields: currentCase.fields
          .filter((field) => field.status !== "match")
          .map((field) => field.key),
        decision,
        note,
        supporting_evidence: supportingEvidence,
        si_fields: siFields,
        bl_fields: blFields,
      });
      onSaved(response.result);
      setMessage({
        type: "success",
        text: "Review and field values recorded to audit trail successfully.",
      });
    } catch (error) {
      setMessage({
        type: "error",
        text:
          error instanceof Error ? error.message : "Review could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  };

  const getVerdictExplanation = (verdict: ReviewDecision) => {
    switch (verdict) {
      case "accept":
        return "Records verification acceptance. If field values match or were corrected to match, the case is marked as OK.";
      case "confirm_mismatch":
        return "Confirms the discrepancy as an active defect. The case is classified as MISMATCH and held from release.";
      case "false_alarm":
        return "Records an operator override for an acceptable operational variance. Explanation and supporting evidence are required; the case remains NEEDS_REVIEW and is not treated as verified OK.";
      case "request_clarification":
        return "Holds the case under NEEDS_REVIEW status pending carrier clarification. Use the Email tab to notify the carrier.";
    }
  };

  return (
    <div className="space-y-4">
      {/* Verification Decision Card */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-[#1a3d8e]/60 bg-white dark:bg-[#06163a] p-4 shadow-xs space-y-3.5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#1a3d8e]/40">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-[#345ec4] dark:text-[#8ea9f7]" />
            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Operator Verification
            </h4>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#091f52] text-slate-700 dark:text-slate-300 font-semibold">
            Case #{currentCase.id}
          </span>
        </div>

        {/* Audit Decision Select */}
        <div>
          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1">
            Verification Verdict
          </label>
          <select
            value={decision}
            onChange={(event) =>
              setDecision(event.target.value as ReviewDecision)
            }
            className="w-full rounded-xl border border-slate-200 dark:border-[#1a3d8e]/60 bg-slate-50/70 dark:bg-[#091f52]/40 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-[#345ec4]/30 transition-all cursor-pointer"
          >
            <option value="accept">Accept Document Release (Pass)</option>
            <option value="confirm_mismatch">
              Confirm Discrepancy / Defect (Mismatch)
            </option>
            <option value="false_alarm">
              Mark False Alarm (Manual Override)
            </option>
            <option value="request_clarification">
              Request Carrier Clarification (Needs Review)
            </option>
          </select>
          <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
            {getVerdictExplanation(decision)}
          </p>
        </div>

        {/* Clarification Shortcut Callout */}
        {decision === "request_clarification" && onSwitchToEmail && (
          <div className="p-3 rounded-xl bg-rose-50/80 border border-rose-200/80 dark:bg-rose-950/40 dark:border-rose-900/60 flex items-center justify-between text-xs animate-in fade-in">
            <div className="flex items-center space-x-2 text-rose-800 dark:text-rose-200">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span className="font-medium text-[11px]">
                Ready to draft email to carrier?
              </span>
            </div>
            <button
              type="button"
              onClick={onSwitchToEmail}
              className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[11px] flex items-center space-x-1 transition-colors cursor-pointer"
            >
              <span>Switch to Email Tab</span>
              <Send className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Reviewer Note */}
        <div>
          <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1">
            Audit Justification & Note
          </label>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-slate-200 dark:border-[#1a3d8e]/60 bg-slate-50/70 dark:bg-[#091f52]/40 px-3 py-2 text-xs text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-[#345ec4]/30 focus:border-[#345ec4] transition-all"
            placeholder="Document operator justification, carrier confirmations, or defect reasons..."
          />
        </div>

        {decision === "false_alarm" && (
          <div>
            <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wide mb-1">
              Supporting Evidence Required
            </label>
            <textarea
              value={supportingEvidence}
              onChange={(event) => setSupportingEvidence(event.target.value)}
              rows={2}
              className="w-full rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-xs text-slate-800 dark:text-slate-200 outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all"
              placeholder="Cite the approval, carrier email, or document evidence supporting this override..."
              required
            />
          </div>
        )}

        {/* Save Button */}
        <button
          type="button"
          onClick={() => void saveReview()}
          disabled={saving}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#052464] via-[#1a3d8e] to-[#345ec4] hover:from-[#1a3d8e] hover:to-[#5a82e2] text-white text-xs font-bold shadow-md shadow-[#345ec4]/25 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>
            {saving ? "Saving to Audit Trail..." : "Save Review to Audit Trail"}
          </span>
        </button>

        {/* Status Message */}
        {message && (
          <div
            className={`p-2.5 rounded-xl text-xs flex items-center space-x-2 animate-in fade-in ${
              message.type === "success"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
                : "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800"
            }`}
          >
            {message.type === "success" ? (
              <Check className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        )}
      </div>

      {/* Ground-Truth Field Corrections Section */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-[#1a3d8e]/60 bg-white dark:bg-[#06163a] overflow-hidden shadow-xs">
        <button
          type="button"
          onClick={() => setShowFields((v) => !v)}
          className="w-full flex items-center justify-between p-3.5 text-left hover:bg-slate-50/60 dark:hover:bg-[#091f52]/30 transition-colors cursor-pointer"
        >
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-800 dark:text-slate-200">
            <SlidersHorizontal className="w-4 h-4 text-[#345ec4] dark:text-[#8ea9f7]" />
            <span>Edit Extracted Ground-Truth Values</span>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${
              showFields ? "rotate-180" : ""
            }`}
          />
        </button>

        {showFields && (
          <div className="p-4 border-t border-slate-100 dark:border-[#1a3d8e]/40 space-y-4">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Modify extracted text values if OCR misread an ambiguous
              character. AI suggestions are previews and require your approval
              before they change these fields.
            </p>

            <div className="rounded-xl border border-[#9fb8f5] bg-[#eef4ff] dark:border-[#345ec4]/60 dark:bg-[#091f52]/60 p-3 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <p className="text-[11px] font-bold text-[#183b88] dark:text-[#cbd9ff]">
                    AI auto-fill suggestion
                  </p>
                  <p className="text-[10px] text-[#45609a] dark:text-slate-400">
                    Preview proposed corrections from the SI source of truth.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void requestAiSuggestion()}
                  disabled={suggesting}
                  className="w-full sm:w-auto shrink-0 rounded-lg bg-[#345ec4] px-3 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-[#274da9] disabled:opacity-50 text-center"
                >
                  {suggesting ? "Preparing..." : "Suggest with AI"}
                </button>
              </div>

              {aiPreview && (
                <div className="space-y-2 border-t border-[#c4d3f5] pt-2 dark:border-[#345ec4]/40">
                  <p className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">
                    Review these proposed changes before applying them:
                  </p>
                  {aiPreview.changes && aiPreview.changes.length > 0 ? (
                    <div className="space-y-1.5">
                      {aiPreview.changes.map((change) => (
                        <div
                          key={`${change.document}-${change.field}`}
                          className="rounded-lg bg-white/80 px-2 py-1.5 text-[10px] dark:bg-[#05163a]/70"
                        >
                          <span className="font-bold uppercase text-slate-500 dark:text-slate-400">
                            {change.document.toUpperCase()} · {change.field}
                          </span>
                          <div className="mt-0.5 font-mono text-slate-700 dark:text-slate-200">
                            <span className="text-rose-600 dark:text-rose-300">
                              {String(change.before ?? "Missing")}
                            </span>
                            <span className="px-1.5 text-slate-400">-&gt;</span>
                            <span className="text-emerald-700 dark:text-emerald-300">
                              {String(change.after ?? "Missing")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      No corrections were suggested for this case.
                    </p>
                  )}
                  {aiPreview.explanation && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      {aiPreview.explanation}
                    </p>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setAiPreview(null)}
                      className="flex-1 sm:flex-initial rounded-lg border border-slate-300 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 dark:border-slate-600 dark:text-slate-300 text-center"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={applyAiSuggestion}
                      disabled={!aiPreview.changes?.length}
                      className="flex-1 sm:flex-initial rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50 text-center"
                    >
                      Apply suggestion
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {currentCase.fields.map((field) => (
                <div
                  key={field.key}
                  className="p-2.5 rounded-xl bg-slate-50/70 dark:bg-[#091f52]/30 border border-slate-200/60 dark:border-[#1a3d8e]/40 space-y-1.5"
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {field.label}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block mb-0.5">
                        SI Value
                      </span>
                      <input
                        value={siFields[field.key] || ""}
                        onChange={(e) =>
                          setSiFields((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        className="w-full font-mono text-xs rounded-lg border border-slate-200 dark:border-[#1a3d8e]/50 bg-white dark:bg-[#05163a] px-2.5 py-1.5 text-slate-800 dark:text-slate-100 outline-none focus:border-[#345ec4]"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 block mb-0.5">
                        BL Value
                      </span>
                      <input
                        value={blFields[field.key] || ""}
                        onChange={(e) =>
                          setBlFields((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        className="w-full font-mono text-xs rounded-lg border border-slate-200 dark:border-[#1a3d8e]/50 bg-white dark:bg-[#05163a] px-2.5 py-1.5 text-slate-800 dark:text-slate-100 outline-none focus:border-[#345ec4]"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Dedicated Save Button directly below field inputs */}
            <div className="pt-2 border-t border-slate-100 dark:border-[#1a3d8e]/40">
              <button
                type="button"
                onClick={() => void saveReview()}
                disabled={saving}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-[#052464] via-[#1a3d8e] to-[#345ec4] hover:from-[#1a3d8e] hover:to-[#5a82e2] text-white text-xs font-bold shadow-md shadow-[#345ec4]/25 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>
                  {saving
                    ? "Saving Field Corrections..."
                    : "Save Field Corrections & Review"}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
