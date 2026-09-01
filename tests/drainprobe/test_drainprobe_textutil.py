"""Acceptance tests for `probecli.textutil.pad`.

Criteria (task 4): pad() appends trailing spaces until `text` reaches `width`;
text already at or beyond `width` comes back unchanged; a negative `width`
raises ValueError("width must be >= 0").
"""
import pytest

from probecli.textutil import pad


def test_pads_short_text_with_trailing_spaces():
    assert pad("ab", 5) == "ab   "


def test_text_beyond_width_is_unchanged():
    assert pad("abcdef", 3) == "abcdef"


def test_text_exactly_at_width_is_unchanged():
    assert pad("abc", 3) == "abc"


def test_empty_text_pads_to_full_width():
    assert pad("", 4) == "    "


def test_zero_width_returns_text_unchanged():
    assert pad("ab", 0) == "ab"
    assert pad("", 0) == ""


def test_negative_width_raises_value_error():
    with pytest.raises(ValueError) as excinfo:
        pad("ab", -1)
    assert str(excinfo.value) == "width must be >= 0"
