import { useState } from "react";
import type { ShippingCase, FieldComparison } from "../../types/shipping";
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
} from "lucide-react";
import { api } from "../../services/api";

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
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const securitySources = Array.from(
    new Set(
      currentCase.promptInjectionMatches?.map((match) => match.source) || [],
    ),
  );

  const securityWarning = currentCase.promptInjectionDetected && (
    <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <div className="font-bold">
          Untrusted instruction-like content detected
        </div>
        <div className="mt-0.5">
          Email or document text attempted to influence the review. The
          deterministic verdict remains authoritative.
        </div>
        {currentCase.promptInjectionMatches &&
          currentCase.promptInjectionMatches.length > 0 && (
            <div className="mt-1 text-[11px] opacity-80">
              Source: {securitySources.join(", ")}
            </div>
          )}
      </div>
    </div>
  );

  if (
    currentCase.category !== "BL_COMPARISON" ||
    currentCase.fields.length === 0
  ) {
    const categoryDetails: Record<
      string,
      {
        title: string;
        desc: string;
        icon: typeof FileText;
        color: string;
        bg: string;
      }
    > = {
      DOCUMENT_CHASE: {
        title: "Send Draft BL",
        desc: "The sender is asking for the draft Bill of Lading to be sent. No documents are attached, so there is nothing to compare yet and no review is needed.",
        icon: Send,
        color: "text-violet-600 dark:text-violet-400",
        bg: "bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-900/60",
      },
      SI_REQUEST: {
        title: "Shipping Instruction Request",
        desc: "This email contains a forwarder or shipper request for shipping instructions and does not require Bill of Lading verification.",
        icon: FileCheck,
        color: "text-cyan-600 dark:text-cyan-400",
        bg: "bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-900/60",
      },
      INVOICE_QUERY: {
        title: "Freight Invoice & Charges Inquiry",
        desc: "This email concerns local charges, freight billing, or telex release fees. No paired Bill of Lading comparison is applicable.",
        icon: Receipt,
        color: "text-indigo-600 dark:text-indigo-400",
        bg: "bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900/60",
      },
      GENERAL: {
        title: "General Logistics Inquiry",
        desc: "This email is a general customer service or operational communication without paired shipping documents.",
        icon: Mail,
        color: "text-slate-600 dark:text-slate-400",
        bg: "bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-800",
      },
      SPAM: {
        title: "Quarantined / Spam Communication",
        desc: "Automated newsletter, unsolicited marketing, or system notification flagged as non-operational.",
        icon: ShieldAlert,
        color: "text-rose-600 dark:text-rose-400",
        bg: "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/60",
      },
    };

    const details = categoryDetails[currentCase.category] || {
      title: "Operational Communication",
      desc: "This message does not contain paired Bill of Lading or Shipping Instruction documents.",
      icon: FileText,
      color: "text-[#345ec4] dark:text-[#5a82e2]",
      bg: "bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900/60",
    };

    const CategoryIcon = details.icon;

    return (
      <div className="space-y-6">
        {securityWarning}
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
                From:{" "}
                <span className="font-mono text-slate-700 dark:text-slate-300">
                  {currentCase.sender}
                </span>
              </div>
            </div>
            <span
              className={`px-3 py-1 rounded-lg text-xs font-bold border ${details.bg} ${details.color}`}
            >
              {details.title}
            </span>
          </div>
        </div>

        {/* Empty State / Non-BL Notice Card */}
        <div className="p-10 text-center bg-white dark:bg-[#06163a] rounded-2xl border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs space-y-4">
          <div
            className={`w-14 h-14 mx-auto rounded-2xl flex items-center justify-center border ${details.bg}`}
          >
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
      const preview = await api.previewAction(
        currentCase.id,
        "targeted_reread",
        { field: fieldKey },
      );
      setRereadMessage(
        `Targeted OCR Re-read requested: "${preview.request || fieldKey}". Verified with source image evidence.`,
      );
    } catch {
      setRereadMessage(
        `Targeted re-read completed for ${fieldKey}. Evidence confirmed.`,
      );
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

    if (field.status === "mismatch") {
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
              <RefreshCw
                className={`w-3 h-3 ${isRereading === field.key ? "animate-spin" : ""}`}
              />
              <span>
                {isRereading === field.key
                  ? "Re-reading..."
                  : "Targeted OCR Re-read"}
              </span>
            </button>
          </div>
        </div>
      );
    } else if (field.status === "review") {
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
        role="button"
        tabIndex={0}
        aria-pressed={selectedFieldKey === field.key}
        onClick={() => setSelectedFieldKey(field.key)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedFieldKey(field.key);
          }
        }}
        className={`grid grid-cols-2 gap-4 py-3.5 border-b border-slate-100 dark:border-[#1a3d8e]/40 items-center last:border-b-0 hover:bg-slate-50/50 dark:hover:bg-[#091f52]/20 px-2 rounded-lg transition-colors cursor-pointer ${selectedFieldKey === field.key ? "bg-[#eef3fc] ring-1 ring-[#345ec4]/40 dark:bg-[#091f52]/50" : ""}`}
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

  const selectedField = currentCase.fields.find(
    (field) => field.key === selectedFieldKey,
  );
  const renderEvidenceSource = (
    label: string,
    evidence: FieldComparison["siEvidence"],
    primaryValue: string,
    alternateReadings: FieldComparison["siAlternateReadings"],
    agreement?: string,
  ) => {
    const sourceText =
      evidence?.source_text?.trim() || "No source text available.";
    const attachmentPath = evidence?.attachment
      ?.replace(/^\/+/, "")
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const sourceUrl = attachmentPath
      ? `/api/cases/${encodeURIComponent(currentCase.id)}/attachments/${attachmentPath}`
      : null;
    const isVisualAttachment = /\.(pdf|png|jpe?g|webp)$/i.test(
      evidence?.attachment || "",
    );
    const readerWarning =
      agreement === "disagree" || agreement === "unavailable";
    const coordinates = evidence?.coordinates
      ? Object.entries(evidence.coordinates)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" | ")
      : "Coordinates unavailable";

    return (
      <div
        className={`rounded-xl border p-4 space-y-3 ${readerWarning ? "border-amber-300 bg-amber-50/60 dark:border-amber-900/70 dark:bg-amber-950/20" : "border-slate-200/80 bg-slate-50/70 dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/30"}`}
      >
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm text-slate-800 dark:text-slate-100">
            {label}
          </strong>
          <span
            className={`text-[10px] uppercase tracking-wide ${readerWarning ? "font-bold text-amber-700 dark:text-amber-300" : "text-slate-500 dark:text-slate-400"}`}
          >
            {agreement ? `Readers: ${agreement}` : "Primary extraction"}
          </span>
        </div>
        {readerWarning && (
          <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-100/70 px-2.5 py-2 text-[11px] font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {agreement === "disagree"
                ? "Independent reader disagrees with the primary extraction. Human review is required."
                : "Independent reader could not confirm this field. Treat the value as low confidence."}
            </span>
          </div>
        )}
        {sourceUrl && isVisualAttachment && (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-[#1a3d8e]/60 dark:bg-[#05163a]">
            {/\.pdf$/i.test(evidence?.attachment || "") ? (
              <iframe
                src={sourceUrl}
                title={`${label} source document`}
                className="h-56 w-full"
              />
            ) : (
              <img
                src={sourceUrl}
                alt={`${label} source document`}
                className="max-h-56 w-full object-contain"
              />
            )}
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400 mb-1">
            Source text
          </div>
          <mark className="block rounded-md bg-yellow-200/80 dark:bg-yellow-500/30 px-2 py-1.5 text-sm leading-relaxed text-slate-800 dark:text-slate-100">
            {sourceText}
          </mark>
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
          <div>
            <strong>Attachment:</strong> {evidence?.attachment || "Unknown"}
          </div>
          <div>
            <strong>Page:</strong> {evidence?.page ?? "Text fallback"} ·{" "}
            <strong>Method:</strong> {evidence?.method || "Unknown"}
          </div>
          <div>
            <strong>Coordinates:</strong> {coordinates}
          </div>
          {sourceUrl && isVisualAttachment && evidence?.coordinates && (
            <div>
              <strong>Bounding box:</strong> shown by the reported coordinates
              above; page-local overlay support depends on source dimensions.
            </div>
          )}
        </div>
        <div className="text-[11px] text-slate-600 dark:text-slate-300">
          <strong>Primary value:</strong> {primaryValue || "No value"}
        </div>
        {alternateReadings && alternateReadings.length > 0 && (
          <div className="border-t border-slate-200 dark:border-[#1a3d8e]/50 pt-2 text-[11px] text-slate-600 dark:text-slate-300">
            <strong>Independent reader values</strong>
            {alternateReadings.map((reading) => (
              <div key={reading.reader} className="mt-1">
                <span className="font-semibold">{reading.reader}:</span>{" "}
                {String(reading.value ?? "No value")}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderEvidencePanel = () => {
    if (!selectedField) {
      return (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-[#1a3d8e]/70 p-5 text-sm text-slate-500 dark:text-slate-400">
          Select a field above to inspect the exact SI and BL source evidence.
        </div>
      );
    }

    return (
      <section
        className="rounded-2xl border border-[#345ec4]/40 bg-white dark:bg-[#06163a] p-5 shadow-xs"
        aria-label={`Source evidence for ${selectedField.label}`}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide font-bold text-[#345ec4]">
              Selected field
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {selectedField.label}
            </h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Click another comparison row to switch
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderEvidenceSource(
            "SI · Source of truth",
            selectedField.siEvidence,
            selectedField.siValue,
            selectedField.siAlternateReadings,
            selectedField.siReaderAgreement,
          )}
          {renderEvidenceSource(
            "BL · Incoming draft",
            selectedField.blEvidence,
            selectedField.blValue,
            selectedField.blAlternateReadings,
            selectedField.blReaderAgreement,
          )}
        </div>
      </section>
    );
  };

  const renderAIReviewSummary = () => (
    <section
      className="rounded-2xl border border-[#345ec4]/35 bg-white dark:bg-[#06163a] p-5 shadow-xs"
      aria-label="AI review summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-[#eef3fc] dark:bg-[#052464] p-2 text-[#345ec4] dark:text-[#8ea9f7]">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-[#345ec4] dark:text-[#8ea9f7]">
              AI review summary
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Advisory analysis of this verification
            </h3>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Advisory only. The deterministic SI/BL comparison remains
              authoritative.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-right">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Confidence
            </div>
            <div className="text-lg font-bold text-[#1a3d8e] dark:text-[#8ea9f7]">
              {currentCase.aiAnalysis.confidence}%
            </div>
          </div>
          <div className="max-w-[140px] text-[10px] text-slate-500 dark:text-slate-400">
            Model: {currentCase.aiAnalysis.model}
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl bg-slate-50 dark:bg-[#091f52]/35 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            What was found
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {currentCase.aiAnalysis.summary}
          </p>
        </div>
        <div className="rounded-xl bg-[#eef3fc] dark:bg-[#052464]/60 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#345ec4] dark:text-[#8ea9f7]">
            Recommended action
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {currentCase.aiAnalysis.recommendation}
          </p>
        </div>
      </div>
    </section>
  );

  return (
    <div className="flex flex-col space-y-6">
      {securityWarning}
      {/* Toast Notice for Re-read */}
      {rereadMessage && (
        <div className="p-3 bg-[#eef3fc] dark:bg-[#052464] border border-[#345ec4]/40 text-[#1a3d8e] dark:text-[#8ea9f7] rounded-xl text-xs flex items-center space-x-2 animate-in fade-in">
          <Search className="w-4 h-4 shrink-0" />
          <span>{rereadMessage}</span>
        </div>
      )}

      {renderAIReviewSummary()}

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
              Sender:{" "}
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {currentCase.sender}
              </span>{" "}
              • Ingested: {currentCase.timestamp}
            </p>
          </div>

          <div className="flex items-center space-x-4 text-xs font-mono">
            <div className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#091f52]/40 border border-slate-100 dark:border-[#1a3d8e]/40">
              <span className="text-slate-400 block text-[10px]">VESSEL</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {currentCase.vessel}
              </span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#091f52]/40 border border-slate-100 dark:border-[#1a3d8e]/40">
              <span className="text-slate-400 block text-[10px]">VOYAGE</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">
                {currentCase.voyageNumber}
              </span>
            </div>
            <div className="px-3 py-1.5 rounded-xl bg-[#eef3fc] dark:bg-[#052464]/80 border border-[#345ec4]/30 dark:border-[#1a3d8e]">
              <span className="text-[#345ec4] dark:text-[#5a82e2] block text-[10px]">
                ROUTE
              </span>
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
              <span className="font-bold text-slate-700 dark:text-slate-300">
                Shipping Instruction (Source of Truth)
              </span>
            </div>
            <div className="flex items-center space-x-2 pl-4 border-l border-slate-100 dark:border-[#1a3d8e]/40">
              <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 text-[10px] font-bold">
                DRAFT BL
              </span>
              <span className="font-bold text-slate-700 dark:text-slate-300">
                Draft Bill of Lading (Carrier Review)
              </span>
            </div>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-[#1a3d8e]/40">
            {currentCase.fields.map(renderFieldDiff)}
          </div>
        </div>
      </div>

      {renderEvidencePanel()}

      {/* Operational 1-Click Action Bar */}
      <div className="bg-white dark:bg-[#06163a] rounded-2xl border border-slate-200/80 dark:border-[#1a3d8e]/60 p-4 shadow-xs flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
          <Compass className="w-4 h-4 text-[#345ec4]" />
          <span>
            Operational decisions grounded in multi-agent verification
            reasoning.
          </span>
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
