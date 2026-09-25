from __future__ import annotations

import smtplib
from email.message import EmailMessage

import pytest
from fastapi.testclient import TestClient

from agents.shipping import api as shipping_api
from agents.shipping.api import create_app
from agents.shipping.email_delivery import (
    EmailDeliveryConfigurationError,
    deliver_email,
)


class FakeSMTP:
    message: EmailMessage | None = None
    connection_args: tuple[object, ...] = ()
    authenticated_as: tuple[str, str] | None = None
    starttls_used = False

    def __init__(self, *args: object, **_kwargs: object) -> None:
        self.connection_args = args
        FakeSMTP.connection_args = args

    def __enter__(self) -> FakeSMTP:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def ehlo(self) -> None:
        return None

    def starttls(self, **_kwargs: object) -> None:
        FakeSMTP.starttls_used = True

    def login(self, username: str, password: str) -> None:
        FakeSMTP.authenticated_as = (username, password)

    def send_message(self, message: EmailMessage) -> dict[str, str]:
        FakeSMTP.message = message
        return {}


def _configure_local_smtp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SMTP_HOST", "127.0.0.1")
    monkeypatch.setenv("SMTP_PORT", "1025")
    monkeypatch.setenv("SMTP_USERNAME", "")
    monkeypatch.setenv("SMTP_PASSWORD", "")
    monkeypatch.setenv("SMTP_FROM_EMAIL", "demo@la-peace.test")
    monkeypatch.setenv("SMTP_FROM_NAME", "La Peace Email")
    monkeypatch.setenv("SMTP_STARTTLS", "false")
    monkeypatch.setenv("SMTP_USE_SSL", "false")


def test_delivery_builds_message_and_real_attachment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_local_smtp(monkeypatch)
    FakeSMTP.message = None
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)

    message_id = deliver_email(
        "recipient@example.com",
        "Shipping update",
        "Please review the attached document.",
        [("draft.txt", b"verified draft", "text/plain")],
    )

    assert message_id == FakeSMTP.message["Message-ID"]
    assert FakeSMTP.connection_args[:2] == ("127.0.0.1", 1025)
    assert FakeSMTP.message["From"] == "La Peace Email <demo@la-peace.test>"
    assert FakeSMTP.message["To"] == "recipient@example.com"
    assert FakeSMTP.message["Subject"] == "Shipping update"
    assert FakeSMTP.message.get_body().get_content().strip() == "Please review the attached document."
    attachment = FakeSMTP.message.get_payload()[1]
    assert attachment.get_filename() == "draft.txt"
    assert attachment.get_payload(decode=True) == b"verified draft"


def test_delivery_requires_smtp_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SMTP_HOST", "")

    with pytest.raises(EmailDeliveryConfigurationError, match="SMTP_HOST"):
        deliver_email("recipient@example.com", "Subject", "Body")


def test_external_delivery_requires_recipient_allowlist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_local_smtp(monkeypatch)
    monkeypatch.setenv("SMTP_HOST", "smtp.gmail.com")
    monkeypatch.setenv("SMTP_USERNAME", "sender@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", "test-app-password")
    monkeypatch.setenv("SMTP_FROM_EMAIL", "sender@gmail.com")
    monkeypatch.setenv("SMTP_ALLOWED_RECIPIENTS", "")

    with pytest.raises(EmailDeliveryConfigurationError, match="SMTP_ALLOWED_RECIPIENTS"):
        deliver_email("recipient@example.com", "Subject", "Body")


def test_external_delivery_uses_starttls_and_allowlisted_recipient(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_local_smtp(monkeypatch)
    monkeypatch.setenv("SMTP_HOST", "smtp.gmail.com")
    monkeypatch.setenv("SMTP_USERNAME", "sender@gmail.com")
    monkeypatch.setenv("SMTP_PASSWORD", "test-app-password")
    monkeypatch.setenv("SMTP_FROM_EMAIL", "sender@gmail.com")
    monkeypatch.setenv("SMTP_ALLOWED_RECIPIENTS", "recipient@example.com")
    monkeypatch.setenv("SMTP_STARTTLS", "true")
    FakeSMTP.starttls_used = False
    FakeSMTP.authenticated_as = None
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)

    deliver_email("recipient@example.com", "Subject", "Body")

    assert FakeSMTP.starttls_used is True
    assert FakeSMTP.authenticated_as == ("sender@gmail.com", "test-app-password")


def test_send_email_endpoint_accepts_multipart_attachments(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_local_smtp(monkeypatch)
    received: dict[str, object] = {}

    def fake_deliver(
        to: str,
        subject: str,
        body: str,
        attachments: list[tuple[str, bytes, str | None]],
    ) -> str:
        received.update(to=to, subject=subject, body=body, attachments=attachments)
        return "<test-message@la-peace.test>"

    monkeypatch.setattr(shipping_api, "deliver_email", fake_deliver)
    response = TestClient(create_app(tmp_path)).post(
        "/email/send",
        data={
            "to": "recipient@example.com",
            "subject": "Shipping update",
            "body": "Please review.",
        },
        files=[("attachments", ("draft.txt", b"draft content", "text/plain"))],
    )

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "to": "recipient@example.com",
        "message_id": "<test-message@la-peace.test>",
    }
    assert received["attachments"] == [("draft.txt", b"draft content", "text/plain")]
