# AlphaKolect: Two Short Follow-ups on the Written Rules (ADR-16)

**For:** the owner of AlphaKolect
**Prepared:** 12 October 2026
**Why:** Thank you for approving the written rules. You asked a good question in C1, so here is our answer, and one
of your notes needs a quick confirmation. Your decision to add the database check to every screen (B1) is recorded and
will be built. As before, **"Not sure" is a fine answer.**

**Answered by:** ____________________ **Date:** ____________________

---

## Your question (C1): can the activity record stop sign-ins, and what protects against it?

**Our answer.**

- **The activity record is not a separate system.** It lives in the same database as the accounts and sign-ins
  themselves. If that database is down, nobody can sign in anyway — with or without the record. So the case "the
  record fails but everything else works" is rare.
- **The realistic way it could fail on its own is a programming mistake** — for example, new code trying to save an
  entry the record does not accept. That is caught **before** it reaches anyone: every kind of entry is tested with a
  real sign-in before any release.
- **For the database itself, protection comes when the system goes live** (the deployment stage): a standby copy that
  takes over automatically if the main database fails, continuous backups, and an alert the moment anything goes
  wrong.

**Our recommendation:** keep your rule — no security change without its record — and require the protections above
when the system goes live.

**C1.** Do you accept?

- ☐ **Yes** — keep the rule, with the protections above *(our suggestion)*
- ☐ No — let's discuss

> Answer:

**C2.** If the main database fails, how much may be lost and how long may the system be down? (This tells the
deployment stage how strong the standby and backups must be — stricter targets cost more to run.)

- ☐ **Lose at most 5 minutes of activity; back within 1 hour** *(our suggestion)*
- ☐ Lose at most 1 hour; back within 4 hours
- ☐ Other:
- ☐ Not sure — please advise when the system goes live

> Answer:

---

## A quick confirmation (A3)

Next to A3 you wrote: *"the platform team manages user accounts and permissions, ensuring that users have the
appropriate access based on their roles."* We want to be sure we built what you meant. ADR-16 says:

- **only you** add, remove and bring back members of your platform team, and only you give them permissions;
- permissions are given **person by person** — the label "support", "verification" or "finance" gives no access by
  itself.

**A3.** Is that right?

- ☐ **Yes** — only I manage my team, person by person
- ☐ No — my team should also be able to manage accounts or permissions (please say how):

> Answer:

---

> Name: Date:
