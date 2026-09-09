from src.a import add


def test_one():
    assert add(1, 2) == 3


def test_two():
    assert add(0, 0) == 0
