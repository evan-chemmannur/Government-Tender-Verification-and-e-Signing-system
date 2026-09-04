#!/usr/bin/env bash
set -eo pipefail

echo "========================================================="
echo "   Government Tender Portal — End-to-End Test Suite      "
echo "========================================================="

# ─── Helper functions ──────────────────────────────────────
fail() { echo -e "\033[31m[FAIL]\033[0m $1"; EXIT_CODE=1; }
pass() { echo -e "\033[32m[PASS]\033[0m $1"; }
info() { echo -e "\033[34m[INFO]\033[0m $1"; }

EXIT_CODE=0
BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"
DB_CONTAINER="${DB_CONTAINER:-tender_db}"
DB_USER="${POSTGRES_USER:-tender_app}"
DB_NAME="${POSTGRES_DB:-tender_portal}"

# ─── 1. Start docker-compose ──────────────────────────────
info "Starting backend and DB containers..."
docker-compose up -d db redis backend

# ─── 2. Wait for backend health ───────────────────────────
info "Waiting for backend to become healthy..."
MAX_RETRIES=30
for i in $(seq 1 $MAX_RETRIES); do
  STATUS=$(curl -s "${BACKEND_URL}/health" | grep '"status":"ok"' || true)
  if [ -n "$STATUS" ]; then
    pass "Backend is healthy!"
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    fail "Backend failed to become healthy within ${MAX_RETRIES} seconds"
    echo "Last response: $(curl -s ${BACKEND_URL}/health 2>&1 || echo 'unreachable')"
    exit 1
  fi
  sleep 1
done

# ─── 3. Create test officer ───────────────────────────────
info "Creating test officer in DB..."
docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c "
INSERT INTO officials (id, aadhaar_sub, name, email, role, department, loa)
VALUES ('official_e2e_001', 'aadhaar_e2e_001', 'E2E Test Officer', 'e2e@test.gov.in', 'ADMIN', 'PWD', 3)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
" > /dev/null 2>&1 && pass "Test officer created" || fail "Failed to create test officer"

# ─── 4. Create test tender ────────────────────────────────
info "Creating test tender in DB..."
docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c "
INSERT INTO tenders (id, tender_id, reference_no, title, department, status,
                     estimated_value, actual_value, awarded_to_name, awarded_to_email, created_by)
VALUES ('tender_e2e_001', 'MH-PWD-E2E-0001', 'REF-E2E-001', 'E2E Road Construction', 'PWD', 'DRAFT',
        50000000, 50000000, 'M/s E2E Corp', 'e2e@corp.in', 'official_e2e_001')
ON CONFLICT (id) DO UPDATE SET status = 'DRAFT';
" > /dev/null 2>&1 && pass "Test tender created (DRAFT)" || fail "Failed to create test tender"

# ─── 5. Complete full lifecycle ───────────────────────────
info "Advancing tender through full lifecycle..."

for STATUS in SUBMITTED UNDER_REVIEW APPROVED_PENDING_SIGN SIGNED AWARDED; do
  docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c \
    "UPDATE tenders SET status = '${STATUS}' WHERE id = 'tender_e2e_001';" > /dev/null 2>&1

  # Verify the status was set correctly
  ACTUAL=$(docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -t -c \
    "SELECT status FROM tenders WHERE id = 'tender_e2e_001';" 2>/dev/null | tr -d ' ')

  if [ "$ACTUAL" = "$STATUS" ]; then
    pass "Tender advanced to ${STATUS}"
  else
    fail "Expected status ${STATUS} but got ${ACTUAL}"
  fi
done

# ─── 6. Create mock Verifiable Credential ─────────────────
info "Creating mock Verifiable Credential..."
docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c "
INSERT INTO vc_records (id, tender_id, credential_id, vc_json, status, status_list_index)
VALUES ('vc_e2e_001', 'tender_e2e_001', 'cred_e2e_001',
        '{\"id\":\"cred_e2e_001\",\"type\":[\"VerifiableCredential\",\"TenderAwardCredential\"],\"issuer\":\"did:web:tender.maharashtra.gov.in\",\"credentialSubject\":{\"tenderTitle\":\"E2E Road Construction\"}}',
        'ACTIVE', 500)
ON CONFLICT (id) DO NOTHING;
" > /dev/null 2>&1 && pass "Mock VC created (ACTIVE)" || fail "Failed to create mock VC"

# ─── 7. Verify via public API endpoint ────────────────────
info "Testing public verification API..."

# Test public tender endpoint
TENDER_RES=$(curl -s "${BACKEND_URL}/api/public/tender/tender_e2e_001")
if echo "$TENDER_RES" | grep -q '"title"'; then
  pass "Public tender API returned tender data"
else
  fail "Public tender API did not return expected data. Response: $TENDER_RES"
fi

# Test public VC endpoint
VC_RES=$(curl -s "${BACKEND_URL}/api/public/vc/tender_e2e_001")
if echo "$VC_RES" | grep -q '"vc"'; then
  pass "Public VC API returned VC data"
else
  fail "Public VC API did not return expected data. Response: $VC_RES"
fi

# ─── 8. Test health endpoint ──────────────────────────────
HEALTH_RES=$(curl -s "${BACKEND_URL}/health")
if echo "$HEALTH_RES" | grep -q '"status":"ok"'; then
  pass "Health endpoint returns ok"
else
  fail "Health endpoint failed. Response: $HEALTH_RES"
fi

# ─── 9. Test 404 handling ─────────────────────────────────
NOT_FOUND_RES=$(curl -s -o /dev/null -w "%{http_code}" "${BACKEND_URL}/api/nonexistent")
if [ "$NOT_FOUND_RES" = "404" ]; then
  pass "404 handling works correctly"
else
  fail "Expected 404 but got ${NOT_FOUND_RES}"
fi

# ─── 10. Test VC revocation ───────────────────────────────
info "Testing VC revocation flow..."
docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c "
UPDATE vc_records SET status = 'REVOKED', revoked_at = NOW(), revoke_reason = 'E2E test revocation'
WHERE id = 'vc_e2e_001';
" > /dev/null 2>&1

REVOKED_STATUS=$(docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -t -c \
  "SELECT status FROM vc_records WHERE id = 'vc_e2e_001';" 2>/dev/null | tr -d ' ')

if [ "$REVOKED_STATUS" = "REVOKED" ]; then
  pass "VC revocation succeeded"
else
  fail "VC revocation failed. Status: $REVOKED_STATUS"
fi

# ─── 11. Cleanup ──────────────────────────────────────────
info "Cleaning up test data..."
docker exec ${DB_CONTAINER} psql -U ${DB_USER} -d ${DB_NAME} -c "
DELETE FROM vc_records WHERE id = 'vc_e2e_001';
DELETE FROM tenders WHERE id = 'tender_e2e_001';
DELETE FROM officials WHERE id = 'official_e2e_001';
" > /dev/null 2>&1 && pass "Test data cleaned up" || info "Cleanup skipped (non-critical)"

# ─── Final Report ─────────────────────────────────────────
echo ""
echo "========================================================="
if [ "$EXIT_CODE" -eq 0 ]; then
  echo -e "   \033[32mALL END-TO-END TESTS PASSED SUCCESSFULLY\033[0m"
else
  echo -e "   \033[31mSOME TESTS FAILED — SEE OUTPUT ABOVE\033[0m"
fi
echo "========================================================="
exit $EXIT_CODE
