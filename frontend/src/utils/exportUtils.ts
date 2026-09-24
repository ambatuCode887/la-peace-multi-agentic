import type { ShippingCase } from "../types/shipping";
import { jsPDF } from "jspdf";

/**
 * Escapes text for RFC 4180 CSV standard.
 */
function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Trigger browser download of a file buffer/string.
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export processed cases to a comprehensive operational audit CSV.
 */
export function exportCasesToCsv(
  cases: ShippingCase[],
  filter: "all" | "mismatches" | "clean" = "all"
): number {
  let targetCases = cases;
  if (filter === "mismatches") {
    targetCases = cases.filter(
      (c) => c.status === "MISMATCH" || c.status === "NEEDS_REVIEW"
    );
  } else if (filter === "clean") {
    targetCases = cases.filter((c) => c.status === "PASS");
  }

  const headers = [
    "Case ID",
    "Category",
    "Sender",
    "Subject",
    "Vessel",
    "Voyage",
    "Route (POL -> POD)",
    "Verification Status",
    "Match Fields Count",
    "Mismatch Fields Count",
    "Discrepancy Details",
    "AI Confidence Score (%)",
    "Recommended Action",
    "Manager Review Decision",
    "Review Reason / Note",
  ];

  const rows = targetCases.map((c) => {
    const matchedCount = c.fields.filter((f) => f.status === "match").length;
    const mismatchedFields = c.fields.filter((f) => f.status === "mismatch");
    const discrepancyDetails = mismatchedFields
      .map(
        (f) =>
          `[${f.label}] SI: "${f.siValue}" vs BL: "${f.blValue}"${
            f.varianceNote ? ` (${f.varianceNote})` : ""
          }`
      )
      .join(" | ");

    const polPod = c.pol && c.pod ? `${c.pol} -> ${c.pod}` : c.pol || c.pod || "N/A";
    const rawConf = c.aiAnalysis?.confidence;
    const confidence =
      rawConf !== undefined
        ? rawConf <= 1
          ? (rawConf * 100).toFixed(1)
          : rawConf.toFixed(1)
        : "N/A";

    return [
      escapeCsv(c.id),
      escapeCsv(c.category),
      escapeCsv(c.sender),
      escapeCsv(c.subject),
      escapeCsv(c.vessel || "N/A"),
      escapeCsv(c.voyageNumber || "N/A"),
      escapeCsv(polPod),
      escapeCsv(c.status),
      escapeCsv(matchedCount),
      escapeCsv(mismatchedFields.length),
      escapeCsv(discrepancyDetails || "None (All fields match)"),
      escapeCsv(confidence),
      escapeCsv(c.aiAnalysis?.recommendation || c.managerReview?.recommended_next_action || "N/A"),
      escapeCsv(c.managerReview?.reason || "N/A"),
      escapeCsv(c.statusNote || "N/A"),
    ].join(",");
  });

  // Prepend UTF-8 BOM (\uFEFF) for Excel compatibility
  const csvContent = "\uFEFF" + [headers.map(escapeCsv).join(","), ...rows].join("\r\n");
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `la_peace_sdoc_operational_audit_${filter}_${dateStr}.csv`;

  downloadFile(csvContent, filename, "text/csv;charset=utf-8;");
  return targetCases.length;
}

/**
 * Export high-level operational statistics and KPI aggregates in JSON format.
 */
export function exportOperationalMetricsJson(
  cases: ShippingCase[],
  sentCount: number
): void {
  const blCases = cases.filter((c) => c.category === "BL_COMPARISON");
  const passCases = blCases.filter((c) => c.status === "PASS");
  const mismatchCases = blCases.filter((c) => c.status === "MISMATCH");
  const reviewCases = blCases.filter((c) => c.status === "NEEDS_REVIEW");

  // Field failure frequencies
  const fieldFailures: Record<string, number> = {};
  blCases.forEach((c) => {
    c.fields.forEach((f) => {
      if (f.status === "mismatch") {
        fieldFailures[f.label] = (fieldFailures[f.label] || 0) + 1;
      }
    });
  });

  const payload = {
    report_title: "La Peace SDOC Operational Verification Audit",
    generated_at: new Date().toISOString(),
    platform: "La Peace Multi-Agent Shipping Document Verification",
    summary: {
      total_inbound_emails: cases.length,
      bl_verifications_completed: blCases.length,
      clean_match_count: passCases.length,
      discrepancy_mismatch_count: mismatchCases.length,
      needs_review_count: reviewCases.length,
      discrepancy_rate_percent: blCases.length
        ? Number(((mismatchCases.length / blCases.length) * 100).toFixed(2))
        : 0,
      clean_pass_rate_percent: blCases.length
        ? Number(((passCases.length / blCases.length) * 100).toFixed(2))
        : 0,
      dispatched_outbox_communications: sentCount,
    },
    category_distribution: {
      BL_COMPARISON: blCases.length,
      DOCUMENT_CHASE: cases.filter((c) => c.category === "DOCUMENT_CHASE").length,
      SI_REQUEST: cases.filter((c) => c.category === "SI_REQUEST").length,
      INVOICE_QUERY: cases.filter((c) => c.category === "INVOICE_QUERY").length,
      GENERAL: cases.filter((c) => c.category === "GENERAL").length,
      SPAM: cases.filter((c) => c.category === "SPAM").length,
    },
    discrepancy_hotspots: fieldFailures,
  };

  const dateStr = new Date().toISOString().slice(0, 10);
  const jsonContent = JSON.stringify(payload, null, 2);
  downloadFile(
    jsonContent,
    `la_peace_sdoc_operational_metrics_${dateStr}.json`,
    "application/json;charset=utf-8;"
  );
}

/**
 * Export carrier and vessel document compliance accuracy comparison CSV.
 */
export function exportCarrierPerformanceCsv(cases: ShippingCase[]): number {
  const blCases = cases.filter((c) => c.category === "BL_COMPARISON");
  const carrierMap: Record<
    string,
    { total: number; pass: number; mismatch: number; topFieldCounts: Record<string, number> }
  > = {};

  blCases.forEach((c) => {
    const carrier =
      c.vessel && c.vessel !== "N/A"
        ? c.vessel
        : c.sender.split("@")[1]?.replace(/\..+$/, "") || "Unspecified Carrier";

    if (!carrierMap[carrier]) {
      carrierMap[carrier] = { total: 0, pass: 0, mismatch: 0, topFieldCounts: {} };
    }
    carrierMap[carrier].total += 1;
    if (c.status === "PASS") {
      carrierMap[carrier].pass += 1;
    } else {
      carrierMap[carrier].mismatch += 1;
      c.fields.forEach((f) => {
        if (f.status === "mismatch") {
          carrierMap[carrier].topFieldCounts[f.label] =
            (carrierMap[carrier].topFieldCounts[f.label] || 0) + 1;
        }
      });
    }
  });

  const headers = [
    "Carrier / Vessel Designation",
    "Total Inbound Draft BLs",
    "Clean Auto-Approved",
    "Flagged Discrepancies",
    "Discrepancy Exception Rate (%)",
    "Top Variance Field",
  ];

  const rows = Object.entries(carrierMap).map(([carrier, data]) => {
    const errorRate = data.total ? ((data.mismatch / data.total) * 100).toFixed(1) : "0.0";
    const topField = Object.entries(data.topFieldCounts).sort((a, b) => b[1] - a[1])[0];
    const topFieldLabel = topField ? `${topField[0]} (${topField[1]}x)` : "None (Clean)";

    return [
      escapeCsv(carrier),
      escapeCsv(data.total),
      escapeCsv(data.pass),
      escapeCsv(data.mismatch),
      escapeCsv(`${errorRate}%`),
      escapeCsv(topFieldLabel),
    ].join(",");
  });

  const csvContent = "\uFEFF" + [headers.map(escapeCsv).join(","), ...rows].join("\r\n");
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadFile(
    csvContent,
    `la_peace_carrier_quality_audit_${dateStr}.csv`,
    "text/csv;charset=utf-8;"
  );
  return Object.keys(carrierMap).length;
}

/**
 * Generates an executive-grade, readable Operations Audit Report in PDF format.
 */
export function exportOperationsReportPdf(cases: ShippingCase[], sentCount: number = 0): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  let y = 14;

  const ensureSpace = (neededHeight: number) => {
    if (y + neededHeight > 275) {
      doc.addPage();
      y = 16;
    }
  };

  // 1. Executive Navy Header Banner
  doc.setFillColor(5, 36, 100);
  doc.rect(14, y, 182, 22, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text("LA PEACE SDOC  |  SHIPPING OPERATIONS REPORT", 20, y + 9);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(200, 220, 255);
  doc.text("Dual-Document Reconciliation & Carrier Discrepancy Exception Audit", 20, y + 16);

  const dateStr = new Date().toISOString().slice(0, 10);
  const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  doc.setFontSize(7.5);
  doc.setTextColor(180, 205, 245);
  doc.text(`Generated: ${dateStr} ${timeStr}`, 190, y + 16, { align: "right" });

  y += 26;

  // 2. Compute Operational Statistics
  const blCases = cases.filter((c) => c.category === "BL_COMPARISON");
  const totalBl = blCases.length;
  const passCases = blCases.filter((c) => c.status === "PASS");
  const mismatchCases = blCases.filter((c) => c.status === "MISMATCH");
  const reviewCases = blCases.filter((c) => c.status === "NEEDS_REVIEW");

  const passRate = totalBl > 0 ? ((passCases.length / totalBl) * 100).toFixed(1) : "0.0";
  const mismatchRate = totalBl > 0 ? ((mismatchCases.length / totalBl) * 100).toFixed(1) : "0.0";

  // 3. 4 Executive KPI Cards
  const cardW = 43;
  const cardH = 20;
  const cardGap = 3.3;

  const kpis = [
    { label: "INBOUND SHIPMENTS", val: `${cases.length}`, sub: `${totalBl} Draft BLs | ${cases.length - totalBl} Inquiries`, color: [5, 36, 100] },
    { label: "CLEARED FOR RELEASE", val: `${passCases.length}`, sub: `${passRate}% Clean SI match`, color: [5, 150, 105] },
    { label: "BLOCKED EXCEPTIONS", val: `${mismatchCases.length}`, sub: `${mismatchRate}% Discrepancy hold`, color: [225, 29, 72] },
    { label: "DISPATCHED EMAILS", val: `${sentCount}`, sub: "Clarifications sent", color: [52, 94, 196] },
  ];

  kpis.forEach((kpi, idx) => {
    const x = 14 + idx * (cardW + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, "FD");

    // Top color strip
    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.rect(x, y, cardW, 1.5, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, x + 3.5, y + 6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.text(kpi.val, x + 3.5, y + 13);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.text(kpi.sub, x + 3.5, y + 17.5);
  });

  y += cardH + 7;

  // 4. Document Clearance Health Summary Section
  ensureSpace(24);
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(14, y, 182, 18, 2, 2, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text("DOCUMENT CLEARANCE HEALTH & TARGET COMPLIANCE", 18, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Reconciliation Status: ${passCases.length} Clean Release Approved (${passRate}%)  |  ${mismatchCases.length} Blocked Exceptions (${mismatchRate}%)  |  ${reviewCases.length} Pending Audit`,
    18,
    y + 11
  );
  doc.text(
    "Operations Benchmark: 91.4% Target Compliance  |  Discrepancy Exception Resolution SLA: < 4 hours per carrier",
    18,
    y + 15
  );

  y += 24;

  // 5. Carrier Reliability Comparative Audit Table
  ensureSpace(40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text("CARRIER & SHIPPING LINE ACCURACY AUDIT", 14, y);
  y += 3.5;

  // Compute carrier stats
  const carrierMap: Record<
    string,
    { total: number; pass: number; mismatch: number; topFields: Record<string, number> }
  > = {};

  blCases.forEach((c) => {
    const carrier =
      c.vessel && c.vessel !== "N/A"
        ? c.vessel
        : c.sender.split("@")[1]?.replace(/\..+$/, "") || "Unspecified Carrier";

    if (!carrierMap[carrier]) {
      carrierMap[carrier] = { total: 0, pass: 0, mismatch: 0, topFields: {} };
    }
    carrierMap[carrier].total += 1;
    if (c.status === "PASS") {
      carrierMap[carrier].pass += 1;
    } else {
      carrierMap[carrier].mismatch += 1;
      c.fields.forEach((f) => {
        if (f.status === "mismatch") {
          carrierMap[carrier].topFields[f.label] = (carrierMap[carrier].topFields[f.label] || 0) + 1;
        }
      });
    }
  });

  const tableHeaders = [
    { title: "CARRIER / VESSEL", w: 55 },
    { title: "INBOUND BLS", w: 26 },
    { title: "AUTO-APPROVED", w: 28 },
    { title: "EXCEPTIONS", w: 24 },
    { title: "ERROR RATE", w: 22 },
    { title: "PRIMARY VARIANCE", w: 27 },
  ];

  // Header row
  doc.setFillColor(5, 36, 100);
  doc.rect(14, y, 182, 6.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);
  doc.setTextColor(255, 255, 255);

  let curX = 16;
  tableHeaders.forEach((th) => {
    doc.text(th.title, curX, y + 4.5);
    curX += th.w;
  });

  y += 6.5;

  // Table rows
  Object.entries(carrierMap).forEach(([carrier, data], idx) => {
    ensureSpace(6.5);
    const rowBg = idx % 2 === 0 ? 255 : 248;
    doc.setFillColor(rowBg, rowBg, rowBg);
    doc.rect(14, y, 182, 6, "F");
    doc.setDrawColor(235, 240, 245);
    doc.line(14, y + 6, 196, y + 6);

    const errorRate = data.total > 0 ? ((data.mismatch / data.total) * 100).toFixed(1) : "0.0";
    const topField = Object.entries(data.topFields).sort((a, b) => b[1] - a[1])[0];
    const topFieldLabel = topField ? `${topField[0]} (${topField[1]}x)` : "None (Clean)";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(30, 41, 59);
    doc.text(carrier.length > 28 ? `${carrier.slice(0, 26)}...` : carrier, 16, y + 4.2);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(`${data.total}`, 73, y + 4.2);
    doc.text(`${data.pass}`, 99, y + 4.2);

    doc.setTextColor(data.mismatch > 0 ? 225 : 71, data.mismatch > 0 ? 29 : 85, data.mismatch > 0 ? 72 : 105);
    doc.text(`${data.mismatch}`, 127, y + 4.2);

    doc.setFont("helvetica", "bold");
    doc.text(`${errorRate}%`, 151, y + 4.2);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 116, 139);
    doc.text(topFieldLabel.length > 18 ? `${topFieldLabel.slice(0, 16)}...` : topFieldLabel, 173, y + 4.2);

    y += 6;
  });

  y += 6;

  // 6. Operational Risk Hotspots Section
  ensureSpace(28);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text("OPERATIONAL RISK CATEGORY HOTSPOTS", 14, y);
  y += 4;

  const weightErrors = blCases.filter((c) => c.fields.some((f) => f.key === "weight" && f.status === "mismatch")).length;
  const consigneeErrors = blCases.filter((c) => c.fields.some((f) => (f.key === "consignee" || f.key === "notify_party") && f.status === "mismatch")).length;
  const routeErrors = blCases.filter((c) => c.fields.some((f) => (f.key === "pol" || f.key === "pod") && f.status === "mismatch")).length;

  const riskBlocks = [
    { title: "Customs & Weight Demurrage Risk", count: weightErrors, desc: "Gross Weight discrepancies risking port weight penalties & customs re-weighing holds." },
    { title: "Cargo Release Title Risk", count: consigneeErrors, desc: "Consignee or Notify Party variances risking legal title rejection at destination port." },
    { title: "Routing & Transshipment Delay", count: routeErrors, desc: "Port of Loading / Discharge variances causing transshipment misrouting." },
  ];

  const riskBoxW = 58;
  riskBlocks.forEach((rb, idx) => {
    const rx = 14 + idx * (riskBoxW + 4);
    doc.setFillColor(254, 242, 242);
    doc.setDrawColor(254, 205, 211);
    doc.roundedRect(rx, y, riskBoxW, 18, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(159, 18, 57);
    doc.text(rb.title, rx + 3, y + 5);

    doc.setFontSize(10);
    doc.setTextColor(225, 29, 72);
    doc.text(`${rb.count} cases flagged`, rx + 3, y + 10.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.8);
    doc.setTextColor(100, 116, 139);
    doc.text(doc.splitTextToSize(rb.desc, riskBoxW - 6), rx + 3, y + 14);
  });

  y += 23;

  // 7. Priority Blocked Exceptions Manifest (Top cases)
  ensureSpace(35);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text("PRIORITY BLOCKED EXCEPTIONS REQUIRING CARRIER CLARIFICATION", 14, y);
  y += 4;

  const topBlocked = mismatchCases.slice(0, 12);

  // Manifest table header
  doc.setFillColor(15, 23, 42);
  doc.rect(14, y, 182, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.setTextColor(255, 255, 255);
  doc.text("CASE ID", 16, y + 4.2);
  doc.text("VESSEL / LINE", 36, y + 4.2);
  doc.text("VARIANCE FIELD", 72, y + 4.2);
  doc.text("SI VALUE (SOURCE OF TRUTH)", 105, y + 4.2);
  doc.text("DRAFT BL (CARRIER)", 150, y + 4.2);

  y += 6;

  topBlocked.forEach((c, idx) => {
    ensureSpace(6);
    const bg = idx % 2 === 0 ? 255 : 249;
    doc.setFillColor(bg, bg, bg);
    doc.rect(14, y, 182, 5.5, "F");
    doc.setDrawColor(241, 245, 249);
    doc.line(14, y + 5.5, 196, y + 5.5);

    const firstMismatch = c.fields.find((f) => f.status === "mismatch") || c.fields[0];
    const vessel = c.vessel || "N/A";
    const fieldLabel = firstMismatch?.label || "General";
    const siVal = firstMismatch?.siValue || "N/A";
    const blVal = firstMismatch?.blValue || "N/A";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(5, 36, 100);
    doc.text(c.id, 16, y + 3.8);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(51, 65, 85);
    doc.text(vessel.length > 18 ? `${vessel.slice(0, 16)}...` : vessel, 36, y + 3.8);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(225, 29, 72);
    doc.text(fieldLabel.length > 16 ? `${fieldLabel.slice(0, 14)}...` : fieldLabel, 72, y + 3.8);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(71, 85, 105);
    doc.text(siVal.length > 24 ? `${siVal.slice(0, 22)}...` : siVal, 105, y + 3.8);
    doc.text(blVal.length > 24 ? `${blVal.slice(0, 22)}...` : blVal, 150, y + 3.8);

    y += 5.5;
  });

  // 8. Footer pass on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.line(14, 287, 196, 287);
    doc.text("La Peace SDOC  |  Dual-Document Shipping Verification & Operations Audit", 14, 291);
    doc.text(`Page ${p} of ${totalPages}`, 196, 291, { align: "right" });
  }

  // Save the PDF
  doc.save(`la_peace_shipping_operations_report_${dateStr}.pdf`);
}

