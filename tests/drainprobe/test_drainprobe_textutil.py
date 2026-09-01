"""Tests for probecli.textutil.pad — trailing-space padding to a target width."""
import pytest

from probecli.textutil import pad


def test_pad_adds_trailing_spaces_to_width():
    assert pad("ab", 5) == "ab   "


def test_pad_leaves_text_longer_than_width_unchanged():
    assert pad("abcdef", 3) == "abcdef"


def test_pad_leaves_text_exactly_at_width_unchanged():
    assert pad("abc", 3) == "abc"


def test_pad_empty_text_becomes_all_spaces():
    assert pad("", 4) == "    "


def test_pad_to_zero_width_returns_text_unchanged():
    assert pad("ab", 0) == "ab"
    assert pad("", 0) == ""


def test_pad_negative_width_raises_value_error():
    with pytest.raises(ValueError) as excinfo:
        pad("ab", -1)
    assert str(excinfo.value) == "width must be >= 0"
