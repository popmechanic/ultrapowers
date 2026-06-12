import re


def redact(text, words):
    for word in words:
        text = re.sub(r"\b" + re.escape(word) + r"\b",
                      lambda m: "*" * len(m.group(0)), text, flags=re.IGNORECASE)
    return text
