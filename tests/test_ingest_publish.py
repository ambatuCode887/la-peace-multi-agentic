from __future__ import annotations

from agents.tools.functions.ingest import documents


def test_csv_units_keep_complete_rows() -> None:
    text = "name,age\nAlice,25\nMissing\nBob,30,extra"
    assert documents._structure_units(text, ".csv") == ["name: Alice, age: 25"]


def test_hybrid_chunks_respect_maximum_size(monkeypatch) -> None:
    monkeypatch.setattr(documents, "embed_texts", lambda units: [[1.0, 0.0] for _ in units])
    chunks = documents.hybrid_chunk_text(
        "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.",
        chunk_size=24,
        overlap=4,
        suffix=".md",
    )
    assert chunks
    assert all(len(chunk) <= 24 for chunk in chunks)


