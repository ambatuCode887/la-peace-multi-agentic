from __future__ import annotations

from google.adk.agents.llm_agent import Agent

from agents.config import build_agent_model, csv_env, env, load_environment
from agents.tools.agents.confluence_publisher.agent import confluence_publisher_agent
from agents.tools.agents.confluence_summary.agent import confluence_summary_agent
from agents.tools.agents.retrieval.agent import retrieval_agent
from agents.tools.agents.shipping_review.agent import shipping_review_manager_agent
from agents.tools.agents.shipping_actions.agent import shipping_actions_agent
from agents.tools.functions.ingest.documents import ingest_file_to_qdrant
from agents.tools.functions.publish.prepare import prepare_confluence_page
from agents.tools.functions.publish.result import publish_confluence_page
from agents.tools.functions.retrieve.credential_stuffing import retrieve_knowledge
from agents.shipping.tool import inspect_shipping_email, run_shipping_verification
from pathlib import Path

load_environment()

def _optional_mcp_tools():
    """Attach Confluence MCP tools when env config is present."""
    mcp_url = env("CONFLUENCE_MCP_URL")
    mcp_command = env("CONFLUENCE_MCP_COMMAND")
    if not mcp_url and not mcp_command:
        return []

    from mcp import StdioServerParameters

    from google.adk.tools.mcp_tool.mcp_session_manager import (
        StdioConnectionParams,
        StreamableHTTPConnectionParams,
    )
    from google.adk.tools.mcp_tool.mcp_toolset import McpToolset

    if mcp_url:
        return [
            McpToolset(
                connection_params=StreamableHTTPConnectionParams(url=mcp_url),
                tool_name_prefix="mcp_confluence",
            )
        ]

    return [
        McpToolset(
            connection_params=StdioConnectionParams(
                server_params=StdioServerParameters(
                    command=mcp_command,
                    args=csv_env("CONFLUENCE_MCP_ARGS"),
                )
            ),
            tool_name_prefix="mcp_confluence",
        )
    ]


root_agent = Agent(
    model=build_agent_model(),
    name="root_agent",
    description="Multi-agent assistant with shipping verification, Qdrant retrieval, and Confluence publishing.",
    instruction=(
        "You coordinate a multi-agent RAG workflow. Use ingestion tools to add "
        "documents to Qdrant, retrieval tools to ground answers, summary agents "
        "to prepare Confluence-ready Markdown, and publisher tools only after "
        "running a dry run unless the user explicitly asks to publish. For the "
        "shipping inbox challenge, use run_shipping_verification to generate the "
        "deterministic submission before explaining or publishing results. For a "
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
        prepare_confluence_page,
        publish_confluence_page,
        *_optional_mcp_tools(),
    ],
    sub_agents=[
        retrieval_agent(),
        shipping_review_manager_agent(),
        shipping_actions_agent(),
        confluence_summary_agent(),
        confluence_publisher_agent(),
    ],
)
