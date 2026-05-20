#!/usr/bin/env python3
"""View DDC 2026 registrations from registrations.json or live from the worker."""

import datetime
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

WORKER_URL = "https://ddc2026-registration.heikki-wilenius.workers.dev/registrations"

def fetch_live(token):
    req = urllib.request.Request(WORKER_URL, headers={
        "Authorization": f"Bearer {token}",
        "User-Agent": "curl/8.0",
    })
    with urllib.request.urlopen(req) as r:
        return json.load(r)

def load_local():
    p = Path(__file__).parent / "registrations.json"
    with open(p) as f:
        return json.load(f)

def fmt_bool(v):
    return "✓" if v else "·"

def print_table(regs, verbose=False):
    paid = [r for r in regs if r.get("paidConfirmedAt")]
    unpaid = [r for r in regs if not r.get("paidConfirmedAt")]

    total_revenue = sum(r.get("totalCost", 0) for r in paid)

    print(f"\n{'─'*90}")
    print(f"  {'#':<3} {'Name':<28} {'Partner':<24} {'Div':<6} {'Cost':>4}  {'Paid':<5} {'Sat':<3} {'Sun':<3} {'Fri':<3} {'Discs':<5} {'Allergies'}")
    print(f"{'─'*90}")

    for i, r in enumerate(regs, 1):
        paid_mark = "PAID" if r.get("paidConfirmedAt") else "    "
        partner = r.get("partner") or ("OPEN" if r.get("lookingForPartner") else "—")
        allergies = r.get("allergies") or ""
        print(
            f"  {i:<3} {r['name']:<28} {partner:<24} {r['division']:<6} {r['totalCost']:>4}  "
            f"{paid_mark:<5} {fmt_bool(r.get('lunchSat')):<3} {fmt_bool(r.get('lunchSun')):<3} "
            f"{fmt_bool(r.get('fridayPickup')):<3} {r.get('extraDiscs', 0):<5} {allergies}"
        )
        if verbose:
            print(f"       email: {r['email']}   registered: {r['registeredAt'][:10]}")

    print(f"{'─'*90}")
    print(f"  {len(regs)} registrations  |  {len(paid)} paid  |  {len(unpaid)} pending  |  revenue: €{total_revenue}")

    if unpaid:
        print(f"\n  Pending payment:")
        for r in unpaid:
            claims = " (claims paid)" if r.get("claimsToHavePaid") else ""
            print(f"    · {r['name']} <{r['email']}>{claims}")

    open_div = [r for r in regs if r["division"] == "open"]
    women_div = [r for r in regs if r["division"] == "women"]
    mixed_div = [r for r in regs if r["division"] == "mixed"]
    print(f"\n  Divisions: open={len(open_div)}  women={len(women_div)}  mixed={len(mixed_div)}")

    looking = [r for r in regs if r.get("lookingForPartner")]
    if looking:
        print(f"  Looking for partner: {', '.join(r['name'] for r in looking)}")
    print()

def print_totals(regs):
    n = len(regs)
    lunch_sat = sum(1 for r in regs if r.get("lunchSat"))
    lunch_sun = sum(1 for r in regs if r.get("lunchSun"))
    courts = sum(1 for r in regs if r.get("court"))
    extra_discs = sum(r.get("extraDiscs", 0) for r in regs)

    print(f"\n{'─'*40}")
    print(f"  Totals ({n} registrations)")
    print(f"{'─'*40}")
    print(f"  Lunch Saturday July 25th  {lunch_sat:>4}")
    print(f"  Lunch Sunday July 26th    {lunch_sun:>4}")
    print(f"  Courts                    {courts:>4}")
    print(f"  Discs — default (×1)      {n:>4}")
    print(f"  Discs — extra             {extra_discs:>4}")
    print(f"  Discs — total             {n + extra_discs:>4}")
    print(f"{'─'*40}\n")


def item_lines(r):
    items = [("Registration fee", 120)]
    if r.get("lunchSat"):
        items.append(("Lunch Saturday July 25th", 15))
    if r.get("lunchSun"):
        items.append(("Lunch Sunday July 26th", 15))
    if r.get("court"):
        items.append(("SweDisc Pro Court", 100))
    n = r.get("extraDiscs", 0)
    if n:
        items.append((f"Extra discs ×{n}", n * 10))
    return items


def write_invoices(regs, filepath):
    out = []
    out.append("# DDC European Open 2026 — Invoices")
    out.append(f"\nGenerated: {datetime.date.today()}")

    for i, r in enumerate(regs, 1):
        out.append("\n---")
        out.append(f"\n## {i}. {r['name']}")
        out.append(f"\n**Email:** {r['email']}")
        partner = r.get("partner")
        if partner:
            out.append(f"**Partner:** {partner}")
        elif r.get("lookingForPartner"):
            out.append("**Partner:** *(looking for partner)*")
        out.append(f"**Division:** {r.get('division', 'open')}")
        confirmed = "Confirmed" if r.get("paidConfirmedAt") else "Not confirmed"
        out.append(f"**Participation:** {confirmed}")

        items = item_lines(r)
        out.append("\n| Item | Amount |")
        out.append("|------|-------:|")
        for label, amount in items:
            out.append(f"| {label} | {amount}€ |")
        out.append(f"| **Total** | **{r['totalCost']}€** |")

    with open(filepath, "w") as f:
        f.write("\n".join(out) + "\n")
    print(f"Invoices written to {filepath} ({len(regs)} registrations)")


def main():
    args = sys.argv[1:]
    verbose = "-v" in args
    totals = "--totals" in args
    args = [a for a in args if a not in ("-v", "--totals")]

    invoice_file = None
    if "--invoices" in args:
        idx = args.index("--invoices")
        args.pop(idx)
        if idx < len(args) and not args[idx].startswith("-"):
            invoice_file = args.pop(idx)
        else:
            invoice_file = "invoices.md"

    since_date = None
    if "--since" in args:
        idx = args.index("--since")
        args.pop(idx)
        if idx < len(args):
            raw = args.pop(idx)
            try:
                since_date = datetime.datetime.strptime(raw, "%d.%m.%Y").date()
            except ValueError:
                print(f"Error: --since expects dd.mm.yyyy, got '{raw}'", file=sys.stderr)
                sys.exit(1)
        else:
            print("Error: --since requires a date argument (dd.mm.yyyy)", file=sys.stderr)
            sys.exit(1)

    if args and args[0] == "--live":
        token = args[1] if len(args) > 1 else input("Admin token: ")
        regs = fetch_live(token)
    else:
        regs = load_local()

    if since_date:
        regs = [r for r in regs if datetime.date.fromisoformat(r["registeredAt"][:10]) >= since_date]

    if invoice_file:
        write_invoices(regs, invoice_file)
    elif totals:
        print_totals(regs)
    else:
        print_table(regs, verbose=verbose)

if __name__ == "__main__":
    main()
