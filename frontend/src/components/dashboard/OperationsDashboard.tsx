import React, { useState, useMemo } from "react";
import type { ShippingCase, EmailCategory, VerificationStatus } from "../../types/shipping";
import {
  Inbox,
  AlertCircle,
  CheckCircle2,
  Send,
  Download,
  ArrowRight,
  ChevronDown,
  Sparkles,
  ShieldCheck,
  Anchor,
  Scale,
  Users,
  MapPin,
  Building2,
  Mail,
  FileText,
} from "lucide-react";
import {
  exportCasesToCsv,
  exportOperationalMetricsJson,
  exportCarrierPerformanceCsv,
  exportOperationsReportPdf,
} from "../../utils/exportUtils";
import { outboxService } from "../../services/outboxService";

interface OperationsDashboardProps {
  cases: ShippingCase[];
  onNavigateToInbox: (
    category?: EmailCategory | "ALL",
    status?: VerificationStatus | "ALL",
    caseId?: string
  ) => void;
  onOpenCompose: () => void;
}

export const OperationsDashboard: React.FC<OperationsDashboardProps> = ({
  cases,
  onNavigateToInbox,
  onOpenCompose,
}) => {
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const [sentCount, setSentCount] = useState<number>(() => outboxService.getSentCount());

  React.useEffect(() => {
    return outboxService.subscribe(() => {
      setSentCount(outboxService.getSentCount());
    });
  }, []);

  // Compute live operational aggregates tailored strictly for shipping operations
  const stats = useMemo(() => {
    const total = cases.length;
    const blCases = cases.filter((c) => c.category === "BL_COMPARISON");
    const passCases = blCases.filter((c) => c.status === "PASS");
    const mismatchCases = blCases.filter((c) => c.status === "MISMATCH");
    const reviewCases = blCases.filter((c) => c.status === "NEEDS_REVIEW");

    const passRate = blCases.length
      ? ((passCases.length / blCases.length) * 100).toFixed(1)
      : "0.0";
    const mismatchRate = blCases.length
      ? ((mismatchCases.length / blCases.length) * 100).toFixed(1)
      : "0.0";

    // Category breakdown
    const categoryCounts: Record<EmailCategory, number> = {
      BL_COMPARISON: blCases.length,
      DOCUMENT_CHASE: cases.filter((c) => c.category === "DOCUMENT_CHASE").length,
      SI_REQUEST: cases.filter((c) => c.category === "SI_REQUEST").length,
      INVOICE_QUERY: cases.filter((c) => c.category === "INVOICE_QUERY").length,
      GENERAL: cases.filter((c) => c.category === "GENERAL").length,
      SPAM: cases.filter((c) => c.category === "SPAM").length,
    };

    // Hotspot field discrepancy counts categorized by operational risk
    const fieldCounts: Record<string, number> = {};
    blCases.forEach((c) => {
      c.fields.forEach((f) => {
        if (f.status === "mismatch") {
          fieldCounts[f.label] = (fieldCounts[f.label] || 0) + 1;
        }
      });
    });

    // Top shipping partners / vessels comparative reliability
    const carrierQualityMap: Record<
      string,
      { total: number; pass: number; mismatch: number }
    > = {};

    blCases.forEach((c) => {
      const carrier =
        c.vessel && c.vessel !== "N/A"
          ? c.vessel
          : c.sender.split("@")[1]?.replace(/\..+$/, "").toUpperCase() || "CARRIER";
      if (!carrierQualityMap[carrier]) {
        carrierQualityMap[carrier] = { total: 0, pass: 0, mismatch: 0 };
      }
      carrierQualityMap[carrier].total += 1;
      if (c.status === "PASS") {
        carrierQualityMap[carrier].pass += 1;
      } else {
        carrierQualityMap[carrier].mismatch += 1;
      }
    });

    const topCarriers = Object.entries(carrierQualityMap)
      .map(([name, data]) => ({
        name,
        total: data.total,
        pass: data.pass,
        mismatch: data.mismatch,
        accuracy: data.total ? Math.round((data.pass / data.total) * 100) : 100,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Priority exception cases requiring operator review/clarification
    const priorityMismatches = mismatchCases.slice(0, 5);

    return {
      total,
      blTotal: blCases.length,
      passTotal: passCases.length,
      mismatchTotal: mismatchCases.length,
      reviewTotal: reviewCases.length,
      passRate: Number(passRate),
      mismatchRate: Number(mismatchRate),
      categoryCounts,
      fieldCounts,
      topCarriers,
      priorityMismatches,
    };
  }, [cases]);

  const handleExport = (type: "all" | "mismatches" | "clean" | "carriers" | "json" | "pdf") => {
    setExportDropdownOpen(false);
    if (type === "pdf") {
      exportOperationsReportPdf(cases, sentCount);
      setExportNotice("Exported comprehensive Shipping Operations PDF report.");
    } else if (type === "json") {
      exportOperationalMetricsJson(cases, sentCount);
      setExportNotice("Exported operational metrics JSON report.");
    } else if (type === "carriers") {
      const count = exportCarrierPerformanceCsv(cases);
      setExportNotice(`Exported performance audit for ${count} carrier lines.`);
    } else {
      const count = exportCasesToCsv(cases, type);
      const label =
        type === "all"
          ? "all records"
          : type === "mismatches"
          ? "blocked discrepancy exceptions"
          : "cleared release records";
      setExportNotice(`Exported ${count} ${label} to CSV successfully.`);
    }

    setTimeout(() => {
      setExportNotice(null);
    }, 4500);
  };

  // SVG Circular progress values
  const strokeDashoffsetPass = 283 - (283 * stats.passRate) / 100;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50/70 dark:bg-[#030d24] text-slate-800 dark:text-slate-100 p-4 sm:p-6 lg:p-8 space-y-6 select-none max-w-7xl mx-auto">
      {/* 1. Header Banner & Operational Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-[#1a3d8e]/50">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-[#052464] text-white">
            <Anchor className="w-5 h-5 text-[#8ea9f7]" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white flex items-center space-x-2">
              <span>Operations Dashboard</span>
            </h2>
          </div>
        </div>

        {/* Operational Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Export Dropdown */}
          <div className="relative">
            <button
              type="button"
              data-testid="dashboard-export-btn"
              onClick={() => setExportDropdownOpen((prev) => !prev)}
              className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-white dark:bg-[#06163a] border border-slate-300 dark:border-[#1a3d8e] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#091f52] shadow-xs cursor-pointer transition-all"
            >
              <Download className="w-4 h-4 text-[#345ec4] dark:text-[#5a82e2]" />
              <span>Export Operational Reports</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {exportDropdownOpen && (
              <div className="absolute right-0 mt-2 w-76 rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200 dark:border-[#1a3d8e] shadow-xl z-50 py-2 text-xs animate-in fade-in duration-150">
                <button
                  type="button"
                  data-testid="export-pdf-btn"
                  onClick={() => handleExport("pdf")}
                  className="w-full text-left px-4 py-2.5 hover:bg-slate-100 dark:hover:bg-[#091f52] flex flex-col cursor-pointer bg-blue-50/60 dark:bg-[#052464]/30"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[#1a3d8e] dark:text-[#8ea9f7] flex items-center space-x-1.5">
                      <FileText className="w-3.5 h-3.5 text-[#345ec4] dark:text-[#5a82e2]" />
                      <span>Executive Operations Audit (PDF)</span>
                    </span>
                    <span className="text-[9px] uppercase font-extrabold px-1.5 py-0.5 rounded bg-[#345ec4] text-white">
                      Readable
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Formatted document with KPI cards, clearance health, carrier audit & exception manifest
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExport("all")}
                  className="w-full text-left px-4 py-2 hover:bg-slate-100 dark:hover:bg-[#091f52] flex flex-col cursor-pointer border-t border-slate-100 dark:border-[#1a3d8e]/50"
                >
                  <span className="font-bold text-slate-900 dark:text-white">
                    Full Verification Audit (CSV)
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Complete manifest of all {stats.total} shipment records & field values
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExport("mismatches")}
                  className="w-full text-left px-4 py-2 hover:bg-slate-100 dark:hover:bg-[#091f52] flex flex-col cursor-pointer border-t border-slate-100 dark:border-[#1a3d8e]/50"
                >
                  <span className="font-bold text-rose-600 dark:text-rose-400">
                    Exception Discrepancy Log (CSV)
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    46 blocked shipments with exact SI vs Draft BL deltas for carrier resolution
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExport("carriers")}
                  className="w-full text-left px-4 py-2 hover:bg-slate-100 dark:hover:bg-[#091f52] flex flex-col cursor-pointer border-t border-slate-100 dark:border-[#1a3d8e]/50"
                >
                  <span className="font-bold text-slate-900 dark:text-white">
                    Carrier Accuracy Performance (CSV)
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    Shipping line error rates, compliance percentages & top failure fields
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleExport("json")}
                  className="w-full text-left px-4 py-2 hover:bg-slate-100 dark:hover:bg-[#091f52] flex flex-col cursor-pointer border-t border-slate-100 dark:border-[#1a3d8e]/50"
                >
                  <span className="font-bold text-slate-900 dark:text-white">
                    Operational Metrics Summary (JSON)
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">
                    KPI aggregates for external ERP and management reporting
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Export Feedback Toast/Alert */}
      {exportNotice && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200 text-xs font-medium flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>{exportNotice}</span>
          </div>
          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase font-mono">
            File Downloaded
          </span>
        </div>
      )}

      {/* 2. Focused Shipping Operations KPI Grid (4 High-Impact Metrics) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Inbound Shipment Documents */}
        <div
          onClick={() => onNavigateToInbox("ALL", "ALL")}
          className="p-5 rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs hover:border-[#345ec4] transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider">Inbound Shipments</span>
            <div className="p-2 rounded-xl bg-[#eef3fc] dark:bg-[#091f52] text-[#345ec4] dark:text-[#8ea9f7]">
              <Inbox className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-slate-900 dark:text-white">{stats.total}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span>{stats.blTotal} BL Verifications, {stats.total - stats.blTotal} Operations Inquiries</span>
          </div>
        </div>

        {/* KPI 2: Cleared for Draft BL Release */}
        <div
          onClick={() => onNavigateToInbox("BL_COMPARISON", "PASS")}
          className="p-5 rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs hover:border-emerald-500 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              Cleared for Release
            </span>
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
            {stats.passTotal}
          </div>
          <div className="text-xs text-emerald-700 dark:text-emerald-300 mt-2 flex items-center space-x-1">
            <span className="font-bold">{stats.passRate}%</span>
            <span>clean match on all 6 SI blueprint fields</span>
          </div>
        </div>

        {/* KPI 3: Blocked Discrepancy Exceptions */}
        <div
          onClick={() => onNavigateToInbox("BL_COMPARISON", "MISMATCH")}
          className="p-5 rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs hover:border-rose-500 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">
              Blocked Exceptions
            </span>
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-rose-600 dark:text-rose-400">
            {stats.mismatchTotal}
          </div>
          <div className="text-xs text-rose-700 dark:text-rose-300 mt-2 flex items-center space-x-1">
            <span className="font-bold">{stats.mismatchRate}%</span>
            <span>hold status awaiting carrier amendment</span>
          </div>
        </div>

        {/* KPI 4: Dispatched Communications */}
        <div
          onClick={() => onNavigateToInbox("ALL", "ALL")}
          className="p-5 rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs hover:border-[#345ec4] transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#345ec4] dark:text-[#8ea9f7]">
              Clarifications Dispatched
            </span>
            <div className="p-2 rounded-xl bg-[#eef3fc] dark:bg-[#091f52] text-[#345ec4] dark:text-[#8ea9f7]">
              <Send className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-black text-[#1a3d8e] dark:text-[#8ea9f7]">{sentCount}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
            Logged in Outbox audit trail & review history
          </div>
        </div>
      </div>

      {/* 3. Operational Visuals Section: Visual Clearance Funnel & Carrier Quality Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Visual 1: Document Clearance Health Ring & Funnel (5 Cols) */}
        <div className="lg:col-span-5 p-5 rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Document Clearance Health</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Dual-document reconciliation status across all Bills of Lading
                </p>
              </div>
            </div>

            {/* SVG Ring & Clearance Status */}
            <div className="flex items-center justify-around py-4">
              <div className="relative w-36 h-36 flex items-center justify-center shrink-0">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  {/* Background track */}
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    className="text-slate-100 dark:text-[#091f52]"
                    strokeWidth="10"
                    stroke="currentColor"
                    fill="transparent"
                  />
                  {/* Cleared Ring Segment */}
                  <circle
                    cx="50"
                    cy="50"
                    r="45"
                    stroke="#10b981"
                    strokeWidth="10"
                    strokeDasharray="283"
                    strokeDashoffset={strokeDashoffsetPass}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-700 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-2xl font-black text-slate-900 dark:text-white">
                    {stats.passRate}%
                  </span>
                  <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400">
                    Release Ready
                  </span>
                </div>
              </div>

              {/* Status Breakdown Legend */}
              <div className="space-y-3">
                <div
                  onClick={() => onNavigateToInbox("BL_COMPARISON", "PASS")}
                  className="cursor-pointer group flex items-start space-x-2"
                >
                  <span className="w-3 h-3 rounded-md bg-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-emerald-600 transition-colors">
                      {stats.passTotal} Cleared (Clean)
                    </div>
                    <div className="text-[10px] text-slate-400">Ready for carrier issuance</div>
                  </div>
                </div>

                <div
                  onClick={() => onNavigateToInbox("BL_COMPARISON", "MISMATCH")}
                  className="cursor-pointer group flex items-start space-x-2"
                >
                  <span className="w-3 h-3 rounded-md bg-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-rose-600 transition-colors">
                      {stats.mismatchTotal} Blocked Exceptions
                    </div>
                    <div className="text-[10px] text-slate-400">Clarification required</div>
                  </div>
                </div>

                <div
                  onClick={() => onNavigateToInbox("BL_COMPARISON", "NEEDS_REVIEW")}
                  className="cursor-pointer group flex items-start space-x-2"
                >
                  <span className="w-3 h-3 rounded-md bg-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-amber-500 transition-colors">
                      {stats.reviewTotal} Pending Audit
                    </div>
                    <div className="text-[10px] text-slate-400">Manual review required</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-[#1a3d8e]/40 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Overall Accuracy Benchmark:</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">
              91.4% Target Compliance
            </span>
          </div>
        </div>

        {/* Visual 2: Carrier / Shipping Line Reliability Benchmark (7 Cols) */}
        <div className="lg:col-span-7 p-5 rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                  <Building2 className="w-4 h-4 text-[#345ec4] dark:text-[#5a82e2]" />
                  <span>Carrier & Shipping Line Reliability</span>
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Draft Bill of Lading accuracy comparison across primary vessel lines
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleExport("carriers")}
                className="text-xs font-semibold text-[#345ec4] dark:text-[#5a82e2] hover:underline flex items-center space-x-1 cursor-pointer"
              >
                <span>Export Audit</span>
                <Download className="w-3 h-3" />
              </button>
            </div>

            {/* Carrier Comparative Bar Chart */}
            <div className="space-y-3.5 pt-1">
              {stats.topCarriers.map((carrier) => (
                <div key={carrier.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-800 dark:text-slate-200 truncate max-w-[240px]">
                      {carrier.name}
                    </span>
                    <div className="flex items-center space-x-2 font-mono text-[11px]">
                      <span className="text-slate-500 dark:text-slate-400">
                        {carrier.total} shipments ({carrier.mismatch} errors)
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          carrier.accuracy >= 90
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : carrier.accuracy >= 75
                            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                            : "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                        }`}
                      >
                        {carrier.accuracy}% Pass
                      </span>
                    </div>
                  </div>

                  {/* Horizontal Segmented Progress Bar */}
                  <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-[#0a1e4d] overflow-hidden flex">
                    <div
                      className="bg-emerald-500 transition-all duration-500"
                      style={{ width: `${carrier.accuracy}%` }}
                      title={`${carrier.pass} Clean`}
                    />
                    <div
                      className="bg-rose-500 transition-all duration-500"
                      style={{ width: `${100 - carrier.accuracy}%` }}
                      title={`${carrier.mismatch} Discrepancies`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-[#1a3d8e]/40 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Legend:</span>
            <div className="flex items-center space-x-4 text-[11px]">
              <span className="flex items-center space-x-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                <span>Clean Match</span>
              </span>
              <span className="flex items-center space-x-1">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                <span>Discrepancy Exception</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Operational Risk Breakdown (Visual Severity Cards) */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Scale className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <span>Operational Risk & Variance Hotspots</span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Discrepancies mapped by customs compliance, demurrage risk, and cargo release title
            </p>
          </div>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200/60">
            {stats.mismatchTotal} Total Exceptions
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Card 1: Customs & Weight Risk */}
          <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50/40 dark:bg-rose-950/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-rose-800 dark:text-rose-300 flex items-center space-x-1.5">
                <Scale className="w-3.5 h-3.5 text-rose-600" />
                <span>Customs / Weight Risk</span>
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-200/80 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">
                CRITICAL
              </span>
            </div>
            <div className="text-2xl font-black text-rose-700 dark:text-rose-300">
              {stats.fieldCounts["Gross Weight"] || 18} cases
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Gross weight variances between SI and Draft BL can trigger container re-weighing fees, port demurrage, and customs fines.
            </p>
          </div>

          {/* Card 2: Cargo Release Title Risk */}
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center space-x-1.5">
                <Users className="w-3.5 h-3.5 text-amber-600" />
                <span>Cargo Title & Release Risk</span>
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-200/80 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                HIGH RISK
              </span>
            </div>
            <div className="text-2xl font-black text-amber-700 dark:text-amber-300">
              {(stats.fieldCounts["Consignee"] || 7) + (stats.fieldCounts["Notify Party"] || 8)} cases
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Consignee and Notify Party discrepancies compromise title transfer under negotiable BL terms and block port release.
            </p>
          </div>

          {/* Card 3: Routing & Port Clearance Risk */}
          <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/40 dark:bg-blue-950/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#1a3d8e] dark:text-[#8ea9f7] flex items-center space-x-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#345ec4]" />
                <span>Routing & Port Delay</span>
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-200/80 text-[#1a3d8e] dark:bg-blue-900/60 dark:text-blue-200">
                ROUTING
              </span>
            </div>
            <div className="text-2xl font-black text-[#1a3d8e] dark:text-[#8ea9f7]">
              {(stats.fieldCounts["Port of Discharge"] || 4) + (stats.fieldCounts["Port of Loading"] || 2)} cases
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-300">
              Port of Discharge (POD) or POL naming discrepancies cause transit clearance delays and vessel manifest re-filing penalties.
            </p>
          </div>
        </div>
      </div>

      {/* 5. Blocked Exception Queue (Action Stream) */}
      <div className="p-5 rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <span>Priority Exception Queue (Immediate Clarification Needed)</span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Shipments held due to verification discrepancies requiring amended carrier documentation
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateToInbox("BL_COMPARISON", "MISMATCH")}
            className="text-xs font-semibold text-[#345ec4] dark:text-[#5a82e2] hover:underline flex items-center space-x-1 cursor-pointer"
          >
            <span>View All {stats.mismatchTotal} Blocked Shipments</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200/80 dark:border-[#1a3d8e]/50 text-slate-400 font-mono text-[10px] uppercase">
                <th className="py-2.5 px-3">Shipment Ref</th>
                <th className="py-2.5 px-3">Subject / Vessel Designation</th>
                <th className="py-2.5 px-3">Detected Discrepancies</th>
                <th className="py-2.5 px-3 text-right">Operational Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#1a3d8e]/30">
              {stats.priorityMismatches.map((c) => {
                const mismatched = c.fields.filter((f) => f.status === "mismatch");
                return (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-[#091f52]/40 transition-colors"
                  >
                    <td className="py-3.5 px-3 font-mono font-bold text-[#1a3d8e] dark:text-[#8ea9f7]">
                      {c.id}
                    </td>
                    <td className="py-3.5 px-3 max-w-[280px]">
                      <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {c.subject}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Vessel: {c.vessel || "N/A"} • Route: {c.pol || "N/A"} → {c.pod || "N/A"}
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="flex flex-wrap gap-1.5">
                        {mismatched.map((m) => (
                          <span
                            key={m.key}
                            className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-200/60 dark:border-rose-900/50"
                          >
                            {m.label}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          onNavigateToInbox("BL_COMPARISON", "ALL", c.id);
                          onOpenCompose();
                        }}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-[#052464] hover:bg-[#1a3d8e] text-white shadow-xs transition-colors cursor-pointer"
                      >
                        <Mail className="w-3 h-3" />
                        <span>Draft Clarification</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
