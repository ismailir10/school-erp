# Ops — Production setup

Manual procedures supporting `.github/workflows/backup.yml` and other Cycle B ops tasks. Run once during Cycle B Phase 2.

---

## 1. GPG keypair (Task 6)

The nightly backup workflow encrypts each `pg_dump` to a public key whose private counterpart never lives in CI. The public key (`ops/backup-public.asc`) is committed; the private key is stored in 1Password + paper safe.

### Generate the keypair (one time)

```bash
# ED25519 primary (certify only) + CV25519 encryption subkey. Two steps:
# ED25519 is a signing curve and CANNOT encrypt, so asking for `sign,encr`
# on it fails with "gpg: Key generation failed: Wrong key usage". The
# subkey must be added explicitly. Never expires; the UID is synthetic —
# the address never receives mail.
gpg --quick-generate-key "Talib Backup <backup@talib.local>" ed25519 cert never

# Capture the primary fingerprint, then hang the encryption subkey off it.
FPR=$(gpg --with-colons --fingerprint backup@talib.local | awk -F: '/^fpr:/{print $10; exit}')
gpg --quick-add-key "$FPR" cv25519 encr never

# Export the public key for the repo
gpg --armor --export backup@talib.local > ops/backup-public.asc

# Export the private key for 1Password + paper backup
gpg --armor --export-secret-keys backup@talib.local > /tmp/backup-private.asc

# The fingerprint captured above is the BACKUP_GPG_FINGERPRINT secret value
# (primary key, no spaces). The workflow refuses to encrypt against a key
# whose fingerprint doesn't match it — tamper-detection on the committed
# ops/backup-public.asc.
echo "$FPR"

# Sanity-check the key before committing it: this is exactly what the
# workflow runs, so a pass here means the backup will get past the key step.
gpg --armor --export backup@talib.local > ops/backup-public.asc
bash scripts/backup-prod.sh check-pubkey ops/backup-public.asc "$FPR"
```

### Store the private key

1. **1Password:** create vault item "Talib Backups" → attach `/tmp/backup-private.asc` as a Secure Note
2. **Paper safe:** print `/tmp/backup-private.asc` and the fingerprint on physical paper, store in safe
3. **Wipe local copy:** `shred -u /tmp/backup-private.asc`

### Recover (disaster scenario)

```bash
gpg --import /path/to/backup-private.asc
gpg -d dump.pgc.gpg > dump.pgc
pg_restore -d "$NEW_DB_DIRECT_URL" dump.pgc
```

---

## 2. Cloudflare R2 bucket (Task 6)

1. Cloudflare dashboard → **R2** → **Create bucket** → name `talib-backups`, region "Automatic"
2. Bucket settings → **Object lifecycle rules** → add rule: delete objects older than 30 days
3. **API tokens** (R2 → Manage API tokens):
   - Permission: `Object Read & Write`
   - Bucket scope: `talib-backups` only
   - TTL: forever
4. Capture: `Access Key ID`, `Secret Access Key`, and the S3-compatible endpoint URL (looks like `https://<accountid>.r2.cloudflarestorage.com`)

---

## 3. GitHub Actions secrets (Task 6)

Set as **Environment secrets** under the `production` environment (Settings → Environments → production → Secrets), NOT repo-level secrets. The workflow runs in `environment: production` which gates secret access behind required-reviewer approval.

```bash
# Run from worktree (or any clone — `gh` reads the repo from .git)
gh secret set PROD_DB_URL              --env production    # paste prod Supabase direct URL (port 5432)
gh secret set BACKUP_GPG_RECIPIENT     --env production    # value: backup@talib.local
gh secret set BACKUP_GPG_FINGERPRINT   --env production    # paste fingerprint from §1 (no spaces)
gh secret set R2_ACCESS_KEY_ID         --env production    # paste from R2 dashboard
gh secret set R2_SECRET_ACCESS_KEY     --env production    # paste from R2 dashboard
gh secret set R2_ENDPOINT              --env production    # paste S3-compat URL
```

Also create the environment + reviewer requirement:

```bash
# Create the environment (if not yet created)
gh api -X PUT repos/ismailir10/annisaa-erp-v3/environments/production
# Require self-review (owner is the only reviewer for solo-founder repo)
gh api -X PUT repos/ismailir10/annisaa-erp-v3/environments/production \
  -F 'reviewers[][type]=User' -F 'reviewers[][id]=$(gh api user --jq .id)'
```

Verify: `gh secret list --env production` shows all 6.

---

## 4. First backup run + verification (Task 7)

```bash
# Manually trigger the workflow
gh workflow run backup.yml --ref feat/cycle-b-prod-infra

# Watch the run
gh run watch
```

Then verify the encrypted blob is reachable + decryptable:

```bash
DATE=$(date -u +%Y/%m/%d)
aws s3 cp "s3://talib-backups/$DATE/dump.pgc.gpg" /tmp/dump.pgc.gpg \
  --endpoint-url "$R2_ENDPOINT"
gpg --import /path/to/backup-private.asc          # if not already imported locally
gpg -d /tmp/dump.pgc.gpg > /tmp/dump.pgc
pg_restore --list /tmp/dump.pgc | head -20         # should show table list
```

---

## 5. DR drill (Task 8)

Pause-staging restore drill. ~30 minutes off-hours. Detailed procedure lives in `docs/runbooks/prod-incident.md` §Restore once T11 lands; T8 records timing + restored row counts back into that runbook.

---

## 6. GitHub branch protection (Task 10)

Enable on `main` + `staging`:

```bash
gh api -X PUT repos/ismailir10/annisaa-erp-v3/branches/main/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=Checks' \
  -F 'required_status_checks.contexts[]=Test & Build' \
  -F 'required_status_checks.contexts[]=E2E' \
  -F enforce_admins=true \
  -F required_pull_request_reviews= \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false

# Repeat for staging
gh api -X PUT repos/ismailir10/annisaa-erp-v3/branches/staging/protection \
  -F required_status_checks.strict=true \
  -F 'required_status_checks.contexts[]=Checks' \
  -F 'required_status_checks.contexts[]=Test & Build' \
  -F 'required_status_checks.contexts[]=E2E' \
  -F enforce_admins=true \
  -F required_pull_request_reviews= \
  -F restrictions= \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```

Verify: `gh api repos/ismailir10/annisaa-erp-v3/branches/main/protection` returns the rule JSON.

### Emergency disable (hotfix path — Cycle B Q4 decision)

```bash
gh api -X DELETE repos/ismailir10/annisaa-erp-v3/branches/main/protection
# ...do the hotfix...
# Re-run the PUT command above to re-enable
```

GitHub audit log records both DELETE and re-enable.

---

## 7. UptimeRobot (Task 9)

Manual external setup:

1. Sign up at uptimerobot.com (free tier)
2. **Add New Monitor** → HTTP(s) → URL `https://talib.annisaasekolahku.com/api/health`
3. Monitoring interval: 5 minutes
4. Alert contacts: email (own address). Defer WhatsApp until Pro upgrade.
5. Status: paused until Cycle B merges to main and `/api/health` is live in prod
