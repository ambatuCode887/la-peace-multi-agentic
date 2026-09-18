from __future__ import annotations

import argparse

from .dataset import DatasetAdapter
from .verification import write_submission


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a TXT-first SDOC submission.")
    parser.add_argument("data_root", help="Path to the challenge data_v2 directory")
    parser.add_argument("output", help="Path for the generated submission JSON")
    args = parser.parse_args()
    submission = write_submission(DatasetAdapter(args.data_root), args.output)
    print(f"Wrote {len(submission)} email results to {args.output}")


if __name__ == "__main__":
    main()