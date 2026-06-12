#!/usr/bin/env python3
"""Convert per-model token counts into API-equivalent USD.

For subscription-plan operators: pull per-model input/output token totals for a
run from the session transcript (or a tool like ccusage), then:

  api_equiv.py --fable 400000 40000 --sonnet 900000 90000 --haiku 60000 6000

Prices are $/MTok, cached 2026-06. Cache reads are billed at ~0.1x input on the
API; if your token source separates cache reads, pass them pre-discounted or
treat the result as an upper bound (state which in your notes).
"""
import argparse

PRICES = {  # $ per million tokens: (input, output)
    "fable": (10.0, 50.0),
    "opus": (5.0, 25.0),
    "sonnet": (3.0, 15.0),
    "haiku": (1.0, 5.0),
}


def main():
    p = argparse.ArgumentParser()
    for model in PRICES:
        p.add_argument(f"--{model}", nargs=2, type=int, metavar=("IN", "OUT"))
    args = p.parse_args()

    total = 0.0
    for model, (p_in, p_out) in PRICES.items():
        counts = getattr(args, model)
        if not counts:
            continue
        usd = counts[0] / 1e6 * p_in + counts[1] / 1e6 * p_out
        total += usd
        print(f"{model:7s} {counts[0]:>10,} in / {counts[1]:>9,} out  ${usd:.2f}")
    print(f"{'TOTAL':7s} {'':>10} {'':>15} ${total:.2f}")


if __name__ == "__main__":
    main()
