import re
from dataclasses import dataclass


@dataclass
class Entry:
    date: str
    description: str
    amount_cents: int

    def validate(self):
        if not self.description.strip():
            raise ValueError("empty description")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", self.date):
            raise ValueError("bad date")
