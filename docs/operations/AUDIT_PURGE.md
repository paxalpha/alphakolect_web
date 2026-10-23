# Audit Retention Purge Runbook

**Status: operator runbook draft.** This runbook describes the P5.8 retention/report implementation. Use only after the P5 deployment and operational approvals are complete. It is not the owner-approved privacy policy. Never use production data to validate this procedure; test against the designated test database first.

## Preconditions

- Run from the persistent, designated operator machine, under the one operator OS account used for every purge command. Do not run in a container, a cloned VM, a transient CI runner, or another network namespace. Do not clone or restore the machine while an export or report exists.
- Configure `DATABASE_MIGRATOR_URL` in the API environment using the approved secret store. Purge commands use the migrator role; never substitute the application or database-superuser credentials. Do not paste credentials into a command, issue, log, or report.
- Ensure the machine and the temporary report volume are protected by full-disk encryption. Do not use a synced folder, network drive, backup target, or a volume with shadow copies/System Restore points. Keep the operator's temporary report directory local, owner-only, and outside every Git worktree. The purge command checks several of these conditions but cannot prove encryption or detect every sync/backup product.
- Use a filesystem that supports hard links for the temporary report directory. On POSIX, its mode must deny access to group and others. On Windows, its ACL must grant access only to the operator, `SYSTEM`, and `Administrators`.
- The owner must be present for the physical report handover. Use a separate removable USB medium, not a card in a reader that remains attached. Give the medium a distinctive, non-default volume label. The medium must not be the report volume.

## Run The Purge

**When:** once a month, on the first working day (the owner's decision, 2026-10-18), until scheduled runs exist (P12). Review the listing (`audit:purge-reports`) at the same time, and at least weekly while a copy is requested.

A plain run deletes only eligible events strictly older than the two-calendar-year cutoff and clears eligible IP/user-agent metadata. Each page and its audit event commit in one transaction. An open report request switches the next run to export mode; it deletes no audit rows and requires `--dir`.

```powershell
pnpm --filter @alphakolect/api run audit:purge
```

For a requested report, create a private local directory first. A new folder inherits its parent's access list, which usually names other accounts, and the command then refuses it (`non_operator_acl`). On Windows, remove the inherited entries and grant only the operator, `SYSTEM` and `Administrators`:

```powershell
New-Item -ItemType Directory "D:\Private\AlphaKolectReport"
icacls "D:\Private\AlphaKolectReport" /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" /grant:r "*S-1-5-18:(OI)(CI)F" /grant:r "*S-1-5-32-544:(OI)(CI)F"
```

On Linux, `mkdir -m 700` gives the same result. Then run:

```powershell
pnpm --filter @alphakolect/api run audit:purge -- --dir "D:\Private\AlphaKolectReport"
```

By default the run's as-of time is the database's clock. A refusal of a folder names its reason (for example `non_operator_acl`, `owner_mismatch`, `not_local_fixed_disk`); correct the folder and run again.

A plain run prints a JSON result with `kind: "plain"`, run ID, page and row counts, and metadata count. An export prints `kind: "export"`, report ID, local path, SHA-256, row/page counts, and whether the directory was flushed. If Windows cannot flush the directory, the command reads the published file back before confirmation and prints a warning. If an open request has no `--dir`, it prints `kind: "export_skipped"`; no audit rows are deleted and no report is made.

Keep the process running until it exits. A stopped export may leave an unresolved database record; do not manually delete or rename files until recovery has been recorded.

## Request, List, And Cancel

Record the owner's written request reference. The note is an internal reference, not personal data or the activity data itself.

```powershell
pnpm --filter @alphakolect/api run audit:purge-request-report -- --note "owner request reference"
pnpm --filter @alphakolect/api run audit:purge-reports
```

The listing includes open requests, unresolved exports, reports, handover attempts, seven-day reminders, and outstanding copy/fate states. Run filesystem checks only on the recorded writing machine; this acquires the purge lock:

```powershell
pnpm --filter @alphakolect/api run audit:purge-reports -- --check-files
```

File checks report `present_and_matching`, `missing`, `altered`, or `directory_unavailable`. A marker is evidence tying a path to a run and host. Do not remove a marker while its export or report outcome is unresolved.

On the owner's written cancellation instruction, cancel the open request by its ID. The database withdraws an active report and releases its held manifest in the same transaction; a live handover must first be ended and the fate of each stick recorded. Then securely destroy the operator copy and record that separately if the command did not complete it automatically.

```powershell
pnpm --filter @alphakolect/api run audit:purge-request-cancel -- --request <request-id> --note "written cancellation reference"
```

## Deliver A Report

1. Run the export on the writing machine with the private local directory. Record the report ID, path, and SHA-256 from its output. Do not email or upload the report.
2. With the owner present, write it to a separate, labeled removable medium. This is the first handover invocation:

```powershell
pnpm --filter @alphakolect/api run audit:purge-report-handover -- --report <report-id> --to "E:\"
```

The command records an attempt, creates the report file exclusively on the medium, flushes it, and prints the attempt ID. Safely eject the medium, physically unplug it, then reinsert it. Do not use a card in a reader that remains connected.
3. Start a fresh command process to verify the reinserted medium. Use the same path and the printed attempt ID:

```powershell
pnpm --filter @alphakolect/api run audit:purge-report-handover -- --report <report-id> --attempt <attempt-id> --verify --to "E:\"
```

At the interactive prompt, type the requested eject phrase exactly, including the attempt ID and medium label. A different volume serial, label, path, an unchanged/unreadable Linux disk sequence, an unconfirmed eject, or another non-file verification refusal changes no database state; correct the physical condition and retry. An unreadable, truncated, or hash-mismatched file is recorded as a failed attempt. Do not treat a write-time readback as proof of a physical eject.
4. Once verification succeeds, obtain the owner's written receipt. It must identify the attempt, medium label, and the report SHA-256 (at least the first 16 characters). Record the receipt reference and an operational note:

```powershell
pnpm --filter @alphakolect/api run audit:purge-report-delivered -- --report <report-id> --attempt <attempt-id> --receipt "receipt reference" --note "receipt filed; no other operator copy retained"
```

Delivery satisfies the request and releases the event manifest. The command then destroys and verifies the operator copy. If destruction remains pending, resolve it before another purge run can proceed; never claim destruction before the run-named files are gone.

## Recovery And Exceptional States

- **Unresolved export:** On the recorded machine, inspect `audit:purge-reports -- --check-files`. If the recorded marker and artifact timestamp prove the run's directory, the automatic path removes only the two run-named report files, records the discard, then removes the marker. Otherwise inspect and remove the run-named files yourself before attesting. Do not remove unrelated files.

```powershell
pnpm --filter @alphakolect/api run audit:purge-export-discarded -- --run <run-id>
pnpm --filter @alphakolect/api run audit:purge-export-discarded -- --run <run-id> --attest "files inspected and removed; reference"
pnpm --filter @alphakolect/api run audit:purge-export-discarded -- --run <run-id> --lost "machine or volume lost; owner notified"
```

Use `--lost` only when the machine or volume is gone. Notify the owner and record the incident through the approved security incident process. An unresolved export blocks new purge runs.

- **Interrupted/failed handover:** The listing shows unended or failed attempts. Securely wipe or physically destroy the medium; deleting a file on flash media is not proof that its bytes were erased. Record the fate before retrying with another medium:

```powershell
pnpm --filter @alphakolect/api run audit:purge-report-handover-abandoned -- --attempt <attempt-id> --note "medium securely wiped/destroyed; reference"
```

- **Lost report before delivery:** First end every handover attempt and attest each medium's fate. On the writing machine, the command removes the run-named operator files automatically; use `--attest` only after confirming those files are absent, or `--lost` if the machine/volume is gone. Notify the owner; a later purge run creates a replacement report from the entries then due.

```powershell
pnpm --filter @alphakolect/api run audit:purge-report-lost -- --report <report-id> --note "loss reference"
pnpm --filter @alphakolect/api run audit:purge-report-lost -- --report <report-id> --attest "files absent; inspected by operator"
pnpm --filter @alphakolect/api run audit:purge-report-lost -- --report <report-id> --lost "writing machine or volume lost; owner notified"
```

- **Copy destruction still pending after delivery/withdrawal:** On the recorded machine, retry automatic destruction. If the directory is unavailable, use an attestation only after confirming the final and partial report files are absent. If the machine or volume is gone, record it as lost and notify the owner.

```powershell
pnpm --filter @alphakolect/api run audit:purge-report-destroyed -- --report <report-id> --note "no other operator copy retained"
pnpm --filter @alphakolect/api run audit:purge-report-destroyed -- --report <report-id> --attest "run-named files absent; inspected by operator"
pnpm --filter @alphakolect/api run audit:purge-report-destroyed -- --report <report-id> --lost "writing machine or volume lost; owner notified"
```

For a reported state that cannot be safely reconciled, stop. Do not edit purge tables directly or manually update an outcome. Preserve the evidence and escalate to the technical lead.

## Reminders, Markers, And The Lock

Review the report listing at least weekly. At seven days it flags an open request awaiting a copy, a report awaiting handover, a verified handover awaiting receipt, or a written medium awaiting verification. Remind the owner in writing and keep the event rows held; reminders do not authorize deletion.

After the database records a terminal export/report outcome, `--check-files` may list a leftover marker. Confirm the run/report state and that no command is active before removing only that run's `.marker` file. Do not remove a marker while an outcome is unresolved; never remove a report file by a broad wildcard.

Every state-changing command uses the same OS-held lock. If a command reports lock contention, do not delete a lock file or force another run. On Windows, use Sysinternals Handle or Process Explorer's handle search for `alphakolect-purge-<SID>`; identify the process and let an active command finish. On Linux, inspect the abstract Unix socket with `ss -xap` and identify the owning process. A connected client or another process squatting on the name is a stop condition; resolve it with the technical lead. The OS releases the lock when its owning process exits.

## Rehearsal Before The First Real Copy

The automated tests cover every database rule and the command's file, lock and recovery behaviour, but not what needs real hardware. Before the first copy is handed to the owner, the operator rehearses those steps once, on the operator machine, against a **test database** (never production; `DATABASE_MIGRATOR_URL` pointing at a throwaway database with a few activity entries older than two years), and records the date, the medium used and each outcome in the purge record of the P5 plan. A step that does not behave as expected stops the first real handover until it is fixed.

1. **A FAT or exFAT folder is refused.** Point `audit:purge -- --dir` at a folder on a FAT- or exFAT-formatted stick. Expected: refused before anything is recorded (`report_directory_must_support_hard_links`, or `not_local_fixed_disk` on Windows).
2. **The handover, end to end.** Request a copy, export it, and hand it over to a labelled removable stick with `audit:purge-report-handover --report <id> --to <stick>`. Expected: the attempt is recorded and the file written; after a safe eject, unplugging and reinserting, a **new** `--verify` command with the printed attempt id asks for the eject phrase and records the handover.
3. **The stick's checks refuse, changing nothing.** With the same stick: a stick with an empty or default label (`NO NAME`, `UNTITLED`) is refused (`medium_requires_nondefault_volume_label`); verifying against a different stick is refused (serial mismatch) and the attempt stays unended; a report file changed or truncated on the stick between the two steps is caught (the attempt is recorded as failed and the file removed from the stick); on Linux, a verification without unplugging is refused (`diskseq_unchanged`) where the kernel provides a disk sequence.
4. **The volume removed.** With an export's folder on a second fixed or removable volume, take the volume offline (or unmount it) and run `audit:purge-reports -- --check-files`. Expected: `directory_unavailable`; `audit:purge-report-destroyed` and `audit:purge-export-discarded` without `--attest` or `--lost` refuse and record nothing. Bring the volume back and the automatic path works again.
5. **A full disk.** With the export folder on a small volume (a small VHD on Windows, a small loop device or tmpfs on Linux) filled almost to capacity, run an export. Expected: it fails, deletes no row, removes its own partial file and marker, and records the export discarded; the request stays open.
6. **On Linux**, a folder open to group or others (`chmod 750`) is refused (`report_directory_not_owner_only`). The Linux CI run of the automated tests checks this too.

Finish by cancelling the rehearsal's request in writing (`audit:purge-request-cancel`), confirming with `--check-files` that no run files or markers remain, wiping the stick, and dropping the test database.
