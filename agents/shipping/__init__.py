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
from .api import app as shipping_api, create_app

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
	"shipping_api",
	"create_app",
]