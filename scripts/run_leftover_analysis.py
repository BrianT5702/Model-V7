"""Analyze leftover counts using the real frontend panel calculator via Node."""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'model_builder.settings')

import django  # noqa: E402

django.setup()

from scripts.export_project_calc_data import main as export_main  # noqa: E402


def main():
    from io import StringIO
    from contextlib import redirect_stdout

    buffer = StringIO()
    with redirect_stdout(buffer):
        sys.argv = ['export_project_calc_data.py', str(sys.argv[1] if len(sys.argv) > 1 else 520)]
        export_main()

    payload = buffer.getvalue()
    node_script = os.path.join(ROOT, 'scripts', 'analyze_mydin_leftovers.mjs')
    proc = subprocess.run(
        ['node', node_script],
        input=payload,
        text=True,
        capture_output=True,
        cwd=ROOT,
        check=False,
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        sys.exit(proc.returncode)
    print(proc.stdout)


if __name__ == '__main__':
    main()
