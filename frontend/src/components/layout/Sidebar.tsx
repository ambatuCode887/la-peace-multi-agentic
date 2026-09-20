import { useState, useRef, useEffect } from "react";
import type {
  ShippingCase,
  VerificationStatus,
  EmailCategory,
} from "../../types/shipping";
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Ship,
  Filter,
  ChevronDown,
  Layers,
  RotateCcw,
  Check,
  FileText,
  FileCheck,
  Receipt,
  Mail,
  ShieldAlert,
} from "lucide-react";

interface SidebarProps {
  allCases?: ShippingCase[];
  cases: ShippingCase[];
  selectedCaseId: string;
  onSelectCase: (caseId: string) => void;
  categoryFilter: EmailCategory | "ALL";
  onCategoryFilterChange: (category: EmailCategory | "ALL") => void;
  statusFilter: VerificationStatus | "ALL";
  onStatusFilterChange: (status: VerificationStatus | "ALL") => void;
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
}) => {
  const [visibleCount, setVisibleCount] = useState<number>(40);
  const [typeDropdownOpen, setTypeDropdownOpen] = useState<boolean>(false);
  const [statusDropdownOpen, setStatusDropdownOpen] = useState<boolean>(false);

  const typeDropdownRef = useRef<HTMLDivElement>(null);
  const statusDropdownRef = useRef<HTMLDivElement>(null);

  const safeAll = allCases && allCases.length > 0 ? allCases : cases;

  // Verification status only applies to BL Verification or when viewing All
  const isStatusApplicable =
    categoryFilter === "ALL" || categoryFilter === "BL_COMPARISON";

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        typeDropdownRef.current &&
        !typeDropdownRef.current.contains(event.target as Node)
      ) {
        setTypeDropdownOpen(false);
      }
      if (
        statusDropdownRef.current &&
        !statusDropdownRef.current.contains(event.target as Node)
      ) {
        setStatusDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTypeDropdownOpen(false);
        setStatusDropdownOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Category counts across total dataset
  const blCount = safeAll.filter((c) => c.category === "BL_COMPARISON").length;
  const chaseCount = safeAll.filter(
    (c) => c.category === "DOCUMENT_CHASE",
  ).length;
  const siCount = safeAll.filter((c) => c.category === "SI_REQUEST").length;
  const invCount = safeAll.filter((c) => c.category === "INVOICE_QUERY").length;
  const genCount = safeAll.filter((c) => c.category === "GENERAL").length;
  const spamCount = safeAll.filter((c) => c.category === "SPAM").length;

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

  // Category options list
  const categoryOptions: Array<{
    value: EmailCategory | "ALL";
    label: string;
    shortLabel: string;
    count: number;
    icon: typeof Layers;
    color: string;
  }> = [
    {
      value: "ALL",
      label: "All Email Types",
      shortLabel: "All Types",
      count: safeAll.length,
      icon: Layers,
      color: "text-[#345ec4]",
    },
    {
      value: "BL_COMPARISON",
      label: "BL Verification",
      shortLabel: "BL Verify",
      count: blCount,
      icon: FileText,
      color: "text-[#345ec4]",
    },
    {
      value: "DOCUMENT_CHASE",
      label: "Send Draft BL",
      shortLabel: "Send Draft BL",
      count: chaseCount,
      icon: HelpCircle,
      color: "text-violet-600",
    },
    {
      value: "SI_REQUEST",
      label: "SI Requests",
      shortLabel: "SI Requests",
      count: siCount,
      icon: FileCheck,
      color: "text-cyan-600",
    },
    {
      value: "INVOICE_QUERY",
      label: "Invoice Queries",
      shortLabel: "Invoices",
      count: invCount,
      icon: Receipt,
      color: "text-indigo-600",
    },
    {
      value: "GENERAL",
      label: "General Inquiries",
      shortLabel: "General",
      count: genCount,
      icon: Mail,
      color: "text-slate-600",
    },
    {
      value: "SPAM",
      label: "Spam & Quarantined",
      shortLabel: "Spam",
      count: spamCount,
      icon: ShieldAlert,
      color: "text-rose-600",
    },
  ];

  // Status options list (when active)
  const statusOptions: Array<{
    value: VerificationStatus | "ALL";
    label: string;
    count: number;
    color: string;
    badgeBg: string;
  }> = [
    {
      value: "ALL",
      label: "All Statuses",
      count: casesInScope.length,
      color: "bg-slate-400",
      badgeBg:
        "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300",
    },
    {
      value: "PASS",
      label: "OK",
      count: cleanCount,
      color: "bg-emerald-500",
      badgeBg:
        "bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300",
    },
    {
      value: "MISMATCH",
      label: "Mismatch",
      count: discrepancyCount,
      color: "bg-rose-500",
      badgeBg:
        "bg-rose-100 dark:bg-rose-950/80 text-rose-800 dark:text-rose-300",
    },
    {
      value: "NEEDS_REVIEW",
      label: "Needs Review",
      count: reviewCount,
      color: "bg-amber-500",
      badgeBg:
        "bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300",
    },
  ];

  const currentCategoryObj =
    categoryOptions.find((o) => o.value === categoryFilter) ||
    categoryOptions[0];
  const currentStatusObj =
    statusOptions.find((o) => o.value === statusFilter) || statusOptions[0];

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
    // If not BL Verification, status is just default (verification does not apply)
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
      case "INQUIRY":
      default:
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-[#0a1e4d]/50 dark:text-slate-400 border border-slate-200/50 dark:border-[#1a3d8e]/40">
            <HelpCircle className="w-3 h-3 text-slate-400" />
            <span>Default</span>
          </span>
        );
    }
  };

  const visibleCases = cases.slice(0, visibleCount);

  return (
    <aside className="w-84 border-r border-slate-200/80 bg-white/95 dark:bg-[#06163a]/95 dark:border-[#1a3d8e]/60 flex flex-col h-[calc(100vh-4rem)] shadow-xs transition-colors select-none">
      {/* Queue Header with Two Clean Dropdown Selectors */}
      <div className="p-3.5 border-b border-slate-100 dark:border-[#1a3d8e]/60 space-y-2.5">
        {/* Title Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-[#345ec4] dark:text-[#5a82e2]" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white tracking-wide">
              Queue
            </h2>
          </div>
          <div className="flex items-center space-x-1.5">
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
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-[#eef3fc] dark:bg-[#052464] text-[#1a3d8e] dark:text-[#8ea9f7] font-semibold border border-[#345ec4]/30">
              {cases.length} of {safeAll.length}
            </span>
          </div>
        </div>

        {/* 1. Email Type Dropdown Button Selector */}
        <div className="relative" ref={typeDropdownRef}>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1 flex items-center justify-between">
            <span>Email Type</span>
            <span className="text-[10px] text-[#345ec4] dark:text-[#5a82e2] font-semibold">
              {safeAll.length} total
            </span>
          </label>

          <button
            id="category-dropdown-btn"
            data-testid="category-dropdown-btn"
            onClick={() => {
              setTypeDropdownOpen(!typeDropdownOpen);
              setStatusDropdownOpen(false);
            }}
            className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between border transition-all cursor-pointer ${
              typeDropdownOpen
                ? "bg-white dark:bg-[#091f52] border-[#345ec4] dark:border-[#5a82e2] ring-2 ring-[#345ec4]/20 shadow-xs"
                : "bg-slate-100/90 dark:bg-[#091f52]/40 hover:bg-slate-200/70 dark:hover:bg-[#091f52]/70 border-slate-200/80 dark:border-[#1a3d8e]/60 text-slate-800 dark:text-slate-200"
            }`}
          >
            <div className="flex items-center space-x-2 truncate">
              <currentCategoryObj.icon
                className={`w-3.5 h-3.5 ${currentCategoryObj.color} shrink-0`}
              />
              <span className="truncate">{currentCategoryObj.label}</span>
            </div>
            <div className="flex items-center space-x-1.5 shrink-0 ml-2">
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold bg-[#eef3fc] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7]">
                {currentCategoryObj.count}
              </span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
                  typeDropdownOpen ? "rotate-180" : ""
                }`}
              />
            </div>
          </button>

          {/* Email Type Dropdown Menu */}
          {typeDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-white/98 dark:bg-[#06163a]/98 backdrop-blur-md border border-slate-200 dark:border-[#1a3d8e] rounded-xl shadow-xl p-1.5 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
              {categoryOptions.map((opt) => {
                const isSelected = categoryFilter === opt.value;
                const IconComponent = opt.icon;
                return (
                  <button
                    key={opt.value}
                    data-testid={`category-option-${opt.value}`}
                    onClick={() => {
                      onCategoryFilterChange(opt.value);
                      setTypeDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-[#eef3fc] text-[#1a3d8e] dark:bg-[#091f52] dark:text-white font-bold"
                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#091f52]/60"
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <IconComponent
                        className={`w-3.5 h-3.5 ${opt.color} shrink-0`}
                      />
                      <span className="truncate">{opt.label}</span>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0 ml-2">
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-[#052464] text-slate-600 dark:text-slate-300 font-medium">
                        {opt.count}
                      </span>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-[#345ec4] dark:text-[#5a82e2]" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. Verification Status Dropdown Button Selector */}
        <div className="relative" ref={statusDropdownRef}>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1 flex items-center justify-between">
            <span>Verification Status</span>
            {!isStatusApplicable && (
              <span className="text-[9px] text-slate-400 dark:text-slate-500 font-normal italic">
                BL Verify only
              </span>
            )}
          </label>

          {isStatusApplicable ? (
            <button
              id="status-dropdown-btn"
              data-testid="status-dropdown-btn"
              onClick={() => {
                setStatusDropdownOpen(!statusDropdownOpen);
                setTypeDropdownOpen(false);
              }}
              className={`w-full px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between border transition-all cursor-pointer ${
                statusDropdownOpen
                  ? "bg-white dark:bg-[#091f52] border-[#345ec4] dark:border-[#5a82e2] ring-2 ring-[#345ec4]/20 shadow-xs"
                  : "bg-slate-100/90 dark:bg-[#091f52]/40 hover:bg-slate-200/70 dark:hover:bg-[#091f52]/70 border-slate-200/80 dark:border-[#1a3d8e]/60 text-slate-800 dark:text-slate-200"
              }`}
            >
              <div className="flex items-center space-x-2 truncate">
                <span
                  className={`w-2 h-2 rounded-full ${currentStatusObj.color} shrink-0`}
                />
                <span className="truncate">{currentStatusObj.label}</span>
              </div>
              <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold ${currentStatusObj.badgeBg}`}
                >
                  {currentStatusObj.count}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
                    statusDropdownOpen ? "rotate-180" : ""
                  }`}
                />
              </div>
            </button>
          ) : (
            // Disabled state when category is non-BL (status does not apply)
            <button
              id="status-dropdown-btn"
              disabled
              className="w-full px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between border border-slate-200/50 dark:border-[#1a3d8e]/30 bg-slate-50/70 dark:bg-[#091f52]/20 text-slate-400 dark:text-slate-500 cursor-not-allowed"
              title="Verification statuses (Clean/Discrepancy/Review) only apply to Bill of Lading verification."
            >
              <div className="flex items-center space-x-2 truncate">
                <span className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 shrink-0" />
                <span className="truncate">
                  Default (All {casesInScope.length})
                </span>
              </div>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-slate-200/50 dark:bg-[#052464]/50 text-slate-500">
                N/A
              </span>
            </button>
          )}

          {/* Status Dropdown Menu (only renders when applicable) */}
          {isStatusApplicable && statusDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-white/98 dark:bg-[#06163a]/98 backdrop-blur-md border border-slate-200 dark:border-[#1a3d8e] rounded-xl shadow-xl p-1.5 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
              {statusOptions.map((opt) => {
                const isSelected = statusFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    data-testid={`status-option-${opt.value}`}
                    onClick={() => {
                      onStatusFilterChange(opt.value);
                      setStatusDropdownOpen(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-[#eef3fc] text-[#1a3d8e] dark:bg-[#091f52] dark:text-white font-bold"
                        : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#091f52]/60"
                    }`}
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <span
                        className={`w-2 h-2 rounded-full ${opt.color} shrink-0`}
                      />
                      <span className="truncate">{opt.label}</span>
                    </div>
                    <div className="flex items-center space-x-2 shrink-0 ml-2">
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md font-bold ${opt.badgeBg}`}
                      >
                        {opt.count}
                      </span>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-[#345ec4] dark:text-[#5a82e2]" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
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
                onClick={() => onSelectCase(c.id)}
                className={`w-full text-left p-3 transition-all flex flex-col space-y-1.5 cursor-pointer bg-white dark:bg-[#06163a] ${
                  isSelected
                    ? "bg-[#eef3fc] border-l-4 border-[#345ec4] dark:bg-[#091f52]/60 dark:border-[#5a82e2]"
                    : "hover:bg-slate-50 dark:hover:bg-[#091f52]/20 border-l-4 border-transparent"
                }`}
                >
                {/* Header Line: ID, Category Badge, Timestamp */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 shrink-0">
                    <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                      {c.id}
                    </span>
                    {getCategoryBadge(c.category)}
                  </div>
                  <span className="ml-2 min-w-0 truncate text-[10px] text-slate-400 font-mono">
                    {c.timestamp.split(" ")[0]}
                  </span>
                </div>

                {/* Vessel / Reference line + Status Badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium truncate max-w-[175px]">
                    <Ship className="w-3.5 h-3.5 text-[#345ec4] dark:text-[#5a82e2] shrink-0" />
                    <span className="truncate">
                      {c.vessel !== "N/A" ? c.vessel : c.subject}
                    </span>
                  </div>
                  {getStatusBadge(c)}
                </div>

                {/* Subject Preview */}
                <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 leading-snug">
                  {c.subject}
                </p>
              </button>
            );
          })
        )}

        {/* Load More Button */}
        {cases.length > visibleCount && (
          <div className="p-3 text-center">
            <button
              onClick={() => setVisibleCount((prev) => prev + 50)}
              className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-[#091f52]/60 dark:hover:bg-[#1a3d8e]/60 text-slate-700 dark:text-slate-300 flex items-center justify-center space-x-1 transition-colors cursor-pointer border border-slate-200/60 dark:border-[#1a3d8e]/50"
            >
              <span>Load More (+50)</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] text-slate-400 block mt-1">
              Showing {Math.min(visibleCount, cases.length)} of {cases.length}{" "}
              cases
            </span>
          </div>
        )}
      </div>
    </aside>
  );
};
