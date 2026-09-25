import React, { useState, useRef, useEffect } from "react";
import type { ShippingCase } from "../../types/shipping";
import { getExtractionTier, type ExtractionTierInfo } from "../../utils/extractionTier";
import {
  Zap,
  Scan,
  Sparkles,
  Info,
  Clock,
  Coins,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";

interface ExtractionTierBadgeProps {
  shippingCase: ShippingCase;
  size?: "xs" | "sm" | "md";
  compact?: boolean;
  showPopover?: boolean;
  placement?: "bottom" | "top";
  className?: string;
  testId?: string;
}

export const ExtractionTierBadge: React.FC<ExtractionTierBadgeProps> = ({
  shippingCase,
  size = "sm",
  compact = false,
  showPopover = true,
  placement = "bottom",
  className = "",
  testId,
}) => {
  // Only display tier badge for BL Verification cases
  if (shippingCase.category !== "BL_COMPARISON") {
    return null;
  }

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number | null>(null);

  const tierInfo: ExtractionTierInfo = getExtractionTier(shippingCase);

  const handleMouseEnter = () => {
    if (!showPopover) return;
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    if (!showPopover) return;
    timeoutRef.current = window.setTimeout(() => {
      setIsOpen(false);
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Tone color configurations
  const toneClasses = {
    slate: {
      badge:
        "bg-slate-100/90 text-slate-700 border-slate-300/80 hover:bg-slate-200/80 dark:bg-slate-800/80 dark:text-slate-300 dark:border-slate-700/80 dark:hover:bg-slate-700/80",
      icon: "text-slate-500 dark:text-slate-400",
      accentBg: "bg-slate-100 dark:bg-slate-800/80",
      headerBorder: "border-slate-200/80 dark:border-slate-700/80",
    },
    blue: {
      badge:
        "bg-sky-50 text-sky-800 border-sky-300/70 hover:bg-sky-100/80 dark:bg-[#072459]/90 dark:text-sky-200 dark:border-sky-700/60 dark:hover:bg-[#0b3175]",
      icon: "text-sky-600 dark:text-sky-400",
      accentBg: "bg-sky-50/70 dark:bg-[#082860]",
      headerBorder: "border-sky-200/70 dark:border-sky-800/60",
    },
    purple: {
      badge:
        "bg-purple-50 text-purple-800 border-purple-300/70 hover:bg-purple-100/80 dark:bg-purple-950/70 dark:text-purple-200 dark:border-purple-800/60 dark:hover:bg-purple-900/80",
      icon: "text-purple-600 dark:text-purple-400",
      accentBg: "bg-purple-50/70 dark:bg-purple-950/50",
      headerBorder: "border-purple-200/70 dark:border-purple-800/60",
    },
  }[tierInfo.badgeTone];

  const sizeClasses = {
    xs: "px-1.5 py-0.5 text-[9px] gap-1",
    sm: "px-2 py-0.5 text-[10px] gap-1.5",
    md: "px-2.5 py-1 text-xs gap-1.5",
  }[size];

  const Icon = {
    tier_1: Zap,
    tier_2: Scan,
    tier_3: Sparkles,
  }[tierInfo.tier];

  // If popovers are disabled (e.g. in compact sidebar lists), render a clean static badge
  if (!showPopover) {
    return (
      <span
        data-testid={testId || `tier-badge-${shippingCase.id}`}
        title={tierInfo.title}
        className={`inline-flex items-center rounded-lg border font-semibold select-none whitespace-nowrap cursor-default shadow-2xs ${sizeClasses} ${toneClasses.badge} ${className}`}
      >
        <Icon className={`w-3 h-3 shrink-0 ${toneClasses.icon}`} />
        <span>{compact ? tierInfo.shortLabel : tierInfo.badgeLabel}</span>
      </span>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-testid={testId || `tier-badge-${shippingCase.id}`}
    >
      {/* Clickable / Focusable Trigger Badge */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        aria-expanded={isOpen}
        aria-label={`Extraction pipeline details: ${tierInfo.badgeLabel}`}
        title={`${tierInfo.title} · Click or hover for details`}
        className={`inline-flex items-center rounded-lg border font-semibold transition-all cursor-pointer shadow-2xs select-none whitespace-nowrap ${sizeClasses} ${toneClasses.badge}`}
      >
        <Icon className={`w-3 h-3 shrink-0 ${toneClasses.icon}`} />
        <span>{compact ? tierInfo.shortLabel : tierInfo.badgeLabel}</span>
        {!compact && (
          <Info className="w-2.5 h-2.5 opacity-50 hover:opacity-100 shrink-0 transition-opacity" />
        )}
      </button>

      {/* Rich Hover Popover Card */}
      {showPopover && isOpen && (
        <div
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className={`absolute z-50 ${
            placement === "top" ? "bottom-full mb-2" : "top-full mt-2"
          } left-0 w-80 sm:w-96 rounded-2xl border border-slate-200 dark:border-[#1a3d8e] bg-white dark:bg-[#06183e] p-4 shadow-2xl text-slate-800 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-150 pointer-events-auto`}
        >
          {/* Popover Arrow Pointer */}
          {placement === "bottom" ? (
            <div className="absolute -top-1.5 left-6 w-3 h-3 overflow-hidden pointer-events-none">
              <div className="w-2.5 h-2.5 bg-white dark:bg-[#06183e] border-l border-t border-slate-200 dark:border-[#1a3d8e] transform rotate-45 translate-y-1" />
            </div>
          ) : (
            <div className="absolute top-full left-6 -mt-px w-3 h-3 overflow-hidden pointer-events-none">
              <div className="w-2.5 h-2.5 bg-white dark:bg-[#06183e] border-r border-b border-slate-200 dark:border-[#1a3d8e] transform rotate-45 -translate-y-1.5 translate-x-0.5" />
            </div>
          )}

          {/* Header */}
          <div className={`flex items-start justify-between pb-3 border-b ${toneClasses.headerBorder}`}>
            <div className="flex items-center space-x-2.5">
              <div className={`p-2 rounded-xl ${toneClasses.accentBg}`}>
                <Icon className={`w-4 h-4 ${toneClasses.icon}`} />
              </div>
              <div>
                <div className="text-xs font-bold leading-tight flex items-center gap-1.5">
                  <span>{tierInfo.title}</span>
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded font-bold bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {tierInfo.tier.replace("_", " ").toUpperCase()}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  {tierInfo.sourceDocType}
                </p>
              </div>
            </div>
          </div>

          {/* 3 Metric Pills */}
          <div className="grid grid-cols-3 gap-2 my-3 text-center">
            <div className="rounded-xl border border-slate-200/70 dark:border-[#1a3d8e]/50 bg-slate-50/70 dark:bg-[#091f52]/40 p-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400 flex items-center justify-center gap-1">
                <Clock className="w-3 h-3 text-[#345ec4] dark:text-[#8ea9f7]" />
                Speed
              </div>
              <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                {tierInfo.latencyEstimate}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/70 dark:border-[#1a3d8e]/50 bg-slate-50/70 dark:bg-[#091f52]/40 p-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400 flex items-center justify-center gap-1">
                <Coins className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                Cost
              </div>
              <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                {tierInfo.costEstimate}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200/70 dark:border-[#1a3d8e]/50 bg-slate-50/70 dark:bg-[#091f52]/40 p-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-400 flex items-center justify-center gap-1">
                <ShieldCheck
                  className={`w-3 h-3 ${
                    tierInfo.riskTone === "emerald"
                      ? "text-emerald-500 dark:text-emerald-400"
                      : "text-amber-500 dark:text-amber-400"
                  }`}
                />
                Risk
              </div>
              <div
                className={`text-xs font-bold mt-0.5 truncate ${
                  tierInfo.riskTone === "emerald"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400"
                }`}
              >
                {tierInfo.riskLabel}
              </div>
            </div>
          </div>

          {/* Operational Engine & Narrative Description */}
          <div className="space-y-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            <div>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Extraction Engine:
              </span>{" "}
              <span className="font-mono text-[11px] text-[#1a3d8e] dark:text-[#8ea9f7]">
                {tierInfo.engine}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-[#091f52]/30 p-2.5 rounded-xl border border-slate-100 dark:border-[#1a3d8e]/30">
              {tierInfo.description}
            </p>
          </div>

          {/* Tier 3 Distortion Alerts (if present) */}
          {tierInfo.distortionReasons && tierInfo.distortionReasons.length > 0 && (
            <div className="mt-3 p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200">
              <div className="text-[10px] font-bold uppercase tracking-wide flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                Escalation Trigger Detected
              </div>
              <ul className="mt-1 text-[11px] list-disc list-inside space-y-0.5">
                {tierInfo.distortionReasons.map((reason, idx) => (
                  <li key={idx} className="line-clamp-2">
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
