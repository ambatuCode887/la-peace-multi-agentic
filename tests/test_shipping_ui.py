from __future__ import annotations

from agents.shipping.api import create_app


def test_api_exposes_dashboard(tmp_path) -> None:
    app = create_app(tmp_path)
    routes = {route.path for route in app.routes}
    assert "/" in routes
    assert "/verify" in routes
    assert "/reviews/{email_id}" in routes