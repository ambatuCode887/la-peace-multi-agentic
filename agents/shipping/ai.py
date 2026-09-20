from __future__ import annotations

import json
import re
from typing import Any

from agents.config import env


class AIUnavailable(RuntimeError):
    """Raised when the configured AI provider is unavailable."""


def _ask_gemini(instruction: str, context: dict[str, Any]) -> str:
    api_key = env("GOOGLE_API_KEY")
    if not api_key:
        raise AIUnavailable("GOOGLE_API_KEY is not configured")
    try:
        from google import genai

        from google.genai import types

        # Without a timeout a slow Gemini reply can hang the request for minutes.
        client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=20_000))
        preferred = env("GOOGLE_MODEL", "gemini-3.1-flash-lite")
        candidates = [preferred, "gemini-3.1-flash-lite", "gemini-3-flash-preview"]
        seen = set()
        last_err = None
        for model in candidates:
            if model in seen:
                continue
            seen.add(model)
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=f"{instruction}\n\nCASE CONTEXT:\n{json.dumps(context, ensure_ascii=True)}",
                )
                text = getattr(response, "text", None)
                if text:
                    return text
            except Exception as error:
                last_err = error
                continue
        raise AIUnavailable(f"Gemini request failed: {last_err}")
    except AIUnavailable:
        raise
    except Exception as error:
        raise AIUnavailable(f"Gemini request failed: {error}") from error


def _ask_ollama(instruction: str, context: dict[str, Any]) -> str:
    model = env("OLLAMA_MODEL", "qwen2.5:3b")
    base_url = (env("OLLAMA_BASE_URL", "http://localhost:11434") or "http://localhost:11434").rstrip("/")
    payload = {
        "model": model,
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": f"{instruction}\n\nCASE CONTEXT:\n{json.dumps(context, ensure_ascii=True)}",
            }
        ],
    }
    try:
        import httpx

        response = httpx.post(f"{base_url}/api/chat", json=payload, timeout=120.0)
        response.raise_for_status()
        text = response.json().get("message", {}).get("content")
        if not text:
            raise AIUnavailable("Ollama returned no text")
        return text
    except AIUnavailable:
        raise
    except Exception as error:
        raise AIUnavailable(
            f"Ollama request failed for model '{model}': {error}. "
            "Check that Ollama is running and the model is available."
        ) from error


def _ask(instruction: str, context: dict[str, Any]) -> tuple[str, str]:
    provider = (env("LLM_PROVIDER", "google") or "google").lower()
    if provider == "ollama":
        return _ask_ollama(instruction, context), "ollama"
    if provider == "google":
        return _ask_gemini(instruction, context), "google-gemini"
    raise AIUnavailable(f"Unsupported LLM_PROVIDER '{provider}'")


def analyze_shipping_case(report: dict[str, Any]) -> dict[str, Any]:
    """Ask Gemini to explain a case without allowing it to change the verdict."""
    instruction = (
        "You are a shipping document review agent. Explain the deterministic "
        "verification result clearly. Identify the category, mismatches, and "
        "whether human review is needed. Never invent values. Return concise "
        "JSON with keys summary, recommended_action, confidence."
    )
    text, provider = _ask(instruction, report)
    return {"text": text, "provider": provider}


def verify_shipping_discrepancies(report: dict[str, Any]) -> dict[str, Any]:
    """Critique deterministic mismatches without changing the verification result."""
    documents = report.get("documents", {})
    si = documents.get("si", {})
    bl = documents.get("bl", {})
    disputes = [
        {
            "field": field,
            "si_value": si.get("fields", {}).get(field),
            "bl_value": bl.get("fields", {}).get(field),
            "si_evidence": si.get("evidence", {}).get(field),
            "bl_evidence": bl.get("evidence", {}).get(field),
            "si_confidence": si.get("confidence", {}).get(field),
            "bl_confidence": bl.get("confidence", {}).get(field),
        }
        for field in report.get("defect_fields", [])
    ]
    if not disputes:
        return {"available": False, "reason": "No deterministic discrepancies to verify."}

    instruction = (
        "You are an independent shipping-document verifier. Review only the "
        "disputed fields and their extraction evidence supplied in the context. "
        "You cannot change the deterministic status or values. For every field, "
        "return exactly one ruling: CONFIRMED_DISCREPANCY, "
        "FORMATTING_OR_NORMALIZATION_ISSUE, or UNCERTAIN_REQUIRES_HUMAN. "
        "Use UNCERTAIN_REQUIRES_HUMAN whenever the evidence is insufficient. "
        "Return JSON only: {\"rulings\":[{\"field\":string,\"ruling\":string,"
        "\"reason\":string}]}. Include every disputed field once."
    )
    text, provider = _ask(instruction, {"disputes": disputes})
    response = _parse_verifier_json(text)
    if response is None:
        raise AIUnavailable("The verifier returned invalid JSON")

    allowed_rulings = {
        "CONFIRMED_DISCREPANCY",
        "FORMATTING_OR_NORMALIZATION_ISSUE",
        "UNCERTAIN_REQUIRES_HUMAN",
    }
    rulings = _verifier_rulings(response)
    if not isinstance(rulings, list):
        raise AIUnavailable("The verifier response did not contain rulings")
    expected_fields = {item["field"] for item in disputes}
    verified_by_field: dict[str, dict[str, str]] = {}
    for item in rulings:
        if not isinstance(item, dict):
            continue
        field = item.get("field")
        ruling = _normalize_verifier_ruling(item.get("ruling", item.get("verdict", item.get("decision"))))
        reason = item.get("reason")
        if field in expected_fields and field not in verified_by_field and ruling in allowed_rulings and isinstance(reason, str):
            verified_by_field[field] = {"field": field, "ruling": ruling, "reason": reason}
    for field in expected_fields - verified_by_field.keys():
        verified_by_field[field] = {
            "field": field,
            "ruling": "UNCERTAIN_REQUIRES_HUMAN",
            "reason": "The verifier did not provide a valid ruling for this disputed field.",
        }
    evidence = {item["field"]: item for item in disputes}
    partial = len(verified_by_field) != len(rulings) or any(
        item["reason"] == "The verifier did not provide a valid ruling for this disputed field."
        for item in verified_by_field.values()
    )
    return {
        "available": True,
        "provider": provider,
        "partial": partial,
        "rulings": [
            {**verified_by_field[field], **evidence[field]}
            for field in expected_fields
        ],
    }


def _parse_verifier_json(text: str) -> dict[str, Any] | None:
    """Parse JSON even when a model wraps it in markdown or short prose."""
    raw = text.strip()
    candidates = [raw]
    if "```" in raw:
        candidates.extend(
            block.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
            for block in raw.split("```")[1::2]
        )
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        candidates.append(raw[start : end + 1])
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    return None


def _verifier_rulings(response: dict[str, Any]) -> list[Any] | None:
    """Accept harmless naming variations from providers while keeping validation strict."""
    for key in ("rulings", "verdicts", "results", "reviews"):
        value = response.get(key)
        if isinstance(value, list):
            return value
    return None


def _normalize_verifier_ruling(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = re.sub(r"[^a-z]+", "_", value.lower()).strip("_")
    aliases = {
        "confirmed_discrepancy": "CONFIRMED_DISCREPANCY",
        "real_discrepancy": "CONFIRMED_DISCREPANCY",
        "mismatch": "CONFIRMED_DISCREPANCY",
        "formatting_or_normalization_issue": "FORMATTING_OR_NORMALIZATION_ISSUE",
        "formatting_issue": "FORMATTING_OR_NORMALIZATION_ISSUE",
        "normalization_issue": "FORMATTING_OR_NORMALIZATION_ISSUE",
        "uncertain_requires_human": "UNCERTAIN_REQUIRES_HUMAN",
        "uncertain": "UNCERTAIN_REQUIRES_HUMAN",
        "human_review": "UNCERTAIN_REQUIRES_HUMAN",
    }
    return aliases.get(normalized)


def chat_about_shipping_case(
    report: dict[str, Any], message: str, history: list[dict[str, str]] | None = None
) -> dict[str, Any]:
    """Answer a user's question using only the saved verification report."""
    instruction = (
        "You are a shipping verification assistant. Answer the user's question "
        "using only the supplied case context. Explain SI and BL values clearly. "
        "Do not change the deterministic status or claim a mismatch not present "
        "in the context. If evidence is insufficient, say human review is needed. "
        f"PREVIOUS CONVERSATION:\n{json.dumps(history or [], ensure_ascii=True)}\n\n"
        f"USER QUESTION: {message}"
    )
    text, provider = _ask(instruction, report)
    return {"answer": text, "provider": provider}


