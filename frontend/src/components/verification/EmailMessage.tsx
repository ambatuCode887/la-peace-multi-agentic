import type { ShippingCase } from '../../types/shipping';
import { ChevronDown, Mail } from 'lucide-react';

interface EmailMessageProps {
  currentCase: ShippingCase;
}

/**
 * The email the case came from: who sent it, the subject and the message text.
 * Collapsed by default so a long message or signature does not push the comparison down.
 */
export const EmailMessage: React.FC<EmailMessageProps> = ({ currentCase }) => {
  const hasBody = typeof currentCase.body === 'string' && currentCase.body.trim() !== '';

  return (
    <details className="group mb-6 rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#0b1f4d]/60">
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
  );
};
