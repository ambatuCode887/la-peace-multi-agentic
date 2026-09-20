import { Fragment, useEffect, useState } from "react";
import { ArrowLeft, BarChart3, RefreshCw, Save } from "lucide-react";
import { api, type EvaluationResult } from "../../services/api";

interface EvaluationDashboardProps {
  backendConnected: boolean;
  onExit: () => void;
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export const EvaluationDashboard: React.FC<EvaluationDashboardProps> = ({
  backendConnected,
  onExit,
}) => {
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const loadEvaluation = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.getEvaluation());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Evaluation data unavailable",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (backendConnected) void loadEvaluation();
    else setLoading(false);
  }, [backendConnected]);

  const saveSnapshot = async () => {
    if (!label.trim()) return;
    setSaving(true);
    try {
      await api.saveEvaluationSnapshot(label);
      setLabel("");
      await loadEvaluation();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not save snapshot",
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Loading evaluation...
      </div>
    );
  if (error)
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        {error}
      </div>
    );
  if (!result) return null;

  const cards = [
    [
      "Mismatch precision",
      percent(result.mismatch.precision),
      "Of flagged mismatches, how many were real",
    ],
    [
      "Mismatch recall",
      percent(result.mismatch.recall),
      "Of real mismatches, how many were caught",
    ],
    [
      "False alarms",
      String(result.mismatch.false_positive),
      "Reference says OK, system flagged mismatch",
    ],
    [
      "Disagreements",
      String(result.disagreement_count),
      "Cases requiring investigation",
    ],
  ];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[#1a3d8e] dark:text-[#8ea9f7]">
            <BarChart3 className="h-5 w-5" />
            <span className="text-xs font-bold uppercase tracking-[0.16em]">
              Evaluation evidence
            </span>
          </div>
          <h2 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
            Accuracy dashboard
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {result.available_reports} of {result.evaluated} reference emails
            have reports.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onExit}
            className="flex items-center gap-2 rounded-xl bg-[#1a3d8e] px-3 py-2 text-xs font-semibold text-white hover:bg-[#2450ae]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to selected case
          </button>
          <button
            onClick={() => void loadEvaluation()}
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-[#1a3d8e]/60 dark:text-slate-300 dark:hover:bg-[#0a1e4d]"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([title, value, note]) => (
          <div
            key={title}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/60"
          >
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {title}
            </p>
            <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
              {value}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              {note}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/60">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Mismatch evidence
          </h3>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <strong className="block text-lg">
                {result.mismatch.true_positive}
              </strong>
              True positive
            </div>
            <div className="rounded-xl bg-rose-50 p-3 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
              <strong className="block text-lg">
                {result.mismatch.false_positive}
              </strong>
              False alarm
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <strong className="block text-lg">
                {result.mismatch.false_negative}
              </strong>
              Missed
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Precision and recall treat only <strong>MISMATCH</strong> as the
            positive class. Needs Review remains a separate safety route.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/60">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Before / after snapshots
          </h3>
          <div className="mt-3 flex gap-2">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Before OCR fix"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs dark:border-[#1a3d8e]/60 dark:bg-[#05163a] dark:text-white"
            />
            <button
              onClick={() => void saveSnapshot()}
              disabled={saving || !label.trim()}
              className="flex items-center gap-1.5 rounded-xl bg-[#1a3d8e] px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> Save
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {result.snapshots.length === 0 && (
              <p className="text-xs text-slate-500">
                Save a labeled run after each change to show false alarms before
                and after.
              </p>
            )}
            {result.snapshots.map((snapshot) => (
              <div
                key={`${snapshot.created_at}-${snapshot.label}`}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-[#05163a]"
              >
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {snapshot.label}
                </span>
                <span className="text-slate-500">
                  P {percent(snapshot.precision)} · R {percent(snapshot.recall)}{" "}
                  · {snapshot.false_positives} false alarms
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/60">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Reference vs actual status counts
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                The reference labels are compared with the latest saved reports.
              </p>
            </div>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {result.matched} exact status matches
            </span>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-100 dark:border-[#1a3d8e]/40">
            <div className="grid grid-cols-[1fr_1fr_1fr] bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-[#05163a] dark:text-slate-400">
              <span>Status</span>
              <span>Reference</span>
              <span>Actual</span>
            </div>
            {["OK", "MISMATCH", "NEEDS_REVIEW", "UNPROCESSED"].map((status) => (
              <div
                key={status}
                className="grid grid-cols-[1fr_1fr_1fr] border-t border-slate-100 px-3 py-2.5 text-xs dark:border-[#1a3d8e]/40"
              >
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {status === "NEEDS_REVIEW"
                    ? "Needs Review"
                    : status === "MISMATCH"
                      ? "Mismatch"
                      : status}
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  {result.status_counts.reference[status] || 0}
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  {result.status_counts.actual[status] || 0}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/60">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            Status confusion matrix
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Rows are reference labels; columns are system labels.
          </p>
          <div className="mt-4 overflow-x-auto">
            <div className="grid min-w-[280px] grid-cols-[1.3fr_repeat(4,1fr)] gap-px overflow-hidden rounded-xl bg-slate-200 text-center text-[10px] dark:bg-[#1a3d8e]/50">
              <span className="bg-slate-50 p-2 text-left font-bold text-slate-500 dark:bg-[#05163a]">
                Ref \ Actual
              </span>
              {["OK", "MISMATCH", "NEEDS_REVIEW", "UNPROCESSED"].map(
                (status) => (
                  <span
                    key={status}
                    className="bg-slate-50 p-2 font-bold text-slate-500 dark:bg-[#05163a]"
                  >
                    {status === "NEEDS_REVIEW"
                      ? "REVIEW"
                      : status === "UNPROCESSED"
                        ? "NONE"
                        : status}
                  </span>
                ),
              )}
              {["OK", "MISMATCH", "NEEDS_REVIEW", "UNPROCESSED"].map((row) => (
                <Fragment key={row}>
                  <span className="bg-white p-2 text-left font-semibold text-slate-600 dark:bg-[#091f52] dark:text-slate-300">
                    {row === "NEEDS_REVIEW"
                      ? "REVIEW"
                      : row === "UNPROCESSED"
                        ? "NONE"
                        : row}
                  </span>
                  {["OK", "MISMATCH", "NEEDS_REVIEW", "UNPROCESSED"].map(
                    (column) => (
                      <span
                        key={column}
                        className={`bg-white p-2 font-semibold dark:bg-[#091f52] ${row === column ? "text-emerald-600 dark:text-emerald-300" : "text-slate-500 dark:text-slate-400"}`}
                      >
                        {result.confusion[row]?.[column] || 0}
                      </span>
                    ),
                  )}
                </Fragment>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/60">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
          Disagreements with reference
        </h3>
        <div className="mt-3 space-y-2">
          {result.disagreements.length === 0 && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              No disagreements found.
            </p>
          )}
          {result.disagreements.map((item) => (
            <div
              key={item.email_id}
              className="rounded-xl border border-slate-100 p-3 dark:border-[#1a3d8e]/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-xs text-slate-800 dark:text-slate-100">
                  {item.email_id}
                </strong>
                <span className="text-[11px] text-slate-500">
                  Expected {item.expected.status} · Actual{" "}
                  {item.actual?.status || "UNPROCESSED"}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {item.reason}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
