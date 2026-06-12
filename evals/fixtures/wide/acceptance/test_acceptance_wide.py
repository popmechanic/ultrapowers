"""Held-out acceptance tests for the wide fixture. Never shown to executors."""
import pytest


def test_word_count_basic():
    from textkit.word_count import word_count
    assert word_count("The cat and the hat") == {"the": 2, "cat": 1, "and": 1, "hat": 1}


def test_word_count_tokenization_and_empty():
    from textkit.word_count import word_count
    assert word_count("Don't stop") == {"don": 1, "t": 1, "stop": 1}
    assert word_count("") == {}
    assert word_count("!!! ???") == {}


def test_truncate_under_and_over():
    from textkit.truncate import truncate
    assert truncate("short", 10) == "short"
    assert truncate("hello brave world", 10) == "hello b..."


def test_truncate_rstrip_and_custom_ellipsis():
    from textkit.truncate import truncate
    # text[:7] == "hello b" for default; with a 1-char ellipsis cut lands on a space
    assert truncate("hello brave world", 7, "~") == "hello~"


def test_truncate_rejects_tiny_limit():
    from textkit.truncate import truncate
    with pytest.raises(ValueError):
        truncate("anything", 2)


def test_titlecase_minor_words():
    from textkit.titlecase import titlecase
    assert titlecase("the lord of the rings") == "The Lord of the Rings"


def test_titlecase_first_last_always_capitalized():
    from textkit.titlecase import titlecase
    assert titlecase("of mice and men of") == "Of Mice and Men Of"
    assert titlecase("") == ""
    assert titlecase("   ") == ""


def test_redact_whole_word_case_insensitive():
    from textkit.redact import redact
    assert redact("Tell Alice that ALICE called", ["alice"]) == "Tell ***** that ***** called"
    assert redact("scandals", ["scandal"]) == "scandals"
    assert redact("scandal!", ["scandal"]) == "*******!"


def test_redact_empty_words():
    from textkit.redact import redact
    assert redact("nothing to hide", []) == "nothing to hide"


def test_ngrams_basic_and_edges():
    from textkit.ngrams import ngrams
    assert ngrams(["a", "b", "c"], 2) == [("a", "b"), ("b", "c")]
    assert ngrams(["a", "b"], 3) == []
    with pytest.raises(ValueError):
        ngrams(["a"], 0)


def test_reverse_words():
    from textkit.reverse_words import reverse_words
    assert reverse_words("one  two three") == "three two one"
    assert reverse_words("") == ""
    assert reverse_words("   ") == ""
