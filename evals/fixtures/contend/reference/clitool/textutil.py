"""Text padding helper. Reference solution."""


def pad(text, width):
    if width < 0:
        raise ValueError("width must be >= 0")
    return text if len(text) >= width else text + " " * (width - len(text))
