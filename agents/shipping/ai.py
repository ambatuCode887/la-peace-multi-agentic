from __future__ import annotations

import json
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

        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=env("GOOGLE_MODEL", "gemini-3.5-flash"),
            contents=f"{instruction}\n\nCASE CONTEXT:\n{json.dumps(context, ensure_ascii=True)}",
        )
        text = getattr(response, "text", None)
        if not text:
            raise AIUnavailable("Gemini returned no text")
        return text
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