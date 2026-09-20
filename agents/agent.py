from __future__ import annotations

from google.adk.agents.llm_agent import Agent

from agents.config import build_agent_model, load_environment
from agents.tools.agents.retrieval.agent import retrieval_agent
from agents.tools.agents.shipping_review.agent import shipping_review_manager_agent
from agents.tools.agents.shipping_actions.agent import shipping_actions_agent
from agents.tools.functions.ingest.documents import ingest_file_to_qdrant
from agents.tools.functions.retrieve.credential_stuffing import retrieve_knowledge
from agents.shipping.tool import inspect_shipping_email, run_shipping_verification

load_environment()

root_agent = Agent(
    model=build_agent_model(),
    name="root_agent",
    description="Multi-agent assistant for shipping verification and Qdrant-backed guidance.",
    instruction=(
        "You coordinate a shipping verification workflow. Use ingestion tools to add "
        "documents to Qdrant and retrieval tools to ground answers. For the shipping "
        "inbox challenge, use run_shipping_verification to generate the "
        "deterministic submission before explaining results. For a "
        "specific email ID, use inspect_shipping_email instead of retrieval_agent. "
        "For difficult shipping exceptions involving mismatches, missing values, "
        "unreadable documents, or uncertain evidence, delegate to "
        "shipping_review_manager_agent. For requests to draft a correction "
        "email, preview a false alarm, or request a targeted re-read, delegate "
        "to shipping_actions_agent. Its output is proposal-only and requires "
        "explicit human confirmation before persistence."
    ),
    tools=[
        ingest_file_to_qdrant,
        retrieve_knowledge,
        run_shipping_verification,
        inspect_shipping_email,
    ],
    sub_agents=[
        retrieval_agent(),
        shipping_review_manager_agent(),
        shipping_actions_agent(),
    ],
)
