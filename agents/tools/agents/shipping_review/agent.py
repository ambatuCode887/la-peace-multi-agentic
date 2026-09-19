from __future__ import annotations

from pathlib import Path

from google.adk.agents.llm_agent import Agent

from agents.config import build_agent_model
from agents.shipping.tool import inspect_shipping_email
from agents.tools.functions.retrieve.credential_stuffing import retrieve_knowledge


_PROMPT = Path(__file__).with_name("prompt.md")


def shipping_review_manager_agent(data_root: str | Path | None = None) -> Agent:
    """Create the optional manager for difficult shipping verification cases."""
    inspection_tool = inspect_shipping_email
    if data_root is not None:
        bound_data_root = str(data_root)

        def inspect_saved_shipping_email(email_id: str) -> dict:
            """Inspect the selected saved case using its bound dataset directory."""
            return inspect_shipping_email(email_id, bound_data_root)

        inspection_tool = inspect_saved_shipping_email

    return Agent(
        model=build_agent_model(),
        name="shipping_review_manager_agent",
        description=(
            "Routes shipping verification exceptions, retrieves relevant rules, "
            "and recommends human review actions without changing the verdict."
        ),
        instruction=_PROMPT.read_text(encoding="utf-8"),
        tools=[inspection_tool, retrieve_knowledge],
        mode="chat",
    )
