from ledger.balance import running_balance


def format_cents(cents):
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}${cents // 100}.{cents % 100:02d}"


def format_report(entries):
    lines = [f"{e.date} {e.description} {format_cents(e.amount_cents)}"
             for e in entries]
    balances = running_balance(entries)
    lines.append(f"TOTAL {format_cents(balances[-1] if balances else 0)}")
    return "\n".join(lines)
