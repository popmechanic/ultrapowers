"""Tests for the `pad` text padding helper."""
import pytest

from probecli.textutil import pad


def test_pads_with_trailing_spaces_to_width():
    assert pad("ab", 5) == "ab   "


def test_text_already_at_width_is_unchanged():
    assert pad("abc", 3) == "abc"


def test_text_beyond_width_is_unchanged():
    assert pad("abcdef", 3) == "abcdef"


def test_empty_text_is_padded_to_full_width():
    assert pad("", 4) == "    "


def test_zero_width_returns_text_unchanged():
    assert pad("ab", 0) == "ab"


def test_negative_width_raises_value_error():
    with pytest.raises(ValueError) as excinfo:
        pad("ab", -1)
    assert str(excinfo.value) == "width must be >= 0"
