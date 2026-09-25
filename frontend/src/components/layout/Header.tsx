import { useState } from "react";
import { Search, Sun, Moon, Menu, X } from "lucide-react";
import lapeaceIcon from "../../assets/lapeace_icon.png";

interface HeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeView?: "dashboard" | "inbox" | "benchmark";
  onGoToDashboard?: () => void;
  onToggleMobileInbox?: () => void;
  mobileInboxOpen?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  darkMode,
  onToggleDarkMode,
  searchQuery,
  onSearchChange,
  activeView = "dashboard",
  onGoToDashboard,
  onToggleMobileInbox,
  mobileInboxOpen = false,
}) => {
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  return (
    <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md sticky top-0 z-30 shadow-xs dark:bg-[#06163a]/95 dark:border-[#1a3d8e]/60 transition-colors">
      <div className="h-16 px-3 sm:px-6 flex items-center justify-between">
        {/* Left Side: Mobile Menu Button + Brand Identity Dashboard Button */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          {onToggleMobileInbox && (
            <button
              type="button"
              onClick={onToggleMobileInbox}
              aria-label={
                mobileInboxOpen
                  ? "Close inbox navigation"
                  : "Open inbox navigation"
              }
              className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#091f52] md:hidden cursor-pointer"
            >
              {mobileInboxOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          )}

          {/* Clickable Brand Logo & Name Navigates to Operations Dashboard */}
          <button
            type="button"
            data-testid="brand-dashboard-btn"
            onClick={onGoToDashboard}
            className="flex items-center space-x-2 sm:space-x-3 group cursor-pointer text-left focus:outline-none"
            title="Go to Operations Dashboard"
          >
            <img
              src={lapeaceIcon}
              alt="La Peace SDOC"
              className="w-7 h-7 sm:w-8 sm:h-8 object-contain drop-shadow-sm select-none group-hover:scale-105 transition-transform"
              style={{ imageRendering: "pixelated" }}
            />
            <div>
              <div className="flex items-center space-x-1.5">
                <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white group-hover:text-[#345ec4] dark:group-hover:text-[#5a82e2] transition-colors">
                  La Peace{" "}
                  <span className="text-[#345ec4] dark:text-[#5a82e2]">SDOC</span>
                </h1>
                {activeView === "dashboard" && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[#e8effd] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7] border border-[#345ec4]/30 hidden sm:inline-block">
                    Dashboard
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:block">
                Multi-Agentic AI Document Verification
              </p>
            </div>
          </button>
        </div>

        {/* Global Search Bar (Desktop) */}
        <div className="flex-1 max-w-md mx-4 lg:mx-8 hidden md:block">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#5a82e2]" />
            <input
              type="text"
              placeholder="Search by case ID, vessel, shipper, or status..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-slate-100/80 border border-slate-200/60 rounded-xl focus:outline-hidden focus:bg-white focus:border-[#345ec4] dark:bg-[#091f52]/50 dark:border-[#1a3d8e]/50 dark:text-slate-200 dark:focus:bg-[#05163a] dark:focus:border-[#5a82e2] transition-all"
            />
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5 sm:space-x-3">
          {/* Mobile Search Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileSearchOpen((prev) => !prev)}
            aria-label="Toggle search input"
            className="p-2 rounded-xl border border-slate-200/80 hover:bg-slate-100 dark:border-[#1a3d8e]/60 dark:hover:bg-[#0a1e4d] text-slate-600 dark:text-slate-300 md:hidden transition-colors cursor-pointer"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Dark/Light Mode Toggle */}
          <button
            id="theme-toggle"
            data-testid="theme-toggle"
            onClick={onToggleDarkMode}
            className="p-2 rounded-xl border border-slate-200/80 hover:bg-slate-100 dark:border-[#1a3d8e]/60 dark:hover:bg-[#0a1e4d] text-slate-600 dark:text-slate-300 transition-colors cursor-pointer shadow-2xs"
            title="Toggle Dark/Light Mode"
          >
            {darkMode ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4 text-[#345ec4]" />
            )}
          </button>
        </div>
      </div>

      {/* Expandable Mobile Search Bar */}
      {mobileSearchOpen && (
        <div className="px-3 pb-3 md:hidden animate-in fade-in slide-in-from-top-1">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#5a82e2]" />
            <input
              type="text"
              autoFocus
              placeholder="Search by case ID, vessel, shipper..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-100/80 border border-slate-200/60 rounded-xl focus:outline-hidden focus:bg-white focus:border-[#345ec4] dark:bg-[#091f52]/50 dark:border-[#1a3d8e]/50 dark:text-slate-200 dark:focus:bg-[#05163a] dark:focus:border-[#5a82e2] transition-all"
            />
          </div>
        </div>
      )}
    </header>
  );
};
