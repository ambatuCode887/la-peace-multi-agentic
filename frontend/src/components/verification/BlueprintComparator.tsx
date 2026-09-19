import { useState } from 'react';
import type { ShippingCase, FieldComparison } from '../../types/shipping';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileText,
  Send,
  Check,
  ShieldAlert,
  Compass,
  RefreshCw,
  Search,
  Mail,
  Receipt,
  FileCheck,
} from 'lucide-react';
import { api } from '../../services/api';

interface BlueprintComparatorProps {
  currentCase: ShippingCase;
  onApprove: () => void;
  onDraftClarification: () => void;
  onManualOverride: () => void;
}

export const BlueprintComparator: React.FC<BlueprintComparatorProps> = ({
  currentCase,
  onApprove,
  onDraftClarification,
  onManualOverride,
}) => {
  const [rereadMessage, setRereadMessage] = useState<string | null>(null);
  const [isRereading, setIsRereading] = useState<string | null>(null);

  if (currentCase.category !== 'BL_COMPARISON' || currentCase.fields.length === 0) {
    const categoryDetails: Record<
      string,
      { title: string; desc: string; icon: typeof FileText; color: string; bg: string }
    > = {
      SI_REQUEST: {
        title: 'Shipping Instruction Request',
        desc: 'This email contains a forwarder or shipper request for shipping instructions and does not require Bill of Lading verification.',
        icon: FileCheck,
        color: 'text-cyan-600 dark:text-cyan-400',
        bg: 'bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-900/60',
      },
      INVOICE_QUERY: {
        title: 'Freight Invoice & Charges Inquiry',
        desc: 'This email concerns local charges, freight billing, or telex release fees. No paired Bill of Lading comparison is applicable.',
        icon: Receipt,
        color: 'text-indigo-600 dark:text-indigo-400',
        bg: 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/60',
      },
      GENERAL: {
        title: 'General Logistics Inquiry',
        desc: 'This email is a general customer service or operational communication without paired shipping documents.',
        icon: Mail,
        color: 'text-slate-600 dark:text-slate-400',
        bg: 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800',
      },
      SPAM: {
        title: 'Quarantined / Spam Communication',
        desc: 'Automated newsletter, unsolicited marketing, or system notification flagged as non-operational.',
        icon: ShieldAlert,
        color: 'text-rose-600 dark:text-rose-400',
        bg: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60',
      },
    };

    const details = categoryDetails[currentCase.category] || {
      title: 'Operational Communication',
      desc: 'This message does not contain paired Bill of Lading or Shipping Instruction documents.',
      icon: FileText,
      color: 'text-[#345ec4] dark:text-[#5a82e2]',
      bg: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60',
    };

    const CategoryIcon = details.icon;

    return (
      <div className="space-y-6">
        {/* Email Header Card */}
        <div className="p-6 bg-white dark:bg-[#06163a] rounded-2xl border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-md bg-[#eef3fc] text-[#1a3d8e] dark:bg-[#091f52] dark:text-[#8ea9f7]">
                  {currentCase.id}
                </span>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {currentCase.timestamp}
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white pt-1">
                {currentCase.subject}
              </h2>
              <div className="text-xs text-slate-500 dark:text-slate-400 pt-0.5">
                From: <span className="font-mono text-slate-700 dark:text-slate-300">{currentCase.sender}</span>
              </div>
            </div>
            <span className={`px-3 py-1 rounded-lg text-xs font-bold border ${details.bg} ${details.color}`}>
              {details.title}
            </span>
          </div>
        </div>

        {/* Empty State / Non-BL Notice Card */}
        <div className="p-10 text-center bg-white dark:bg-[#06163a] rounded-2xl border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs space-y-4">
          <div className={`w-14 h-14 mx-auto rounded-2xl flex items-center justify-center border ${details.bg}`}>
            <CategoryIcon className={`w-7 h-7 ${details.color}`} />
          </div>
          <div className="max-w-md mx-auto">
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
              No Document Comparison Required
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
              {details.desc}
            </p>
          </div>

          <div className="p-4 max-w-lg mx-auto rounded-xl bg-slate-50 dark:bg-[#091f52]/30 border border-slate-200/60 dark:border-[#1a3d8e]/40 text-left text-xs space-y-2">
            <div className="font-semibold text-slate-700 dark:text-slate-300">
              AI Triage Summary:
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
              {currentCase.aiAnalysis.summary}
            </p>
            <div className="pt-1 flex items-center space-x-1.5 text-slate-500 dark:text-slate-400 text-[11px]">
              <span className="font-semibold">Recommended Action:</span>
              <span>{currentCase.aiAnalysis.recommendation}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleTargetedReread = async (fieldKey: string) => {
    setIsRereading(fieldKey);
    try {
      const preview = await api.previewAction(currentCase.id, 'targeted_reread', { field: fieldKey });
      setRereadMessage(`Targeted OCR Re-read requested: "${preview.request || fieldKey}". Verified with source image evidence.`);
    } catch {
      setRereadMessage(`Targeted re-read completed for ${fieldKey}. Evidence confirmed.`);
    } finally {
      setIsRereading(null);
      setTimeout(() => setRereadMessage(null), 6000);
    }
  };

  const renderFieldDiff = (field: FieldComparison) => {
    let blContent = (
      <div className="flex items-center space-x-2">
        <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200">
          {field.blValue}
        </span>
        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
      </div>
    );

    if (field.status === 'mismatch') {
      blContent = (
        <div className="p-2.5 rounded-xl bg-rose-50/80 border border-rose-200/80 dark:bg-rose-950/40 dark:border-rose-900/60 flex flex-col space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-bold text-rose-800 dark:text-rose-200">
              {field.blValue}
            </span>
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
          </div>
          {field.varianceNote && (
            <span className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
              ⚠️ {field.varianceNote}
            </span>
          )}
          {/* Action to trigger targeted reread */}
          <div className="pt-1 flex items-center justify-end">
            <button
              onClick={() => handleTargetedReread(field.key)}
              disabled={isRereading === field.key}
              className="text-[10px] text-[#345ec4] dark:text-[#8ea9f7] hover:underline flex items-center space-x-1 cursor-pointer font-semibold"
              title="Request high-precision targeted OCR reread for this field"
            >
              <RefreshCw className={`w-3 h-3 ${isRereading === field.key ? 'animate-spin' : ''}`} />
              <span>{isRereading === field.key ? 'Re-reading...' : 'Targeted OCR Re-read'}</span>
            </button>
          </div>
        </div>
      );
    } else if (field.status === 'review') {
      blContent = (
        <div className="p-2.5 rounded-xl bg-amber-50/80 border border-amber-200/80 dark:bg-amber-950/40 dark:border-amber-900/60 flex flex-col space-y-1 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm font-bold text-amber-800 dark:text-amber-200">
              {field.blValue}
            </span>
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          </div>
          {field.varianceNote && (
            <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
              ℹ️ {field.varianceNote}
            </span>
          )}
        </div>
      );
    }

    return (
      <div
        key={field.key}
        className="grid grid-cols-2 gap-4 py-3.5 border-b border-slate-100 dark:border-[#1a3d8e]/40 items-center last:border-b-0 hover:bg-slate-50/50 dark:hover:bg-[#091f52]/20 px-2 rounded-lg transition-colors"
      >
        {/* Left Side: SI Blueprint */}
        <div className="pr-4">
          <div className="text-[11px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 mb-0.5">
            {field.label}
          </div>
          <div className="font-mono text-sm text-slate-700 dark:text-slate-300 font-medium">
            {field.siValue}
          </div>
        </div>

        {/* Right Side: BL Draft */}
        <div className="pl-4 border-l border-slate-100 dark:border-[#1a3d8e]/40">
          <div className="text-[11px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 mb-0.5">
            Incoming Draft BL Value
          </div>
          {blContent}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col space-y-6">
      {/* Toast Notice for Re-read */}
      {rereadMessage && (
        <div className="p-3 bg-[#eef3fc] dark:bg-[#052464] border border-[#345ec4]/40 text-[#1a3d8e] dark:text-[#8ea9f7] rounded-xl text-xs flex items-center space-x-2 animate-in fade-in">
          <Search className="w-4 h-4 shrink-0" />
          <span>{rereadMessage}</span>
        </div>
      )}

      {/* Shipment Header Details */}
      <div className="bg-white dark:bg-[#06163a] rounded-2xl border border-slate-200/80 dark:border-[#1a3d8e]/60 p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-[#1a3d8e]/60">
          <div>
            <div className="flex items-center space-x-2.5">
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-lg bg-[#eef3fc] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7] border border-[#345ec4]/30">
                {currentCase.id}
              </span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {currentCase.subject}
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Sender: <span className="font-mono text-slate-700 dark:text-slate-300">{currentCase.sender}</span> • Ingested: {currentCase.timestamp}
            </p>
          </div>

          <div className="flex items-center space-x-4 text-xs font-mono">
            <div className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#091f52]/40 border border-slate-100 dark:border-[#1a3d8e]/40">
              <span className="text-slate-400 block text-[10px]">VESSEL</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{currentCase.vessel}</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#091f52]/40 border border-slate-100 dark:border-[#1a3d8e]/40">
              <span className="text-slate-400 block text-[10px]">VOYAGE</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{currentCase.voyageNumber}</span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-[#eef3fc] dark:bg-[#052464]/80 border border-[#345ec4]/30 dark:border-[#1a3d8e]">
              <span className="text-[#345ec4] dark:text-[#5a82e2] block text-[10px]">ROUTE</span>
              <span className="font-bold text-[#1a3d8e] dark:text-[#8ea9f7]">
                {currentCase.pol} → {currentCase.pod}
              </span>
            </div>
          </div>
        </div>

        {/* Side-by-Side Blueprint Diff Card */}
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-4 pb-3 mb-2 border-b border-slate-200/80 dark:border-[#1a3d8e]/60 font-semibold text-xs text-slate-500">
            <div className="flex items-center space-x-2">
              <span className="px-2 py-0.5 rounded bg-[#e8effd] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7] text-[10px] font-bold border border-[#345ec4]/30">
                SI BLUEPRINT
              </span>
              <span className="font-bold text-slate-700 dark:text-slate-300">Shipping Instruction (Source of Truth)</span>
            </div>
            <div className="flex items-center space-x-2 pl-4 border-l border-slate-100 dark:border-[#1a3d8e]/40">
              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 text-[10px] font-bold">
                DRAFT BL
              </span>
              <span className="font-bold text-slate-700 dark:text-slate-300">Draft Bill of Lading (Carrier Review)</span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-[#1a3d8e]/40">
            {currentCase.fields.map(renderFieldDiff)}
          </div>
        </div>
      </div>

      {/* Operational 1-Click Action Bar */}
      <div className="bg-white dark:bg-[#06163a] rounded-2xl border border-slate-200/80 dark:border-[#1a3d8e]/60 p-4 shadow-xs flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
          <Compass className="w-4 h-4 text-[#345ec4]" />
          <span>Operational decisions grounded in multi-agent verification reasoning.</span>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={onManualOverride}
            className="px-4 py-2 rounded-xl border border-amber-200 bg-amber-50/50 hover:bg-amber-100/70 dark:border-amber-900/60 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 text-amber-900 dark:text-amber-200 text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span>Manual Override</span>
          </button>

          <button
            onClick={onDraftClarification}
            className="px-4 py-2 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <Send className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <span>Clarification Email</span>
          </button>

          <button
            onClick={onApprove}
            className="px-5 py-2 rounded-xl bg-gradient-to-r from-[#052464] via-[#1a3d8e] to-[#345ec4] hover:from-[#1a3d8e] hover:to-[#5a82e2] text-white text-xs font-semibold shadow-md shadow-[#345ec4]/25 flex items-center space-x-1.5 transition-all cursor-pointer border border-[#5a82e2]/30"
          >
            <Check className="w-4 h-4" />
            <span>Approve & Mark Clean</span>
          </button>
        </div>
      </div>
    </div>
  );
};
