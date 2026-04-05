#!/usr/bin/env bash
# Creates all planned GitHub issues for rjsteen/fresh
# Requires: gh CLI authenticated (gh auth login)
# Usage: ./create-issues.sh

set -euo pipefail

REPO="rjsteen/fresh"

create() {
  local title="$1"
  local label="$2"
  local body="$3"
  echo "Creating: $title"
  gh issue create --repo "$REPO" --title "$title" --label "$label" --body "$body"
}

# ---------------------------------------------------------------------------
# AUTH
# ---------------------------------------------------------------------------

create \
  "Add registration page (web)" \
  "frontend,auth" \
"## Summary
The \`/register\` route and page are missing. \`Login.tsx\` exists but there is no way for a new user to create an account from the web UI.

## Acceptance criteria
- [ ] \`pages/Register.tsx\` — email, password, confirm-password, region (US/EU) + timezone fields
- [ ] On success: store JWT, register device, redirect to \`/dashboard\`
- [ ] Client-side validation with Zod (mirrors backend \`User\` changeset rules)
- [ ] Route added to \`App.tsx\` and linked from Login page
- [ ] Error messages shown inline (email taken, weak password, etc.)"

create \
  "Persist auth token securely and handle expiry" \
  "frontend,auth" \
"## Summary
\`Login.tsx\` stores the JWT in \`localStorage\`. This is fine for a first pass but needs hardening and expiry handling.

## Acceptance criteria
- [ ] Token stored with an expiry timestamp
- [ ] \`useAuth\` hook (or context) that exposes \`isAuthenticated\`, \`token\`, \`logout()\`
- [ ] Axios/fetch interceptor that attaches \`Authorization: Bearer <token>\` to every API call
- [ ] On 401 response: clear token, redirect to \`/login\`
- [ ] Refresh endpoint (\`POST /api/v1/auth/refresh\`) called before expiry
- [ ] Protected route wrapper redirects unauthenticated users to \`/login\`"

create \
  "Mobile: implement auth screens (login + register)" \
  "mobile,auth" \
"## Summary
The mobile app has no auth screens. \`DashboardScreen\` is the only screen; it will crash for unauthenticated users because there is no JWT.

## Acceptance criteria
- [ ] \`screens/LoginScreen.tsx\` — email/password form, posts to backend, stores JWT with expo-secure-store
- [ ] \`screens/RegisterScreen.tsx\` — mirrors web register page
- [ ] expo-router stack: unauthenticated root → \`(auth)/login\`, authenticated root → \`(app)/dashboard\`
- [ ] Auth context / Zustand slice shared across screens
- [ ] GoCardless / SimpleFIN OAuth redirect handling (deep link back into the app after bank auth)"

# ---------------------------------------------------------------------------
# FRONTEND — WEB PAGES
# ---------------------------------------------------------------------------

create \
  "Implement Accounts page (web)" \
  "frontend" \
"## Summary
\`pages/Accounts.tsx\` is a stub. Users need to be able to view linked bank accounts and add/remove connections.

## Acceptance criteria
- [ ] List all accounts from the on-device SQLite DB (\`getAccounts()\` from \`@fresh/core\`)
- [ ] Per-account card: name, type (checking/savings/credit), last-synced timestamp, balance
- [ ] \"Add account\" flow:
  - US: shows SimpleFIN Bridge instructions + token input field → calls \`POST /api/v1/connections/simplefin/claim\`
  - EU: redirects user to GoCardless requisition URL → calls \`POST /api/v1/connections/gocardless/requisition\`
- [ ] Remove account (deletes local data + sync job)
- [ ] Sync status badge (idle / syncing / error) driven by Phoenix channel events
- [ ] Manual \"Sync now\" button → \`POST /api/v1/sync/:id/trigger\`"

create \
  "Implement Transactions page (web)" \
  "frontend" \
"## Summary
\`pages/Transactions.tsx\` is a stub. This is the primary data-browsing view.

## Acceptance criteria
- [ ] Paginated or virtualised transaction list (date descending)
- [ ] Filter bar: date range, account selector, category multi-select, debit/credit toggle, search
- [ ] Each row: date, merchant, amount, category chip (colour-coded), anomaly badge
- [ ] Inline category override: click chip → dropdown of all categories → saves via \`categorizeTransaction()\`
- [ ] Expandable row for notes / tags (stored in SQLite only)
- [ ] Export to CSV (client-side, from SQLite query)"

create \
  "Implement Budget page (web)" \
  "frontend" \
"## Summary
\`pages/Budget.tsx\` is a stub. Budgets are fully modelled in the core package but there is no UI.

## Acceptance criteria
- [ ] Current-period overview: total budgeted vs. spent, % remaining
- [ ] Per-category budget lines with progress bars (\`getBudgetSummary()\` from core)
- [ ] Create / edit budget: period picker (monthly / custom), add lines per category with limit amounts
- [ ] Spending chart: actual vs. budget by category (bar chart via Recharts)
- [ ] Rollover toggle per budget line"

create \
  "Implement Settings page (web)" \
  "frontend" \
"## Summary
\`pages/Settings.tsx\` is a stub.

## Acceptance criteria
- [ ] Profile section: email display, change-password form, region/timezone selector (PATCH \`/api/v1/users/me\`)
- [ ] Alert rules CRUD: list rules from SQLite, create/edit/delete using \`BudgetRuleEngine\` types (\`large_transaction\`, \`budget_threshold\`, \`balance_low\`, \`merchant\`)
- [ ] Connected devices list (from \`GET /api/v1/devices\`) with revoke button
- [ ] Data section: export all local data (JSON), wipe local database
- [ ] Danger zone: delete account (calls backend + wipes local DB)"

# ---------------------------------------------------------------------------
# FRONTEND — MOBILE SCREENS
# ---------------------------------------------------------------------------

create \
  "Mobile: implement Accounts, Transactions, Budget, Settings screens" \
  "mobile" \
"## Summary
Only \`DashboardScreen\` is implemented. All other main screens are missing.

## Acceptance criteria
- [ ] \`screens/AccountsScreen.tsx\` — mirrors web Accounts page, adapted for mobile layout
- [ ] \`screens/TransactionsScreen.tsx\` — FlatList with filters in a bottom sheet
- [ ] \`screens/BudgetScreen.tsx\` — budget summary with react-native-gifted-charts bar chart
- [ ] \`screens/SettingsScreen.tsx\` — profile, alert rules, device management
- [ ] expo-router tab navigator: Dashboard | Transactions | Budget | Accounts | Settings
- [ ] Deep-link handling for GoCardless OAuth redirect"

# ---------------------------------------------------------------------------
# BACKEND — REMAINING TASKS
# ---------------------------------------------------------------------------

create \
  "Complete SimpleFIN bank adapter" \
  "backend" \
"## Summary
\`sync/simplefin.ex\` is a stub. The adapter needs to exchange setup tokens and fetch transaction batches.

## Acceptance criteria
- [ ] \`claim_access_url/1\`: POST to SimpleFIN Bridge with one-time token, return permanent access URL
- [ ] \`fetch_transactions/2\`: GET \`/accounts/transactions\` with cursor, return raw transaction list
- [ ] Parse SimpleFIN response into internal \`%Transaction{}\` struct
- [ ] Encrypt access URL before storing in \`sync_jobs.encrypted_access_url_ref\` via \`Vault\`
- [ ] Error handling: 401 (re-auth needed), 429 (rate limit backoff), network errors
- [ ] Integration test with VCR cassette or mock HTTP"

create \
  "Complete GoCardless bank adapter" \
  "backend" \
"## Summary
\`sync/gocardless.ex\` is a stub. The EU bank integration needs the full requisition + transaction fetch flow.

## Acceptance criteria
- [ ] \`create_requisition/2\`: POST to GoCardless API, return redirect URL for user consent
- [ ] \`fetch_accounts/1\`: list accounts after user authorises requisition
- [ ] \`fetch_transactions/2\`: GET transactions with date cursor
- [ ] Map GoCardless \`TransactionAmount\` to internal struct
- [ ] Store encrypted account ID ref via Vault
- [ ] Webhook handler for requisition status updates
- [ ] Integration test with VCR cassette or mock HTTP"

create \
  "Add \`/internal/models/notify\` endpoint for ML sidecar" \
  "backend" \
"## Summary
The ML sidecar calls \`POST /internal/models/notify\` after uploading a new ONNX model, but this endpoint does not exist in \`router.ex\`.

## Acceptance criteria
- [ ] Route added under \`/internal\` scope (not publicly accessible — IP allowlist or shared-secret plug)
- [ ] Controller creates/updates \`model_versions\` record with version, CDN path, checksum
- [ ] Triggers \`ModelDistributionWorker\` via Oban to broadcast \`model:updated\` to all connected devices
- [ ] Returns 200 with model version on success
- [ ] \`SIDECAR_TOKEN\` header validation (401 if missing/invalid)"

create \
  "Add \`GET /api/v1/models/current\` endpoint" \
  "backend" \
"## Summary
\`ModelController\` exists but the endpoint body is incomplete. Devices need to query the current model version and CDN URL on startup to decide whether to pull new weights.

## Acceptance criteria
- [ ] Returns \`{version, cdn_url, checksum}\` for \`categorizer\` and \`anomaly_detector\` model types
- [ ] Query latest production row from \`model_versions\`
- [ ] Authenticated (Guardian pipeline)
- [ ] Used by frontend on mount to check if cached model is stale"

create \
  "Add \`PATCH /api/v1/users/me\` profile update endpoint" \
  "backend" \
"## Summary
There is no endpoint for users to update their own profile (timezone, region, password).

## Acceptance criteria
- [ ] \`PATCH /api/v1/users/me\` — accepts \`timezone\`, \`region\`, \`current_password\` + \`new_password\`
- [ ] Password change requires current password verification
- [ ] Returns updated user (without password hash)
- [ ] Validated with \`User\` changeset"

create \
  "Add \`DELETE /api/v1/users/me\` account deletion endpoint" \
  "backend" \
"## Summary
Users should be able to delete their account from the Settings page.

## Acceptance criteria
- [ ] Requires password confirmation
- [ ] Deletes user, all devices, and all sync jobs (cascade)
- [ ] Broadcasts \`account:deleted\` via Phoenix channel so device can wipe local DB
- [ ] Returns 204"

# ---------------------------------------------------------------------------
# CORE PACKAGE
# ---------------------------------------------------------------------------

create \
  "Wire encrypted transaction batch decryption into sync flow" \
  "core,backend" \
"## Summary
The Phoenix channel \`onSyncComplete\` callback in \`App.tsx\` only logs. The actual decrypt-and-write pipeline is not implemented.

## Acceptance criteria
- [ ] \`sync:complete\` payload from backend contains encrypted batch
- [ ] \`@fresh/core\` exposes \`decryptBatch(encryptedBatch, deviceKey): Transaction[]\`
- [ ] \`App.tsx\` (web) and mobile equivalent call \`decryptBatch\` then \`upsertTransaction()\` for each item
- [ ] ONNX categorizer + anomaly detector run on each new transaction immediately after insert
- [ ] Results written back via \`categorizeTransaction()\`
- [ ] \`sync:ack\` sent back to backend after all transactions written"

create \
  "Implement SQLCipher encryption for on-device SQLite (web + mobile)" \
  "core,security" \
"## Summary
The core \`DbClient\` has schema and migrations but the platform drivers don't configure SQLCipher encryption. On web, \`sql.js-httpvfs\` is used; on mobile, \`expo-sqlite\` supports SQLCipher via \`expo-sqlite/next\`.

## Acceptance criteria
- [ ] Web driver: use \`@sqlite.org/sqlite-wasm\` with \`sqlcipher\` build or equivalent; derive key from device secret
- [ ] Mobile driver: pass encryption key to \`expo-sqlite\` via \`SQLiteDatabase.openAsync\` options
- [ ] Key derived from a device-specific secret stored in the platform secure enclave (keychain / Android Keystore)
- [ ] Migration to encrypted DB from plain DB on first upgrade (re-encrypt in-place)
- [ ] Document key derivation approach"

create \
  "Verify ONNX model checksum after CDN download" \
  "core,security" \
"## Summary
The \`TransactionCategorizer\` and \`AnomalyDetector\` download ONNX weights from the CDN but do not verify the SHA-256 checksum provided by the backend before loading the model.

## Acceptance criteria
- [ ] After download, compute SHA-256 of the binary
- [ ] Compare against \`checksum\` field from \`GET /api/v1/models/current\`
- [ ] Reject and delete cached file if checksum mismatch; retry download once
- [ ] Throw descriptive error if second attempt also fails"

# ---------------------------------------------------------------------------
# TESTING
# ---------------------------------------------------------------------------

create \
  "Add backend test suite (ExUnit)" \
  "testing,backend" \
"## Summary
There are no test files in \`apps/backend/test/\` beyond the generated placeholder.

## Acceptance criteria
- [ ] Auth controller tests: register, login, refresh, invalid credentials
- [ ] Device controller tests: register, list, revoke
- [ ] Sync controller tests: trigger, schedule update
- [ ] Connection controller tests: SimpleFIN claim, GoCardless requisition
- [ ] BankSyncWorker unit test with mocked HTTP adapters
- [ ] ModelDistributionWorker unit test
- [ ] StaleDeviceWorker unit test
- [ ] Channel tests: \`sync:ack\`, \`alert:register\`"

create \
  "Add frontend unit and integration tests" \
  "testing,frontend" \
"## Summary
There are no tests in \`apps/web\` or \`packages/core\`.

## Acceptance criteria
- [ ] Core package: unit tests for \`BudgetRuleEngine\`, \`queries.ts\`, feature extraction in \`inference.ts\`
- [ ] Web: React Testing Library tests for Dashboard, Login, Register, Accounts, Transactions, Budget, Settings
- [ ] Web: integration test for the full login → device-register → channel-connect flow (MSW for API mocking)
- [ ] CI runs \`pnpm turbo run test\` on every PR"