import { useEffect, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, X } from "lucide-react";
import { api } from "../../services/api";
import type { BackendReport, RuleCorrectionProposal } from "../../services/api";

interface BatchRuleCorrectionModalProps {
  onClose: () => void;
  onSaved: (report: BackendReport) => void;
}

const FIELD_LABELS: Record<string, string> = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify_party: "Notify party",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  container_count: "Container count",
  gross_weight_kg: "Gross weight (kg)",
};

const displayValue = (value: string | number | null | undefined) =>
  value == null || value === "" ? "(empty)" : String(value);

export function BatchRuleCorrectionModal({
  onClose,
  onSaved,
}: BatchRuleCorrectionModalProps) {
  const [proposals, setProposals] = useState<RuleCorrectionProposal[]>([]);
  const [total, setTotal] = useState(0);
  const [ready, setReady] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [manualChoices, setManualChoices] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    let active = true;
    api.previewBatchRuleCorrections()
      .then((result) => {
        if (!active) return;
        setProposals(result.results);
        setTotal(result.total);
        setReady(result.ready);
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : "Could not prepare rule-based proposals.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const saveDecision = async (
    proposal: RuleCorrectionProposal,
    accept: boolean,
  ) => {
    setSavingId(proposal.email_id);
    setError(null);
    try {
      const siFields = { ...proposal.si_fields };
      const blFields = { ...proposal.bl_fields };
      if (accept) {
        for (const field of proposal.unresolved_fields) {
          const choice = manualChoices[proposal.email_id]?.[field];
          if (choice === "si_to_bl") blFields[field] = siFields[field];
          if (choice === "bl_to_si") siFields[field] = blFields[field];
        }
      }
      const response = await api.submitReviewCorrection(proposal.email_id, {
        category: "BL_COMPARISON",
        status: accept ? "OK" : "MISMATCH",
        review_reason: null,
        has_defect: !accept,
        defect_fields: accept ? [] : proposal.defect_fields,
        decision: accept ? "accept" : "confirm_mismatch",
        note: accept
          ? "Accepted source-evidence-backed or operator-selected correction."
          : "Rejected rule-based correction; mismatch retained for manual review.",
        ...(accept
          ? { si_fields: siFields, bl_fields: blFields }
          : {}),
      });
      onSaved(response.result as BackendReport);
      const savedStatus = response.result?.status || (accept ? "OK" : "MISMATCH");
      setDecisions((previous) => ({
        ...previous,
        [proposal.email_id]: accept
          ? `Accepted · ${savedStatus}`
          : "Rejected · MISMATCH",
      }));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? `${proposal.email_id}: ${requestError.message}`
          : `${proposal.email_id}: Could not save the review decision.`,
      );
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 sm:p-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="batch-rule-correction-title"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-[#1a3d8e] dark:bg-[#071a43]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6 dark:border-[#1a3d8e]">
          <div>
            <h2 id="batch-rule-correction-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Batch rule corrections
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {loading
                ? "Checking source evidence..."
                : `${ready} of ${total} mismatched cases have evidence-supported proposals.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close batch rule corrections"
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-[#10295c] dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 sm:px-6 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
          Proposals are generated from stored SI/BL source snippets only. Conflicting or unsupported values stay unresolved; nothing is saved until you decide.
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading && (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-600 dark:text-slate-300">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Checking mismatched fields against source text
            </div>
          )}
          {error && (
            <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </div>
          )}
          {!loading && !error && proposals.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-600 dark:text-slate-300">
              No mismatched shipping cases need correction.
            </p>
          )}

          <div className="space-y-3">
            {proposals.map((proposal) => {
              const decision = decisions[proposal.email_id];
              const busy = savingId === proposal.email_id;
              const canAccept = proposal.ready || (
                proposal.unresolved_fields.length > 0
                && proposal.unresolved_fields.every((field) => manualChoices[proposal.email_id]?.[field])
              );
              return (
                <article key={proposal.email_id} className="rounded-lg border border-slate-200 bg-white dark:border-[#244276] dark:bg-[#0a2050]">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-[#1a3d8e]/70">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900 dark:text-white">{proposal.email_id}</h3>
                      {proposal.subject && <p className="mt-0.5 break-words text-sm text-slate-600 dark:text-slate-300">{proposal.subject}</p>}
                    </div>
                    {decision ? (
                      <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{decision}</span>
                    ) : proposal.ready ? (
                      <span className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">Evidence agrees</span>
                    ) : canAccept ? (
                      <span className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">Ready for your decision</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold uppercase text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" /> Manual review
                      </span>
                    )}
                  </div>

                  <div className="space-y-3 px-4 py-3">
                    {proposal.changes.map((change) => (
                      <div key={change.field} className="grid gap-1 text-sm sm:grid-cols-[minmax(8rem,1fr)_1fr_auto_1fr] sm:items-center">
                        <span className="font-medium text-slate-700 dark:text-slate-200">{FIELD_LABELS[change.field] || change.field}</span>
                        <span className="break-words text-slate-600 dark:text-slate-300">{change.document.toUpperCase()}: {displayValue(change.before)}</span>
                        <span aria-hidden="true" className="hidden text-slate-400 sm:inline">to</span>
                        <span className="break-words font-semibold text-emerald-800 dark:text-emerald-200">{displayValue(change.after)}</span>
                        <p className="text-xs text-slate-500 sm:col-span-4 dark:text-slate-400">{change.reason}</p>
                      </div>
                    ))}

                    {proposal.unresolved_fields.map((field) => {
                      const siValue = proposal.si_fields[field];
                      const blValue = proposal.bl_fields[field];
                      const evidence = proposal.source_evidence[field];
                      return (
                        <div key={field} className="rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
                          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_minmax(13rem,1.2fr)] sm:items-start">
                            <div>
                              <span className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">SI value</span>
                              <span className="break-words text-slate-900 dark:text-white">{FIELD_LABELS[field] || field}: {displayValue(siValue)}</span>
                            </div>
                            <div>
                              <span className="block text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">BL value</span>
                              <span className="break-words text-slate-900 dark:text-white">{displayValue(blValue)}</span>
                            </div>
                            <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                              Choose the value to apply
                              <select
                                value={manualChoices[proposal.email_id]?.[field] || ""}
                                onChange={(event) => setManualChoices((previous) => ({
                                  ...previous,
                                  [proposal.email_id]: {
                                    ...previous[proposal.email_id],
                                    [field]: event.target.value,
                                  },
                                }))}
                                className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm font-normal text-slate-800 dark:border-[#35558b] dark:bg-[#071a43] dark:text-white"
                              >
                                <option value="">Select a source value</option>
                                <option value="si_to_bl" disabled={siValue == null || siValue === ""}>
                                  Apply SI value to BL
                                </option>
                                <option value="bl_to_si" disabled={blValue == null || blValue === ""}>
                                  Apply BL value to SI
                                </option>
                              </select>
                            </label>
                          </div>
                          <details className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                            <summary className="cursor-pointer font-medium">View extracted source evidence</summary>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <p className="whitespace-pre-wrap break-words"><strong>SI:</strong> {evidence?.si || "No source snippet stored."}</p>
                              <p className="whitespace-pre-wrap break-words"><strong>BL:</strong> {evidence?.bl || "No source snippet stored."}</p>
                            </div>
                          </details>
                        </div>
                      );
                    })}

                    {!decision && (
                      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3 dark:border-[#1a3d8e]/70">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => saveDecision(proposal, false)}
                          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-[#35558b] dark:text-slate-200 dark:hover:bg-[#10295c]"
                        >
                          Reject, keep mismatch
                        </button>
                        <button
                          type="button"
                          disabled={!canAccept || busy}
                          onClick={() => saveDecision(proposal, true)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          Accept correction
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-xs text-slate-500 sm:px-6 dark:border-[#1a3d8e] dark:text-slate-400">
          <span>Accepted edits are audit logged. Rejections remain MISMATCH.</span>
          <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#10295c]">
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}