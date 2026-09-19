import { useState, useEffect } from 'react';
import { ALL_CASES } from './data/allCases';
import type { ShippingCase, VerificationStatus, EmailCategory } from './types/shipping';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { DiscrepancyBanner } from './components/verification/DiscrepancyBanner';
import { BlueprintComparator } from './components/verification/BlueprintComparator';
import { CopilotDrawer } from './components/copilot/CopilotDrawer';
import { api, mapReportToShippingCase } from './services/api';

export function App() {
  const [cases, setCases] = useState<ShippingCase[]>(ALL_CASES);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('email_001');
  const [categoryFilter, setCategoryFilter] = useState<EmailCategory | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<VerificationStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(true);
  const [activeDrawerTab, setActiveDrawerTab] = useState<'summary' | 'email' | 'chat'>('summary');
  const [backendConnected, setBackendConnected] = useState<boolean>(false);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  // Initial backend health check
  useEffect(() => {
    api.checkBackend().then((connected) => {
      setBackendConnected(connected);
    });
  }, []);

  // Fetch live detail report and manager review when selected case changes
  useEffect(() => {
    if (backendConnected && selectedCaseId) {
      Promise.all([
        api.getCaseDetail(selectedCaseId).catch(() => null),
        api.getManagerReview(selectedCaseId).catch(() => null),
      ]).then(([report, managerReview]) => {
        if (report || managerReview) {
          setCases((prev) =>
            prev.map((c) => {
              if (c.id !== selectedCaseId) return c;
              if (report) {
                return mapReportToShippingCase(report, c, managerReview);
              }
              if (managerReview) {
                return { ...c, managerReview };
              }
              return c;
            })
          );
        }
      });
    }
  }, [selectedCaseId, backendConnected]);

  const isStatusApplicable = categoryFilter === 'ALL' || categoryFilter === 'BL_COMPARISON';

  const filteredCases = cases.filter((c) => {
    const matchesCategory = categoryFilter === 'ALL' || c.category === categoryFilter;
    const matchesStatus =
      !isStatusApplicable || statusFilter === 'ALL' || c.status === statusFilter;
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
    cases.find((c) => c.id === selectedCaseId) ||
    filteredCases[0] ||
    cases[0];

  const handleCategoryFilterChange = (cat: EmailCategory | 'ALL') => {
    setCategoryFilter(cat);
    setStatusFilter('ALL');
    const matches = cases.filter((c) => cat === 'ALL' || c.category === cat);
    if (matches.length > 0 && !matches.some((c) => c.id === selectedCaseId)) {
      setSelectedCaseId(matches[0].id);
    }
  };

  const handleStatusFilterChange = (stat: VerificationStatus | 'ALL') => {
    setStatusFilter(stat);
    const matches = cases.filter((c) => {
      const matchCat = categoryFilter === 'ALL' || c.category === categoryFilter;
      const matchStat = stat === 'ALL' || c.status === stat;
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
          status: 'OK',
          has_defect: false,
          defect_fields: [],
          decision: 'false_alarm',
          note: 'Approved by human operator after review. Clean document release.',
        });
      } catch (err) {
        console.warn('Backend approval submission error:', err);
      }
    }
    setCases((prev) =>
      prev.map((c) =>
        c.id === currentCase.id
          ? {
              ...c,
              status: 'PASS',
              statusNote: 'Approved by human operator after review. Clean document submitted.',
            }
          : c
      )
    );
    alert(`Case #${currentCase.id} has been Approved and marked as CLEAN in the verification engine.`);
  };

  const handleManualOverride = async () => {
    const reason = prompt('Enter justification for manual pass override:');
    if (reason) {
      if (backendConnected) {
        try {
          await api.submitReviewCorrection(currentCase.id, {
            category: currentCase.category,
            status: 'OK',
            has_defect: false,
            defect_fields: [],
            decision: 'false_alarm',
            note: `Manual override: ${reason}`,
          });
        } catch (err) {
          console.warn('Backend manual override error:', err);
        }
      }
      setCases((prev) =>
        prev.map((c) =>
          c.id === currentCase.id
            ? {
                ...c,
                status: 'PASS',
                statusNote: `Manual override by operator: ${reason}`,
              }
            : c
        )
      );
    }
  };

  const handleOpenClarification = () => {
    setDrawerOpen(true);
    setActiveDrawerTab('email');
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
      />

      {/* Main 3-Zone Workspace */}
      <div className="flex flex-1 overflow-hidden">
        {/* Zone 1: Queue (Left ~336px) */}
        <Sidebar
          allCases={cases}
          cases={filteredCases}
          selectedCaseId={currentCase.id}
          onSelectCase={(id) => setSelectedCaseId(id)}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={handleCategoryFilterChange}
          statusFilter={statusFilter}
          onStatusFilterChange={handleStatusFilterChange}
        />

        {/* Zone 2: Main Operational Canvas (Center) */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#f5f8ff]/70 dark:bg-[#05163a]/90">
          <div className="max-w-4xl mx-auto">
            {/* Conditional Discrepancy & Status Alert Banner */}
            <DiscrepancyBanner
              currentCase={currentCase}
              onOpenClarification={handleOpenClarification}
            />

            {/* Side-by-Side Blueprint Diff Comparator */}
            <BlueprintComparator
              currentCase={currentCase}
              onApprove={handleApproveCase}
              onDraftClarification={handleOpenClarification}
              onManualOverride={handleManualOverride}
            />
          </div>
        </main>

        {/* Zone 3: AI Assistant Intelligence Drawer (Right) */}
        <CopilotDrawer
          currentCase={currentCase}
          isOpen={drawerOpen}
          onToggle={() => setDrawerOpen((prev) => !prev)}
          activeTab={activeDrawerTab}
          onTabChange={setActiveDrawerTab}
        />
      </div>
    </div>
  );
}

export default App;
