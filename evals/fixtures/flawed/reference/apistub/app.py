import json
import re

from apistub.handlers import create_user, get_user


def route(store, method, path, payload=None):
    if method == "POST" and path == "/users":
        return create_user(store, payload)
    match = re.fullmatch(r"/users/(\d+)", path)
    if method == "GET" and match:
        return get_user(store, int(match.group(1)))
    return 404, json.dumps({"errors": ["no route"]})
