from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - allows lightweight syntax/smoke checks
    def load_dotenv(*_args, **_kwargs) -> bool:
        return False


PROJECT_ROOT = Path(__file__).resolve().parents[1]
AGENTS_ROOT = Path(__file__).resolve().parent


def project_env_path() -> Path | None:
    """Return the preferred project environment file, if present."""
    for candidate in (AGENTS_ROOT / ".env", PROJECT_ROOT / ".env"):
        if candidate.exists():
            return candidate
    return None


def load_environment() -> None:
    """Load project env files without overriding process-level secrets."""
    for path in (PROJECT_ROOT / ".env", AGENTS_ROOT / ".env"):
        if path.exists():
            load_dotenv(path, override=False)


def env(name: str, default: str | None = None) -> str | None:
    load_environment()
    return os.getenv(name, default)


def required_env(name: str) -> str:
    value = env(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def env_int(name: str, default: int) -> int:
    value = env(name)
    if value is None or value == "":
        return default
    return int(value)


def build_agent_model():
    provider = (env("LLM_PROVIDER", "google") or "google").lower()
    if provider == "google":
        return env("GOOGLE_MODEL", "gemini-3.5-flash")
    if provider == "ollama":
        from google.adk.models.lite_llm import LiteLlm

        model_name = env("OLLAMA_MODEL", "llama3.1")
        api_base = env("OLLAMA_BASE_URL", "http://localhost:11434")
        return LiteLlm(model=f"ollama_chat/{model_name}", api_base=api_base)
    raise RuntimeError(
        f"Unsupported LLM_PROVIDER '{provider}'. Use 'google' or 'ollama'."
    )


def truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def missing(names: Iterable[str]) -> list[str]:
    return [name for name in names if not env(name)]
