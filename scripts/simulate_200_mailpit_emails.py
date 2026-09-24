from __future__ import annotations

import argparse
import json
import mimetypes
import os
import random
import shutil
import smtplib
from email.message import EmailMessage
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = PROJECT_ROOT / "data_v2"
INBOX_ROOT = DATA_ROOT / "inbox"
ATTACHMENTS_ROOT = DATA_ROOT / "attachments"


def load_template(email_id: str) -> tuple[dict[str, Any], list[Path]]:
    record_path = INBOX_ROOT / f"{email_id}.json"
    if not record_path.is_file():
        raise FileNotFoundError(record_path)
    record = json.loads(record_path.read_text(encoding="utf-8"))
    paths = []
    for reference in record.get("attachments", []):
        path = (DATA_ROOT / reference).resolve()
        try:
            path.relative_to(DATA_ROOT.resolve())
        except ValueError as error:
            raise ValueError(f"Attachment path escapes data_v2: {reference}") from error
        if not path.is_file():
            raise FileNotFoundError(path)
        paths.append(path)
    if len(paths) < 2:
        raise ValueError(f"Template {email_id} does not contain at least two attachments")
    return record, paths


def available_templates() -> list[str]:
    templates = []
    for index in range(1, 501):
        email_id = f"email_{index:03d}"
        try:
            load_template(email_id)
        except (FileNotFoundError, ValueError, json.JSONDecodeError):
            continue
        templates.append(email_id)
    if not templates:
        raise RuntimeError("No usable inbox templates found in email_001 through email_500")
    return templates


def find_available_start(start: int, count: int) -> int:
    candidate = start
    while True:
        collision = None
        for index in range(candidate, candidate + count):
            email_id = f"email_{index:03d}"
            if (INBOX_ROOT / f"{email_id}.json").exists() or any(
                ATTACHMENTS_ROOT.glob(f"{email_id}_*")
            ):
                collision = index
                break
        if collision is None:
            return candidate
        candidate = collision + 1


def make_message(
    record: dict[str, Any],
    email_id: str,
    recipient: str,
    attachments: list[Path],
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = str(record.get("from") or "demo@example.com")
    message["To"] = recipient
    message["Subject"] = str(record.get("subject") or "(No subject)")
    message["X-Demo-Index"] = email_id
    message.set_content(str(record.get("body") or ""))
    for path in attachments:
        content_type, _ = mimetypes.guess_type(path.name)
        maintype, subtype = content_type.split("/", 1) if content_type else (
            "application",
            "octet-stream",
        )
        message.add_attachment(
            path.read_bytes(),
            maintype=maintype,
            subtype=subtype,
            filename=path.name,
        )
    return message


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate and send a randomized batch of shipping emails to Mailpit."
    )
    parser.add_argument("--count", type=int, default=200)
    parser.add_argument("--start-index", type=int, help="First output index; defaults to the next free range from 600")
    parser.add_argument("--seed", type=int, help="Seed template selection for repeatable runs")
    parser.add_argument("--to", default="inbox@example.com")
    parser.add_argument("--host", default=os.getenv("MAILPIT_SMTP_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("MAILPIT_SMTP_PORT", "1025")))
    parser.add_argument("--dry-run", action="store_true", help="Plan the batch without writing or sending")
    args = parser.parse_args()
    if args.count < 1 or (args.start_index is not None and args.start_index < 1):
        parser.error("--count and any supplied --start-index must be positive")

    start_index = args.start_index or find_available_start(600, args.count)
    templates = available_templates()
    chooser = random.Random(args.seed)
    planned = []
    for index in range(start_index, start_index + args.count):
        email_id = f"email_{index:03d}"
        template_id = chooser.choice(templates)
        record, source_paths = load_template(template_id)
        output_paths = []
        references = []
        for source_path in source_paths:
            suffix = source_path.name[len(template_id):] if source_path.name.startswith(template_id) else f"_{source_path.name}"
            target_path = ATTACHMENTS_ROOT / f"{email_id}{suffix}"
            if target_path.exists():
                raise FileExistsError(f"Refusing to overwrite {target_path}")
            output_paths.append((source_path, target_path))
            references.append(f"attachments/{target_path.name}")
        new_record = dict(record)
        new_record["email_id"] = email_id
        new_record["attachments"] = references
        planned.append((template_id, new_record, output_paths))

    if args.dry_run:
        template_counts: dict[str, int] = {}
        for template_id, _, _ in planned:
            template_counts[template_id] = template_counts.get(template_id, 0) + 1
        print(
            f"Would send {len(planned)} emails ({planned[0][1]['email_id']} through "
            f"{planned[-1][1]['email_id']}) using {len(template_counts)} templates; "
            f"each includes its source attachments."
        )
        return

    sent = 0
    with smtplib.SMTP(args.host, args.port, timeout=10) as smtp:
        for _, record, output_paths in planned:
            email_id = record["email_id"]
            copied_paths = []
            record_path = INBOX_ROOT / f"{email_id}.json"
            try:
                for source_path, target_path in output_paths:
                    shutil.copyfile(source_path, target_path)
                    copied_paths.append(target_path)
                record_path.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
                smtp.send_message(make_message(record, email_id, args.to, copied_paths))
                sent += 1
            except Exception:
                record_path.unlink(missing_ok=True)
                for path in copied_paths:
                    path.unlink(missing_ok=True)
                raise
    print(f"Sent {sent} emails to {args.host}:{args.port} starting at email_{start_index:03d}.")


if __name__ == "__main__":
    main()