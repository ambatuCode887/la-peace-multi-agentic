import React, { useState, useMemo } from "react";
import type { ShippingCase } from "../../types/shipping";
import {
  Sparkles,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Paperclip,
} from "lucide-react";

interface OperationalEmailHubProps {
  currentCase: ShippingCase;
}

interface ExtractedLogistics {
  blNumbers: string[];
  bookingNumbers: string[];
  containerCodes: string[];
  ports: { pol?: string; pod?: string };
  grossWeight?: string;
  invoiceReferences: string[];
  amounts: string[];
  hasDemurrageOrTHC: boolean;
  isUrgentKeyword: boolean;
}

interface UrgencyAssessment {
  level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  badgeText: string;
  badgeBg: string;
  title: string;
  slaWindow: string;
  riskNote: string;
}

interface SummaryPoint {
  label: string;
  text: string;
  highlight?: boolean;
  urgencyBadge?: {
    text: string;
    classes: string;
  };
}

export const OperationalEmailHub: React.FC<OperationalEmailHubProps> = ({
  currentCase,
}) => {
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [emailExpanded, setEmailExpanded] = useState(true);

  const textToScan = `${currentCase.subject}\n${currentCase.body || ""}`;

  // Extract structured logistics references from email subject and body
  const extracted: ExtractedLogistics = useMemo(() => {
    const text = textToScan;

    // B/L numbers (e.g., SIN..., MEDU..., OOLU..., MSKU..., MSDUL...)
    const blRegex = /\b(?:SIN\d{8,12}|MEDU[A-Z0-9]{7,14}|MSDUL\d{8,14}|OOLU\d{7,12}|MSKU\d{7,12}|525007\d{4})\b/gi;
    const blMatches = Array.from(new Set(text.match(blRegex) || []));

    // Booking & PO references (e.g., 5RVN-93974, 5AAT-84131, PO-12345)
    const bookingRegex = /\b(?:5[A-Z0-9]{3}-\d{4,6}|PO[_\-\s]*\d+(?:[_-]\d+)?|BKG[_\-\s]*[A-Z0-9]+)\b/gi;
    const bookingMatches = Array.from(new Set(text.match(bookingRegex) || []));

    // Container codes & packing units
    const containerRegex = /\b(?:\d+\s*[xX]\s*[\d']+(?:GP|HC|FCL|DC|HQ)?|[A-Z]{4}\d{7})\b/g;
    const containerMatches = Array.from(new Set(text.match(containerRegex) || []));

    // Ports
    const polMatch = text.match(/(?:POL|PORT OF LOADING|LOAD PORT|PELABUHAN MUAT)[:\s]+([^\r\n,;]+)/i);
    const podMatch = text.match(/(?:POD|PORT OF DISCHARGE|DISCHARGE PORT|PELABUHAN BONGKAR)[:\s]+([^\r\n,;]+)/i);

    // Gross Weight
    const weightMatch = text.match(/(?:GROSS\s*W(?:EIGH)?T|G\.W\.|TOTAL\s*WEIGHT)[:\s]+([\d,.]+\s*(?:KG|MT|LBS?|TONS?))/i);

    // Invoices
    const invRegex = /(?:INVOICE|INV)[:\s#]*([A-Z0-9\-_]{5,15})/gi;
    const invMatches: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = invRegex.exec(text)) !== null) {
      if (match[1] && !invMatches.includes(match[1])) {
        invMatches.push(match[1]);
      }
    }

    // Currencies
    const amountRegex = /(?:USD|MYR|SGD|EUR|RMB|CNY|\$)\s*[\d,]+(?:\.\d{2})?/gi;
    const amountMatches = Array.from(new Set(text.match(amountRegex) || []));

    const hasDemurrageOrTHC = /(?:THC|terminal\s+handling|local\s+charges|demurrage|detention|d\s*&\s*d)/i.test(text);
    const isUrgentKeyword = /(?:urgent|asap|immediately|closing\s+today|critical|rush|cutoff|cut-off)/i.test(text);

    return {
      blNumbers: blMatches,
      bookingNumbers: bookingMatches,
      containerCodes: containerMatches,
      ports: {
        pol: polMatch ? polMatch[1].trim() : undefined,
        pod: podMatch ? podMatch[1].trim() : undefined,
      },
      grossWeight: weightMatch ? weightMatch[1].trim() : undefined,
      invoiceReferences: invMatches,
      amounts: amountMatches,
      hasDemurrageOrTHC,
      isUrgentKeyword,
    };
  }, [textToScan]);

  // Urgency & Operational Risk Categorization
  const urgency: UrgencyAssessment = useMemo(() => {
    if (currentCase.category === "SPAM") {
      return {
        level: "LOW",
        badgeText: "Low Urgency",
        badgeBg: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700",
        title: "Quarantined / Filtered Spam",
        slaWindow: "No SLA Required",
        riskNote: "Unsolicited marketing or non-operational email; safe to archive or ignore.",
      };
    }

    if (extracted.isUrgentKeyword || extracted.hasDemurrageOrTHC) {
      return {
        level: "CRITICAL",
        badgeText: "Critical Urgency",
        badgeBg: "bg-rose-100 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800",
        title: "Imminent Risk / Demurrage Exposure",
        slaWindow: "Immediate Dispatch (< 2h SLA)",
        riskNote: extracted.hasDemurrageOrTHC
          ? "Demurrage, detention, or disputed terminal charges flagged; risk of ongoing daily penalties."
          : "Counterparty indicated urgent timeline or closing cut-off; prompt handling required to prevent delay.",
      };
    }

    if (currentCase.category === "DOCUMENT_CHASE") {
      return {
        level: "HIGH",
        badgeText: "High Urgency",
        badgeBg: "bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800",
        title: "Awaiting Draft Bill of Lading",
        slaWindow: "Standard Chaser Window (< 4h SLA)",
        riskNote: "Shipper is actively following up for the draft B/L to review terms before vessel departure.",
      };
    }

    if (currentCase.category === "INVOICE_QUERY") {
      return {
        level: "HIGH",
        badgeText: "High Urgency",
        badgeBg: "bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800",
        title: "Invoice & Charge Clarification",
        slaWindow: "Billing Reconciliation (< 8h SLA)",
        riskNote: "Customer requires breakdown or amendment before authorizing invoice settlement.",
      };
    }

    if (currentCase.category === "SI_REQUEST") {
      return {
        level: "MEDIUM",
        badgeText: "Medium Urgency",
        badgeBg: "bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300 border-sky-300 dark:border-sky-800",
        title: "Shipping Instruction Processing",
        slaWindow: "Vessel Cut-Off Window (< 12h SLA)",
        riskNote: "Shipping Instructions received for booking; queue for B/L draft generation before closing.",
      };
    }

    return {
      level: "LOW",
      badgeText: "Low Urgency",
      badgeBg: "bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800",
      title: "Routine Operational Communication",
      slaWindow: "Customer Service Window (< 24h SLA)",
      riskNote: "General operational communication without immediate financial or gate penalty.",
    };
  }, [currentCase.category, extracted]);

  // Point-Form AI Summary Generation
  const aiSummary = useMemo(() => {
    // 1. Core Executive Takeaway
    let executiveTakeaway = "";
    if (currentCase.category === "DOCUMENT_CHASE") {
      executiveTakeaway = `The sender is urgently requesting the draft Bill of Lading for review. No shipping documents are attached to this message.`;
    } else if (currentCase.category === "SI_REQUEST") {
      executiveTakeaway = `The shipper or forwarder has submitted Shipping Instructions or requested booking documentation details.`;
    } else if (currentCase.category === "INVOICE_QUERY") {
      executiveTakeaway = `Inquiry regarding invoice charges and billing breakdown; requires financial clarification prior to payment release.`;
    } else if (currentCase.category === "SPAM") {
      executiveTakeaway = `Automated notification or unsolicited non-operational email filtered from standard documentation queue.`;
    } else {
      executiveTakeaway = `General logistics communication regarding booking schedule, container status, or operational updates.`;
    }

    // 2. Point-Form Bullets
    const points: SummaryPoint[] = [];

    // Bullet 1: Inbound Intent
    let intentDetail = "";
    if (currentCase.category === "DOCUMENT_CHASE") {
      intentDetail = "Requesting expedited issuance of the draft B/L to verify shipper, consignee, and cargo particulars before final print.";
    } else if (currentCase.category === "SI_REQUEST") {
      intentDetail = "Submitting instruction particulars for cargo booking to initiate drafting of the Bill of Lading.";
    } else if (currentCase.category === "INVOICE_QUERY") {
      intentDetail = extracted.hasDemurrageOrTHC
        ? "Auditing terminal handling charges (THC) or detention/demurrage fees against contracted ocean tariff."
        : "Requesting itemized invoice breakdown and verification of billed charges.";
    } else if (currentCase.category === "SPAM") {
      intentDetail = "Non-commercial automated marketing, newsletter, or external phishing alert.";
    } else {
      intentDetail = "Operational tracking, vessel berthing advisory, or general container inquiries.";
    }
    points.push({ label: "Inbound Request", text: intentDetail });

    // Bullet 2: Logistics & Booking Context
    const refParts: string[] = [];
    if (extracted.bookingNumbers.length > 0) {
      refParts.push(`Booking: ${extracted.bookingNumbers.join(", ")}`);
    }
    if (extracted.blNumbers.length > 0) {
      refParts.push(`B/L: ${extracted.blNumbers.join(", ")}`);
    }
    if (extracted.ports.pol || extracted.ports.pod) {
      refParts.push(`Route: ${extracted.ports.pol || "Unknown POL"} → ${extracted.ports.pod || "Unknown POD"}`);
    }
    if (extracted.containerCodes.length > 0) {
      refParts.push(`Equipment: ${extracted.containerCodes.join(", ")}`);
    }
    if (extracted.invoiceReferences.length > 0) {
      refParts.push(`Invoice: ${extracted.invoiceReferences.join(", ")}`);
    }

    if (refParts.length > 0) {
      points.push({
        label: "Trade Context",
        text: refParts.join(" · "),
      });
    }

    // Bullet 3: Risk & Urgency Assessment (with prominent color-coded badge)
    points.push({
      label: "Urgency Assessment",
      text: `${urgency.riskNote} Target response window: ${urgency.slaWindow}.`,
      highlight: urgency.level === "CRITICAL" || urgency.level === "HIGH",
      urgencyBadge: {
        text: urgency.badgeText,
        classes: urgency.badgeBg,
      },
    });

    // Bullet 4: Prescriptive Next Step
    let nextStep = "";
    if (currentCase.category === "DOCUMENT_CHASE") {
      nextStep = "Generate draft Bill of Lading in carrier manifest system and reply to sender with attached draft PDF.";
    } else if (currentCase.category === "SI_REQUEST") {
      nextStep = "Extract shipping instruction details into booking database and prepare carrier draft B/L.";
    } else if (currentCase.category === "INVOICE_QUERY") {
      nextStep = "Forward charge inquiry to Accounts Payable / Billing Desk with verified booking rate confirmation.";
    } else if (currentCase.category === "SPAM") {
      nextStep = "No operational action needed. Maintain quarantine status.";
    } else {
      nextStep = "Review inquiry and provide operational status update or route to port handling specialist.";
    }
    points.push({ label: "Recommended Next Step", text: nextStep });

    return { executiveTakeaway, points };
  }, [currentCase.category, extracted, urgency]);

  const copySummaryText = () => {
    const textToCopy = `[${urgency.badgeText}] ${currentCase.subject}\n\nSummary:\n${aiSummary.executiveTakeaway}\n\nKey Points:\n${aiSummary.points
      .map((p) => `• ${p.label}: ${p.urgencyBadge ? `[${p.urgencyBadge.text}] ` : ""}${p.text}`)
      .join("\n")}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2500);
  };

  // Sender initials for avatar
  const senderInitials = useMemo(() => {
    const raw = currentCase.sender || "";
    const namePart = raw.split("<")[0].trim() || raw.split("@")[0] || "OP";
    const parts = namePart.split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return namePart.slice(0, 2).toUpperCase();
  }, [currentCase.sender]);

  return (
    <div className="space-y-4">
      {/* 1. TOP URGENCY & SLA STATUS BAR */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 px-4 rounded-xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs">
        <div className="flex items-center space-x-2.5">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold border ${urgency.badgeBg}`}
          >
            {urgency.level === "CRITICAL" ? (
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5 shrink-0" />
            ) : urgency.level === "HIGH" ? (
              <Clock className="w-3.5 h-3.5 mr-1.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 shrink-0" />
            )}
            {urgency.badgeText}
          </span>
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            {urgency.title}
          </span>
        </div>

        <div className="flex items-center space-x-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center space-x-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-medium">{urgency.slaWindow}</span>
          </div>
          <span>•</span>
          <span className="font-mono text-[11px] text-slate-400">
            Status: <strong className="text-slate-600 dark:text-slate-300">OK (No BL Comparison)</strong>
          </span>
        </div>
      </div>

      {/* 2. AI SUMMARY POINT-FORM CARD */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-indigo-50/70 via-blue-50/40 to-white dark:from-[#091b49]/90 dark:via-[#06163a] dark:to-[#040f2b] border border-indigo-200/80 dark:border-indigo-900/70 shadow-xs p-6 space-y-4">
        {/* Subtle Decorative Gradient Glow */}
        <div className="absolute -top-16 -right-16 w-48 h-48 bg-indigo-400/10 dark:bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        {/* AI Summary Header Bar */}
        <div className="flex items-center justify-between border-b border-indigo-100/80 dark:border-[#1a3d8e]/40 pb-3">
          <div className="flex items-center space-x-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white shadow-xs">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-bold tracking-wide uppercase text-indigo-900 dark:text-indigo-200">
              AI Summary
            </span>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-100/70 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/60">
              Point-Form Triage
            </span>
          </div>

          <button
            onClick={copySummaryText}
            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-white/80 dark:hover:bg-[#091f52] transition-colors border border-slate-200/60 dark:border-[#1a3d8e]/60 cursor-pointer shadow-2xs"
            title="Copy structured summary to clipboard"
          >
            {copiedSummary ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copy Summary</span>
              </>
            )}
          </button>
        </div>

        {/* Executive Takeaway */}
        <div className="pt-1">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white leading-relaxed">
            {aiSummary.executiveTakeaway}
          </h3>
        </div>

        {/* Point-Form Bullets with Color-Coded Urgency */}
        <div className="space-y-2.5 pt-1">
          {aiSummary.points.map((point, index) => (
            <div key={index} className="flex items-start space-x-3 text-xs leading-relaxed">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400 shrink-0" />
              <div className="text-slate-700 dark:text-slate-300">
                <strong className="text-slate-900 dark:text-white font-semibold mr-1.5">
                  {point.label}:
                </strong>
                {point.urgencyBadge && (
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border mr-2 align-middle ${point.urgencyBadge.classes}`}
                  >
                    {point.urgencyBadge.text}
                  </span>
                )}
                <span className={point.highlight ? "font-medium text-slate-900 dark:text-slate-100" : ""}>
                  {point.text}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 3. MODERN GMAIL-STYLE EMAIL VIEWER */}
      <div className="rounded-2xl bg-white dark:bg-[#06163a] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs overflow-hidden">
        {/* Email Header Bar */}
        <div className="p-5 border-b border-slate-100 dark:border-[#1a3d8e]/40 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
              {currentCase.subject}
            </h2>
            <button
              onClick={() => setEmailExpanded(!emailExpanded)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              title={emailExpanded ? "Collapse message" : "Expand message"}
            >
              {emailExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="flex items-center justify-between text-xs pt-1">
            <div className="flex items-center space-x-3">
              {/* Avatar circle */}
              <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800/80 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300 shrink-0">
                {senderInitials}
              </div>
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  {currentCase.sender}
                </div>
                <div className="text-[11px] text-slate-400 dark:text-slate-500">
                  To: Documentation Operations Desk &lt;docs@shipping.com&gt;
                </div>
              </div>
            </div>

            <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
              {currentCase.timestamp}
            </div>
          </div>
        </div>

        {/* Email Body Content */}
        {emailExpanded && (
          <div className="p-6 space-y-4">
            <div className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-normal whitespace-pre-wrap font-sans">
              {currentCase.body ? (
                currentCase.body
              ) : (
                <span className="italic text-slate-400">
                  (No email body text provided for this message.)
                </span>
              )}
            </div>

            {/* Email Attachments indicator if present */}
            {currentCase.fields.length === 0 && (
              <div className="pt-4 border-t border-slate-100 dark:border-[#1a3d8e]/40 flex items-center space-x-2 text-xs text-slate-400 dark:text-slate-500">
                <Paperclip className="w-3.5 h-3.5" />
                <span>No document attachments found on this email record.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
