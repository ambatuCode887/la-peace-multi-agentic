import { useState } from "react";
import type { BackendReport } from "../../services/api";
import type { ShippingCase } from "../../types/shipping";
import { api } from "../../services/api";
import {
  FileUp,
  Inbox,
  RefreshCw,
  RotateCcw,
  Trash2,
  Loader2,
  ArrowLeft,
  Info,
} from "lucide-react";

interface OperationsPanelProps {
  backendConnected: boolean;
  currentCase?: ShippingCase;
  onVerified: (report: BackendReport) => void;
  onProcessInbox: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onRetry: (emailId: string) => Promise<void>;
  onDelete: (emailId: string) => Promise<void>;
  onExit?: () => void;
}

export function OperationsPanel({
  backendConnected,
  currentCase,
  onVerified,
  onProcessInbox,
  onRefresh,
  onRetry,
  onDelete,
  onExit,
}: OperationsPanelProps) {
  const [emailId, setEmailId] = useState("");
  const [sender, setSender] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: string, callback: () => Promise<void>) => {
    setBusy(action);
    setMessage(null);
    try {
      await callback();
      setMessage(
        action === "upload"
          ? "Verification completed and added to the live inbox."
          : "Operation completed.",
      );
      if (action === "upload") {
        setEmailId("");
        setSender("");
        setSubject("");
        setBody("");
        setAttachments([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Operation failed.");
    } finally {
      setBusy(null);
    }
  };

  const handleProcessInboxAction = () => {
    if (backendConnected) {
      void run("process", onProcessInbox);
    } else {
      void run("process", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setMessage(
          "Live Mailbox Scan Demo: Successfully polled incoming enterprise mailbox. Scanned 520 shipment messages and synchronized multi-agent verification queue.",
        );
      });
    }
  };

  const handleRefreshAction = () => {
    if (backendConnected) {
      void run("refresh", onRefresh);
    } else {
      void run("refresh", async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        setMessage(
          "Queue Refreshed: Displaying all 520 verified operational shipment records.",
        );
      });
    }
  };

  const submitUpload = () => {
    if (!emailId.trim() || !subject.trim() || attachments.length === 0) {
      setMessage(
        "Email ID, subject, and at least one attachment are required.",
      );
      return;
    }
    void run("upload", async () => {
      const report = await api.verifyUpload({
        emailId: emailId.trim(),
        sender: sender.trim(),
        subject: subject.trim(),
        body,
        attachments,
      });
      onVerified(report);
    });
  };

  return (
    <section className="mb-6 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-[#1a3d8e]/60 dark:bg-[#06163a]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#345ec4] dark:text-[#8ea9f7]">
            Operations
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Process shipping documents
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Upload shipping document packages for automated verification or trigger inbox batch synchronization.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleRefreshAction}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-[#1a3d8e]/60 dark:text-slate-200 dark:hover:bg-[#091f52] cursor-pointer"
          >
            {busy === "refresh" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}{" "}
            Refresh inbox
          </button>
          <button
            type="button"
            onClick={handleProcessInboxAction}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1a3d8e] px-3 py-2 text-xs font-semibold text-white hover:bg-[#345ec4] disabled:opacity-50 cursor-pointer shadow-xs"
          >
            {busy === "process" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Inbox className="h-3.5 w-3.5" />
            )}{" "}
            Process inbox
          </button>
          {currentCase && (
            <>
              <button
                type="button"
                onClick={() => void run("retry", () => onRetry(currentCase.id))}
                disabled={!backendConnected || busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-900/60 dark:text-amber-200 dark:hover:bg-amber-950/40"
              >
                {busy === "retry" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}{" "}
                Retry selected
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete case ${currentCase.id}?`))
                    void run("delete", () => onDelete(currentCase.id));
                }}
                disabled={!backendConnected || busy !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete selected
              </button>
            </>
          )}
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-[#1a3d8e] bg-slate-50 dark:bg-[#091f52] px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#0c2a72] transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Verification
            </button>
          )}
        </div>
      </div>

      {/* Friendly Operational Architecture Notice */}
      {!backendConnected && (
        <div className="mt-4 rounded-xl border border-blue-200/80 bg-blue-50/70 dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/40 p-3.5 text-xs text-blue-900 dark:text-blue-200 animate-in fade-in">
          <div className="flex items-start gap-2.5">
            <Info className="h-4 w-4 shrink-0 text-[#345ec4] dark:text-[#5a82e2] mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold text-slate-900 dark:text-white">
                Live Mailbox Ingestion Architecture (Demo Simulation Mode)
              </p>
              <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                In production deployment, this system continuously connects to live enterprise email servers (IMAP / Docker Mailbox), automatically ingesting incoming shipping correspondence, parsing MIME attachments, and triggering the multi-agent OCR verification pipeline.
              </p>
              <p className="text-[11px] font-medium text-[#345ec4] dark:text-[#8ea9f7]">
                💡 Click <strong>"Process inbox"</strong> above to demo the live mailbox scanning and triage sequence.
              </p>
            </div>
          </div>
        </div>
      )}

      <form
        className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitUpload();
        }}
      >
        <input
          value={emailId}
          onChange={(event) => setEmailId(event.target.value)}
          placeholder="Case ID (e.g. upload_001)"
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#345ec4] dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/40 dark:text-white"
        />
        <input
          value={sender}
          onChange={(event) => setSender(event.target.value)}
          placeholder="Sender email (e.g. docs@shipper.com)"
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#345ec4] dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/40 dark:text-white"
        />
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="Email Subject / Vessel Details (required)"
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#345ec4] dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/40 dark:text-white"
        />
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-[#1a3d8e]/70 dark:bg-[#091f52]/40 dark:text-slate-300">
          <FileUp className="h-4 w-4 text-[#345ec4]" />
          <span className="truncate">
            {attachments.length
              ? `${attachments.length} attachment(s) selected`
              : "Select SI / BL attachments"}
          </span>
          <input
            type="file"
            multiple
            accept=".txt,.pdf,.docx,.xlsx"
            className="hidden"
            onChange={(event) =>
              setAttachments(Array.from(event.target.files || []))
            }
          />
        </label>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Email body"
          rows={2}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-[#345ec4] dark:border-[#1a3d8e]/60 dark:bg-[#091f52]/40 dark:text-white md:col-span-2"
        />
        <button
          type="submit"
          disabled={!backendConnected || busy !== null}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#345ec4] px-3 py-2 text-xs font-bold text-[#1a3d8e] hover:bg-[#eef3fc] disabled:opacity-50 dark:text-[#8ea9f7] dark:hover:bg-[#091f52] md:col-span-2"
        >
          {busy === "upload" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileUp className="h-3.5 w-3.5" />
          )}{" "}
          Verify uploaded documents
        </button>
      </form>
      {message && (
        <div className="mt-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 p-3 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2 font-medium animate-in fade-in">
          <Info className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{message}</span>
        </div>
      )}
    </section>
  );
}
