from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


def load_ground_truth(path: str | Path) -> dict[str, dict[str, Any]]:
    reference_path = Path(path).expanduser()
    if not reference_path.is_file():
        raise FileNotFoundError(f"Ground truth file not found: {reference_path}")
    payload = json.loads(reference_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Ground truth must be a JSON object keyed by email ID")
    return {
        str(email_id): record
        for email_id, record in payload.items()
        if isinstance(record, dict)
    }


def evaluate_shipping_reports(
    ground_truth: dict[str, dict[str, Any]],
    reports: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    confusion: dict[str, dict[str, int]] = {}
    true_positive = false_positive = false_negative = 0

    for email_id, expected in ground_truth.items():
        actual = reports.get(email_id)
        expected_status = str(expected.get("status") or "UNPROCESSED")
        actual_status = str((actual or {}).get("status") or "UNPROCESSED")
        confusion.setdefault(expected_status, {})[actual_status] = (
            confusion.setdefault(expected_status, {}).get(actual_status, 0) + 1
        )

        expected_mismatch = expected_status == "MISMATCH"
        actual_mismatch = actual_status == "MISMATCH"
        if expected_mismatch and actual_mismatch:
            true_positive += 1
        elif not expected_mismatch and actual_mismatch:
            false_positive += 1
        elif expected_mismatch and not actual_mismatch:
            false_negative += 1

        if expected_status != actual_status or not actual:
            cases.append(_disagreement(email_id, expected, actual))

    precision = _ratio(true_positive, true_positive + false_positive)
    recall = _ratio(true_positive, true_positive + false_negative)
    evaluated = len(ground_truth)
    matched = evaluated - len(cases)
    status_counts = _counts(ground_truth, reports, lambda record: record.get("status"))

    return {
        "evaluated": evaluated,
        "available_reports": sum(email_id in reports for email_id in ground_truth),
        "matched": matched,
        "disagreement_count": len(cases),
        "status_counts": status_counts,
        "confusion": confusion,
        "mismatch": {
            "true_positive": true_positive,
            "false_positive": false_positive,
            "false_negative": false_negative,
            "precision": precision,
            "recall": recall,
        },
        "disagreements": cases,
    }


def load_reports(root: str | Path) -> dict[str, dict[str, Any]]:
    reports: dict[str, dict[str, Any]] = {}
    reports_root = Path(root).expanduser()
    if not reports_root.is_dir():
        return reports
    for report_path in reports_root.glob("*/report.json"):
        try:
            report = json.loads(report_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(report, dict):
            email_id = str(report.get("email_id") or report_path.parent.name)
            reports[email_id] = report
    return reports


def read_snapshots(path: str | Path) -> list[dict[str, Any]]:
    snapshot_path = Path(path)
    if not snapshot_path.is_file():
        return []
    try:
        payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return payload if isinstance(payload, list) else []


def append_snapshot(
    path: str | Path,
    label: str,
    evaluation: dict[str, Any],
) -> dict[str, Any]:
    snapshot = {
        "label": label.strip() or "Evaluation run",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "evaluated": evaluation["evaluated"],
        "disagreement_count": evaluation["disagreement_count"],
        "false_positives": evaluation["mismatch"]["false_positive"],
        "false_negatives": evaluation["mismatch"]["false_negative"],
        "precision": evaluation["mismatch"]["precision"],
        "recall": evaluation["mismatch"]["recall"],
    }
    snapshots = read_snapshots(path)
    snapshots.append(snapshot)
    snapshot_path = Path(path)
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_text(json.dumps(snapshots, indent=2) + "\n", encoding="utf-8")
    return snapshot


def _disagreement(
    email_id: str,
    expected: dict[str, Any],
    actual: dict[str, Any] | None,
) -> dict[str, Any]:
    expected_fields = sorted(expected.get("defect_fields") or [])
    actual_fields = sorted((actual or {}).get("defect_fields") or [])
    expected_status = expected.get("status") or "UNPROCESSED"
    actual_status = (actual or {}).get("status") or "UNPROCESSED"
    reasons: list[str] = []
    if actual is None:
        reasons.append("No processed report was found")
    elif expected_status != actual_status:
        reasons.append(f"Expected status {expected_status}, got {actual_status}")
    if expected_fields != actual_fields:
        reasons.append(f"Expected defect fields {expected_fields or 'none'}, got {actual_fields or 'none'}")
    if expected.get("review_reason") != (actual or {}).get("review_reason"):
        reasons.append(
            f"Expected review reason {expected.get('review_reason') or 'none'}, "
            f"got {(actual or {}).get('review_reason') or 'none'}"
        )
    return {
        "email_id": email_id,
        "expected": {
            "category": expected.get("category"),
            "status": expected_status,
            "review_reason": expected.get("review_reason"),
            "defect_fields": expected_fields,
        },
        "actual": None if actual is None else {
            "category": actual.get("category"),
            "status": actual_status,
            "review_reason": actual.get("review_reason"),
            "defect_fields": actual_fields,
        },
        "reason": "; ".join(reasons),
    }


def _counts(
    ground_truth: dict[str, dict[str, Any]],
    reports: dict[str, dict[str, Any]],
    selector: Callable[[dict[str, Any]], Any],
) -> dict[str, dict[str, int]]:
    counts = {"reference": {}, "actual": {}}
    for email_id, expected in ground_truth.items():
        expected_value = str(selector(expected) or "UNPROCESSED")
        actual_value = str(selector(reports.get(email_id, {})) or "UNPROCESSED")
        counts["reference"][expected_value] = counts["reference"].get(expected_value, 0) + 1
        counts["actual"][actual_value] = counts["actual"].get(actual_value, 0) + 1
    return counts


def _ratio(numerator: int, denominator: int) -> float:
    return round(numerator / denominator, 4) if denominator else 0.0