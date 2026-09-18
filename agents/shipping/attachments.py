from __future__ import annotations

from pathlib import Path

from .dataset import DatasetAdapter


class AttachmentReadError(RuntimeError):
    """Raised when an attachment cannot produce usable text."""


def read_attachment_text(adapter: DatasetAdapter, reference: str) -> str:
    """Extract text from a supported attachment referenced by an email."""
    suffix = Path(reference).suffix.lower()
    try:
        if suffix == ".txt":
            text = adapter.read_text(reference)
        elif suffix == ".pdf":
            text = _read_pdf(adapter, reference)
        elif suffix == ".docx":
            text = _read_docx(adapter, reference)
        elif suffix == ".xlsx":
            text = _read_xlsx(adapter, reference)
        else:
            raise AttachmentReadError(f"Unsupported attachment format: {suffix}")
    except AttachmentReadError:
        raise
    except Exception as error:
        raise AttachmentReadError(f"Could not read attachment: {reference}") from error

    text = text.strip()
    if not text:
        raise AttachmentReadError(f"Attachment contains no readable text: {reference}")
    return text


def _read_pdf(adapter: DatasetAdapter, reference: str) -> str:
    from io import BytesIO
    from pypdf import PdfReader

    source = str(adapter.resolve_attachment(reference)) if not adapter.is_http else BytesIO(adapter.read_bytes(reference))
    reader = PdfReader(source)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    if text.strip():
        return text
    return _ocr_pdf_images(reader, reference)


def _ocr_pdf_images(reader: object, reference: str) -> str:
    """OCR embedded PDF images when the PDF has no text layer."""
    from io import BytesIO

    try:
        import pytesseract
        from PIL import Image
    except ImportError as error:
        raise AttachmentReadError(
            "OCR requires the optional pytesseract and Pillow packages."
        ) from error

    pages = getattr(reader, "pages", [])
    blocks: list[str] = []
    try:
        for page in pages:
            for image in getattr(page, "images", []):
                with Image.open(BytesIO(image.data)) as source:
                    blocks.append(pytesseract.image_to_string(source))
    except Exception as error:
        raise AttachmentReadError(f"OCR failed for attachment: {reference}") from error
    text = "\n".join(blocks).strip()
    if not text:
        raise AttachmentReadError(f"OCR produced no text for attachment: {reference}")
    return text


def _read_docx(adapter: DatasetAdapter, reference: str) -> str:
    from io import BytesIO
    import docx

    source = BytesIO(adapter.read_bytes(reference)) if adapter.is_http else str(adapter.resolve_attachment(reference))
    document = docx.Document(source)
    blocks = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables:
        for row in table.rows:
            values = [cell.text.strip() for cell in row.cells]
            if any(values):
                blocks.append(" | ".join(values))
    return "\n".join(blocks)


def _read_xlsx(adapter: DatasetAdapter, reference: str) -> str:
    from io import BytesIO
    from openpyxl import load_workbook

    source = BytesIO(adapter.read_bytes(reference)) if adapter.is_http else adapter.resolve_attachment(reference)
    workbook = load_workbook(
        filename=source,
        read_only=True,
        data_only=True,
    )
    blocks: list[str] = []
    try:
        for worksheet in workbook.worksheets:
            for row in worksheet.iter_rows(values_only=True):
                values = [str(value).strip() for value in row if value is not None and str(value).strip()]
                if values:
                    blocks.append(" | ".join(values))
    finally:
        workbook.close()
    return "\n".join(blocks)