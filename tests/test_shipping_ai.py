from __future__ import annotations

from agents.shipping.ai import AIUnavailable, analyze_shipping_case


def test_ai_analysis_requires_configuration(monkeypatch) -> None:
    monkeypatch.setattr("agents.shipping.ai.env", lambda name, default=None: None)
    try:
        analyze_shipping_case({"email_id": "email_001", "status": "OK"})
    except AIUnavailable as error:
        assert "GOOGLE_API_KEY" in str(error)
    else:
        raise AssertionError("Expected missing API key to disable AI")