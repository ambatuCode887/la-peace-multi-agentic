from __future__ import annotations

from email.message import EmailMessage
from pathlib import Path

from scripts import simulate_200_mailpit_emails as simulator


def test_simulator_message_contains_all_attachments(tmp_path: Path) -> None:
    si_path = tmp_path / "email_600_SI.txt"
    bl_path = tmp_path / "email_600_BL.txt"
    si_path.write_bytes(b"shipping instruction")
    bl_path.write_bytes(b"draft bill of lading")

    message = simulator.make_message(
        {
            "from": "sender@example.com",
            "subject": "Document check",
            "body": "Please compare the attached files.",
        },
        "email_600",
        "inbox@example.com",
        [si_path, bl_path],
    )

    attachments = list(message.iter_attachments())
    assert isinstance(message, EmailMessage)
    assert message["X-Demo-Index"] == "email_600"
    assert [part.get_filename() for part in attachments] == [
        "email_600_SI.txt",
        "email_600_BL.txt",
    ]
    assert [part.get_payload(decode=True) for part in attachments] == [
        b"shipping instruction",
        b"draft bill of lading",
    ]


def test_simulator_skips_colliding_output_ranges(tmp_path: Path, monkeypatch) -> None:
    inbox_root = tmp_path / "inbox"
    attachments_root = tmp_path / "attachments"
    inbox_root.mkdir()
    attachments_root.mkdir()
    (inbox_root / "email_600.json").touch()
    (attachments_root / "email_602_BL.txt").touch()
    monkeypatch.setattr(simulator, "INBOX_ROOT", inbox_root)
    monkeypatch.setattr(simulator, "ATTACHMENTS_ROOT", attachments_root)

    assert simulator.find_available_start(600, 3) == 603