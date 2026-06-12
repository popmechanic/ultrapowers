import re


def slugify(text):
    """Lowercase, collapse runs of non-alphanumerics to single hyphens, strip edges."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
