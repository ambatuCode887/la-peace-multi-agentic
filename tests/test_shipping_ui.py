from __future__ import annotations

from agents.shipping.api import create_app


def test_api_exposes_dashboard() -> None:
    app = create_app()
    routes = {route.path for route in app.routes}
    assert "/" in routes
    assert "/verify" in routes
    assert "/reviews/{email_id}" in routes