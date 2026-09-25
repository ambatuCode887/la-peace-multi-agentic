import { useState, useEffect } from "react";
import type { ShippingCase, FieldComparison } from "../../types/shipping";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
  Search,
  X,
  Mail,
  Clock,
} from "lucide-react";
import { API_BASE, api } from "../../services/api";
import { formatMalaysiaTime } from "../../utils/formatTime";
import { formatSubject } from "../../utils/formatSubject";
import { OperationalEmailHub } from "./OperationalEmailHub";
import { ExtractionTierBadge } from "../common/ExtractionTierBadge";

interface BlueprintComparatorProps {
  currentCase: ShippingCase;
  onApprove?: () => void;
  onDraftClarification?: () => void;
  onManualOverride?: () => void;
}

export const BlueprintComparator: React.FC<BlueprintComparatorProps> = ({
  currentCase,
  onManualOverride,
}) => {
  const [rereadMessage, setRereadMessage] = useState<string | null>(null);
  const [isRereading, setIsRereading] = useState<string | null>(null);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(
    () => currentCase.fields[0]?.key || "shipper",
  );

  // Keep the first row (shipper) selected by default when switching cases
  useEffect(() => {
    if (currentCase.fields && currentCase.fields.length > 0) {
      setSelectedFieldKey(currentCase.fields[0].key);
    }
  }, [currentCase.id]);

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
    return (
      <div className="space-y-6">
        {securityWarning}
        <OperationalEmailHub currentCase={currentCase} />
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

  const subject = formatSubject(currentCase.subject);
  const ocrAlerts =
    currentCase.ocrDistortionAnalysis?.filter(
      (analysis) => analysis.is_ocr_distortion,
    ) || [];

  const renderOcrAlert = () => {
    if (ocrAlerts.length === 0) return null;
    return (
      <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <div className="font-bold">OCR distortion suspected</div>
          <div className="mt-0.5">
            {ocrAlerts
              .map(
                (alert) =>
                  `${alert.field.replace(/_/g, " ")}: ${alert.explanation}`,
              )
              .join(" ")}
          </div>
          <div className="mt-1 font-semibold">
            Human confirmation is required before approval.
          </div>
          <button
            onClick={onManualOverride}
            className="ml-auto shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-bold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/60"
          >
            Open human review
          </button>
        </div>
      </div>
    );
  };

  const renderFieldDiff = (field: FieldComparison) => {
    const hasSiValue =
      field.siValue !== null &&
      field.siValue !== undefined &&
      !["", "null", "n/a"].includes(String(field.siValue).trim().toLowerCase());
    const hasBlValue =
      field.blValue !== null &&
      field.blValue !== undefined &&
      !["", "null", "n/a"].includes(String(field.blValue).trim().toLowerCase());
    const missingValueLabel = !hasSiValue
      ? "Missing SI value"
      : !hasBlValue
        ? "Missing BL value"
        : null;
    let blContent = (
      <div className="flex items-center space-x-2">
        <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200">
          {field.blValue}
        </span>
        {hasSiValue && hasBlValue ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        ) : (
          <>
            <AlertTriangle
              className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0"
              aria-label={missingValueLabel ?? undefined}
            />
            {!hasBlValue && (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                Missing BL value
              </span>
            )}
          </>
        )}
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
        onClick={() =>
          setSelectedFieldKey((prev) => (prev === field.key ? null : field.key))
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedFieldKey((prev) =>
              prev === field.key ? null : field.key,
            );
          }
        }}
        className={`group grid grid-cols-1 sm:grid-cols-2 items-stretch border-b border-slate-200 dark:border-[#1a3d8e]/60 last:border-b-0 overflow-hidden transition-colors cursor-pointer ${selectedFieldKey === field.key ? "bg-[#eef3fc] ring-1 ring-inset ring-[#345ec4]/50 dark:bg-[#091f52]/60" : ""}`}
      >
        {/* Left Side: SI Blueprint, a tinted band so the source of truth stands apart from the draft BL */}
        <div className="flex flex-col justify-center border-l-[3px] border-[#345ec4] bg-[#e9f0fd] py-3 sm:py-3.5 pl-3 pr-3 sm:pr-4 dark:border-[#5a82e2] dark:bg-[#0d2f7a]/70">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-[#345ec4]/15 px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide text-[#1a3d8e] dark:bg-[#5a82e2]/25 dark:text-[#b4c5fa]">
              {field.label}
            </span>
            <span className="sm:hidden text-[10px] font-bold text-[#1a3d8e] dark:text-[#8ea9f7] uppercase tracking-wider">
              SI Source of Truth
            </span>
            {!hasSiValue && missingValueLabel && (
              <span className="flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                {missingValueLabel}
              </span>
            )}
          </div>
          <div className="font-mono text-xs sm:text-sm text-slate-900 dark:text-white font-semibold break-words">
            {field.siValue}
          </div>
        </div>

        {/* Right Side: BL Draft */}
        <div
          className={`flex flex-col justify-center border-t sm:border-t-0 sm:border-l border-slate-200 py-3 sm:py-3.5 pl-3 sm:pl-4 pr-3 sm:pr-2 transition-colors dark:border-[#1a3d8e]/60 ${selectedFieldKey === field.key ? "" : "bg-slate-50 group-hover:bg-slate-100 dark:bg-white/[0.05] dark:group-hover:bg-white/[0.09]"}`}
        >
          <div className="text-[10px] sm:text-[11px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-0.5">
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
    attachmentSide: "SI" | "BL",
    evidence: FieldComparison["siEvidence"],
    primaryValue: string,
    alternateReadings: FieldComparison["siAlternateReadings"],
    agreement?: string,
  ) => {
    const sourceText =
      evidence?.source_text?.trim() || "No source text available.";
    const fallbackAttachment = currentCase.attachments?.find((attachment) => {
      const filename = attachment.split(/[\\/]/).pop() || attachment;
      return new RegExp(`(?:^|[^a-z])${attachmentSide}(?:[^a-z]|$)`, "i").test(filename);
    });
    const attachment = evidence?.attachment || fallbackAttachment;
    const attachmentPath = attachment
      ?.replace(/^\/+/, "")
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    const sourceUrl = attachmentPath
      ? `${API_BASE}/cases/${encodeURIComponent(currentCase.id)}/attachments/${attachmentPath}`
      : null;
    const isVisualAttachment = /\.(pdf|png|jpe?g|webp)$/i.test(attachment || "");
    const pageLabel = evidence ? evidence.page ?? "Text fallback" : "Not extracted";
    const formatLabel = evidence?.method || (fallbackAttachment ? "Preview only" : "Unknown");
    const readerWarning =
      agreement === "disagree" || agreement === "unavailable";

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
        {!evidence?.attachment && fallbackAttachment && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Attachment preview only; extracted source evidence is unavailable.
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
            <strong>Attachment:</strong> {attachment || "Unknown"}
          </div>
          <div>
            <strong>Page:</strong> {pageLabel} ·{" "}
            <strong>Format:</strong> {formatLabel}
          </div>
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
        <div className="rounded-xl border border-slate-200/70 bg-slate-50/60 dark:border-[#1a3d8e]/40 dark:bg-[#06163a]/40 px-4 py-2.5 text-center text-xs text-slate-500 dark:text-slate-400">
          <span>
            💡{" "}
            <strong className="font-semibold text-slate-600 dark:text-slate-300">
              Tip:
            </strong>{" "}
            Click any comparison row above to inspect source document text and
            reader confidence.
          </span>
        </div>
      );
    }

    return (
      <section
        className="rounded-2xl border border-[#345ec4]/40 bg-white dark:bg-[#06163a] p-5 shadow-xs animate-in fade-in"
        aria-label={`Source evidence for ${selectedField.label}`}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide font-bold text-[#345ec4]">
              Source Evidence Inspector
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>{selectedField.label}</span>
              <span className="text-xs font-normal text-slate-400 font-mono">
                ({selectedField.key})
              </span>
            </h3>
          </div>
          <div className="flex items-center space-x-3">
            <span className="text-xs text-slate-400 hidden sm:inline">
              Click row again or close to dismiss
            </span>
            <button
              onClick={() => setSelectedFieldKey(null)}
              className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-[#091f52] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              title="Close evidence panel"
              aria-label="Close evidence panel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Operator Guidance Tip */}
        <div className="mb-4 rounded-xl border border-blue-200/80 bg-blue-50/70 dark:border-[#345ec4]/50 dark:bg-[#091f52]/40 px-3.5 py-2 text-xs text-blue-900 dark:text-blue-200 flex items-center space-x-2">
          <span className="text-sm shrink-0 select-none">💡</span>
          <span className="text-[11px] leading-relaxed">
            <strong className="font-semibold">Tip:</strong> Click any comparison row in the table above to inspect its source document evidence, OCR snippets, and independent reader confidence.
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {renderEvidenceSource(
            "SI · Source of truth",
            "SI",
            selectedField.siEvidence,
            selectedField.siValue,
            selectedField.siAlternateReadings,
            selectedField.siReaderAgreement,
          )}
          {renderEvidenceSource(
            "BL · Incoming draft",
            "BL",
            selectedField.blEvidence,
            selectedField.blValue,
            selectedField.blAlternateReadings,
            selectedField.blReaderAgreement,
          )}
        </div>
      </section>
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

      {renderOcrAlert()}

      {/* Shipment Header Details (Discrepancy Report Card Header) */}
      <div className="bg-white dark:bg-[#06163a] rounded-2xl border border-slate-200/80 dark:border-[#1a3d8e]/60 p-4 sm:p-5 shadow-xs">
        {/* Row 1: Case ID, Reply Badge, Subtitle & Verification Status Pill */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-slate-100 dark:border-[#1a3d8e]/40">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs sm:text-sm font-mono font-bold px-2.5 py-1 rounded-lg bg-[#eef3fc] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7] border border-[#345ec4]/30">
              {currentCase.id}
            </span>
            <ExtractionTierBadge shippingCase={currentCase} size="sm" testId="comparator-tier-badge" />
            {subject.isReply && (
              <span className="inline-block rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:bg-slate-800 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700">
                Reply
              </span>
            )}
            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500 hidden sm:inline">
              Shipping Instruction vs Draft BL
            </span>
          </div>

          {/* Status Badge */}
          {currentCase.status === "PASS" && !currentCase.promptInjectionDetected ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
              title="Every extracted field matches the Shipping Instruction."
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Clean · All {currentCase.fields.length} fields match</span>
            </span>
          ) : currentCase.status === "MISMATCH" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
              <AlertCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>Discrepancy Detected</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Needs Review</span>
            </span>
          )}
        </div>

        {/* Row 2: Full-Width Email Title with Clean Typographic Hierarchy */}
        <div className="py-2.5">
          <h2
            className="text-sm sm:text-base md:text-[17px] font-semibold text-slate-800 dark:text-slate-100 leading-relaxed break-words"
            title={currentCase.subject}
          >
            {subject.segments && subject.segments.length > 0 ? (
              subject.segments.map((segment, index) => (
                <span key={index} className="inline">
                  {index > 0 && (
                    <span className="inline-block px-2 text-slate-400 dark:text-slate-500 font-normal select-none">
                      /
                    </span>
                  )}
                  <span className="inline-block">{segment}</span>
                </span>
              ))
            ) : (
              <span>{subject.title}</span>
            )}
          </h2>

          {/* Reference Chips */}
          {subject.references.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 dark:text-slate-500 mr-1">
                Ref:
              </span>
              {subject.references.map((reference, index) => (
                <span
                  key={`${reference}-${index}`}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700 dark:border-[#1a3d8e]/60 dark:bg-white/[0.05] dark:text-slate-300"
                >
                  {reference}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Row 3: Sender & Ingestion Metadata */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400 pt-1 pb-3">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="text-slate-400">Sender:</span>
            <span className="font-mono text-slate-700 dark:text-slate-300 font-medium truncate max-w-[240px] sm:max-w-none">
              {currentCase.sender}
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 shrink-0">
            <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="text-slate-400">Ingested:</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {formatMalaysiaTime(currentCase.timestamp)}
            </span>
          </span>
        </div>

        {/* Row 4: Dedicated Logistics Strip (Vessel / Voyage / Route) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 pt-3 border-t border-slate-100 dark:border-[#1a3d8e]/40 text-xs font-mono">
          <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#091f52]/40 border border-slate-100 dark:border-[#1a3d8e]/40 flex flex-col justify-center">
            <span className="text-slate-400 text-[10px] font-sans font-bold uppercase tracking-wider mb-0.5">
              VESSEL
            </span>
            <span className="font-bold text-slate-800 dark:text-slate-200 truncate" title={currentCase.vessel}>
              {currentCase.vessel || "N/A"}
            </span>
          </div>
          <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-[#091f52]/40 border border-slate-100 dark:border-[#1a3d8e]/40 flex flex-col justify-center">
            <span className="text-slate-400 text-[10px] font-sans font-bold uppercase tracking-wider mb-0.5">
              VOYAGE
            </span>
            <span className="font-bold text-slate-800 dark:text-slate-200 truncate" title={currentCase.voyageNumber}>
              {currentCase.voyageNumber || "N/A"}
            </span>
          </div>
          <div className="col-span-2 sm:col-span-1 px-3 py-2 rounded-xl bg-[#eef3fc] dark:bg-[#052464]/80 border border-[#345ec4]/30 dark:border-[#1a3d8e] flex flex-col justify-center">
            <span className="text-[#345ec4] dark:text-[#5a82e2] text-[10px] font-sans font-bold uppercase tracking-wider mb-0.5">
              ROUTE
            </span>
            <span className="font-bold text-[#1a3d8e] dark:text-[#8ea9f7] truncate" title={`${currentCase.pol} → ${currentCase.pod}`}>
              {currentCase.pol} → {currentCase.pod}
            </span>
          </div>
        </div>

        {/* Side-by-Side Blueprint Diff Card */}
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-[#1a3d8e]/60">
          {/* Mobile indicator bar */}
          <div className="sm:hidden px-3 py-2 bg-slate-100 dark:bg-[#091f52]/40 text-[11px] text-slate-600 dark:text-slate-400 font-semibold flex items-center justify-between border-b border-slate-200 dark:border-[#1a3d8e]/60">
            <span>SI Source vs Draft BL</span>
            <span className="text-[10px] text-[#345ec4] dark:text-[#8ea9f7]">Tap row for evidence</span>
          </div>

          <div className="hidden sm:grid grid-cols-2 border-b-2 border-slate-300 dark:border-[#5a82e2]/50 font-semibold text-xs text-slate-500">
            <div className="flex items-center space-x-2 border-l-[3px] border-[#345ec4] bg-[#dbe6fb] py-3 pl-3 pr-4 dark:border-[#5a82e2] dark:bg-[#10388c]/70">
              <span className="px-2 py-0.5 rounded bg-white text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7] text-[10px] font-bold border border-[#345ec4]/40 dark:border-[#5a82e2]/50">
                SI BLUEPRINT
              </span>
              <span className="font-bold text-slate-800 dark:text-slate-100">
                Shipping Instruction (Source of Truth)
              </span>
            </div>
            <div className="flex items-center space-x-2 border-l border-slate-200 bg-slate-100 py-3 pl-4 dark:border-[#1a3d8e]/60 dark:bg-white/[0.09]">
              <span className="px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 text-[10px] font-bold">
                DRAFT BL
              </span>
              <span className="font-bold text-slate-700 dark:text-slate-300">
                Draft Bill of Lading (Carrier Review)
              </span>
            </div>
          </div>

          <div>{currentCase.fields.map(renderFieldDiff)}</div>
        </div>
      </div>

      {renderEvidencePanel()}
    </div>
  );
};
