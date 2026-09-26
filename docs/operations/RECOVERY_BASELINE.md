# AlphaKolect / Alphaweb — Recovery Baseline

Date: 2026-09-25
Recovery branch: `recovery/alphaweb-takeover`
Production checkout: `/home/mayowae/public_html/alphaweb`

## Git Baseline

* Main branch was clean at takeover.
* HEAD: `a5c23e6d3dadc726183a50fac5894047e85ce85f`
* Remote: `git@github.com:mayowae/Alphaweb.git`
* Recovery branch created locally.
* No application code has been modified during takeover mapping.
* Current untracked recovery documents:
  * `AUDIT_REPORT.md`
  * `RECOVERY_BASELINE.md`

## Production Runtime — Verified During Recovery Mapping

* Backend: PM2 process `alphaweb-backend`
* Frontend: PM2 process `alphaweb-frontend`
* Production database is local to the VPS.
* Nginx service was observed active during the server mapping.
* Production Alphaweb services were not restarted, reloaded, deleted, or otherwise intentionally modified during recovery mapping.

## Repository / Infrastructure Findings

* The repository contains tracked environment files and other sensitive infrastructure material requiring remediation.
* The repository contains numerous legacy deployment and diagnostic scripts, including scripts containing historical production credentials.
* The repository contains unrelated infrastructure/client material that requires later cleanup and boundary review.
* These findings have not yet been remediated.
* `AUDIT_REPORT.md` remains untracked and has not been committed.

## Recovery Status

Phase 0 forensic mapping is **in progress**.

### Completed / Established

* Local Git baseline established.
* Recovery branch created.
* Production application checkout identified.
* Production runtime processes identified.
* Production database location established as local to the VPS.
* Production environment variable inventory identified without recording secret values.
* Server GitHub authentication identities inspected.
* Legacy deployment infrastructure identified.
* Repository `.gitignore` policy inspected.
* No production application changes made during the recovery mapping.

### Open Items

1. **Production backup (0.3)**
   * Create/verify a production database backup.
   * Create/verify a safe application/files backup before remediation.

2. **Existing backup directory**
   * Verify whether `/home/mayowae/public_html/alphaweb/backups/` contains existing database or mailbox archives.
   * Verify whether the directory is accessible from the web server.
   * Do not expose, download, or modify any existing backup until its contents and access path are understood.

3. **Server access inventory (0.6)**
   * Complete and document the `authorized_keys` inventory.
   * Document which GitHub identity the server's root Git key authenticates as.
   * Do not remove or rotate existing keys until their operational dependencies are understood.

4. **GitHub repository access**
   * Verify the current permission level for the recovery operator on `mayowae/Alphaweb`.
   * Review the repository Collaborators list.
   * Review repository Deploy keys.
   * Identify active automation/deployment identities before changing or revoking access.

## Security Handling

* No passwords, API keys, JWT secrets, database credentials, SMTP credentials, or provider secrets are recorded in this document.
* Historical credentials discovered in the repository are considered compromised and will be handled during the remediation phase.
* No credential rotation has been performed yet.
* No production deployment has been performed.
* No production database schema or application code has been modified.

## Next Recovery Principle

Before changing authentication, secrets, deployment configuration, repository history, or production application code:

1. Establish a recoverable production backup.
2. Establish who/what currently has production and repository access.
3. Preserve the current state sufficiently to allow rollback.
4. Then begin controlled remediation.
