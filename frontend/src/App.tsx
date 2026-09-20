import { useState, useEffect } from "react";
import type {
  ShippingCase,
  VerificationStatus,
  EmailCategory,
} from "./types/shipping";
import { Header } from "./components/layout/Header";
import { Sidebar } from "./components/layout/Sidebar";
import { DiscrepancyBanner } from "./components/verification/DiscrepancyBanner";
import { EmailMessage } from "./components/verification/EmailMessage";
import { BlueprintComparator } from "./components/verification/BlueprintComparator";
import { CopilotDrawer } from "./components/copilot/CopilotDrawer";
import { ReviewPanel } from "./components/review/ReviewPanel";
import { OperationsPanel } from "./components/operations/OperationsPanel";
import { EvaluationDashboard } from "./components/evaluation/EvaluationDashboard";
import {
  api,
  mapReportToShippingCase,
  mapSummaryToShippingCase,
} from "./services/api";
import type { BackendReport } from "./services/api";

export function App() {
  const [cases, setCases] = useState<ShippingCase[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<EmailCategory | "ALL">(
    "ALL",
  );
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | "ALL">(
    "ALL",
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [operationsOpen, setOperationsOpen] = useState<boolean>(false);
  const [evaluationOpen, setEvaluationOpen] = useState<boolean>(false);
  const [detailVersion, setDetailVersion] = useState<number>(0);
  const [activeDrawerTab, setActiveDrawerTab] = useState<
    "summary" | "email" | "chat"
  >("summary");
  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [queueLoading, setQueueLoading] = useState<boolean>(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const refreshCases = async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const summaries = await api.getCases();
      setCases((previous) =>
        summaries.map((summary) =>
          mapSummaryToShippingCase(
            summary,
            previous.find((item) => item.id === summary.email_id),
          ),
        ),
      );
      setSelectedCaseId((current) =>
        summaries.some((summary) => summary.email_id === current)
          ? current
          : summaries[0]?.email_id || "",
      );
    } catch (error) {
      setQueueError(
        error instanceof Error
          ? error.message
          : "Could not load backend cases.",
      );
    } finally {
      setQueueLoading(false);
    }
  };

  // Initial backend health check and live queue hydration.
  useEffect(() => {
    api.checkBackend().then((connected) => {
      setBackendConnected(connected);
      if (connected) void refreshCases();
      else setQueueLoading(false);
    });
  }, []);

  // Fetch live detail report and manager review when selected case changes
  useEffect(() => {
    if (backendConnected && selectedCaseId) {
      void api
        .getCaseDetail(selectedCaseId)
        .then((report) => {
          setCases((prev) =>
            prev.map((c) =>
              c.id === selectedCaseId ? mapReportToShippingCase(report, c) : c,
            ),
          );
        })
        .catch(() => undefined);

      void api.getManagerReview(selectedCaseId).then((managerReview) => {
        if (!managerReview) return;
        setCases((prev) =>
          prev.map((c) =>
            c.id === selectedCaseId ? { ...c, managerReview } : c,
          ),
        );
      });
    }
  }, [selectedCaseId, backendConnected, detailVersion]);

  const isStatusApplicable =
    categoryFilter === "ALL" || categoryFilter === "BL_COMPARISON";

  const filteredCases = cases.filter((c) => {
    const matchesCategory =
      categoryFilter === "ALL" || c.category === categoryFilter;
    const matchesStatus =
      !isStatusApplicable ||
      statusFilter === "ALL" ||
      c.status === statusFilter;
    const q = searchQuery.toLowerCase().trim();
    if (!q) return matchesCategory && matchesStatus;
    const matchesSearch =
      c.id.toLowerCase().includes(q) ||
      c.vessel.toLowerCase().includes(q) ||
      c.subject.toLowerCase().includes(q) ||
      c.sender.toLowerCase().includes(q) ||
      (c.statusNote && c.statusNote.toLowerCase().includes(q));
    return matchesCategory && matchesStatus && matchesSearch;
  });

  const currentCase =
    cases.find((c) => c.id === selectedCaseId) || filteredCases[0] || cases[0];

  const handleReport = (
    report: Parameters<typeof mapReportToShippingCase>[0],
  ) => {
    setCases((previous) => {
      const existing = previous.find((item) => item.id === report.email_id);
      const mapped = mapReportToShippingCase(report, existing);
      return existing
        ? previous.map((item) => (item.id === mapped.id ? mapped : item))
        : [mapped, ...previous];
    });
    setSelectedCaseId(report.email_id);
  };

  // Operations panel actions. Each one reloads the queue and the open case afterwards.
  const handleProcessInbox = async () => {
    await api.processInbox();
    await refreshCases();
    setDetailVersion((version) => version + 1);
  };

  const handleRetryCase = async (emailId: string) => {
    await api.retryCase(emailId);
    await refreshCases();
    setDetailVersion((version) => version + 1);
  };

  const handleDeleteCase = async (emailId: string) => {
    await api.deleteCase(emailId);
    await refreshCases();
  };

  // A newly verified upload is shown straight away, so clear any filter that would hide it.
  const handleVerified = (report: BackendReport) => {
    handleReport(report);
    setCategoryFilter("ALL");
    setStatusFilter("ALL");
    setSearchQuery("");
  };

  const handleReviewSaved = (report: BackendReport) => {
    handleReport(report);
  };

  const handleCategoryFilterChange = (cat: EmailCategory | "ALL") => {
    setCategoryFilter(cat);
    setStatusFilter("ALL");
    const matches = cases.filter((c) => cat === "ALL" || c.category === cat);
    if (matches.length > 0 && !matches.some((c) => c.id === selectedCaseId)) {
      setSelectedCaseId(matches[0].id);
    }
  };

  const handleStatusFilterChange = (stat: VerificationStatus | "ALL") => {
    setStatusFilter(stat);
    const matches = cases.filter((c) => {
      const matchCat =
        categoryFilter === "ALL" || c.category === categoryFilter;
      const matchStat = stat === "ALL" || c.status === stat;
      return matchCat && matchStat;
    });
    if (matches.length > 0 && !matches.some((c) => c.id === selectedCaseId)) {
      setSelectedCaseId(matches[0].id);
    }
  };

  const handleApproveCase = async () => {
    if (backendConnected) {
      try {
        await api.submitReviewCorrection(currentCase.id, {
          category: currentCase.category,
          status: "OK",
          has_defect: false,
          defect_fields: [],
          decision: "false_alarm",
          note: "Approved by human operator after review. Clean document release.",
        });
      } catch (err) {
        console.warn("Backend approval submission error:", err);
      }
    }
    setCases((prev) =>
      prev.map((c) =>
        c.id === currentCase.id
          ? {
              ...c,
              status: "PASS",
              statusNote:
                "Approved by human operator after review. Clean document submitted.",
            }
          : c,
      ),
    );
    alert(
      `Case #${currentCase.id} has been Approved and marked as CLEAN in the verification engine.`,
    );
  };

  const handleManualOverride = async () => {
    const reason = prompt("Enter justification for manual pass override:");
    if (reason) {
      if (backendConnected) {
        try {
          await api.submitReviewCorrection(currentCase.id, {
            category: currentCase.category,
            status: "OK",
            has_defect: false,
            defect_fields: [],
            decision: "false_alarm",
            note: `Manual override: ${reason}`,
          });
        } catch (err) {
          console.warn("Backend manual override error:", err);
        }
      }
      setCases((prev) =>
        prev.map((c) =>
          c.id === currentCase.id
            ? {
                ...c,
                status: "PASS",
                statusNote: `Manual override by operator: ${reason}`,
              }
            : c,
        ),
      );
    }
  };

  const handleOpenClarification = () => {
    setDrawerOpen(true);
    setActiveDrawerTab("email");
  };

  const handleSelectCase = (id: string) => {
    setEvaluationOpen(false);
    setSelectedCaseId(id);
  };

  return (
    <div className="flex flex-col h-screen bg-[#f5f8ff] text-[#0d1a3a] dark:bg-[#05163a] dark:text-[#eef3fc] transition-colors">
      {/* Top Header with La Peace SDOC Branding, raw Lapis Lazuli icon & Live Backend Telemetry */}
      <Header
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((prev) => !prev)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        backendConnected={backendConnected}
        operationsOpen={operationsOpen}
        onToggleOperations={() => setOperationsOpen((open) => !open)}
        evaluationOpen={evaluationOpen}
        onToggleEvaluation={() => setEvaluationOpen((open) => !open)}
      />

      {/* Main 3-Zone Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Zone 1: Queue (Left ~336px) */}
        <Sidebar
          allCases={cases}
          cases={filteredCases}
          selectedCaseId={currentCase?.id || ""}
          onSelectCase={handleSelectCase}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={handleCategoryFilterChange}
          statusFilter={statusFilter}
          onStatusFilterChange={handleStatusFilterChange}
        />

        {/* Zone 2: Main Operational Canvas (Center) */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#f5f8ff]/70 dark:bg-[#05163a]/90">
          <div className="max-w-4xl mx-auto">
            {evaluationOpen ? (
              <EvaluationDashboard
                backendConnected={backendConnected}
                onExit={() => setEvaluationOpen(false)}
              />
            ) : (
              <>
                {/* Operations: process inbox, upload a case, retry or delete */}
                {operationsOpen && (
                  <OperationsPanel
                    backendConnected={backendConnected}
                    currentCase={currentCase}
                    onVerified={handleVerified}
                    onProcessInbox={handleProcessInbox}
                    onRefresh={refreshCases}
                    onRetry={handleRetryCase}
                    onDelete={handleDeleteCase}
                  />
                )}

                {/* Conditional Discrepancy & Status Alert Banner */}
                {currentCase && (
                  <DiscrepancyBanner
                    currentCase={currentCase}
                    onOpenClarification={handleOpenClarification}
                  />
                )}

                {/* The email this case came from: sender, subject and message (for comparison cases) */}
                {currentCase &&
                  currentCase.category === "BL_COMPARISON" &&
                  currentCase.fields.length > 0 && (
                    <EmailMessage currentCase={currentCase} />
                  )}

                {/* Side-by-Side Blueprint Diff Comparator */}
                {queueLoading && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
                    Loading live backend queue...
                  </div>
                )}
                {queueError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
                    {queueError}
                  </div>
                )}
                {!queueLoading && !currentCase && !queueError && (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                    No backend cases are available yet. Upload a case or process
                    the inbox.
                  </div>
                )}
                {currentCase && (
                  <BlueprintComparator
                    currentCase={currentCase}
                    onApprove={handleApproveCase}
                    onDraftClarification={handleOpenClarification}
                    onManualOverride={handleManualOverride}
                  />
                )}
                {currentCase && (
                  <ReviewPanel
                    currentCase={currentCase}
                    onSaved={handleReviewSaved}
                  />
                )}
              </>
            )}
          </div>
        </main>

        {/* Zone 3: AI Assistant Intelligence Drawer (Right) */}
        {currentCase && (
          <CopilotDrawer
            currentCase={currentCase}
            isOpen={drawerOpen}
            onToggle={() => setDrawerOpen((prev) => !prev)}
            activeTab={activeDrawerTab}
            onTabChange={setActiveDrawerTab}
          />
        )}
      </div>
    </div>
  );
}

export default App;
