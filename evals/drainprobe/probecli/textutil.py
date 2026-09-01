"""Text layout helpers for the report CLI.

Measurement payload for the #454 concurrent-drain arms (sitting 2, map #360).
"""


def pad(text, width):
    """Return `text` padded with trailing spaces to at least `width` chars.

    Text already at or beyond `width` is returned unchanged.
    """
    if width < 0:
        raise ValueError("width must be >= 0")
    return text.ljust(width)
