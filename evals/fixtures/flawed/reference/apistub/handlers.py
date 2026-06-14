import json

from apistub.serialize import to_json
from apistub.validate import validate_payload


def create_user(store, payload):
    errors = validate_payload(payload)
    if errors:
        return 400, json.dumps({"errors": errors})
    user = store.add(payload["name"], payload["email"])
    return 201, to_json(user)


def get_user(store, user_id):
    user = store.get(user_id)
    if user is None:
        return 404, json.dumps({"errors": ["not found"]})
    return 200, to_json(user)
