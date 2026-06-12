from ledger.model import Entry


def test_entry_fields():
    e = Entry(date="2026-01-15", description="coffee", amount_cents=-450)
    assert (e.date, e.description, e.amount_cents) == ("2026-01-15", "coffee", -450)
