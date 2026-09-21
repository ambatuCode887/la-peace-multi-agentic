import {
  Search,
  Sun,
  Moon,
  Inbox,
  BarChart3,
} from "lucide-react";
import lapeaceIcon from "../../assets/lapeace_icon.png";

interface HeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  backendConnected?: boolean;
  operationsOpen?: boolean;
  onToggleOperations?: () => void;
  evaluationOpen?: boolean;
  onToggleEvaluation?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  darkMode,
  onToggleDarkMode,
  searchQuery,
  onSearchChange,
  operationsOpen = false,
  onToggleOperations,
  evaluationOpen = false,
  onToggleEvaluation,
}) => {
  return (
    <header className="h-16 border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs dark:bg-[#06163a]/95 dark:border-[#1a3d8e]/60 transition-colors">
      {/* Brand Identity: La Peace SDOC with authentic Minecraft Lapis Lazuli Mineral */}
      <div className="flex items-center space-x-3">
        <img
          src={lapeaceIcon}
          alt="La Peace SDOC"
          className="w-8 h-8 object-contain drop-shadow-sm select-none"
          style={{ imageRendering: "pixelated" }}
        />
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              La Peace{" "}
              <span className="text-[#345ec4] dark:text-[#5a82e2]">SDOC</span>
            </h1>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#e8effd] text-[#1a3d8e] dark:bg-[#052464] dark:text-[#8ea9f7] border border-[#345ec4]/30">
              Multi-Agent
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:block">
            Multi-Agentic AI Document Verification
          </p>
        </div>
      </div>

      {/* Global Search Bar */}
      <div className="flex-1 max-w-md mx-8 hidden md:block">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#5a82e2]" />
          <input
            type="text"
            placeholder="Search by case ID, vessel, shipper, or status..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9 pr-12 py-1.5 text-sm bg-slate-100/80 border border-slate-200/60 rounded-xl focus:outline-hidden focus:bg-white focus:border-[#345ec4] dark:bg-[#091f52]/50 dark:border-[#1a3d8e]/50 dark:text-slate-200 dark:focus:bg-[#05163a] dark:focus:border-[#5a82e2] transition-all"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-slate-400 bg-white dark:bg-[#0d2766] border border-slate-200 dark:border-[#1a3d8e]/80 px-1.5 py-0.5 rounded shadow-2xs">
            Ctrl K
          </kbd>
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex items-center space-x-3">

        {/* Operations: process inbox, upload a case, retry or delete */}
        {onToggleOperations && (
          <button
            id="operations-toggle"
            data-testid="operations-toggle"
            onClick={onToggleOperations}
            aria-pressed={operationsOpen}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
              operationsOpen
                ? "bg-[#1a3d8e] border-[#1a3d8e] text-white"
                : "border-slate-200/80 text-slate-600 hover:bg-slate-100 dark:border-[#1a3d8e]/60 dark:text-slate-300 dark:hover:bg-[#0a1e4d]"
            }`}
            title="Process the inbox, upload a case, retry or delete"
          >
            <Inbox className="w-4 h-4" />
            <span>Operations</span>
          </button>
        )}

        {onToggleEvaluation && (
          <button
            id="evaluation-toggle"
            data-testid="evaluation-toggle"
            onClick={onToggleEvaluation}
            aria-pressed={evaluationOpen}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-colors ${
              evaluationOpen
                ? "bg-[#1a3d8e] border-[#1a3d8e] text-white"
                : "border-slate-200/80 text-slate-600 hover:bg-slate-100 dark:border-[#1a3d8e]/60 dark:text-slate-300 dark:hover:bg-[#0a1e4d]"
            }`}
            title="View benchmark precision, recall, and disagreements"
          >
            <BarChart3 className="w-4 h-4" />
            <span>Evaluation</span>
          </button>
        )}

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
    </header>
  );
};
