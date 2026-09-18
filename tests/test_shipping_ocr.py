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