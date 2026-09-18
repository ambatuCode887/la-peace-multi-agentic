from __future__ import annotations

from types import SimpleNamespace

from agents.shipping.attachments import _ocr_pdf_images


def test_ocr_reads_embedded_pdf_images(monkeypatch) -> None:
    class FakeImage:
        data = b"image"

    class FakePage:
        images = [FakeImage()]

    class FakeReader:
        pages = [FakePage()]

    class FakePytesseract:
        @staticmethod
        def image_to_string(image):
            return "SHIPPING INSTRUCTION\nShipper: ACME"

    class FakeImageContext:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    fake_pil = SimpleNamespace(Image=SimpleNamespace(open=lambda _stream: FakeImageContext()))
    monkeypatch.setitem(__import__("sys").modules, "pytesseract", FakePytesseract)
    monkeypatch.setitem(__import__("sys").modules, "PIL", fake_pil)
    monkeypatch.setitem(__import__("sys").modules, "PIL.Image", fake_pil.Image)

    assert "SHIPPING INSTRUCTION" in _ocr_pdf_images(FakeReader(), "scan.pdf")


def test_rapidocr_pdf_document(monkeypatch) -> None:
    from agents.shipping.attachments import _ocr_pdf_document
    from types import SimpleNamespace

    class FakeAdapter:
        is_http = False

        @staticmethod
        def resolve_attachment(reference):
            return SimpleNamespace(read_bytes=lambda: b"%PDF-fake")

    class FakeBitmap:
        @staticmethod
        def to_numpy():
            import numpy as np
            return np.zeros((100, 100, 3), dtype=np.uint8)

    class FakePage:
        @staticmethod
        def render(scale=1.0):
            return FakeBitmap()

    class FakePdf:
        def __iter__(self):
            return iter([FakePage()])

    class FakeRapidOCR:
        def __call__(self, _arr):
            return [[None, "SHIPPING INSTRUCTION", 0.99], [None, "Shipper: ACME", 0.95]], [0.01, 0.01, 0.01]

    monkeypatch.setitem(__import__("sys").modules, "pypdfium2", SimpleNamespace(PdfDocument=lambda _data: FakePdf()))
    monkeypatch.setitem(__import__("sys").modules, "rapidocr_onnxruntime", SimpleNamespace(RapidOCR=FakeRapidOCR))

    text = _ocr_pdf_document(FakeAdapter(), "scan.pdf")
    assert "SHIPPING INSTRUCTION" in text
    assert "Shipper: ACME" in text