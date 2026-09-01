#!/usr/bin/env python3
"""ultralearn outcome vocabulary — the three ways a lookup ends, named once.

"I could not look" and "I looked and there was nothing" are different facts;
spelled as two empty lists they read identically downstream. This module is the
shared spelling: one importable name and one machine-greppable stderr prefix per
outcome, so a harvest's diagnostics can be grepped rather than read.

    FAILED-LOOKUP:  could not look — the input layer failed
    LOOKED-EMPTY:   looked, found nothing — a healthy quiet result
    SWALLOW:        a deliberate continue past an error, marked as such

Everything here writes to stderr only, keeps stdout clean for real output, holds
no state, and never exits — callers decide their own exit codes.
"""
from __future__ import annotations

import sys

FAILED_LOOKUP_PREFIX = "FAILED-LOOKUP:"
LOOKED_EMPTY_PREFIX = "LOOKED-EMPTY:"
SWALLOW_PREFIX = "SWALLOW:"


class FailedLookup(RuntimeError):
    """Raised when a lookup could not be performed at all.

    Distinct from an empty result: nothing was learned about what is there.
    """


def _emit(prefix: str, message: str) -> None:
    print(f"{prefix} {message}", file=sys.stderr)


def report_failed_lookup(cause: str) -> None:
    """Report that a lookup could not be performed, naming the cause."""
    _emit(FAILED_LOOKUP_PREFIX, cause)


def report_looked_empty(where: str) -> None:
    """Report a completed lookup that found nothing, naming where it looked."""
    _emit(LOOKED_EMPTY_PREFIX, where)


def swallow(reason: str, exc: BaseException | None = None) -> None:
    """Mark a deliberate continue past an error, with the exception when there is one."""
    _emit(SWALLOW_PREFIX, reason if exc is None else f"{reason}: {exc!r}")
