import { useEffect, useState } from "react";
import type { BackendReport } from "../../services/api";
import type { ActionPreview, ShippingCase } from "../../types/shipping";
import { api } from "../../services/api";
import { Check, ChevronDown, Loader2, Save } from "lucide-react";

interface ReviewPanelProps {
  currentCase: ShippingCase;
  onSaved: (report: BackendReport) => void;
}

type ReviewDecision =
  | "accept"
  | "confirm_mismatch"
  | "false_alarm"
  | "request_clarification";

export function ReviewPanel({ currentCase, onSaved }: ReviewPanelProps) {
  const [open, setOpen] = useState(false);
  const [siFields, setSiFields] = useState<Record<string, string>>({});
  const [blFields, setBlFields] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>("accept");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [correctionPreview, setCorrectionPreview] =
    useState<ActionPreview | null>(null);
  const [aiProposal, setAiProposal] = useState<ActionPreview | null>(null);

  useEffect(() => {
    setSiFields(
      Object.fromEntries(
        currentCase.fields.map((field) => [field.key, field.siValue]),
      ),
    );
    setBlFields(
      Object.fromEntries(
        currentCase.fields.map((field) => [field.key, field.blValue]),
      ),
    );
    setNote("");
    setDecision(
      currentCase.status === "MISMATCH" ? "confirm_mismatch" : "accept",
    );
    setMessage(null);
    setCorrectionPreview(null);
    setAiProposal(null);
  }, [currentCase.id, currentCase.fields, currentCase.status]);

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
        si_fields: siFields,
        bl_fields: blFields,
      });
      onSaved(response.result);
      setMessage("Review saved to the backend audit record.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Review could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  const previewCorrectionEmail = async () => {
    setMessage(null);
    try {
      setCorrectionPreview(
        await api.previewAction(currentCase.id, "draft_correction_email", {
          requested_correction:
            note || "Please confirm the correct shipping-document values.",
        }),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not prepare correction email.",
      );
    }
  };

  const previewAiCorrection = async () => {
    setMessage(null);
    try {
      setAiProposal(
        await api.previewAction(currentCase.id, "ai_field_correction", {
          request: note,
        }),
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not prepare AI correction.",
      );
    }
  };

  const applyAiCorrection = () => {
    if (!aiProposal) return;
    setSiFields(aiProposal.si_fields || siFields);
    setBlFields(aiProposal.bl_fields || blFields);
    setMessage(
      "AI proposal applied to the editable form. Save the review to persist it.",
    );
  };

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white shadow-xs dark:border-[#1a3d8e]/60 dark:bg-[#06163a]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between p-5 text-left"
      >
        <span>
          <span className="block text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Human review
          </span>
          <span className="mt-1 block text-base font-bold text-slate-900 dark:text-white">
            Edit extracted values and record a decision
          </span>
        </span>
        <ChevronDown
          className={`h-5 w-5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-slate-100 p-5 dark:border-[#1a3d8e]/50">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(["si", "bl"] as const).map((document) => {
              const values = document === "si" ? siFields : blFields;
              const setValues = document === "si" ? setSiFields : setBlFields;
              return (
                <div key={document} className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {document} values
                  </h3>
                  {currentCase.fields.map((field) => (
                    <label
                      key={field.key}
                      className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                    >
                      {field.label}
                      <input
                        value={values[field.key] || ""}
                        onChange={(event) =>
                          setValues((previous) => ({
                            ...previous,
                            [field.key]: event.target.value,
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-[#345ec4] dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/40 dark:text-white"
                      />
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          <label className="mt-4 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Reviewer note
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-normal text-slate-800 outline-none focus:border-[#345ec4] dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/40 dark:text-white"
              placeholder="Explain the correction or review decision."
            />
          </label>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              Decision
              <select
                value={decision}
                onChange={(event) =>
                  setDecision(event.target.value as ReviewDecision)
                }
                className="mt-1 block rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-[#1a3d8e]/60 dark:bg-[#091f52] dark:text-white"
              >
                <option value="accept">Accept correction</option>
                <option value="confirm_mismatch">Confirm mismatch</option>
                <option value="false_alarm">Mark false alarm</option>
                <option value="request_clarification">
                  Request clarification
                </option>
              </select>
            </label>
            <button
              type="button"
              onClick={() => void saveReview()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#1a3d8e] px-4 py-2 text-xs font-bold text-white hover:bg-[#345ec4] disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}{" "}
              Save review
            </button>
            {message && (
              <span className="text-xs text-slate-600 dark:text-slate-300">
                {message}
              </span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-[#1a3d8e]/50">
            <button
              type="button"
              onClick={() => void previewCorrectionEmail()}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-[#1a3d8e]/60 dark:text-slate-200 dark:hover:bg-[#091f52]"
            >
              Preview correction email
            </button>
            <button
              type="button"
              onClick={() => void previewAiCorrection()}
              disabled={saving}
              className="rounded-lg border border-[#345ec4]/50 px-3 py-2 text-xs font-semibold text-[#1a3d8e] hover:bg-[#eef3fc] dark:text-[#8ea9f7] dark:hover:bg-[#091f52]"
            >
              Ask AI to propose correction
            </button>
          </div>
          {correctionPreview?.body && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/40 dark:text-slate-200">
              <strong>Correction email preview</strong>
              <pre className="mt-2 whitespace-pre-wrap font-sans">
                {correctionPreview.body}
              </pre>
            </div>
          )}
          {aiProposal && (
            <div className="mt-3 rounded-lg border border-[#345ec4]/40 bg-[#eef3fc]/60 p-3 text-xs dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/40 dark:text-slate-200">
              <strong>AI correction proposal</strong>
              {aiProposal.changes?.length ? (
                <ul className="mt-2 list-disc pl-5">
                  {aiProposal.changes.map((change) => (
                    <li key={`${change.document}-${change.field}`}>
                      {change.document.toUpperCase()} {change.field}:{" "}
                      {String(change.before ?? "empty")} to{" "}
                      <strong>{String(change.after ?? "empty")}</strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2">No safe replacement was found.</p>
              )}
              <p className="mt-2 text-slate-600 dark:text-slate-300">
                {aiProposal.explanation}
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={applyAiCorrection}
                  disabled={!aiProposal.changes?.length}
                  className="rounded-lg bg-[#1a3d8e] px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  Apply to form
                </button>
                <button
                  type="button"
                  onClick={() => setAiProposal(null)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold dark:border-[#1a3d8e]/60"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
          {decision === "accept" && (
            <div className="mt-3 flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-300">
              <Check className="h-3.5 w-3.5" /> Edited values will be recorded
              as the accepted result.
            </div>
          )}
        </div>
      )}
    </section>
  );
}
