#!/usr/bin/env python3
"""Assert every workflow step that reaches the GitHub API has GH_REPO set.

`gh` resolves the target repository from GH_REPO or, failing that, from the git
remote of the working directory. A workflow job with neither dies on its first
command with `fatal: not a git repository` — before reaching the API, and with
an error that names git rather than the real problem.

That is not hypothetical. backup.yml's alert and resolve jobs had exactly this
defect from 2026-08-22 to 2026-09-09: 122 consecutive red backup runs opened
zero issues, because the alarm could not resolve the repository it was meant to
open an issue on. This guard is why that cannot come back silently.

Steps are checked whether they call `gh` directly or go through
scripts/alert-issue.sh, which needs the same context.

A second rule, same failure shape: a job that declares its own `permissions`
map without `contents` gets `contents: none`, so `actions/checkout` fails on a
private repo before the job reaches its real work. The keepalive and backup
alert/resolve jobs declared `issues: write` only and failed exactly so until
2026-10-16 (cycle 2026-10-16-keepalive-permissions): every prod-down and
backup-failure issue they were meant to open was silently never opened.

Usage: python3 scripts/check-workflow-gh-repo.py .github/workflows/*.yml
       python3 scripts/check-workflow-gh-repo.py --self-test
"""
import re
import sys

import yaml

# A real invocation: `gh` at the start of a command position, followed by a
# subcommand. Deliberately narrow so that prose and code *about* gh — including
# this file's own description of the bug — does not register as a call.
GH_CALL = re.compile(r"(?:^|[\s;&|(`]|\$\()gh\s+[a-z]", re.M)
# alert-issue.sh reaches the API for `open` and `close` only. Its `self-test`
# drives a stub, and merely naming the file (shellcheck, a comment) is not a
# call at all — matching those would make the guard cry wolf, which is how
# guards get switched off.
INDIRECT_CALL = re.compile(r"alert-issue\.sh\s+(?:open|close)\b")


def offenders(path):
    doc = yaml.safe_load(open(path)) or {}
    workflow_env = doc.get("env") or {}
    found = []
    for job_name, job in (doc.get("jobs") or {}).items():
        job_env = job.get("env") or {}
        for step in job.get("steps") or []:
            run = step.get("run") or ""
            if not (GH_CALL.search(run) or INDIRECT_CALL.search(run)):
                continue
            env = {**workflow_env, **job_env, **(step.get("env") or {})}
            if "GH_REPO" not in env:
                found.append(f"{job_name} / {step.get('name', '(unnamed step)')}")
    return found


def checkout_without_contents(path):
    """Jobs that run actions/checkout under a token with no `contents` read.

    A job-level `permissions` map replaces the workflow-level one entirely, and
    every scope it does not name becomes `none`. A string (`read-all`,
    `write-all`) or no `permissions` at all keeps contents readable.
    """
    doc = yaml.safe_load(open(path)) or {}
    found = []
    for job_name, job in (doc.get("jobs") or {}).items():
        perms = job.get("permissions", doc.get("permissions"))
        if not isinstance(perms, dict):
            continue
        if perms.get("contents") in ("read", "write"):
            continue
        for step in job.get("steps") or []:
            if str(step.get("uses") or "").startswith("actions/checkout"):
                found.append(f"{job_name} / {step.get('name', step['uses'])}")
    return found


SELF_TEST_FIXTURES = {
    "good-direct.yml": """
jobs:
  j:
    steps:
      - name: calls gh with GH_REPO
        env:
          GH_REPO: owner/repo
        run: gh issue list --state open
""",
    "good-indirect.yml": """
jobs:
  j:
    env:
      GH_REPO: owner/repo
    steps:
      - name: opens an alert, GH_REPO inherited from the job
        run: bash scripts/alert-issue.sh open lbl "T" body.md owner
""",
    "good-not-a-call.yml": """
jobs:
  j:
    steps:
      - name: only names the script, never calls the API
        run: |
          shellcheck scripts/alert-issue.sh
          bash scripts/alert-issue.sh self-test
""",
    "bad-direct.yml": """
jobs:
  j:
    steps:
      - name: calls gh with no GH_REPO anywhere
        run: |
          set -e
          EXISTING=$(gh issue list --state open --label x)
""",
    "bad-indirect.yml": """
jobs:
  j:
    steps:
      - name: opens an alert with no GH_REPO
        run: bash scripts/alert-issue.sh open lbl "T" body.md owner
""",
    "good-checkout-with-contents.yml": """
jobs:
  alert:
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v7
""",
    "good-checkout-inherits-workflow.yml": """
permissions:
  contents: read
  issues: write
jobs:
  alert:
    steps:
      - uses: actions/checkout@v7
""",
    "bad-checkout-no-contents.yml": """
permissions:
  contents: read
jobs:
  alert:
    permissions:
      issues: write
    steps:
      - uses: actions/checkout@v7
""",
}


def self_test():
    """The guard is itself a silent-failure risk: one that never fires looks
    exactly like a clean repo. Assert it fires on the real defect and stays
    quiet on the shapes that are fine."""
    import tempfile, os
    failures = 0
    with tempfile.TemporaryDirectory() as d:
        for name, body in SELF_TEST_FIXTURES.items():
            path = os.path.join(d, name)
            with open(path, "w") as fh:
                fh.write(body)
            bad = offenders(path) + checkout_without_contents(path)
            should_fail = name.startswith("bad-")
            if bool(bad) != should_fail:
                verdict = "flagged" if bad else "passed"
                print(f"::error::{name}: expected "
                      f"{'a finding' if should_fail else 'no finding'}, but it {verdict}")
                failures += 1
            else:
                print(f"  OK — {name}")
    if failures:
        return 1
    print("\n  OK — self-test passed")
    return 0


def main(paths):
    failed = False
    for path in paths:
        bad = offenders(path)
        no_contents = checkout_without_contents(path)
        if bad:
            failed = True
            print(f"::error::{path}: reaches the GitHub API without GH_REPO in: "
                  + "; ".join(bad))
            print("  Add 'GH_REPO: ${{ github.repository }}' to the step or job env,")
            print("  and an actions/checkout step if the job runs a repo script.")
        if no_contents:
            failed = True
            print(f"::error::{path}: runs actions/checkout with no `contents` "
                  "permission in: " + "; ".join(no_contents))
            print("  Add 'contents: read' to that job's permissions map.")
        if not bad and not no_contents:
            print(f"OK — {path}")
    return 1 if failed else 0


if __name__ == "__main__":
    args = sys.argv[1:]
    sys.exit(self_test() if args[:1] == ["--self-test"] else main(args))
