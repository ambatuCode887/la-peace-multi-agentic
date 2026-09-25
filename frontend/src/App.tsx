import { useState, useEffect, useMemo } from "react";
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
import { OperationsDashboard } from "./components/dashboard/OperationsDashboard";
import { BenchmarkScoreboard } from "./components/evaluation/BenchmarkScoreboard";
import { SentEmailViewer } from "./components/verification/SentEmailViewer";
import { BatchRuleCorrectionModal } from "./components/review/BatchRuleCorrectionModal";
import { ALL_CASES } from "./data/allCases";
import {
  api,
  mapReportToShippingCase,
  mapSummaryToShippingCase,
} from "./services/api";
import type { BackendReport, ScheduledEmailSummary } from "./services/api";
import { outboxService, type DispatchedEmail, type DraftEmail } from "./services/outboxService";

export function App() {
  const [cases, setCases] = useState<ShippingCase[]>(ALL_CASES);
  const [activeView, setActiveView] = useState<"dashboard" | "inbox" | "benchmark">("dashboard");
  const [selectedCaseId, setSelectedCaseId] = useState<string>(() => {
    try {
      const param = new URLSearchParams(window.location.search).get("case");
      if (param) return param;
    } catch {}
    return ALL_CASES[0]?.id || "email_001";
  });
  const [readCaseIds, setReadCaseIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("lapeace_read_case_ids");
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch {}
    return new Set(["email_001"]);
  });
  const [challengeFilterActive, setChallengeFilterActive] = useState<boolean>(false);
  const [activeMailboxFolder, setActiveMailboxFolder] = useState<"INBOX" | "SENT" | "DRAFTS" | "SCHEDULED">("INBOX");
  const [selectedSentEmail, setSelectedSentEmail] = useState<DispatchedEmail | null>(() => {
    const list = outboxService.getSentEmails();
    return list.length > 0 ? list[0] : null;
  });
  const [draftToRestore, setDraftToRestore] = useState<DraftEmail | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedScheduledEmail, setSelectedScheduledEmail] = useState<ScheduledEmailSummary | null>(null);
  const [scheduledRefreshKey, setScheduledRefreshKey] = useState(0);

  useEffect(() => {
    return outboxService.subscribe(() => {
      const list = outboxService.getSentEmails();
      setSelectedSentEmail((curr) => {
        if (!curr && list.length > 0) return list[0];
        const stillExists = list.find((item) => item.id === curr?.id);
        return stillExists || (list.length > 0 ? list[0] : null);
      });
    });
  }, []);
  const [categoryFilter, setCategoryFilter] = useState<EmailCategory | "ALL">(
    "ALL",
  );
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | "ALL">(
    "ALL",
  );
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [batchRuleCorrectionsOpen, setBatchRuleCorrectionsOpen] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<
    "summary" | "review" | "email" | "chat"
  >("summary");
  const [backendConnected, setBackendConnected] = useState<boolean>(false);
  const [mobileInboxOpen, setMobileInboxOpen] = useState<boolean>(false);
  // Starts true: the first backend check may retry while a hosted backend wakes up.
  const [queueLoading, setQueueLoading] = useState<boolean>(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  // Default to collapsed when on dashboard for maximum workspace width
  const [inboxCollapsed, setInboxCollapsed] = useState<boolean>(true);
  const [railCollapsed, setRailCollapsed] = useState<boolean>(true);

  useEffect(() => {
    try {
      localStorage.setItem("inboxCollapsed", inboxCollapsed ? "1" : "0");
    } catch {
      // not remembered, still works
    }
  }, [inboxCollapsed]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const refreshCases = async (surfaceErrors = false) => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      let syncError: Error | undefined;
      try {
        await api.syncMailpit();
      } catch (error) {
        syncError = error instanceof Error ? error : new Error(String(error));
      }
      const result = await api.getCases(1, 1000);
      const summaries = result.cases;
      if (summaries.length > 0) {
        setCases((previous) => {
          const mappedFromBackend = summaries.map((summary) =>
            mapSummaryToShippingCase(
              summary,
              previous.find((item) => item.id === summary.email_id) ||
              ALL_CASES.find((item) => item.id === summary.email_id),
            ),
          );
          const backendIds = new Set(summaries.map((s) => s.email_id));
          const challengeCasesNotInBackend = ALL_CASES.filter(
            (c) => c.isChallengeCase && !backendIds.has(c.id)
          );
          return [...challengeCasesNotInBackend, ...mappedFromBackend];
        });
        setSelectedCaseId((current) => {
          try {
            const urlParam = new URLSearchParams(window.location.search).get(
              "case",
            );
            if (urlParam) {
              return urlParam;
            }
          } catch {}
          return summaries.some((summary) => summary.email_id === current)
            ? current
            : summaries[0]?.email_id || "";
        });
      }
      if (surfaceErrors && syncError) throw syncError;
    } catch (error) {
      console.warn("Backend cases unavailable, using active dataset:", error);
      setQueueError(
        error instanceof Error ? error.message : "Could not refresh the inbox.",
      );
      setCases((previous) => (previous.length === 0 ? ALL_CASES : previous));
      if (surfaceErrors) throw error;
    } finally {
      setQueueLoading(false);
    }
  };

  // Initial backend health check and live queue hydration.
  useEffect(() => {
    api.checkBackendWithRetry().then((connected) => {
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
          setCases((prev) => {
            const exists = prev.some((c) => c.id === selectedCaseId);
            if (exists) {
              return prev.map((c) =>
                c.id === selectedCaseId ? mapReportToShippingCase(report, c) : c,
              );
            }
            return [mapReportToShippingCase(report), ...prev];
          });
        })
        .catch(() => undefined);
    }
  }, [selectedCaseId, backendConnected]);

  useEffect(() => {
    const selectedCase = cases.find((item) => item.id === selectedCaseId);
    if (
      !backendConnected ||
      !selectedCaseId ||
      !drawerOpen ||
      activeDrawerTab !== "summary" ||
      selectedCase?.managerReview
    ) {
      return;
    }

    let cancelled = false;
    void api.getManagerReview(selectedCaseId).then((managerReview) => {
      if (!cancelled && managerReview) {
        setCases((previous) =>
          previous.map((item) =>
            item.id === selectedCaseId ? { ...item, managerReview } : item,
          ),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCaseId, backendConnected, drawerOpen, activeDrawerTab, cases]);

  const casesWithRead = useMemo(() => {
    return cases.map((c) => ({
      ...c,
      isRead: readCaseIds.has(c.id),
    }));
  }, [cases, readCaseIds]);

  const isStatusApplicable =
    categoryFilter === "ALL" || categoryFilter === "BL_COMPARISON";

  const filteredCases = casesWithRead.filter((c) => {
    if (challengeFilterActive && !c.isChallengeCase) return false;
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
      (c.challengeBadge && c.challengeBadge.toLowerCase().includes(q)) ||
      (c.statusNote && c.statusNote.toLowerCase().includes(q));
    return matchesCategory && matchesStatus && matchesSearch;
  });

  const rawCurrentCase =
    casesWithRead.find((c) => c.id === selectedCaseId) || filteredCases[0] || casesWithRead[0];
  const currentCase = useMemo(() => {
    if (!rawCurrentCase) return null;
    if (rawCurrentCase.id.startsWith("email_edge_") && (!rawCurrentCase.fields || rawCurrentCase.fields.length === 0)) {
      const fallback = ALL_CASES.find((c) => c.id === rawCurrentCase.id);
      if (fallback) {
        return {
          ...rawCurrentCase,
          category: "BL_COMPARISON" as EmailCategory,
          fields: fallback.fields,
          vessel: rawCurrentCase.vessel !== "N/A" ? rawCurrentCase.vessel : fallback.vessel,
          voyageNumber: rawCurrentCase.voyageNumber !== "N/A" ? rawCurrentCase.voyageNumber : fallback.voyageNumber,
          pol: rawCurrentCase.pol !== "N/A" ? rawCurrentCase.pol : fallback.pol,
          pod: rawCurrentCase.pod !== "N/A" ? rawCurrentCase.pod : fallback.pod,
        };
      }
    }
    return rawCurrentCase;
  }, [rawCurrentCase]);
  const mismatchCount = casesWithRead.filter(
    (item) => item.category === "BL_COMPARISON" && item.status === "MISMATCH",
  ).length;

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

  const handleReviewSaved = (report: BackendReport) => {
    handleReport(report);
  };

  const handleScheduledCreated = (email: ScheduledEmailSummary) => {
    setSelectedScheduledEmail(email);
    setActiveMailboxFolder("SCHEDULED");
    setActiveView("inbox");
    setInboxCollapsed(false);
    setScheduledRefreshKey((current) => current + 1);
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

  const handleOpenReview = () => {
    setDrawerOpen(true);
    setActiveDrawerTab("review");
  };

  const handleOpenClarification = () => {
    setDrawerOpen(true);
    setActiveDrawerTab("email");
  };

  const markCaseRead = (id: string) => {
    setReadCaseIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem("lapeace_read_case_ids", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const handleToggleRead = (id: string) => {
    setReadCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      try {
        localStorage.setItem("lapeace_read_case_ids", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const handleSelectCase = (id: string) => {
    setActiveMailboxFolder("INBOX");
    setActiveView("inbox");
    setSelectedCaseId(id);
    markCaseRead(id);
    setMobileInboxOpen(false);
  };

  const handleSelectDraft = async (draftSummary: DraftEmail) => {
    const draft = await outboxService.getDraft(draftSummary.id);
    if (!draft) return;
    setSelectedDraftId(draft.id);
    setDraftToRestore(draft);
    setActiveMailboxFolder("DRAFTS");
    setActiveView("inbox");
    setSelectedCaseId(draft.caseId);
    setInboxCollapsed(false);
    setDrawerOpen(true);
    setActiveDrawerTab("email");
  };

  const handleGoToDashboard = () => {
    setActiveView("dashboard");
    setInboxCollapsed(true);
    setRailCollapsed(true);
  };

  const handleGoToBenchmark = () => {
    setActiveView("benchmark");
    setInboxCollapsed(true);
    setRailCollapsed(true);
  };

  const handleNavigateToInbox = (
    category: EmailCategory | "ALL" = "ALL",
    status: VerificationStatus | "ALL" = "ALL",
    caseId?: string
  ) => {
    setActiveView("inbox");
    setActiveMailboxFolder("INBOX");
    setInboxCollapsed(false);
    setCategoryFilter(category);
    setStatusFilter(status);
    if (caseId) {
      setSelectedCaseId(caseId);
    }
  };

  const handleOpenCompose = () => {
    setActiveView("inbox");
    setActiveMailboxFolder("INBOX");
    setInboxCollapsed(false);
    setDrawerOpen(true);
    setActiveDrawerTab("email");
  };

  return (
    <div className="flex flex-col h-screen h-dvh bg-[#f5f8ff] text-[#0d1a3a] dark:bg-[#05163a] dark:text-[#eef3fc] transition-colors">
      {/* Top Header with La Peace SDOC Branding (Dashboard home button) & Controls */}
      <Header
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((prev) => !prev)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeView={activeView}
        onGoToDashboard={handleGoToDashboard}
        mobileInboxOpen={mobileInboxOpen}
        onToggleMobileInbox={() => setMobileInboxOpen((prev) => !prev)}
      />

      {/* Main 3-Zone Workspace */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Zone 1: Queue (Left ~336px or Mobile Drawer) */}
        <Sidebar
          allCases={casesWithRead}
          cases={filteredCases}
          selectedCaseId={currentCase?.id || ""}
          onSelectCase={handleSelectCase}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={(cat) => {
            setActiveMailboxFolder("INBOX");
            handleCategoryFilterChange(cat);
            setActiveView("inbox");
            setInboxCollapsed(false);
          }}
          statusFilter={statusFilter}
          onStatusFilterChange={handleStatusFilterChange}
          onRefreshInbox={() => refreshCases(true)}
          collapsed={inboxCollapsed}
          onToggleCollapsed={() => setInboxCollapsed((collapsed) => !collapsed)}
          railCollapsed={railCollapsed}
          onToggleRail={() => setRailCollapsed((prev) => !prev)}
          mobileOpen={mobileInboxOpen}
          onCloseMobile={() => setMobileInboxOpen(false)}
          activeMailboxFolder={activeMailboxFolder}
          scheduledRefreshKey={scheduledRefreshKey}
          onMailboxFolderChange={(folder) => {
            setActiveMailboxFolder(folder);
            setActiveView("inbox");
            setInboxCollapsed(false);
          }}
          selectedSentId={selectedSentEmail?.id || null}
          onSelectSent={(email) => {
            setSelectedSentEmail(email);
            setActiveMailboxFolder("SENT");
            setActiveView("inbox");
            setInboxCollapsed(false);
          }}
          onSelectDraft={(draft) => void handleSelectDraft(draft)}
          selectedScheduledId={selectedScheduledEmail?.id || null}
          onSelectScheduled={(email) => {
            setSelectedScheduledEmail(email);
            setActiveMailboxFolder("SCHEDULED");
            setActiveView("inbox");
            setInboxCollapsed(false);
          }}
          onScheduledCancelled={(id) => {
            setSelectedScheduledEmail((email) =>
              email?.id === id ? { ...email, status: "cancelled" } : email,
            );
          }}
          activeView={activeView}
          onGoToDashboard={handleGoToDashboard}
          onGoToBenchmark={handleGoToBenchmark}
          onOpenBatchRuleCorrections={() => setBatchRuleCorrectionsOpen(true)}
          mismatchCount={mismatchCount}
          onToggleRead={handleToggleRead}
          challengeFilterActive={challengeFilterActive}
          onToggleChallengeFilter={() => setChallengeFilterActive((prev) => !prev)}
        />

        {/* Zone 2: Main Operational Canvas (Center) */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-6 bg-[#f5f8ff]/70 dark:bg-[#05163a]/90">
          <div
            className={`mx-auto transition-[max-width] duration-200 ${
              activeView === "dashboard" || activeView === "benchmark"
                ? "max-w-7xl"
                : inboxCollapsed
                ? "max-w-6xl"
                : "max-w-4xl"
            }`}
          >
            {activeView === "dashboard" ? (
              <OperationsDashboard
                cases={casesWithRead}
                onNavigateToInbox={handleNavigateToInbox}
                onOpenCompose={handleOpenCompose}
              />
            ) : activeView === "benchmark" ? (
              <BenchmarkScoreboard />
            ) : activeMailboxFolder === "SENT" ? (
              selectedSentEmail ? (
                <SentEmailViewer
                  email={selectedSentEmail}
                  onNavigateToCase={(caseId) => {
                    setActiveMailboxFolder("INBOX");
                    handleSelectCase(caseId);
                  }}
                  onBackToInbox={() => setActiveMailboxFolder("INBOX")}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-[#1a3d8e]/60 bg-white dark:bg-[#06163a] p-8 text-center text-sm text-slate-500">
                  No sent messages recorded yet.
                </div>
              )
            ) : activeMailboxFolder === "DRAFTS" ? (
              selectedDraftId && currentCase ? (
                <CopilotDrawer
                  key={selectedDraftId}
                  currentCase={currentCase}
                  isOpen
                  onToggle={() => undefined}
                  activeTab="email"
                  onTabChange={() => undefined}
                  draftToRestore={draftToRestore?.id === selectedDraftId ? draftToRestore : null}
                  onDraftRestored={() => setDraftToRestore(null)}
                  embeddedEmailOnly
                  onDraftCompleted={() => setSelectedDraftId(null)}
                  onScheduledCreated={handleScheduledCreated}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-[#1a3d8e]/60 bg-white dark:bg-[#06163a] p-8 text-center text-sm text-slate-500">
                  {selectedDraftId ? "Loading draft and its case…" : "Select a draft from the Drafts folder to continue editing."}
                </div>
              )
            ) : activeMailboxFolder === "SCHEDULED" ? (
              selectedScheduledEmail ? (
                <article className="mx-auto max-w-4xl overflow-hidden rounded-xl border border-slate-200/80 bg-white dark:border-[#1a3d8e]/60 dark:bg-[#06163a]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-[#1a3d8e]/40">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold capitalize text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                        {selectedScheduledEmail.status}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">Scheduled for {new Date(selectedScheduledEmail.scheduled_at).toLocaleString()}</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">Case #{selectedScheduledEmail.case_id}</span>
                  </div>
                  <div className="border-b border-slate-100 p-4 dark:border-[#1a3d8e]/40">
                    <h1 className="text-base font-bold text-slate-900 dark:text-white">{selectedScheduledEmail.subject}</h1>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">To: {selectedScheduledEmail.to.join(", ")}</p>
                  </div>
                  <div className="min-h-48 whitespace-pre-wrap p-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {selectedScheduledEmail.body || "(No message body)"}
                  </div>
                  {selectedScheduledEmail.attachment_names.length > 0 && (
                    <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500 dark:border-[#1a3d8e]/40 dark:text-slate-400">
                      Attachments: {selectedScheduledEmail.attachment_names.join(", ")}
                    </div>
                  )}
                </article>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-[#1a3d8e]/60 bg-white dark:bg-[#06163a] p-8 text-center text-sm text-slate-500">
                  Select a scheduled email to view its content and delivery status.
                </div>
              )
            ) : (
              <>
                {/* Conditional Discrepancy & Status Alert Banner */}
                {currentCase && (
                  <DiscrepancyBanner
                    currentCase={currentCase}
                    onOpenClarification={handleOpenClarification}
                    onOpenReview={handleOpenReview}
                  />
                )}

                {/* For BL_COMPARISON cases, keep the collapsible source email visible above the diff table. For non-BL inquiries, OperationalEmailHub displays the full Gmail-style email viewer. */}
                {currentCase && currentCase.category === "BL_COMPARISON" && (
                  <EmailMessage currentCase={currentCase} onSelectCase={handleSelectCase} />
                )}

                {/* Side-by-Side Blueprint Diff Comparator */}
                {queueError && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
                    {queueError}
                  </div>
                )}
                {!queueLoading && !currentCase && !queueError && (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
                    No backend cases are available yet. Process the inbox or refresh.
                  </div>
                )}
                {currentCase && (
                  <BlueprintComparator
                    currentCase={currentCase}
                    onManualOverride={handleOpenReview}
                  />
                )}
              </>
            )}
          </div>
        </main>

        {/* Zone 3: AI Assistant & Operator Review Workspace (Right) */}
        {activeView === "inbox" && currentCase && activeMailboxFolder === "INBOX" && (
          <CopilotDrawer
            currentCase={currentCase}
            isOpen={drawerOpen}
            onToggle={() => setDrawerOpen((prev) => !prev)}
            activeTab={activeDrawerTab}
            onTabChange={setActiveDrawerTab}
            onReviewSaved={handleReviewSaved}
            onScheduledCreated={handleScheduledCreated}
            draftToRestore={draftToRestore}
            onDraftRestored={() => setDraftToRestore(null)}
          />
        )}
      </div>
      {batchRuleCorrectionsOpen && (
        <BatchRuleCorrectionModal
          onClose={() => setBatchRuleCorrectionsOpen(false)}
          onSaved={handleReviewSaved}
        />
      )}
    </div>
  );
}

export default App;
