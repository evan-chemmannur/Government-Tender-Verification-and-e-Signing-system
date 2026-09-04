#!/usr/bin/env bash
# ============================================================================
# security-check.sh — Pre-Deployment Security Checklist
# Government Tender Verification and e-Signing System
#
# Usage:
#   chmod +x scripts/security-check.sh
#   ./scripts/security-check.sh
#
# Returns exit code 0 if all checks pass, 1 if any check fails.
# ============================================================================

set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Colour

PASS="${GREEN}[PASS]${NC}"
FAIL="${RED}[FAIL]${NC}"
WARN="${YELLOW}[WARN]${NC}"
INFO="${BLUE}[INFO]${NC}"

TOTAL=0
PASSED=0
FAILED=0
WARNINGS=0

# ── Helpers ───────────────────────────────────────────────────────────────────
pass()  { echo -e "${PASS} $1"; ((PASSED++));  ((TOTAL++)); }
fail()  { echo -e "${FAIL} $1"; ((FAILED++));  ((TOTAL++)); }
warn()  { echo -e "${WARN} $1"; ((WARNINGS++)); ((TOTAL++)); }
info()  { echo -e "${INFO} $1"; }
header(){ echo -e "\n${BOLD}═══ $1 ═══${NC}"; }

# ── Working directory ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$PROJECT_ROOT/backend"

cd "$PROJECT_ROOT"

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Government Tender Portal — Pre-Deployment Security Check   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. Hardcoded Secrets Check ────────────────────────────────────────────────
header "1. Hardcoded Secrets Detection"

SECRETS_PATTERNS=(
  "password\s*=\s*['\"][^'\"]{6,}"
  "secret\s*=\s*['\"][^'\"]{6,}"
  "api_key\s*=\s*['\"][^'\"]{6,}"
  "private_key\s*=\s*['\"][^'\"]"
  "PRIVATE KEY-----"
  "BEGIN RSA"
  "AWS_SECRET_ACCESS_KEY"
  "eyJhbGciOi"  # JWT-like base64 hardcoded
)

EXCLUDE_DIRS="--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage --exclude-dir=tests"
SECRETS_FOUND=0

for pattern in "${SECRETS_PATTERNS[@]}"; do
  if grep -rqiE "$pattern" $EXCLUDE_DIRS --include="*.js" --include="*.ts" --include="*.jsx" --include="*.env" "$PROJECT_ROOT" 2>/dev/null; then
    echo -e "  ${RED}Found pattern:${NC} $pattern"
    grep -rniE "$pattern" $EXCLUDE_DIRS --include="*.js" --include="*.ts" --include="*.jsx" "$PROJECT_ROOT" 2>/dev/null | head -3 || true
    ((SECRETS_FOUND++))
  fi
done

if [[ $SECRETS_FOUND -eq 0 ]]; then
  pass "No hardcoded secrets detected in source files"
else
  fail "Found $SECRETS_FOUND suspicious secret patterns in source code"
fi

# ── 2. NPM Audit ──────────────────────────────────────────────────────────────
header "2. NPM Vulnerability Audit"

cd "$BACKEND_DIR"
AUDIT_OUTPUT=$(npm audit --json 2>/dev/null || true)
CRITICAL=$(echo "$AUDIT_OUTPUT" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.metadata?.vulnerabilities?.critical||0)}catch(e){console.log(0)}" 2>/dev/null || echo 0)
HIGH=$(echo "$AUDIT_OUTPUT" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.metadata?.vulnerabilities?.high||0)}catch(e){console.log(0)}" 2>/dev/null || echo 0)

if [[ "$CRITICAL" -gt 0 ]]; then
  fail "Found $CRITICAL CRITICAL vulnerabilities — run: npm audit fix"
elif [[ "$HIGH" -gt 0 ]]; then
  warn "Found $HIGH HIGH severity vulnerabilities — review with: npm audit"
else
  pass "No critical/high npm vulnerabilities found"
fi
cd "$PROJECT_ROOT"

# ── 3. .env File Not in Git ───────────────────────────────────────────────────
header "3. .env Files in Version Control"

if git -C "$PROJECT_ROOT" ls-files --error-unmatch .env 2>/dev/null; then
  fail ".env file is tracked by git — remove it immediately: git rm --cached .env"
else
  pass ".env is not tracked by git"
fi

if git -C "$PROJECT_ROOT" ls-files --error-unmatch backend/.env 2>/dev/null; then
  fail "backend/.env is tracked by git"
else
  pass "backend/.env is not tracked by git"
fi

# Check .gitignore includes .env
if grep -q '\.env' "$PROJECT_ROOT/.gitignore" 2>/dev/null; then
  pass ".env is listed in .gitignore"
else
  fail ".env is NOT listed in .gitignore — add it immediately"
fi

# ── 4. HTTPS Enforcement ─────────────────────────────────────────────────────
header "4. HTTPS Configuration"

# Check if HSTS is configured in security middleware
if grep -q "hsts" "$BACKEND_DIR/src/middleware/security.js" 2>/dev/null; then
  pass "HSTS is configured in security middleware"
else
  fail "HSTS not found in security middleware"
fi

# Check for insecure HTTP URLs hardcoded in non-localhost context
INSECURE_URLS=$(grep -rn "http://" $EXCLUDE_DIRS --include="*.js" --include="*.jsx" "$PROJECT_ROOT/backend/src" "$PROJECT_ROOT/frontend/src" 2>/dev/null | \
  grep -v "http://localhost" | grep -v "http://127.0.0.1" | grep -v "//localhost" | \
  grep -v "#" | wc -l || echo 0)

if [[ "$INSECURE_URLS" -gt 0 ]]; then
  warn "Found $INSECURE_URLS non-localhost HTTP URLs — verify they upgrade to HTTPS in production"
  grep -rn "http://" $EXCLUDE_DIRS --include="*.js" --include="*.jsx" "$PROJECT_ROOT/backend/src" "$PROJECT_ROOT/frontend/src" 2>/dev/null | \
    grep -v "http://localhost" | grep -v "http://127.0.0.1" | head -5 || true
else
  pass "No non-localhost HTTP URLs detected"
fi

# ── 5. Security Headers Present ──────────────────────────────────────────────
header "5. Security Headers Configuration"

SECURITY_MW="$BACKEND_DIR/src/middleware/security.js"

declare -A HEADER_CHECKS=(
  ["Content-Security-Policy"]="contentSecurityPolicy"
  ["X-Frame-Options / frame-ancestors"]="frameAncestors"
  ["HSTS"]="hsts"
  ["X-Content-Type-Options"]="noSniff"
  ["Referrer-Policy"]="referrerPolicy"
)

for label in "${!HEADER_CHECKS[@]}"; do
  pattern="${HEADER_CHECKS[$label]}"
  if grep -q "$pattern" "$SECURITY_MW" 2>/dev/null; then
    pass "$label configured"
  else
    fail "$label NOT configured in security middleware"
  fi
done

# ── 6. Rate Limiting Check ───────────────────────────────────────────────────
header "6. Rate Limiting"

if grep -q "loginRateLimiter" "$SECURITY_MW" 2>/dev/null; then
  pass "Login rate limiter defined"
else
  fail "Login rate limiter not found"
fi

if grep -q "apiRateLimiter" "$SECURITY_MW" 2>/dev/null; then
  pass "API rate limiter defined"
else
  fail "API rate limiter not found"
fi

# Check rate limiter is applied in app.js
if grep -q "loginRateLimiter\|apiRateLimiter" "$BACKEND_DIR/src/app.js" 2>/dev/null; then
  pass "Rate limiters are mounted in app.js"
else
  warn "Rate limiters may not be mounted in app.js — verify manually"
fi

# ── 7. CSRF Protection ───────────────────────────────────────────────────────
header "7. CSRF Protection"

CSRF_MW="$BACKEND_DIR/src/middleware/csrfProtection.js"
if [[ -f "$CSRF_MW" ]]; then
  pass "CSRF middleware file exists"
  if grep -q "timingSafeEqual" "$CSRF_MW"; then
    pass "CSRF uses constant-time comparison (timing-safe)"
  else
    warn "CSRF comparison may not be timing-safe"
  fi
  if grep -q "crypto.randomBytes" "$CSRF_MW"; then
    pass "CSRF token uses cryptographic random source"
  else
    fail "CSRF token generation may not use secure randomness"
  fi
else
  fail "CSRF middleware not found at $CSRF_MW"
fi

# Check CSRF is applied in app.js
if grep -q "csrfProtection" "$BACKEND_DIR/src/app.js" 2>/dev/null; then
  pass "CSRF protection is mounted in app.js"
else
  warn "CSRF protection not found in app.js — verify it is applied"
fi

# ── 8. Input Sanitization ────────────────────────────────────────────────────
header "8. Input Sanitization"

SANITIZE_UTIL="$BACKEND_DIR/src/utils/inputSanitization.js"
if [[ -f "$SANITIZE_UTIL" ]]; then
  pass "Input sanitization utility exists"
  grep -q "xss\|DOMPurify\|isomorphic-dompurify" "$SANITIZE_UTIL" && \
    pass "XSS sanitization library in use" || \
    fail "XSS sanitization library not found"
else
  fail "Input sanitization utility not found at $SANITIZE_UTIL"
fi

# ── 9. Private Key / Certificate File Exposure ───────────────────────────────
header "9. Sensitive File Exposure"

SENSITIVE_FILES=("*.pem" "*.key" "*.p12" "*.pfx" "*.jks")
for pattern in "${SENSITIVE_FILES[@]}"; do
  TRACKED=$(git -C "$PROJECT_ROOT" ls-files "$pattern" 2>/dev/null | wc -l || echo 0)
  if [[ "$TRACKED" -gt 0 ]]; then
    fail "Sensitive file type $pattern is tracked in git!"
    git -C "$PROJECT_ROOT" ls-files "$pattern" | head -3
  else
    pass "No $pattern files tracked in git"
  fi
done

# ── 10. Docker Security ───────────────────────────────────────────────────────
header "10. Docker Security"

COMPOSE_FILE="$PROJECT_ROOT/docker-compose.yml"
if [[ -f "$COMPOSE_FILE" ]]; then
  if grep -q "USER node\|user:" "$BACKEND_DIR/Dockerfile" 2>/dev/null; then
    pass "Backend Docker container does not run as root (USER directive present)"
  else
    warn "Backend Dockerfile may be running as root — add USER node for production"
  fi

  if grep -q "healthcheck" "$COMPOSE_FILE"; then
    pass "Health checks configured in docker-compose.yml"
  else
    warn "Health checks not found in docker-compose.yml"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "${BOLD}  Security Check Summary${NC}"
echo -e "${BOLD}═══════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "  ${RED}Failed:${NC}   $FAILED"
echo -e "  Total:    $TOTAL"
echo ""

if [[ $FAILED -gt 0 ]]; then
  echo -e "${RED}${BOLD}❌ Security check FAILED — resolve all failures before deployment.${NC}"
  exit 1
elif [[ $WARNINGS -gt 0 ]]; then
  echo -e "${YELLOW}${BOLD}⚠️  Security check passed with warnings — review before production deployment.${NC}"
  exit 0
else
  echo -e "${GREEN}${BOLD}✅ All security checks passed!${NC}"
  exit 0
fi
