from dataclasses import dataclass

FIELDS = {"name": str, "email": str}


@dataclass
class User:
    id: int
    name: str
    email: str
