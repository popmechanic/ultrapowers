from apistub.schema import FIELDS


def validate_payload(payload):
    errors = []
    for key, typ in FIELDS.items():
        if key not in payload:
            errors.append(f"missing: {key}")
        elif not isinstance(payload[key], typ):
            errors.append(f"wrong type: {key}")
    email = payload.get("email")
    if isinstance(email, str) and "@" not in email:
        errors.append("invalid: email")
    return errors
