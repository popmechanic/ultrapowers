from dataclasses import dataclass


@dataclass
class Entry:
    date: str
    description: str
    amount_cents: int
