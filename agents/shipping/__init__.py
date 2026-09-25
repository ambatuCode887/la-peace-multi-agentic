"""Shipping document verification components."""

from .dataset import DatasetAdapter, DatasetEmail
from .attachments import AttachmentReadError, read_attachment_text
from .text_baseline import TextAttachment, TextBaseline, build_text_baseline
from .verification import (
	build_submission,
	classify_email,
	compare_shipments,
	extract_shipment_fields,
	write_submission,
)
from .tool import inspect_shipping_email, run_shipping_verification


def __getattr__(name: str):
	if name == "create_app":
		from .api import create_app

		return create_app
	raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
	"DatasetAdapter",
	"DatasetEmail",
	"AttachmentReadError",
	"read_attachment_text",
	"TextAttachment",
	"TextBaseline",
	"build_text_baseline",
	"build_submission",
	"classify_email",
	"compare_shipments",
	"extract_shipment_fields",
	"write_submission",
	"run_shipping_verification",
	"inspect_shipping_email",
	"create_app",
]