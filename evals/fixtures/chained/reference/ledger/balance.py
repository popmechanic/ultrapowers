def running_balance(entries):
    out, total = [], 0
    for entry in entries:
        total += entry.amount_cents
        out.append(total)
    return out
