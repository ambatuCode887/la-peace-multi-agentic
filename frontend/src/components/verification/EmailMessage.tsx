import { useEffect, useState } from 'react';
import type { ShippingCase } from '../../types/shipping';
import { ArrowUpRight, ChevronDown, Link2, Mail } from 'lucide-react';
import { api, type RelatedCaseSummary } from '../../services/api';

interface EmailMessageProps {
  currentCase: ShippingCase;
  onSelectCase: (emailId: string) => void;
}

/**
 * The email the case came from: who sent it, the subject and the message text.
 * Collapsed by default so a long message or signature does not push the comparison down.
 */
export const EmailMessage: React.FC<EmailMessageProps> = ({ currentCase, onSelectCase }) => {
  const hasBody = typeof currentCase.body === 'string' && currentCase.body.trim() !== '';
  const [relatedCases, setRelatedCases] = useState<RelatedCaseSummary[]>([]);
  const [relatedCasesLoading, setRelatedCasesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRelatedCases([]);
    setRelatedCasesLoading(true);
    void api.getRelatedCases(currentCase.id).then((results) => {
      if (!cancelled) setRelatedCases(results);
    }).catch(() => {
      if (!cancelled) setRelatedCases([]);
    }).finally(() => {
      if (!cancelled) setRelatedCasesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [currentCase.id]);

  return (
    <div className="mb-6">
    <details className="group rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0b1f4d]/60">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0 rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <Mail className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
              From: {currentCase.sender}
            </p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {currentCase.subject}
            </p>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          <span className="group-open:hidden">Show message</span>
          <span className="hidden group-open:inline">Hide message</span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="border-t border-slate-200 px-4 py-3 dark:border-slate-800">
        {hasBody ? (
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700 dark:text-slate-300">
            {currentCase.body}
          </p>
        ) : (
          <p className="text-xs italic text-slate-500 dark:text-slate-400">
            No message text is available for this email.
          </p>
        )}
      </div>
    </details>
      <section aria-label="Related shipment cases" className="mt-3 rounded-lg border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900 dark:bg-sky-950/20">
        <h3 className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-100">
          <Link2 className="h-4 w-4 text-sky-700 dark:text-sky-300" />
          Related shipment cases
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{relatedCases.length}</span>
        </h3>
        {relatedCasesLoading ? (
          <p className="px-2 py-1 text-xs text-slate-600 dark:text-slate-400">
            Checking for shared shipment references…
          </p>
        ) : relatedCases.length > 0 ? (
          <ul className="space-y-1">
            {relatedCases.map((relatedCase) => (
              <li key={relatedCase.email_id}>
                <button
                  type="button"
                  onClick={() => onSelectCase(relatedCase.email_id)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left hover:bg-sky-100 dark:hover:bg-sky-900/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-sky-900 dark:text-sky-200">
                      {relatedCase.email_id} · {relatedCase.subject}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-600 dark:text-slate-400">
                      Shared reference: {relatedCase.shared_references.join(', ')}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    {relatedCase.status.replaceAll('_', ' ')}
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-1 text-xs text-slate-600 dark:text-slate-400">
            No other cases share a booking, B/L, invoice, container, or shipment reference.
          </p>
        )}
      </section>
    </div>
  );
};
