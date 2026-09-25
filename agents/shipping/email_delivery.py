from __future__ import annotations

import mimetypes
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

from agents.config import env, truthy


class EmailDeliveryConfigurationError(RuntimeError):
    pass


class EmailDeliveryError(RuntimeError):
    pass


def _validate_header(value: str, label: str) -> str:
    clean_value = value.strip()
    if not clean_value or "\r" in clean_value or "\n" in clean_value:
        raise ValueError(f"{label} is invalid")
    return clean_value


def _validate_address(value: str, label: str) -> str:
    address = _validate_header(value, label)
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", address):
        raise ValueError(f"{label} must be a valid email address")
    return address


def deliver_email(
    to: str,
    subject: str,
    body: str,
    attachments: list[tuple[str, bytes, str | None]] | None = None,
) -> str:
    host = (env("SMTP_HOST") or "").strip()
    if not host:
        raise EmailDeliveryConfigurationError("SMTP_HOST is not configured")

    try:
        port = int(env("SMTP_PORT", "587") or "587")
    except ValueError as error:
        raise EmailDeliveryConfigurationError("SMTP_PORT must be an integer") from error
    if not 1 <= port <= 65535:
        raise EmailDeliveryConfigurationError("SMTP_PORT is outside the valid range")

    username = (env("SMTP_USERNAME") or "").strip()
    password = env("SMTP_PASSWORD") or ""
    if bool(username) != bool(password):
        raise EmailDeliveryConfigurationError(
            "SMTP_USERNAME and SMTP_PASSWORD must be configured together"
        )

    is_local = host.lower() in {"localhost", "127.0.0.1", "::1"}
    if not is_local and not (username and password):
        raise EmailDeliveryConfigurationError(
            "SMTP credentials are required for non-local mail servers"
        )

    use_ssl = truthy(env("SMTP_USE_SSL", "false"))
    use_starttls = truthy(env("SMTP_STARTTLS", "true"))
    if use_ssl and use_starttls:
        raise EmailDeliveryConfigurationError(
            "Enable either SMTP_USE_SSL or SMTP_STARTTLS, not both"
        )

    from_email = _validate_address(
        env("SMTP_FROM_EMAIL", username) or "",
        "SMTP_FROM_EMAIL",
    )
    from_name = _validate_header(env("SMTP_FROM_NAME", "La Peace Email") or "", "SMTP_FROM_NAME")
    recipient = _validate_address(to, "Recipient")
    if not is_local:
        allowed_recipients = {
            address.strip().lower()
            for address in (env("SMTP_ALLOWED_RECIPIENTS") or "").split(",")
            if address.strip()
        }
        if not allowed_recipients:
            raise EmailDeliveryConfigurationError(
                "SMTP_ALLOWED_RECIPIENTS must list approved external recipients"
            )
        if recipient.lower() not in allowed_recipients:
            raise ValueError("Recipient is not in SMTP_ALLOWED_RECIPIENTS")
    clean_subject = _validate_header(subject, "Subject")

    message = EmailMessage()
    message["From"] = formataddr((from_name, from_email))
    message["To"] = recipient
    message["Subject"] = clean_subject
    message["Message-ID"] = make_msgid()
    message.set_content(body)

    for filename, content, content_type in attachments or []:
        safe_name = Path(filename).name
        if not safe_name or safe_name in {".", ".."}:
            raise ValueError("Attachment filename is invalid")
        guessed_type = content_type or mimetypes.guess_type(safe_name)[0]
        maintype, subtype = (
            guessed_type.split("/", 1)
            if guessed_type and "/" in guessed_type
            else ("application", "octet-stream")
        )
        message.add_attachment(
            content,
            maintype=maintype,
            subtype=subtype,
            filename=safe_name,
        )

    message_id = str(message["Message-ID"])
    try:
        if use_ssl:
            connection = smtplib.SMTP_SSL(
                host,
                port,
                timeout=20,
                context=ssl.create_default_context(),
            )
        else:
            connection = smtplib.SMTP(host, port, timeout=20)
        with connection as smtp:
            smtp.ehlo()
            if use_starttls:
                smtp.starttls(context=ssl.create_default_context())
                smtp.ehlo()
            if username:
                smtp.login(username, password)
            refused = smtp.send_message(message)
            if refused:
                raise smtplib.SMTPRecipientsRefused(refused)
    except (OSError, smtplib.SMTPException) as error:
        raise EmailDeliveryError(
            "SMTP server did not accept the email; verify the server and sender settings"
        ) from error
    return message_id