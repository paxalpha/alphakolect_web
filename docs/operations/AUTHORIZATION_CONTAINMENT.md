# Authorization Containment Runbook

**Status: operational procedure for P5.5 containment control.** Use only for a suspected or confirmed over-authorization incident. This is not a substitute for incident response or a code fix; containment is temporary and fixes are forward-only.

## Authority And Scope

- The business owner may authorize suspension of merchant staff grants.
- The super administrator may authorize suspension of platform staff grants.
- The technical lead may set the relevant flag immediately in an emergency, then informs the owner or super administrator straight away and records when and how they were informed.
- Only the owner may approve lifting merchant-grant containment; only the super administrator may approve lifting platform-grant containment. Record the approval and its scope before issuing any command that turns a flag off.
- The application cannot execute this operation. It requires the operator's approved `DATABASE_MIGRATOR_URL`. Do not put credentials in command arguments or incident notes.

A set flag causes the resolver and database write-time checks to ignore grants of that kind from the next request, including a write waiting for its re-check. The fixed merchant-owner and platform-super-administrator permission sets remain available. Set both flags explicitly on every change so changing one scope cannot accidentally clear the other.

## Detect And Contain

Treat unexpected access, a faulty grant writer/resolver, or an unexplained sensitive read as an incident. Preserve request IDs, relevant audit-event IDs, deployment versions, timestamps, and the initial scope. Do not copy IP addresses or user-agent values into general incident notes.

First record the current state:

```powershell
pnpm --filter @alphakolect/api admin:containment -- --status
```

Expected output names whether merchant and platform grants are `SUSPENDED` or `in effect`, plus the update timestamp. If status cannot be read, stop ordinary grant changes and escalate to the technical lead; do not infer the current state.

If one specific, understood grant is the only issue and the normal writer is trusted, the appropriate owner or super administrator may remove that grant through the normal audited management flow. If the grant set, resolver, or write-time enforcement cannot be trusted, set the relevant containment flag.

Examples, each specifying both flags:

```powershell
pnpm --filter @alphakolect/api admin:containment -- --merchant on --platform off --reason "incident reference; merchant staff grants suspended"
pnpm --filter @alphakolect/api admin:containment -- --merchant off --platform on --reason "incident reference; platform staff grants suspended"
pnpm --filter @alphakolect/api admin:containment -- --merchant on --platform on --reason "incident reference; both staff grant classes suspended"
```

Expected output begins `Containment set and recorded:` and reports both effective flags, followed by `It applies from the next request.` The command writes the operator event `platform.authorization_containment_set`. Verify the result with `--status` and record the output and event ID/reference in the incident record.

If a particular staff account is compromised, the relevant owner or super administrator should also deactivate that membership through its normal writer, which revokes its sessions. Restore the membership only after the incident review; a reactivated platform staff member returns with no grants.

## Notify And Reconcile

1. Notify affected business owners in a direct, recorded channel that staff access has been temporarily paused, which staff-grant scope is affected, when the pause began, and what remains available to the owner. Do not disclose another business's information or include IP/user-agent details. For a platform-grant incident, notify the owner/super administrator and affected business owners when their service or access is affected.
2. Review the relevant activity record and incident evidence. Sensitive reads and privileged writes are audited; confirm the actor, scope, action, and time using the approved audit interfaces. Do not query audit tables through an unapproved path.
3. The merchant owner confirms the intended merchant role grants; the super administrator confirms the intended platform staff grants. Remove unintended grants through the audited grant writers. Reproduce the cause with a regression test and fix forward in code or a new migration.
4. Before lifting a flag, require the full regression test for the incident, the P5.9 authorization matrix, and the agreed full local gate to pass. Obtain explicit approval from the authority listed above. Record the approver, timestamp, scope, and evidence in the incident record before running the lift command.
5. Lift only the approved scope, again specifying both flags. For example, after merchant approval and with platform containment intentionally retained:

```powershell
pnpm --filter @alphakolect/api admin:containment -- --merchant off --platform on --reason "incident reference; merchant owner approved lift at YYYY-MM-DD HH:MM UTC"
```

The command prints `Containment set and recorded:` with the resulting state. Verify with `--status`, retain the event reference, and notify affected business owners that staff access has resumed and when. Do not lift the other flag unless its own authority separately approves it.

## Close The Incident

Record the timeline, impact and affected authorization scope; containment state transitions and event references; notifications; grant reconciliation; regression test and forward fix; approval to lift; and post-lift verification. Store the incident record in the approved security location with access restricted to incident responders. Never include credentials, report contents, request bodies, IP addresses, or user-agent details in the incident narrative.
