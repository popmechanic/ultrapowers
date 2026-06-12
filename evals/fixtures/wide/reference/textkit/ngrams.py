def ngrams(tokens, n):
    if n < 1:
        raise ValueError("n must be >= 1")
    return [tuple(tokens[i:i + n]) for i in range(len(tokens) - n + 1)]
