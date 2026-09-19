import { Search, Sparkles, Sun, Moon, ShieldCheck, Database } from 'lucide-react';
import lapeaceIcon from '../../assets/lapeace_icon.png';

interface HeaderProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  backendConnected?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  darkMode,
  onToggleDarkMode,
  searchQuery,
  onSearchChange,
  backendConnected = false,
}) => {
  return (
    <header className="h-16 border-b border-slate-200/80 bg-white/95 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs dark:bg-[#06163a]/95 dark:border-[#1a3d8e]/60 transition-colors">
      {/* Brand Identity: La Peace SDOC with authentic Minecraft Lapis Lazuli Mineral */}
      <div className="flex items-center space-x-3">
        <img
          src={lapeaceIcon}
          alt="La Peace SDOC"
          className="w-8 h-8 object-contain drop-shadow-sm select-none"
          style={{ imageRendering: 'pixelated' }}
        />
        <div>
          <div className="flex items-center space-x-2">
            <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
              La Peace <span className="text-[#345ec4] dark:text-[#5a82e2]">SDOC</span>
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

      {/* Status & Model Telemetry */}
      <div className="flex items-center space-x-3">
        {/* Multi-Agent Model Indicator */}
        <div className="hidden lg:flex items-center space-x-2 px-3 py-1 rounded-full bg-[#eef3fc] border border-[#345ec4]/30 dark:bg-[#0a1e4d]/70 dark:border-[#1a3d8e] text-xs text-[#1a3d8e] dark:text-[#8ea9f7] shadow-2xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#5a82e2] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#345ec4]"></span>
          </span>
          <Sparkles className="w-3.5 h-3.5 text-[#5a82e2]" />
          <span className="font-semibold">Gemini 3 Flash</span>
          <span className="text-[10px] opacity-70">| Multi-Agent RAG</span>
        </div>

        {/* Live Backend Telemetry */}
        <div className="hidden xl:flex items-center space-x-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center space-x-1 font-mono" title="Docker challenge inbox on port 8080">
            <Database className="w-3.5 h-3.5 text-[#345ec4]" />
            <span>:8080</span>
          </div>
          <span>•</span>
          <div
            className={`flex items-center space-x-1.5 font-mono px-2 py-0.5 rounded-md ${
              backendConnected
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60'
                : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60'
            }`}
            title={backendConnected ? 'FastAPI backend live on port 8090' : 'FastAPI backend reconnecting...'}
          >
            <span
              className={`w-2 h-2 rounded-full ${backendConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'}`}
            />
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>:8090</span>
          </div>
        </div>

        {/* Dark/Light Mode Toggle */}
        <button
          id="theme-toggle"
          data-testid="theme-toggle"
          onClick={onToggleDarkMode}
          className="p-2 rounded-xl border border-slate-200/80 hover:bg-slate-100 dark:border-[#1a3d8e]/60 dark:hover:bg-[#0a1e4d] text-slate-600 dark:text-slate-300 transition-colors cursor-pointer shadow-2xs"
          title="Toggle Dark/Light Mode"
        >
          {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-[#345ec4]" />}
        </button>
      </div>
    </header>
  );
};
