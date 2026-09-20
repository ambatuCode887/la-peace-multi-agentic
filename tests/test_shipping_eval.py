from agents.eval.shipping import evaluate_shipping_reports


def test_shipping_evaluation_reports_mismatch_precision_recall_and_reasons() -> None:
    ground_truth = {
        "ok": {"status": "OK", "defect_fields": [], "review_reason": None},
        "real": {"status": "MISMATCH", "defect_fields": ["gross_weight_kg"], "review_reason": None},
        "missed": {"status": "MISMATCH", "defect_fields": ["shipper"], "review_reason": None},
    }
    reports = {
        "ok": {"status": "MISMATCH", "defect_fields": ["shipper"], "review_reason": None},
        "real": {"status": "MISMATCH", "defect_fields": ["gross_weight_kg"], "review_reason": None},
        "missed": {"status": "OK", "defect_fields": [], "review_reason": None},
    }

    result = evaluate_shipping_reports(ground_truth, reports)

    assert result["mismatch"] == {
        "true_positive": 1,
        "false_positive": 1,
        "false_negative": 1,
        "precision": 0.5,
        "recall": 0.5,
    }
    assert result["disagreement_count"] == 2
    assert any(item["email_id"] == "ok" and "Expected status OK" in item["reason"] for item in result["disagreements"])