import json


def to_json(user):
    return json.dumps({"id": user.id, "name": user.name, "email": user.email})
