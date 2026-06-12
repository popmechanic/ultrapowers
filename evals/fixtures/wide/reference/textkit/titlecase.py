MINOR = {"a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to"}


def titlecase(text):
    words = text.split()
    if not words:
        return ""
    last = len(words) - 1
    out = []
    for i, word in enumerate(words):
        if word.lower() in MINOR and i not in (0, last):
            out.append(word.lower())
        else:
            out.append(word[:1].upper() + word[1:].lower())
    return " ".join(out)
