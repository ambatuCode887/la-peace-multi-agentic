import type { ShippingCase } from '../../types/shipping';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, ArrowRight } from 'lucide-react';

interface DiscrepancyBannerProps {
  currentCase: ShippingCase;
  onOpenClarification: () => void;
}

export const DiscrepancyBanner: React.FC<DiscrepancyBannerProps> = ({
  currentCase,
  onOpenClarification,
}) => {
  if (currentCase.category !== 'BL_COMPARISON') {
    return null;
  }

  if (currentCase.status === 'MISMATCH') {
    return (
      <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-900/60 flex items-start justify-between">
        <div className="flex items-start space-x-3">
          <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 shrink-0">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-rose-900 dark:text-rose-200 flex items-center space-x-2">
              <span>Discrepancy Alert: Variance Exceeds Tolerance Threshold</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-rose-200/80 text-rose-900 dark:bg-rose-900 dark:text-rose-300 font-bold">
                1.12% DELTA
              </span>
            </h3>
            <p className="text-xs text-rose-700 dark:text-rose-300 mt-1 leading-relaxed">
              {currentCase.statusNote}
            </p>
          </div>
        </div>

        <button
          onClick={onOpenClarification}
          className="ml-4 px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs shrink-0 flex items-center space-x-1.5 transition-colors"
        >
          <span>Draft Clarification</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (currentCase.status === 'NEEDS_REVIEW') {
    return (
      <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900/60 flex items-start justify-between">
        <div className="flex items-start space-x-3">
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
              Human Review Needed: Entity Variance Detected
            </h3>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1 leading-relaxed">
              {currentCase.statusNote}
            </p>
          </div>
        </div>

        <span className="ml-4 px-3 py-1 rounded-lg bg-amber-200/70 text-amber-900 dark:bg-amber-900 dark:text-amber-200 text-xs font-medium shrink-0">
          Pending Operator Confirmation
        </span>
      </div>
    );
  }

  if (currentCase.status === 'PASS') {
    return (
      <div className="mb-6 p-4 rounded-xl bg-emerald-50/80 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900/60 flex items-start justify-between">
        <div className="flex items-start space-x-3">
          <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
              Clean Verification: All Verified Fields Match
            </h3>
            <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
              {currentCase.statusNote}
            </p>
          </div>
        </div>

        <span className="ml-4 px-3 py-1 rounded-lg bg-emerald-200/70 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200 text-xs font-medium shrink-0">
          Ready for Auto-Submission
        </span>
      </div>
    );
  }

  return (
    <div className="mb-6 p-4 rounded-xl bg-slate-50 border border-slate-200 dark:bg-slate-800/40 dark:border-slate-800 flex items-start space-x-3">
      <div className="p-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
        <Info className="w-5 h-5" />
      </div>
      <div>
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
          Inquiry Case: Automated Knowledge Routing
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          {currentCase.statusNote}
        </p>
      </div>
    </div>
  );
};
