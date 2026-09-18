from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .dataset import DatasetAdapter


@dataclass(frozen=True)
class TextAttachment:
    """Text content linked to the email that referenced the attachment."""

    email_id: str
    reference: str
    text: str


@dataclass(frozen=True)
class TextBaseline:
    """Deterministic inventory of the text-only dataset slice."""

    attachments: tuple[TextAttachment, ...]
    unsupported_references: tuple[str, ...]

    @property
    def text_attachment_count(self) -> int:
        return len(self.attachments)

    @property
    def unsupported_attachment_count(self) -> int:
        return len(self.unsupported_references)


def build_text_baseline(adapter: DatasetAdapter) -> TextBaseline:
    """Read every referenced ``.txt`` attachment without parsing binary files."""
    text_attachments: list[TextAttachment] = []
    unsupported: list[str] = []

    for email in adapter:
        for reference in email.attachments:
            if Path(reference).suffix.lower() != ".txt":
                unsupported.append(reference)
                continue
            text_attachments.append(
                TextAttachment(
                    email_id=email.email_id,
                    reference=reference,
                    text=adapter.read_text(reference),
                )
            )

    return TextBaseline(
        attachments=tuple(text_attachments),
        unsupported_references=tuple(unsupported),
    )