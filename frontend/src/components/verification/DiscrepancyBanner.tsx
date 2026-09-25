import type { ShippingCase } from "../../types/shipping";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ArrowRight,
} from "lucide-react";

interface DiscrepancyBannerProps {
  currentCase: ShippingCase;
  onOpenClarification: () => void;
  onOpenReview?: () => void;
}

export const DiscrepancyBanner: React.FC<DiscrepancyBannerProps> = ({
  currentCase,
  onOpenClarification,
  onOpenReview,
}) => {
  if (currentCase.category !== "BL_COMPARISON") {
    return null;
  }

  const mismatchedFields = currentCase.fields.filter(
    (f) => f.status === "mismatch",
  );
  const reviewFields = currentCase.fields.filter((f) => f.status === "review");

  const challengeCallout = currentCase.isChallengeCase ? (
    <div className="mb-3 px-3.5 sm:px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-amber-500/10 border border-amber-500/40 flex items-center justify-between gap-3 shadow-2xs">
      <div className="flex items-center space-x-2 min-w-0">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-amber-500 text-white shrink-0 shadow-2xs">
          ⭐ Challenge Scenario
        </span>
        <span className="text-xs font-bold text-amber-900 dark:text-amber-200 truncate">
          {currentCase.challengeBadge}: {currentCase.challengeRationale}
        </span>
      </div>
      {onOpenReview && (
        <button
          onClick={onOpenReview}
          className="text-[11px] font-bold text-amber-800 dark:text-amber-300 hover:underline shrink-0 cursor-pointer"
        >
          View Telemetry &rarr;
        </button>
      )}
    </div>
  ) : null;

  // 1. MISMATCH Alert
  if (currentCase.status === "MISMATCH") {
    const mismatchCount = mismatchedFields.length;

    return (
      <>
        {challengeCallout}
        <div className="mb-4 px-3.5 sm:px-4 py-3 rounded-xl bg-rose-50/90 border border-rose-200/90 dark:bg-rose-950/40 dark:border-rose-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs animate-in fade-in">
        <div className="flex items-start sm:items-center space-x-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5 sm:mt-0">
            <AlertCircle className="w-4 h-4" />
          </div>
          <div className="text-xs text-rose-900 dark:text-rose-200">
            <span className="font-bold">
              {mismatchCount} Discrepanc{mismatchCount === 1 ? "y" : "ies"} Detected:
            </span>{" "}
            <span className="text-rose-700 dark:text-rose-300">
              {mismatchedFields.length > 0
                ? mismatchedFields.map((f) => f.label).join(", ")
                : currentCase.statusNote}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 w-full sm:w-auto shrink-0">
          {onOpenReview && (
            <button
              onClick={onOpenReview}
              className="flex-1 sm:flex-initial min-h-[40px] sm:min-h-0 justify-center px-3 py-2 sm:py-1.5 rounded-lg bg-white dark:bg-rose-950/80 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-semibold hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors cursor-pointer"
            >
              Review & Resolve
            </button>
          )}
          <button
            onClick={onOpenClarification}
            className="flex-1 sm:flex-initial min-h-[40px] sm:min-h-0 justify-center px-3.5 py-2 sm:py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <span>Draft Clarification</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </>
    );
  }

  // 2. NEEDS_REVIEW Alert
  if (currentCase.status === "NEEDS_REVIEW") {
    const isOcr = currentCase.ocrDistortionAnalysis?.some(
      (a) => a.is_ocr_distortion,
    );

    return (
      <>
        {challengeCallout}
        <div className="mb-4 px-3.5 sm:px-4 py-3 rounded-xl bg-amber-50/90 border border-amber-200/90 dark:bg-amber-950/40 dark:border-amber-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs animate-in fade-in">
        <div className="flex items-start sm:items-center space-x-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="text-xs text-amber-900 dark:text-amber-200">
            <span className="font-bold">Human Confirmation Required:</span>{" "}
            <span className="text-amber-700 dark:text-amber-300">
              {isOcr
                ? "Possible OCR distortion detected — inspect bounding box evidence."
                : reviewFields.length > 0
                  ? `${reviewFields.map((f) => f.label).join(", ")} contains extraction ambiguity.`
                  : currentCase.statusNote}
            </span>
          </div>
        </div>

        {onOpenReview ? (
          <button
            onClick={onOpenReview}
            className="w-full sm:w-auto min-h-[40px] sm:min-h-0 justify-center px-3.5 py-2 sm:py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <span>Confirm & Review</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        ) : (
          <span className="px-3 py-1 rounded-lg bg-amber-200/70 text-amber-900 dark:bg-amber-900 dark:text-amber-200 text-xs font-medium shrink-0 text-center">
            Pending Operator Confirmation
          </span>
        )}
      </div>
    </>
    );
  }

  // 3. PASS (Clean verification or with security hold)
  if (currentCase.status === "PASS") {
    if (currentCase.promptInjectionDetected) {
      return (
        <div className="mb-4 px-3.5 sm:px-4 py-3 rounded-xl bg-amber-50 border border-amber-300 dark:bg-amber-950/40 dark:border-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs animate-in fade-in">
          <div className="flex items-start sm:items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div className="text-xs text-amber-900 dark:text-amber-200">
              <span className="font-bold">Security Review Required:</span>{" "}
              Instruction-like content detected in source text. Hold auto-submission.
            </div>
          </div>

          {onOpenReview ? (
            <button
              onClick={onOpenReview}
              className="w-full sm:w-auto min-h-[40px] sm:min-h-0 justify-center px-3.5 py-2 sm:py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <span>Inspect Security Review</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span className="px-3 py-1 rounded-lg bg-amber-200/70 text-amber-900 dark:bg-amber-900 dark:text-amber-200 text-xs font-medium shrink-0 text-center">
              Hold Auto-Submission
            </span>
          )}
        </div>
      );
    }

    if (challengeCallout) {
      return challengeCallout;
    }
    // Clean pass: nothing for the reviewer to decide, so no bar here.
    return null;
  }

  // 4. Default / Informational
  return (
    <div className="mb-4 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 dark:bg-slate-800/40 dark:border-slate-800 flex items-center space-x-2.5 text-xs text-slate-600 dark:text-slate-300">
      <Info className="w-4 h-4 text-slate-400 shrink-0" />
      <span>{currentCase.statusNote}</span>
    </div>
  );
};
