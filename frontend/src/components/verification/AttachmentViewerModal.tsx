import React, { useEffect, useState } from "react";
import {
  X,
  Download,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  FileCode,
  Loader2,
  AlertCircle,
} from "lucide-react";

export interface OriginalAttachment {
  filename: string;
  url: string;
  ext: string;
}

interface AttachmentViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  attachment: OriginalAttachment | null;
}

export const AttachmentViewerModal: React.FC<AttachmentViewerModalProps> = ({
  isOpen,
  onClose,
  attachment,
}) => {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  // If text file, fetch the original content from the backend
  useEffect(() => {
    if (!isOpen || !attachment) {
      setTextContent(null);
      setError(null);
      return;
    }

    const isText = ["txt", "json", "csv", "md", "log"].includes(
      attachment.ext.toLowerCase(),
    );
    if (isText) {
      setLoading(true);
      setError(null);
      fetch(attachment.url)
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`Failed to load file (${res.statusText})`);
          }
          return res.text();
        })
        .then((text) => {
          setTextContent(text);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Failed to load file content.");
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setTextContent(null);
    }
  }, [isOpen, attachment]);

  if (!isOpen || !attachment) return null;

  const getFileIcon = () => {
    switch (attachment.ext.toLowerCase()) {
      case "pdf":
        return <FileText className="w-5 h-5 text-rose-600 dark:text-rose-400" />;
      case "xlsx":
      case "xls":
        return <FileSpreadsheet className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />;
      default:
        return <FileCode className="w-5 h-5 text-blue-600 dark:text-blue-400" />;
    }
  };

  const isPdf = attachment.ext.toLowerCase() === "pdf";
  const isExcel = ["xlsx", "xls"].includes(attachment.ext.toLowerCase());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-[#07173e] border border-slate-200/90 dark:border-[#1a3d8e] shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-attachment-title"
      >
        {/* Top Header Bar */}
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-[#1a3d8e]/60 flex items-center justify-between bg-slate-50/90 dark:bg-[#051438] shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="p-2 rounded-xl bg-white dark:bg-[#091f52] border border-slate-200/80 dark:border-[#1a3d8e]/60 shadow-xs shrink-0">
              {getFileIcon()}
            </div>
            <div className="min-w-0">
              <h3
                id="modal-attachment-title"
                className="text-sm font-bold text-slate-900 dark:text-white truncate"
              >
                {attachment.filename}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 uppercase font-mono">
                Original Attachment Source ({attachment.ext.toUpperCase()})
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <a
              href={attachment.url}
              download={attachment.filename}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#091f52] border border-slate-200 dark:border-[#1a3d8e]/80 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#0f2e7a] transition-colors shadow-xs"
              title="Download original file"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </a>
            <a
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#091f52] text-xs transition-colors"
              title="Open in new browser tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Open</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#091f52] transition-colors cursor-pointer"
              title="Close viewer (Esc)"
              aria-label="Close viewer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body Canvas */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100 dark:bg-[#040e29]">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500 dark:text-slate-400 space-y-3">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-600 dark:text-indigo-400" />
              <p className="text-xs">Loading original attachment content...</p>
            </div>
          )}

          {error && (
            <div className="max-w-lg mx-auto p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-start space-x-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
              <div>
                <p className="font-semibold">Unable to load preview</p>
                <p className="mt-0.5">{error}</p>
                <a
                  href={attachment.url}
                  download={attachment.filename}
                  className="mt-2 inline-flex items-center space-x-1 text-xs font-bold text-rose-800 dark:text-rose-200 underline"
                >
                  <Download className="w-3 h-3" />
                  <span>Download file directly</span>
                </a>
              </div>
            </div>
          )}

          {/* Text / Markdown / CSV Preview */}
          {!loading && !error && textContent !== null && (
            <div className="max-w-3xl mx-auto rounded-xl bg-white dark:bg-[#0b1f4d] border border-slate-200 dark:border-[#1a3d8e]/60 p-5 shadow-xs">
              <pre className="text-xs font-mono text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed overflow-x-auto">
                {textContent}
              </pre>
            </div>
          )}

          {/* PDF Viewer (Native Browser Embed) */}
          {!loading && !error && isPdf && (
            <div className="w-full h-[70vh] rounded-xl overflow-hidden bg-white shadow-md border border-slate-200 dark:border-[#1a3d8e]/60">
              <iframe
                src={attachment.url}
                title={attachment.filename}
                className="w-full h-full border-0"
              />
            </div>
          )}

          {/* Excel / Binary File Info & Download Card */}
          {!loading && !error && isExcel && (
            <div className="max-w-md mx-auto my-12 p-8 rounded-2xl bg-white dark:bg-[#0b1f4d] border border-slate-200 dark:border-[#1a3d8e]/60 text-center shadow-lg space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shadow-sm">
                <FileSpreadsheet className="w-8 h-8" />
              </div>
              <div>
                <h4 className="text-base font-bold text-slate-900 dark:text-white">
                  {attachment.filename}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Microsoft Excel Spreadsheet (.xlsx)
                </p>
              </div>
              <div className="pt-2">
                <a
                  href={attachment.url}
                  download={attachment.filename}
                  className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/25 transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Spreadsheet</span>
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
