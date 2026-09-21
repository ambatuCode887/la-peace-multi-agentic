from __future__ import annotations

import argparse
import mimetypes
from pathlib import Path

from agents.storage import MongoCaseStore
from agents.config import env


def migrate(root: Path, case_id: str | None = None) -> tuple[int, int]:
    uri = env("MONGODB_URI")
    if not uri:
        raise RuntimeError("MONGODB_URI is required")
    database = env("MONGODB_DB", "shipping") or "shipping"
    store = MongoCaseStore(uri=uri, database=database)
    case_dirs = [root / case_id] if case_id else sorted(root.glob("email_*/"))
    migrated = 0
    cases: set[str] = set()

    for case_root in case_dirs:
        attachments_dir = case_root / "attachments"
        if not attachments_dir.is_dir():
            continue
        for path in sorted(attachments_dir.iterdir()):
            if not path.is_file():
                continue
            email_id = case_root.name
            store.save_attachment(
                email_id=email_id,
                name=path.name,
                content=path.read_bytes(),
                content_type=mimetypes.guess_type(path.name)[0],
            )
            migrated += 1
            cases.add(email_id)

    return migrated, len(cases)


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill case attachments into MongoDB")
    parser.add_argument(
        "root",
        nargs="?",
        default=".artifacts/uploads",
        type=Path,
        help="Local uploads root containing email_*/attachments directories",
    )
    parser.add_argument("--case", dest="case_id", help="Migrate one case, e.g. email_208")
    args = parser.parse_args()
    migrated, cases = migrate(args.root.expanduser().resolve(), args.case_id)
    print(f"Migrated {migrated} attachments for {cases} cases into MongoDB")


if __name__ == "__main__":
    main()
