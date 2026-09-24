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


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = PROJECT_ROOT / "data_v2"


def load_template(template_id: str) -> tuple[dict, list[Path]]:
    inbox_path = DATA_ROOT / "inbox" / f"{template_id}.json"
    if not inbox_path.is_file():
        raise FileNotFoundError(f"Inbox template not found: {inbox_path}")

    record = json.loads(inbox_path.read_text(encoding="utf-8"))
    attachment_paths = []
    for relative_path in record.get("attachments", []):
        source_path = (DATA_ROOT / relative_path).resolve()
        try:
            source_path.relative_to(DATA_ROOT.resolve())
        except ValueError as exc:
            raise ValueError(f"Attachment path escapes data_v2: {relative_path}") from exc
        if not source_path.is_file():
            raise FileNotFoundError(f"Attachment not found: {source_path}")
        attachment_paths.append(source_path)

    if not attachment_paths:
        raise ValueError(f"Template has no attachments: {template_id}")
    return record, attachment_paths


def available_templates() -> list[str]:
    templates = []
    for index in range(1, 501):
        template_id = f"email_{index:03d}"
        try:
            load_template(template_id)
        except (FileNotFoundError, ValueError, json.JSONDecodeError):
            continue
        templates.append(template_id)
    if not templates:
        raise ValueError("No inbox templates with attachments found in email_001 through email_500")
    return templates


def prepare_case(index: int, template_id: str, record: dict, source_paths: list[Path]) -> tuple[dict, list[tuple[Path, Path]]]:
    email_id = f"email_{index:03d}"
    inbox_path = DATA_ROOT / "inbox" / f"{email_id}.json"
    if inbox_path.exists():
        raise FileExistsError(f"Refusing to overwrite {inbox_path}")

    attachment_copies = []
    relative_attachments = []
    for source_path in source_paths:
        source_name = source_path.name
        if source_name.startswith(template_id):
            target_name = email_id + source_name[len(template_id):]
        else:
            target_name = f"{email_id}_{source_name}"
        target_path = DATA_ROOT / "attachments" / target_name
        if target_path.exists():
            raise FileExistsError(f"Refusing to overwrite {target_path}")
        attachment_copies.append((source_path, target_path))
        relative_attachments.append(f"attachments/{target_name}")

    new_record = dict(record)
    new_record["email_id"] = email_id
    new_record["attachments"] = relative_attachments
    return new_record, attachment_copies


def make_message(record: dict, email_id: str, recipient: str, attachment_paths: list[Path]) -> EmailMessage:
    message = EmailMessage()
    message["From"] = str(record.get("from") or "demo@example.com")
    message["To"] = recipient
    message["Subject"] = str(record.get("subject") or "(No subject)")
    message["X-Demo-Index"] = email_id
    message.set_content(str(record.get("body") or ""))

    for path in attachment_paths:
        content_type, _ = mimetypes.guess_type(path.name)
        if content_type:
            maintype, subtype = content_type.split("/", 1)
        else:
            maintype, subtype = "application", "octet-stream"
        message.add_attachment(
            path.read_bytes(),
            maintype=maintype,
            subtype=subtype,
            filename=path.name,
        )
    return message


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Clone an inbox sample with its attachments and send it to local Mailpit."
    )
    parser.add_argument("--start-index", type=int, default=600)
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--template", help="Use a specific source case instead of random selection")
    parser.add_argument("--seed", type=int, help="Seed the random template selection for repeatable runs")
    parser.add_argument("--to", default="inbox@example.com")
    parser.add_argument("--host", default=os.getenv("MAILPIT_SMTP_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("MAILPIT_SMTP_PORT", "1025")))
    parser.add_argument("--dry-run", action="store_true", help="Validate and list outputs without writing or sending")
    args = parser.parse_args()

    if args.start_index < 1 or args.count < 1:
        parser.error("--start-index and --count must be positive integers")

    templates = [args.template] if args.template else available_templates()
    chooser = random.Random(args.seed)
    cases = []
    for index in range(args.start_index, args.start_index + args.count):
        template_id = chooser.choice(templates)
        record, source_paths = load_template(template_id)
        new_record, attachment_copies = prepare_case(index, template_id, record, source_paths)
        cases.append((template_id, new_record, attachment_copies))

    if args.dry_run:
        for template_id, new_record, attachment_copies in cases:
            print(
                f"Would create and send {new_record['email_id']} from {template_id} "
                f"with {len(attachment_copies)} attachment(s)"
            )
        return

    with smtplib.SMTP(args.host, args.port, timeout=10) as smtp:
        for _, new_record, attachment_copies in cases:
            new_id = new_record["email_id"]
            for source_path, target_path in attachment_copies:
                shutil.copyfile(source_path, target_path)
            inbox_path = DATA_ROOT / "inbox" / f"{new_id}.json"
            inbox_path.write_text(json.dumps(new_record, indent=2) + "\n", encoding="utf-8")
            target_paths = [target for _, target in attachment_copies]
            smtp.send_message(make_message(new_record, new_id, args.to, target_paths))
            print(f"Created {inbox_path.relative_to(PROJECT_ROOT)} and sent to {args.host}:{args.port}")


if __name__ == "__main__":
    main()