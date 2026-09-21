from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone
from typing import Any

import fitz

EXPORT_FIELDS = (
    "email_id",
    "export_timestamp",
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
    "attachment_filename",
    "verification_status",
)


def export_rows(reports: list[dict[str, Any]]) -> list[dict[str, Any]]:
    exported_at = datetime.now(timezone.utc).isoformat()
    rows = []
    for report in reports:
        documents = report.get("documents") or {}
        si = documents.get("si") or {}
        bl = documents.get("bl") or {}
        fields = bl.get("fields") or si.get("fields") or {}
        rows.append({
            "email_id": report.get("email_id", ""),
            "export_timestamp": exported_at,
            "shipper": fields.get("shipper", ""),
            "consignee": fields.get("consignee", ""),
            "notify_party": fields.get("notify_party", ""),
            "port_of_loading": fields.get("port_of_loading", ""),
            "port_of_discharge": fields.get("port_of_discharge", ""),
            "container_count": fields.get("container_count", ""),
            "gross_weight_kg": fields.get("gross_weight_kg", ""),
            "attachment_filename": bl.get("attachment") or "",
            "verification_status": report.get("status", ""),
        })
    return rows


def render_export(reports: list[dict[str, Any]], export_format: str) -> tuple[bytes, str, str]:
    rows = export_rows(reports)
    if export_format == "json":
        return (
            json.dumps({"generated_at": rows[0]["export_timestamp"], "draft_bls": rows}, indent=2).encode("utf-8"),
            "application/json",
            "json",
        )
    if export_format == "csv":
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=EXPORT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
        return output.getvalue().encode("utf-8-sig"), "text/csv", "csv"
    if export_format == "pdf":
        document = fitz.open()
        for row in rows:
            page = document.new_page()
            text = "Draft Bill of Lading\n\n" + "\n".join(
                f"{field.replace('_', ' ').title()}: {row[field]}" for field in EXPORT_FIELDS
            )
            page.insert_textbox(fitz.Rect(54, 54, 540, 760), text, fontsize=11, lineheight=1.5)
        content = document.tobytes()
        document.close()
        return content, "application/pdf", "pdf"
    raise ValueError("format must be csv, json, or pdf")