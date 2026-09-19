from __future__ import annotations

from pathlib import Path

from google.adk.agents.llm_agent import Agent

from agents.config import build_agent_model
from agents.shipping.actions import (
    draft_correction_email,
    preview_false_alarm,
    preview_targeted_reread,
)


_PROMPT = Path(__file__).with_name("prompt.md")


def shipping_actions_agent() -> Agent:
    """Create the proposal-only workflow-actions specialist."""
    return Agent(
        model=build_agent_model(),
        name="shipping_actions_agent",
        description="Prepares confirmed shipping review actions without persisting them.",
        instruction=_PROMPT.read_text(encoding="utf-8"),
        tools=[draft_correction_email, preview_false_alarm, preview_targeted_reread],
        mode="chat",
    )
