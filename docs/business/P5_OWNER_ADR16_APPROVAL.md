# AlphaKolect: Approving the Written Rules for Staff Access (ADR-16)

**For:** the owner of AlphaKolect
**Prepared:** 12 October 2026
**Why:** Building has started with Part 1. Its first step was to write down, in one place, the rules the system will
follow — the technical document is called **ADR-16**. Before the next step, you are asked to confirm that it says what
you decided, and to accept two consequences. The independent reviewer checks the technical parts separately; this
form only covers what is yours to decide. As before, **"Not sure" is a fine answer.**

**Answered by:** ____________________ **Date:** ____________________

---

## Part A — Does it say what you decided?

Each line below is one of your decisions, as written in ADR-16. Tick **Correct**, or **Not right** and say what.
Nothing here is new: these are your earlier answers, restated.

| # | What ADR-16 says | Correct | Not right |
|---|---|---|---|
| A1 | **Only the business owner** invites staff and agents, cancels invitations, changes a staff member's role or branch, switches people off or back on, and edits roles and their permissions. Staff cannot do any of these. The owner may give a staff member one branch or all branches. | ☐ | ☐ | - Correct: the owner is the only one who can manage staff and their permissions. Staff cannot manage other staff or their own permissions.
| A2 | **Only the business owner** sees the business's activity record — including refused attempts — and can look at one person's actions. Staff can never be given access to it. | ☐ | ☐ | - Correct: the owner is the only one who can view the activity record, and staff cannot access it.
| A3 | **Your platform team:** you add a person with an email that has **no** AlphaKolect account; they start with **no** permissions, and you give each person exactly what they need. When someone leaves, their permissions are removed; if they come back, they start again with none. | ☐ | ☐ | - Correct: the platform team manages user accounts and permissions, ensuring that users have the appropriate access based on their roles.
| A4 | **Platform and business accounts stay apart, both ways:** a platform team account can never join a business, and a business account can never be made a platform account. | ☐ | ☐ | - Correct: this separation ensures that the platform and business operations remain distinct and secure.
| A5 | **Internet addresses and device details** are kept to investigate break-ins and settle disputes. Only each business owner (for their own people) and you can see them — **never** your platform team. Business owners never see your team's address or device. They are also kept out of the system's technical logs. | ☐ | ☐ | - Correct: this protects user privacy and maintains the integrity of the system's technical infrastructure.
| A6 | **The two-year rule** (built later, after its own approval): every activity entry, including existing ones, is deleted after two years; you may ask for a copy first, and the system keeps no copy. | ☐ | ☐ | - Correct: this rule helps manage data retention and ensures compliance with data protection regulations.
| A7 | **Already agreed:** permissions are added feature by feature; "view" and "change" are separate; an archived role gives no access; a staff member tied to an archived branch reaches nothing kept per branch; security changes are saved only together with their record; the record of who did something comes from their own sign-in; permission is checked again just before any change is saved. | ☐ | ☐ | - Correct: this ensures that permissions are managed consistently and securely across all features of the system.

> If anything is not right, say what:

---

## Part B — One risk to accept

For **changes**, the system checks permission **twice**: once in the app, and again in the database itself, so a
mistake in one is caught by the other. For **viewing** most screens, it checks **once**, in the app:

- the business details, the list of branches, the roles and their permissions, and
- **the list of invitations — which shows the email addresses of the people invited.**

The database still keeps every business completely separate, so a mistake could **never** show one business's
information to another business. But a mistake in that single check could show these screens to a staff member of
**the same business** who was not given permission to see them. Every screen is tested against every kind of user to
catch such a mistake, and the risk is written down so it is not forgotten.

**B1.** How should we handle this?

- ☐ **Accept it for now.** Keep the single check for these screens, tested and written down. *(Our suggestion: changes
  and sensitive screens already have the double check; adding it here is a later improvement.)*
- ☐ **Add the database check now** for these screens too. *(More work in this stage, so building takes longer.)*

> Answer: Add the database check now for these screens too. We want to be sure that all screens are secure, and adding the database check now will provide an extra layer of protection against potential mistakes.

---

## Part C — One consequence to accept

You decided that security changes — signing in, changing a password, two-step codes — are saved **only together with
their activity record**. The consequence: if the activity record ever cannot be written (for example, a database
problem), **people cannot sign in** until it is fixed. The system stops rather than act without a record. When the
system goes live, an alert will warn whoever runs it as soon as this happens.

**C1.**

- ☐ **Accept.** Security first: no sign-in without its record. *(Our suggestion; it follows your decision.)*
- ☐ Let's discuss

> Answer: What do you recommend we do to ensure that the activity record is always available and that sign-ins are not disrupted? Are there any backup systems or redundancies in place to prevent this issue from occurring?

---

## Part D — Your approval

> I approve ADR-16 for Part 1, with the answers above:
>
> ☐ Yes ☐ Not yet
> Yes i approve ADR-16 for Part 1, with the answers above.
> Name: Mayowa Edward Fadahunsi Date: 12th of October, 2026
