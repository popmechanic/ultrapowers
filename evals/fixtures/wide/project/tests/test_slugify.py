from textkit.slugify import slugify


def test_basic():
    assert slugify("Hello, World!") == "hello-world"


def test_strips_edges():
    assert slugify("  --Already--Slugged--  ") == "already-slugged"
