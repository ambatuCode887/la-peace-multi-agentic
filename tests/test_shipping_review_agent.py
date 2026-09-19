from __future__ import annotations

from agents.tools.agents.shipping_review import shipping_review_manager_agent


def test_shipping_review_manager_has_inspection_and_retrieval_tools(monkeypatch) -> None:
    monkeypatch.setattr(
        "agents.tools.agents.shipping_review.agent.build_agent_model",
        lambda: "test-model",
    )

    manager = shipping_review_manager_agent()

    assert manager.name == "shipping_review_manager_agent"
    tool_names = {
        getattr(tool, "__name__", getattr(tool, "name", ""))
        for tool in manager.tools
    }
    assert {"inspect_shipping_email", "retrieve_knowledge"}.issubset(tool_names)
    assert "deterministic status" in manager.instruction
    assert "must not override deterministic comparison results" in manager.instruction
    assert "bound to the selected case directory" in manager.instruction
    assert "Never invent a data root" in manager.instruction
