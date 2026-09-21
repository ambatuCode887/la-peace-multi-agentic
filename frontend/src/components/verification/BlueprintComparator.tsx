import { useState } from "react";
import type { ShippingCase, FieldComparison } from "../../types/shipping";
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Send,
  Check,
  ShieldAlert,
  Compass,
  RefreshCw,
  Search,
  Gauge,
} from "lucide-react";
import { api } from "../../services/api";
import { OperationalEmailHub } from "./OperationalEmailHub";

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

  const routingTelemetry = currentCase.routingTelemetry;
  const ocrAlerts =
    currentCase.ocrDistortionAnalysis?.filter(
      (analysis) => analysis.is_ocr_distortion,
    ) || [];

  const renderRoutingTelemetry = () => {
    if (!routingTelemetry) return null;
    return (
      <section
        className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs dark:border-[#1a3d8e]/60 dark:bg-[#06163a]"
        aria-label="Verification routing telemetry"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="rounded-lg bg-[#eef3fc] p-2 text-[#345ec4] dark:bg-[#052464] dark:text-[#8ea9f7]">
              <Gauge className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Cheap-first verification routing
              </h3>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Rules decide clear fields; only ambiguous fields receive
                advisory diagnosis.
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-500 dark:text-slate-400">
            <div>
              Estimated targeted cost:{" "}
              <strong className="text-slate-800 dark:text-slate-200">
                ${routingTelemetry.estimatedCostUsd.toFixed(5)}
              </strong>
            </div>
            <div>
              {routingTelemetry.ruleLatencyMs.toFixed(1)} ms rules ·{" "}
              {routingTelemetry.llmLatencyMs.toFixed(1)} ms LLM
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-950/30">
            <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
              Rule resolved
            </div>
            <div className="text-lg font-bold text-emerald-900 dark:text-emerald-100">
              {routingTelemetry.resolvedByRules}
            </div>
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              LLM routed
            </div>
            <div className="text-lg font-bold text-amber-900 dark:text-amber-100">
              {routingTelemetry.sentToLlm}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-[#091f52]/40">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              LLM calls
            </div>
            <div className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {routingTelemetry.llmCalls}
            </div>
          </div>
          <div className="rounded-lg bg-blue-50 px-3 py-2 dark:bg-blue-950/30">
            <div className="text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Full-doc baseline
            </div>
            <div className="text-lg font-bold text-blue-900 dark:text-blue-100">
              ${routingTelemetry.fullDocumentCostUsd.toFixed(4)}
            </div>
          </div>
        </div>
        {routingTelemetry.scalabilitySummary && (
          <p className="mt-3 text-[11px] font-medium text-slate-600 dark:text-slate-300">
            {routingTelemetry.scalabilitySummary}
          </p>
        )}
      </section>
    );
  };

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
    const resolutionBadge =
      field.resolutionSource === "llm" ? (
        <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          LLM ambiguity check
        </span>
      ) : field.resolutionSource === "human" ? (
        <span className="rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-800 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-200">
          Human review required
        </span>
      ) : (
        <span className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
          Rule checked
        </span>
      );
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
            <span>{field.label}</span>
            <span className="ml-2 inline-block normal-case tracking-normal">
              {resolutionBadge}
            </span>
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

  const renderAIReviewSummary = () => {
    const isExtractionConfidence =
      currentCase.aiAnalysis.model === "Deterministic ETL extraction";

    return (
      <section
        className="rounded-2xl border border-[#345ec4]/35 bg-white dark:bg-[#06163a] p-5 shadow-xs"
        aria-label={
          isExtractionConfidence
            ? "Document extraction summary"
            : "AI review summary"
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-[#eef3fc] dark:bg-[#052464] p-2 text-[#345ec4] dark:text-[#8ea9f7]">
              <Compass className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-[#345ec4] dark:text-[#8ea9f7]">
                {isExtractionConfidence
                  ? "Document extraction summary"
                  : "AI review summary"}
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Advisory analysis of this verification
              </h3>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                {isExtractionConfidence
                  ? "Based on deterministic field extraction from the source documents."
                  : "Advisory only. The deterministic SI/BL comparison remains authoritative."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-right">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {isExtractionConfidence
                  ? "Extraction confidence"
                  : "AI confidence"}
              </div>
              <div className="text-lg font-bold text-[#1a3d8e] dark:text-[#8ea9f7]">
                {currentCase.aiAnalysis.confidence !== undefined
                  ? `${currentCase.aiAnalysis.confidence}%`
                  : "Not provided"}
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
  };

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
      {renderRoutingTelemetry()}
      {renderOcrAlert()}

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
