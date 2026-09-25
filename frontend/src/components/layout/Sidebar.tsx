import { useState, useRef, useEffect, useMemo } from "react";
import type {
  ShippingCase,
  VerificationStatus,
  EmailCategory,
} from "../../types/shipping";
import { api, type ExportFormat } from "../../services/api";
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Ship,
  Inbox,
  Clock,
  RotateCcw,
  RefreshCw,
  Check,
  FileText,
  FileCheck,
  Receipt,
  Mail,
  ShieldAlert,
  PanelLeftClose,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Send,
  Paperclip,
  LayoutDashboard,
  PenSquare,
  Award,
  ListChecks,
  ArrowUpDown,
} from "lucide-react";
import { formatMalaysiaTime } from "../../utils/formatTime";
import { outboxService, type DispatchedEmail } from "../../services/outboxService";
import { ExtractionTierBadge } from "../common/ExtractionTierBadge";

interface SidebarProps {
  allCases?: ShippingCase[];
  cases: ShippingCase[];
  selectedCaseId: string;
  onSelectCase: (caseId: string) => void;
  categoryFilter: EmailCategory | "ALL";
  onCategoryFilterChange: (category: EmailCategory | "ALL") => void;
  statusFilter: VerificationStatus | "ALL";
  onStatusFilterChange: (status: VerificationStatus | "ALL") => void;
  onRefreshInbox?: () => Promise<void> | void;
  onLoadMore?: () => Promise<void> | void;
  hasMoreCases?: boolean;
  /** When true, the entire inbox message list shrinks to a slim rail so the canvas gets full width. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  railCollapsed?: boolean;
  onToggleRail?: () => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  activeMailboxFolder?: "INBOX" | "SENT";
  onMailboxFolderChange?: (folder: "INBOX" | "SENT") => void;
  selectedSentId?: string | null;
  onSelectSent?: (sentEmail: DispatchedEmail) => void;
  activeView?: "dashboard" | "inbox" | "benchmark";
  onGoToDashboard?: () => void;
  onGoToBenchmark?: () => void;
  onOpenCompose?: () => void;
  onOpenBatchRuleCorrections?: () => void;
  mismatchCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  allCases,
  cases,
  selectedCaseId,
  onSelectCase,
  categoryFilter,
  onCategoryFilterChange,
  statusFilter,
  onStatusFilterChange,
  onRefreshInbox,
  onLoadMore,
  hasMoreCases = false,
  collapsed = false,
  onToggleCollapsed,
  railCollapsed: propRailCollapsed,
  onToggleRail,
  mobileOpen = false,
  onCloseMobile,
  activeMailboxFolder = "INBOX",
  onMailboxFolderChange,
  selectedSentId,
  onSelectSent,
  activeView = "dashboard",
  onGoToDashboard,
  onGoToBenchmark,
  onOpenCompose,
  onOpenBatchRuleCorrections,
  mismatchCount = 0,
}) => {
  const [sortBy, setSortBy] = useState<"date" | "sender" | "vessel" | "status">("date");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [loadingMore, setLoadingMore] = useState(false);
  const [internalRailCollapsed, setInternalRailCollapsed] = useState(false);
  const railCollapsed = propRailCollapsed !== undefined ? propRailCollapsed : internalRailCollapsed;
  const handleToggleRail = () => {
    if (onToggleRail) {
      onToggleRail();
    } else {
      setInternalRailCollapsed((prev) => !prev);
    }
  };
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const [scanNoticeTone, setScanNoticeTone] = useState<"success" | "error">(
    "success",
  );
  const [selectedExportIds, setSelectedExportIds] = useState<string[]>([]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const scanNoticeTimeoutRef = useRef<number | null>(null);

  const [sentEmails, setSentEmails] = useState<DispatchedEmail[]>(() =>
    outboxService.getSentEmails(),
  );

  useEffect(() => {
    return outboxService.subscribe(() => {
      setSentEmails(outboxService.getSentEmails());
    });
  }, []);

  const scheduleScanNoticeClear = () => {
    if (scanNoticeTimeoutRef.current !== null) {
      window.clearTimeout(scanNoticeTimeoutRef.current);
    }
    scanNoticeTimeoutRef.current = window.setTimeout(() => {
      setScanNotice(null);
      scanNoticeTimeoutRef.current = null;
    }, 3000);
  };

  const handleRefreshInbox = async () => {
    if (!onRefreshInbox) return;
    setIsRefreshing(true);
    setScanNotice(null);
    const start = Date.now();
    try {
      await onRefreshInbox();
      const elapsed = Date.now() - start;
      if (elapsed < 1200) {
        await new Promise((resolve) => setTimeout(resolve, 1200 - elapsed));
      }
      setScanNoticeTone("success");
      setScanNotice("Inbox updated");
      scheduleScanNoticeClear();
    } catch {
      const elapsed = Date.now() - start;
      if (elapsed < 1200) {
        await new Promise((resolve) => setTimeout(resolve, 1200 - elapsed));
      }
      setScanNoticeTone("error");
      setScanNotice("Inbox refresh failed");
      scheduleScanNoticeClear();
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    return () => {
      if (scanNoticeTimeoutRef.current !== null) {
        window.clearTimeout(scanNoticeTimeoutRef.current);
      }
    };
  }, []);

  const safeAll = allCases && allCases.length > 0 ? allCases : cases;

  // Category counts across total dataset
  const blCount = safeAll.filter((c) => c.category === "BL_COMPARISON").length;
  const chaseCount = safeAll.filter(
    (c) => c.category === "DOCUMENT_CHASE",
  ).length;
  const siCount = safeAll.filter((c) => c.category === "SI_REQUEST").length;
  const invCount = safeAll.filter((c) => c.category === "INVOICE_QUERY").length;
  const genCount = safeAll.filter((c) => c.category === "GENERAL").length;
  const spamCount = safeAll.filter((c) => c.category === "SPAM").length;

  // Verification status only applies to BL Verification or when viewing All
  const isStatusApplicable =
    categoryFilter === "ALL" || categoryFilter === "BL_COMPARISON";

  // Status counts relative to current scope
  const casesInScope =
    categoryFilter === "ALL"
      ? safeAll
      : safeAll.filter((c) => c.category === categoryFilter);

  const cleanCount = casesInScope.filter((c) => c.status === "PASS").length;
  const discrepancyCount = casesInScope.filter(
    (c) => c.status === "MISMATCH",
  ).length;
  const reviewCount = casesInScope.filter(
    (c) => c.status === "NEEDS_REVIEW",
  ).length;

  // Category options list (Outlook / Gmail Label Hierarchy)
  const categoryFolders: Array<{
    value: EmailCategory | "ALL";
    label: string;
    shortLabel: string;
    count: number;
    icon: typeof Inbox;
    color: string;
    activeBg: string;
    activeText: string;
  }> = [
    {
      value: "ALL",
      label: "All Inbound",
      shortLabel: "All",
      count: safeAll.length,
      icon: Inbox,
      color: "text-[#345ec4] dark:text-[#5a82e2]",
      activeBg: "bg-[#eef3fc] dark:bg-[#091f52]",
      activeText: "text-[#1a3d8e] dark:text-white",
    },
    {
      value: "BL_COMPARISON",
      label: "BL Verification",
      shortLabel: "BL Verify",
      count: blCount,
      icon: FileText,
      color: "text-blue-600 dark:text-blue-400",
      activeBg: "bg-blue-50 dark:bg-blue-950/60",
      activeText: "text-blue-900 dark:text-blue-200",
    },
    {
      value: "DOCUMENT_CHASE",
      label: "Send Draft BL",
      shortLabel: "Chasers",
      count: chaseCount,
      icon: Clock,
      color: "text-violet-600 dark:text-violet-400",
      activeBg: "bg-violet-50 dark:bg-violet-950/60",
      activeText: "text-violet-900 dark:text-violet-200",
    },
    {
      value: "SI_REQUEST",
      label: "SI Requests",
      shortLabel: "SI Inbound",
      count: siCount,
      icon: FileCheck,
      color: "text-cyan-600 dark:text-cyan-400",
      activeBg: "bg-cyan-50 dark:bg-cyan-950/60",
      activeText: "text-cyan-900 dark:text-cyan-200",
    },
    {
      value: "INVOICE_QUERY",
      label: "Invoice Queries",
      shortLabel: "Invoices",
      count: invCount,
      icon: Receipt,
      color: "text-indigo-600 dark:text-indigo-400",
      activeBg: "bg-indigo-50 dark:bg-indigo-950/60",
      activeText: "text-indigo-900 dark:text-indigo-200",
    },
    {
      value: "GENERAL",
      label: "General Inquiries",
      shortLabel: "General",
      count: genCount,
      icon: Mail,
      color: "text-slate-600 dark:text-slate-400",
      activeBg: "bg-slate-100 dark:bg-[#081a44]",
      activeText: "text-slate-900 dark:text-white",
    },
    {
      value: "SPAM",
      label: "Quarantined Spam",
      shortLabel: "Spam",
      count: spamCount,
      icon: ShieldAlert,
      color: "text-rose-600 dark:text-rose-400",
      activeBg: "bg-rose-50 dark:bg-rose-950/60",
      activeText: "text-rose-900 dark:text-rose-200",
    },
  ];

  // Segmented status options
  const statusOptions: Array<{
    value: VerificationStatus | "ALL";
    label: string;
    shortLabel: string;
    count: number;
    dotColor: string;
    badgeBg: string;
  }> = [
    {
      value: "ALL",
      label: "All",
      shortLabel: "All",
      count: casesInScope.length,
      dotColor: "bg-slate-400",
      badgeBg: "text-slate-700 dark:text-slate-300",
    },
    {
      value: "PASS",
      label: "OK",
      shortLabel: "OK",
      count: cleanCount,
      dotColor: "bg-emerald-500",
      badgeBg: "text-emerald-700 dark:text-emerald-400",
    },
    {
      value: "MISMATCH",
      label: "Mismatch",
      shortLabel: "Mismatch",
      count: discrepancyCount,
      dotColor: "bg-rose-500",
      badgeBg: "text-rose-700 dark:text-rose-400",
    },
    {
      value: "NEEDS_REVIEW",
      label: "Needs Review",
      shortLabel: "Review",
      count: reviewCount,
      dotColor: "bg-amber-500",
      badgeBg: "text-amber-700 dark:text-amber-400",
    },
  ];

  const currentFolder =
    categoryFolders.find((f) => f.value === categoryFilter) || categoryFolders[0];

  const getCategoryBadge = (category: EmailCategory) => {
    switch (category) {
      case "BL_COMPARISON":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#e8effd] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7] border border-[#345ec4]/30 shrink-0">
            BL Verify
          </span>
        );
      case "DOCUMENT_CHASE":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-50 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300 border border-violet-200/60 dark:border-violet-800/60 shrink-0">
            Send Draft BL
          </span>
        );
      case "SI_REQUEST":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-50 text-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300 border border-cyan-200/60 dark:border-cyan-800/60 shrink-0">
            SI Request
          </span>
        );
      case "INVOICE_QUERY":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 shrink-0">
            Invoice
          </span>
        );
      case "GENERAL":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shrink-0">
            General
          </span>
        );
      case "SPAM":
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/40 shrink-0">
            Spam
          </span>
        );
    }
  };

  const getStatusBadge = (c: ShippingCase) => {
    if (c.category !== "BL_COMPARISON") {
      return (
        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-[#0a1e4d]/50 dark:text-slate-400 border border-slate-200/50 dark:border-[#1a3d8e]/40">
          <span>Default</span>
        </span>
      );
    }

    switch (c.status) {
      case "PASS":
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            <span>OK</span>
          </span>
        );
      case "MISMATCH":
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border border-rose-200/60 dark:border-rose-800/60">
            <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
            <span>Mismatch</span>
          </span>
        );
      case "NEEDS_REVIEW":
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60">
            <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            <span>Needs Review</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-[#0a1e4d]/50 dark:text-slate-400 border border-slate-200/50 dark:border-[#1a3d8e]/40">
            <HelpCircle className="w-3 h-3 text-slate-400" />
            <span>Default</span>
          </span>
        );
    }
  };

  const visibleCases = useMemo(() => {
    const list = [...cases];
    return list.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "date") {
        const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        cmp = timeA - timeB;
        if (cmp === 0) cmp = a.id.localeCompare(b.id);
      } else if (sortBy === "sender") {
        cmp = (a.sender || "").localeCompare(b.sender || "");
      } else if (sortBy === "vessel") {
        const labelA = a.vessel || a.subject || "";
        const labelB = b.vessel || b.subject || "";
        cmp = labelA.localeCompare(labelB);
      } else if (sortBy === "status") {
        const priority: Record<string, number> = {
          MISMATCH: 3,
          REVIEW: 2,
          PASS: 1,
        };
        const pA = priority[a.status] || 0;
        const pB = priority[b.status] || 0;
        cmp = pA - pB;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });
  }, [cases, sortBy, sortOrder]);
  const okCases = safeAll.filter(
    (c) => c.category === "BL_COMPARISON" && c.status === "PASS",
  );
  const selectedOkIds = selectedExportIds.filter((id) =>
    okCases.some((c) => c.id === id),
  );

  const toggleExportSelection = (caseItem: ShippingCase) => {
    if (caseItem.category !== "BL_COMPARISON" || caseItem.status !== "PASS")
      return;
    setSelectedExportIds((current) =>
      current.includes(caseItem.id)
        ? current.filter((id) => id !== caseItem.id)
        : [...current, caseItem.id],
    );
  };

  const exportSelected = async () => {
    if (selectedOkIds.length === 0) return;
    setExporting(true);
    setExportNotice(null);
    try {
      await api.downloadBatchExport(selectedOkIds, exportFormat);
      setExportNotice(
        `Exported ${selectedOkIds.length} Draft BL${selectedOkIds.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setExportNotice(
        error instanceof Error ? error.message : "Draft BL export failed.",
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      {/* Mobile Drawer Backdrop Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        data-testid="sidebar-container"
        className={`border-r border-slate-200/80 bg-white/95 dark:bg-[#06163a]/95 dark:border-[#1a3d8e]/60 flex flex-col md:flex-row shadow-2xl md:shadow-xs transition-all select-none ${
          mobileOpen
            ? "fixed inset-y-0 left-0 z-50 w-[92vw] max-w-sm sm:max-w-md h-dvh flex"
            : "hidden md:flex md:h-[calc(100dvh-4rem)]"
        }`}
      >
        {/* ======================================================== */}
        {/* PANE 1: GMAIL / OUTLOOK FOLDER & LABEL RAIL               */}
        {/* ======================================================== */}
        <div
          data-testid="sidebar-rail"
          className={`border-r border-slate-200/80 dark:border-[#1a3d8e]/60 bg-slate-50/70 dark:bg-[#030d24] flex flex-col shrink-0 transition-all duration-200 ${
            mobileOpen
              ? "p-2.5 border-b md:border-b-0"
              : railCollapsed
                ? "w-16 items-center py-3"
                : "w-48 py-3"
          }`}
        >
          {/* Rail Header */}
          <div
            className={`h-8 flex items-center pb-2 mb-1.5 w-full ${
              railCollapsed && !mobileOpen
                ? "justify-center px-0"
                : "justify-between px-2.5"
            }`}
          >
            {(!railCollapsed || mobileOpen) && (
              <div className="flex items-center space-x-1.5">
                <Inbox className="w-3.5 h-3.5 text-[#345ec4] dark:text-[#5a82e2]" />
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Folders
                </span>
              </div>
            )}
            {!mobileOpen && (
              <button
                type="button"
                data-testid="toggle-rail-btn"
                onClick={handleToggleRail}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-[#091f52] transition-colors cursor-pointer"
                title={railCollapsed ? "Expand folder labels" : "Collapse folder rail"}
                aria-label={railCollapsed ? "Expand folder labels" : "Collapse folder rail"}
              >
                {railCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </button>
            )}
          </div>

          {/* Operations Dashboard Navigation Button */}
          {onGoToDashboard && (
            railCollapsed && !mobileOpen ? (
              <div className="flex justify-center mb-1 w-full">
                <button
                  type="button"
                  data-testid="sidebar-dashboard-btn"
                  onClick={onGoToDashboard}
                  title="Operations Dashboard"
                  className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                    activeView === "dashboard"
                      ? "bg-[#e8effd] dark:bg-[#052464] text-[#1a3d8e] dark:text-[#8ea9f7] ring-2 ring-[#345ec4]/40 font-bold shadow-xs"
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-[#091f52]/40"
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4 text-[#345ec4] dark:text-[#5a82e2]" />
                </button>
              </div>
            ) : (
              <div className="px-1.5 mb-1 w-full">
                <button
                  type="button"
                  data-testid="sidebar-dashboard-btn"
                  onClick={onGoToDashboard}
                  className={`group w-full h-9 flex items-center justify-between text-left transition-all cursor-pointer rounded-xl px-2.5 text-xs ${
                    activeView === "dashboard"
                      ? "bg-[#e8effd] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7] font-bold shadow-xs border-l-3 border-l-[#345ec4]"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#091f52]/40 font-medium"
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <LayoutDashboard className="w-3.5 h-3.5 text-[#345ec4] dark:text-[#5a82e2] shrink-0" />
                    <span className="truncate">Operations Dashboard</span>
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-[#345ec4] dark:text-[#5a82e2] bg-white/70 dark:bg-[#091f52] px-1.5 py-0.5 rounded">
                    KPI
                  </span>
                </button>
              </div>
            )
          )}

          {/* AI Benchmark & Evaluation Navigation Button */}
          {onGoToBenchmark && (
            railCollapsed && !mobileOpen ? (
              <div className="flex justify-center mb-1 w-full">
                <button
                  type="button"
                  data-testid="sidebar-benchmark-btn"
                  onClick={onGoToBenchmark}
                  title="AI Benchmark & Model Evaluation (Certified)"
                  className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                    activeView === "benchmark"
                      ? "bg-[#e8effd] dark:bg-[#052464] text-[#1a3d8e] dark:text-[#8ea9f7] ring-2 ring-[#345ec4]/40 font-bold shadow-xs"
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-[#091f52]/40"
                  }`}
                >
                  <Award className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                </button>
              </div>
            ) : (
              <div className="px-1.5 mb-1 w-full">
                <button
                  type="button"
                  data-testid="sidebar-benchmark-btn"
                  onClick={onGoToBenchmark}
                  className={`group w-full h-9 flex items-center justify-between text-left transition-all cursor-pointer rounded-xl px-2.5 text-xs ${
                    activeView === "benchmark"
                      ? "bg-[#e8effd] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7] font-bold shadow-xs border-l-3 border-l-[#345ec4]"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#091f52]/40 font-medium"
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <Award className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                    <span className="truncate">AI Benchmark</span>
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    CERTIFIED
                  </span>
                </button>
              </div>
            )
          )}

          {/* Batch Rule Corrections Button */}
          {onOpenBatchRuleCorrections && mismatchCount > 0 && (
            railCollapsed && !mobileOpen ? (
              <div className="flex justify-center mb-1 w-full">
                <button
                  type="button"
                  data-testid="sidebar-batch-rules-btn"
                  onClick={onOpenBatchRuleCorrections}
                  title={`Batch Rule Corrections (${mismatchCount} cases)`}
                  className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/50"
                >
                  <ListChecks className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center shadow-xs">
                    {mismatchCount}
                  </span>
                </button>
              </div>
            ) : (
              <div className="px-1.5 mb-1 w-full">
                <button
                  type="button"
                  data-testid="sidebar-batch-rules-btn"
                  onClick={onOpenBatchRuleCorrections}
                  className="group w-full h-9 flex items-center justify-between text-left transition-all cursor-pointer rounded-xl px-2.5 text-xs text-emerald-800 dark:text-emerald-200 bg-emerald-50/70 hover:bg-emerald-100/80 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/50 border border-emerald-300 dark:border-emerald-800/60 font-semibold"
                >
                  <div className="flex items-center space-x-2 truncate">
                    <ListChecks className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="truncate">Rule Fixes</span>
                  </div>
                  <span className="text-[10px] font-bold text-white bg-emerald-600 px-1.5 py-0.2 rounded-full">
                    {mismatchCount}
                  </span>
                </button>
              </div>
            )
          )}

          {/* Divider between Operations Hub and Actions/Folders */}
          <div className={`border-t border-slate-200/80 dark:border-[#1a3d8e]/50 my-1.5 ${railCollapsed && !mobileOpen ? "w-8 self-center" : "w-full"}`} />

          {/* Quick Compose Button */}
          {onOpenCompose && (
            railCollapsed && !mobileOpen ? (
              <div className="flex justify-center mb-1.5 w-full">
                <button
                  type="button"
                  data-testid="sidebar-compose-btn"
                  onClick={onOpenCompose}
                  title="Compose New Email"
                  className="w-9 h-9 rounded-xl bg-gradient-to-r from-[#052464] to-[#345ec4] text-white flex items-center justify-center shadow-xs hover:shadow-[#345ec4]/30 cursor-pointer hover:scale-105 transition-all"
                >
                  <PenSquare className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="px-1.5 mb-1.5 w-full">
                <button
                  type="button"
                  data-testid="sidebar-compose-btn"
                  onClick={onOpenCompose}
                  className="w-full h-9 px-3 rounded-xl bg-gradient-to-r from-[#052464] via-[#1a3d8e] to-[#345ec4] hover:from-[#1a3d8e] hover:to-[#5a82e2] text-white text-xs font-bold flex items-center justify-center space-x-2 shadow-xs cursor-pointer hover:scale-[1.02] transition-all"
                >
                  <PenSquare className="w-3.5 h-3.5" />
                  <span>Compose Email</span>
                </button>
              </div>
            )
          )}

          {/* Divider between Actions and Inbound Folders */}
          <div className={`border-t border-slate-200/80 dark:border-[#1a3d8e]/50 my-1.5 ${railCollapsed && !mobileOpen ? "w-8 self-center" : "w-full"}`} />

          {/* Folder Buttons List */}
          <nav
            aria-label="Email folders and labels"
            className={`flex w-full ${
              mobileOpen
                ? "flex-row overflow-x-auto space-x-1.5 pb-1 no-scrollbar"
                : railCollapsed
                  ? "flex-col space-y-2.5 px-0 py-1 overflow-y-auto items-center"
                  : "flex-col space-y-2 px-1.5 py-1 overflow-y-auto"
            }`}
          >
            {categoryFolders.map((folder) => {
              const isSelected = activeMailboxFolder === "INBOX" && categoryFilter === folder.value;
              const Icon = folder.icon;

              // Collapsed Icon-Only Mode on Desktop
              if (railCollapsed && !mobileOpen) {
                return (
                  <button
                    key={folder.value}
                    type="button"
                    data-testid={`category-label-${folder.value}`}
                    data-category={folder.value}
                    onClick={() => {
                      if (onMailboxFolderChange) onMailboxFolderChange("INBOX");
                      onCategoryFilterChange(folder.value);
                    }}
                    title={`${folder.label} (${folder.count})`}
                    className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                      isSelected
                        ? `${folder.activeBg} ${folder.color} ring-2 ring-[#345ec4]/30 shadow-xs font-bold`
                        : "text-slate-500 hover:bg-slate-200/50 dark:hover:bg-[#091f52]/40"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {folder.count > 0 && (
                      <span className="absolute top-0.5 right-0.5 h-3.5 min-w-3.5 px-1 rounded-full bg-[#1a3d8e] dark:bg-[#5a82e2] text-white text-[8px] font-bold flex items-center justify-center leading-none shadow-xs pointer-events-none border border-white dark:border-[#030d24]">
                        {folder.count > 99 ? "99+" : folder.count}
                      </span>
                    )}
                  </button>
                );
              }

              // Full Expanded Label Item (Desktop or Mobile)
              return (
                <button
                  key={folder.value}
                  type="button"
                  data-testid={`category-label-${folder.value}`}
                  data-category={folder.value}
                  onClick={() => {
                    if (onMailboxFolderChange) onMailboxFolderChange("INBOX");
                    onCategoryFilterChange(folder.value);
                  }}
                  className={`group w-full h-9 flex items-center justify-between text-left transition-all cursor-pointer rounded-xl shrink-0 ${
                    mobileOpen
                      ? "px-2.5 shrink-0 text-xs space-x-1.5"
                      : "px-2.5 text-xs"
                  } ${
                    isSelected
                      ? `${folder.activeBg} ${folder.activeText} font-bold shadow-xs border-l-3 border-l-[#345ec4] dark:border-l-[#5a82e2]`
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#091f52]/40 font-medium"
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isSelected
                          ? folder.color
                          : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200"
                      }`}
                    />
                    <span className="truncate">
                      {mobileOpen ? folder.shortLabel : folder.label}
                    </span>
                  </div>

                  <span
                    className={`ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded-md font-semibold transition-colors shrink-0 ${
                      isSelected
                        ? "bg-[#345ec4] text-white dark:bg-[#5a82e2] dark:text-white"
                        : "bg-slate-200/80 text-slate-500 dark:bg-[#06183e] dark:text-slate-400 group-hover:bg-slate-300 dark:group-hover:bg-[#0c2966]"
                    }`}
                  >
                    {folder.count}
                  </span>
                </button>
              );
            })}

            {/* Divider between Inbound Folders and Sent Mailbox */}
            <div className={`border-t border-slate-200/80 dark:border-[#1a3d8e]/50 my-1.5 ${railCollapsed && !mobileOpen ? "w-8 self-center" : "w-full"}`} />

            {/* SENT MAIL FOLDER BUTTON */}
            {railCollapsed && !mobileOpen ? (
              <button
                type="button"
                data-testid="category-label-SENT"
                onClick={() => {
                  if (onMailboxFolderChange) onMailboxFolderChange("SENT");
                }}
                title={`Sent Mail (${sentEmails.length})`}
                className={`relative w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                  activeMailboxFolder === "SENT"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 ring-2 ring-emerald-500/40 shadow-xs font-bold"
                    : "text-slate-500 hover:bg-slate-200/50 dark:hover:bg-[#091f52]/40"
                }`}
              >
                <Send className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                {sentEmails.length > 0 && (
                  <span className="absolute top-0.5 right-0.5 h-3.5 min-w-3.5 px-1 rounded-full bg-emerald-600 dark:bg-emerald-500 text-white text-[8px] font-bold flex items-center justify-center leading-none shadow-xs pointer-events-none border border-white dark:border-[#030d24]">
                    {sentEmails.length > 99 ? "99+" : sentEmails.length}
                  </span>
                )}
              </button>
            ) : (
              <button
                type="button"
                data-testid="category-label-SENT"
                onClick={() => {
                  if (onMailboxFolderChange) onMailboxFolderChange("SENT");
                }}
                className={`group w-full h-9 flex items-center justify-between text-left transition-all cursor-pointer rounded-xl shrink-0 ${
                  mobileOpen
                    ? "px-2.5 shrink-0 text-xs space-x-1.5"
                    : "px-2.5 text-xs"
                } ${
                  activeMailboxFolder === "SENT"
                    ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/70 dark:text-emerald-200 font-bold shadow-xs border-l-3 border-l-emerald-600 dark:border-l-emerald-500"
                    : "text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#091f52]/40 font-medium"
                }`}
              >
                <div className="flex items-center space-x-2 truncate">
                  <Send
                    className={`w-3.5 h-3.5 shrink-0 ${
                      activeMailboxFolder === "SENT"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-300"
                    }`}
                  />
                  <span className="truncate">Sent Mail</span>
                </div>

                <span
                  className={`ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded-md font-semibold transition-colors shrink-0 ${
                    activeMailboxFolder === "SENT"
                      ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-white"
                      : "bg-slate-200/80 text-slate-500 dark:bg-[#06183e] dark:text-slate-400 group-hover:bg-slate-300 dark:group-hover:bg-[#0c2966]"
                  }`}
                >
                  {sentEmails.length}
                </span>
              </button>
            )}
          </nav>
        </div>

        {/* ======================================================== */}
        {/* PANE 2: MESSAGE LIST & VERIFICATION FILTERING            */}
        {/* ======================================================== */}
        {!collapsed && (
          <div className="flex-1 flex flex-col min-w-0 md:w-80 lg:w-84 h-full bg-white dark:bg-[#06163a]">
          {activeMailboxFolder === "SENT" ? (
            <>
              {/* Sent Mail Header */}
              <div className="p-3 border-b border-slate-100 dark:border-[#1a3d8e]/60 space-y-2 shrink-0">
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center space-x-2 min-w-0">
                    {onCloseMobile && (
                      <button
                        type="button"
                        onClick={onCloseMobile}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 md:hidden cursor-pointer"
                        title="Close inbox"
                        aria-label="Close inbox"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                    <div className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-950/70 flex items-center justify-center shrink-0">
                      <Send className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
                        Sent Mail
                      </h2>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                    {sentEmails.length} sent
                  </span>
                </div>
              </div>

              {/* Scrollable Sent Messages List */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1a3d8e]/40">
                {sentEmails.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-xs">
                    No sent emails logged yet.
                  </div>
                ) : (
                  sentEmails.map((email) => {
                    const isSelected = email.id === selectedSentId;
                    return (
                      <button
                        key={email.id}
                        data-sent-id={email.id}
                        onClick={() => {
                          if (onSelectSent) onSelectSent(email);
                          if (onCloseMobile) onCloseMobile();
                        }}
                        className={`w-full text-left p-3 transition-all flex flex-col space-y-1.5 cursor-pointer bg-white dark:bg-[#06163a] border-b border-b-slate-100 dark:border-b-[#1a3d8e]/50 ${
                          isSelected
                            ? "bg-emerald-50/70 border-l-4 border-l-emerald-600 dark:bg-emerald-950/40 dark:border-l-emerald-500"
                            : "hover:bg-slate-50/80 dark:hover:bg-[#091f52]/20 border-l-4 border-l-transparent"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-1.5 min-w-0">
                            <span className="text-[12px] font-bold text-slate-900 dark:text-white truncate max-w-[170px]">
                              To: {email.to}
                            </span>
                            {email.attachments && email.attachments.length > 0 && (
                              <Paperclip className="w-3 h-3 text-[#345ec4] dark:text-[#5a82e2] shrink-0" />
                            )}
                          </div>
                          <span className="ml-2 text-[10px] text-slate-400 font-mono shrink-0">
                            {formatMalaysiaTime(email.sentAt, "compact")}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-slate-700 dark:text-slate-300 font-medium truncate max-w-[175px]">
                            {email.subject}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300/40 shrink-0">
                            #{email.caseId}
                          </span>
                        </div>

                        <p className="text-[11px] text-slate-400 dark:text-slate-400 line-clamp-1 leading-snug">
                          {email.body}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : (
            <>
              {/* Message List Header */}
              <div className="p-3 border-b border-slate-100 dark:border-[#1a3d8e]/60 space-y-2 shrink-0">
                {/* Folder Title Bar with Controls */}
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center space-x-1.5 min-w-0">
                {onCloseMobile && (
                  <button
                    type="button"
                    onClick={onCloseMobile}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 md:hidden cursor-pointer"
                    title="Close inbox"
                    aria-label="Close inbox"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                <currentFolder.icon
                  className={`w-4 h-4 ${currentFolder.color} shrink-0`}
                />
                <h2
                  className="text-sm font-bold text-slate-900 dark:text-white truncate"
                  title={currentFolder.label}
                >
                  <span className="hidden xl:inline">{currentFolder.label}</span>
                  <span className="xl:hidden">{currentFolder.shortLabel}</span>
                </h2>
                <button
                  type="button"
                  id="sidebar-refresh-inbox"
                  data-testid="sidebar-refresh-inbox"
                  onClick={handleRefreshInbox}
                  disabled={isRefreshing || !onRefreshInbox}
                  aria-label="Scan and refresh live inbox"
                  title="Scan and refresh live inbox"
                  className="p-1 rounded-md text-slate-400 hover:text-[#345ec4] dark:hover:text-[#5a82e2] hover:bg-slate-100 dark:hover:bg-[#091f52] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${
                      isRefreshing
                        ? "animate-spin text-[#345ec4] dark:text-[#5a82e2]"
                        : ""
                    }`}
                  />
                </button>
                {isRefreshing && (
                  <span className="text-[10px] text-[#345ec4] dark:text-[#5a82e2] font-semibold animate-pulse hidden sm:inline">
                    Syncing...
                  </span>
                )}
                {!isRefreshing && scanNotice && (
                  <span
                    role="status"
                    aria-live="polite"
                    className={`text-[10px] font-semibold flex items-center gap-0.5 animate-in fade-in ${
                      scanNoticeTone === "success"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {scanNoticeTone === "success" ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <AlertTriangle className="w-3 h-3" />
                    )}
                    {scanNotice}
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-1 shrink-0">
                {(categoryFilter !== "ALL" || statusFilter !== "ALL") && (
                  <button
                    onClick={() => {
                      onCategoryFilterChange("ALL");
                      onStatusFilterChange("ALL");
                    }}
                    className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#091f52] transition-colors cursor-pointer flex items-center space-x-1 text-[11px]"
                    title="Reset all filters"
                    data-testid="reset-filters"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span className="hidden sm:inline">Reset</span>
                  </button>
                )}
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-md bg-[#eef3fc] dark:bg-[#052464] text-[#1a3d8e] dark:text-[#8ea9f7] font-bold border border-[#345ec4]/30">
                  {cases.length} of {safeAll.length}
                </span>
                {onToggleCollapsed && (
                  <button
                    type="button"
                    onClick={onToggleCollapsed}
                    className="hidden md:inline-flex p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#091f52] transition-colors cursor-pointer"
                    title="Hide inbox sidebar"
                    aria-label="Hide inbox sidebar"
                    data-testid="collapse-inbox"
                  >
                    <PanelLeftClose className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Segmented Status Filter Bar (All, OK, Mismatch, Review) */}
            {isStatusApplicable ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <span>Status Filter</span>
                </div>
                <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#040e28] border border-slate-200/80 dark:border-[#1a3d8e]/60">
                  {statusOptions.map((opt) => {
                    const isSelected = statusFilter === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        data-testid={`status-pill-${opt.value}`}
                        onClick={() => onStatusFilterChange(opt.value)}
                        className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1 py-1 px-1 rounded-lg transition-all cursor-pointer ${
                          isSelected
                            ? "bg-white dark:bg-[#091f52] text-slate-900 dark:text-white shadow-xs font-bold border border-slate-200/60 dark:border-[#1a3d8e]"
                            : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-[#091f52]/40 font-medium"
                        }`}
                        title={`Filter by ${opt.label} status (${opt.count} cases)`}
                      >
                        <div className="flex items-center space-x-1">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${opt.dotColor} shrink-0`}
                          />
                          <span className="text-[11px] leading-tight">
                            {opt.shortLabel}
                          </span>
                        </div>
                        <span className="text-[10px] opacity-75 font-mono">
                          {opt.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-[#040e28]/60 border border-slate-200/60 dark:border-[#1a3d8e]/40 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <div className="flex items-center space-x-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                  <span className="font-medium">Default</span>
                </div>
                <span className="text-[10px] font-mono uppercase bg-slate-200/60 dark:bg-[#091f52] px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">
                  N/A
                </span>
              </div>
            )}

            {/* Outlook-Style Arrange & Sort Bar */}
            <div className="pt-2 border-t border-slate-100 dark:border-[#1a3d8e]/40 flex items-center justify-between gap-1">
              <div className="flex items-center space-x-1 min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 shrink-0">
                  Arrange:
                </span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as "date" | "sender" | "vessel" | "status")}
                  aria-label="Arrange emails by field"
                  className="text-[11px] font-semibold bg-transparent text-slate-700 dark:text-slate-200 border-none outline-none cursor-pointer focus:ring-0 p-0 truncate"
                >
                  <option value="date" className="bg-white dark:bg-[#06183e] text-slate-800 dark:text-slate-200">Date</option>
                  <option value="sender" className="bg-white dark:bg-[#06183e] text-slate-800 dark:text-slate-200">From / Shipper</option>
                  <option value="vessel" className="bg-white dark:bg-[#06183e] text-slate-800 dark:text-slate-200">Subject / Vessel</option>
                  <option value="status" className="bg-white dark:bg-[#06183e] text-slate-800 dark:text-slate-200">Status</option>
                </select>
              </div>

              <button
                type="button"
                data-testid="sidebar-sort-order-btn"
                onClick={() => setSortOrder((prev) => (prev === "desc" ? "asc" : "desc"))}
                className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-semibold text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#091f52] transition-colors cursor-pointer shrink-0"
                title={sortOrder === "desc" ? "Sort: Newest / Descending (click to toggle)" : "Sort: Oldest / Ascending (click to toggle)"}
              >
                <span>{sortOrder === "desc" ? "Newest on Top" : "Oldest on Top"}</span>
                <ArrowUpDown className="w-3 h-3 text-[#345ec4] dark:text-[#5a82e2]" />
              </button>
            </div>

            {/* Batch Export Bar */}
            <div className="border-t border-slate-100 pt-2 dark:border-[#1a3d8e]/40">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {selectedOkIds.length} OK selected
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setSelectedExportIds(okCases.map((c) => c.id))}
                    className="text-[10px] font-semibold text-[#345ec4] hover:underline dark:text-[#8ea9f7] cursor-pointer"
                  >
                    Select all OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedExportIds([])}
                    className="text-[10px] font-semibold text-slate-500 hover:underline dark:text-slate-400 cursor-pointer"
                  >
                    Clear selection
                  </button>
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5">
                <select
                  value={exportFormat}
                  onChange={(event) =>
                    setExportFormat(event.target.value as ExportFormat)
                  }
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[10px] font-semibold text-slate-700 dark:border-[#1a3d8e]/60 dark:bg-[#091f52] dark:text-slate-200 cursor-pointer"
                  aria-label="Batch export format"
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                  <option value="pdf">PDF</option>
                </select>
                <button
                  type="button"
                  onClick={() => void exportSelected()}
                  disabled={selectedOkIds.length === 0 || exporting}
                  className="flex-1 rounded-lg bg-[#1a3d8e] px-2 py-1.5 text-[10px] font-bold text-white hover:bg-[#345ec4] disabled:cursor-not-allowed disabled:opacity-40 transition-colors cursor-pointer"
                >
                  {exporting ? "Exporting..." : "Export BL Draft"}
                </button>
              </div>
              {exportNotice && (
                <p
                  className="mt-1 text-[10px] text-slate-500 dark:text-slate-400"
                  role="status"
                >
                  {exportNotice}
                </p>
              )}
            </div>
          </div>

          {/* Scrollable Cases List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1a3d8e]/40">
            {visibleCases.length === 0 ? (
              <div className="p-8 text-center text-slate-400 dark:text-slate-500 text-xs">
                No cases match the selected filters.
              </div>
            ) : (
              visibleCases.map((c) => {
                const isSelected = c.id === selectedCaseId;
                return (
                  <button
                    key={c.id}
                    data-case-id={c.id}
                    onClick={() => {
                      onSelectCase(c.id);
                      if (onCloseMobile) onCloseMobile();
                    }}
                    className={`w-full text-left p-3 transition-all flex flex-col space-y-1.5 cursor-pointer bg-white dark:bg-[#06163a] border-b border-b-slate-100 dark:border-b-[#1a3d8e]/50 ${
                      isSelected
                        ? "bg-[#eef3fc] border-l-4 border-l-[#345ec4] dark:bg-[#091f52]/60 dark:border-l-[#5a82e2]"
                        : "hover:bg-slate-50/80 dark:hover:bg-[#091f52]/20 border-l-4 border-l-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={selectedOkIds.includes(c.id)}
                          disabled={
                            c.category !== "BL_COMPARISON" || c.status !== "PASS"
                          }
                          onChange={() => toggleExportSelection(c)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select ${c.id} for Draft BL export`}
                          className="h-3.5 w-3.5 shrink-0 accent-[#345ec4] disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
                        />
                        <span className="text-[14px] font-mono font-extrabold tracking-tight text-slate-900 dark:text-white">
                          {c.id}
                        </span>
                        {getCategoryBadge(c.category)}
                      </div>
                      <span className="ml-2 min-w-0 truncate text-[10px] text-slate-400 font-mono">
                        {formatMalaysiaTime(c.timestamp, "compact")}
                      </span>
                    </div>

                    {/* Vessel / Reference line + Tier Badge & Status Badge */}
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center space-x-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium truncate max-w-[150px]">
                        <Ship className="w-3.5 h-3.5 text-[#345ec4] dark:text-[#5a82e2] shrink-0" />
                        <span className="truncate">
                          {c.vessel !== "N/A" ? c.vessel : c.subject}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1.5 shrink-0">
                        {c.category === "BL_COMPARISON" && (
                          <ExtractionTierBadge shippingCase={c} size="xs" compact={true} showPopover={false} testId={`sidebar-tier-badge-${c.id}`} />
                        )}
                        {getStatusBadge(c)}
                      </div>
                    </div>

                    {/* Subject Preview */}
                    <p className="text-[11px] text-slate-500 dark:text-slate-300 line-clamp-1 leading-snug">
                      {c.subject}
                    </p>
                  </button>
                );
              })
            )}

            {/* Load More Button */}
            {hasMoreCases && (
              <div className="p-3 text-center">
                <button
                  onClick={async () => {
                    if (!onLoadMore || loadingMore) return;
                    setLoadingMore(true);
                    try {
                      await onLoadMore();
                    } finally {
                      setLoadingMore(false);
                    }
                  }}
                  disabled={loadingMore}
                  className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-[#091f52]/60 dark:hover:bg-[#1a3d8e]/60 text-slate-700 dark:text-slate-300 flex items-center justify-center space-x-1 transition-colors cursor-pointer border border-slate-200/60 dark:border-[#1a3d8e]/50"
                >
                  <span>{loadingMore ? "Loading..." : "Load more cases"}</span>
                  {!loadingMore && <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                <span className="text-[10px] text-slate-400 block mt-1">
                  Showing {cases.length} loaded cases
                </span>
              </div>
            )}
          </div>
            </>
          )}
          </div>
        )}
      </aside>
    </>
  );
};
