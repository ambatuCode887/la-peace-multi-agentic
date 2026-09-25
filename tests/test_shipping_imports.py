from __future__ import annotations

import os
import subprocess
import sys


def test_verification_import_does_not_load_api_without_mongodb_uri() -> None:
    environment = os.environ.copy()
    environment.pop("MONGODB_URI", None)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; "
            "import agents.shipping.verification; "
            "assert 'agents.shipping.api' not in sys.modules",
        ],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_importing_api_does_not_create_global_app() -> None:
    environment = os.environ.copy()
    environment.pop("MONGODB_URI", None)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import agents.shipping.api as api; "
            "assert not hasattr(api, 'app')",
        ],
        capture_output=True,
        check=False,
        env=environment,
        text=True,
    )

    assert result.returncode == 0, result.stderr
