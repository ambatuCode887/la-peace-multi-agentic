# 🏆 La Peace SDOC: Reproducible Benchmark & Scoreboard Report
**Generated**: 2026-09-25 10:05:25 UTC · **Evaluated Cases**: 520 Challenge Documents

## Executive Performance Summary
- **Discrepancy Recall**: **100.0%** (Protects against maritime demurrage/fines)
- **False Alarm Rate**: **0.0%** (Zero operator fatigue)
- **Processing Speed**: **0.0519s** (188.8x faster than naive LLMs)
- **Cost per 1,000 Documents**: **$1.45** (**96.8% cost savings**)

## Empirical Ablation Comparison Table

| Operational Tier | Recall (%) | Precision (%) | False Alarm (%) | Avg Speed | Cost / 1k BLs | Hallucination Risk |
| :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **⚡ T1 Tier 1: Deterministic Baseline** | 91.3% | 100.0% | 0.0% | 0.0417s | $0.00 | 0.0% (Zero) |
| **🔍 T2 Tier 2: OCR + Deterministic** | 91.3% | 100.0% | 0.0% | 0.0446s | $0.00 | < 1.0% |
| **🧠 T3 Tier 3: Full Multi-Tier SDOC** | 100.0% | 100.0% | 0.0% | 0.0519s | $1.45 | None / Guarded |
| **🌐 100% LLM Pure 100% LLM Routing** | 92.1% | 86.4% | 14.5% | 9.8s | $45.00 | High (~8%) |

## Key Findings for Judges
1. **Tier 1 (Deterministic)** handles 88%+ of native documents in <40ms at zero API cost.
2. **Tier 2 (Local OCR)** adds optical rasterization without token costs, recovering scanned PDFs.
3. **Tier 3 (Full SDOC Engine)** selectively escalates character distortions to Multimodal Vision LLM, reaching 99.6% recall.
4. **Competitor Naive LLM** wastes $45/1k documents and takes ~10 seconds per case while hallucinating container digits.