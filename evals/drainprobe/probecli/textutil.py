"""Text padding helper for the report CLI."""


def pad(text, width):
    """Pad `text` with trailing spaces up to `width`.

    Text already at or beyond `width` is returned unchanged.
    """
    if width < 0:
        raise ValueError("width must be >= 0")
    return text if len(text) >= width else text + " " * (width - len(text))
