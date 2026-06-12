import re

from ledger.model import Entry


def parse_line(line):
    parts = line.split("|")
    if len(parts) != 3:
        raise ValueError("bad line")
    date, description, amount = parts
    if not re.fullmatch(r"-?\d+\.\d{2}", amount):
        raise ValueError("bad amount")
    sign = -1 if amount.startswith("-") else 1
    dollars, cents = amount.lstrip("-").split(".")
    entry = Entry(date=date, description=description,
                  amount_cents=sign * (int(dollars) * 100 + int(cents)))
    entry.validate()
    return entry
