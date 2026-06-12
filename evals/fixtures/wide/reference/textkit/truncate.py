def truncate(text, limit, ellipsis="..."):
    if limit < len(ellipsis):
        raise ValueError("limit smaller than ellipsis")
    if len(text) <= limit:
        return text
    return text[: limit - len(ellipsis)].rstrip() + ellipsis
