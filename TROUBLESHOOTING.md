# Troubleshooting Guide

This document covers common issues encountered during the integration and deployment of the Government Tender Portal, along with their root causes and solutions.

---

### 1. eSignet Login Fails
**Symptom**: After clicking "Login with eSignet" and authenticating on the MOSIP Sandbox, the user is redirected to an error page (e.g., `invalid_redirect_uri` or an immediate 400 Bad Request).
**Root Cause**: The redirect URI configured in the MOSIP Partner Management System (PMS) does not exactly match the callback URL your backend is expecting. OIDC is extremely strict about trailing slashes and protocols.
**Fix**: 
1. Log into the MOSIP PMS dashboard.
2. Edit your OIDC Client configuration.
3. Ensure the redirect URI is exactly `http://localhost:3000/auth/callback` (or your production equivalent). No trailing slash.

### 2. JWT Signature Verification Fails
**Symptom**: When decoding a Verifiable Credential or a webhook payload, the system throws a `JsonWebTokenError: invalid signature`.
**Root Cause**: The public key configured in the system does not match the private key used to sign the payload. For OID4VCI and Certify, Ed25519 keys must be used. If an RSA key was generated instead, the EdDSA verification algorithm will fail.
**Fix**: 
1. Regenerate your keys using the correct algorithm: `openssl genpkey -algorithm Ed25519 -out private.pem`.
2. Extract the public key and update your `did.json` and the MOSIP PMS portal.

### 3. VC Issuance Fails
**Symptom**: The `/api/tenders/:id/sign` endpoint fails with a 401 or 403 error from the Certify service.
**Root Cause**: The access token used to authenticate the backend against Inji Certify has expired, or the `INJI_CLIENT_SECRET` in your `.env` file is incorrect.
**Fix**: 
1. Check the backend logs to confirm a 401 Unauthorized response.
2. Verify the `INJI_CLIENT_SECRET` matches the one generated in the Certify Issuer portal.
3. Ensure the backend logic is correctly requesting a fresh token if the previous one expired (handled by `bottleneck` and `axios-retry` in the `certifyService`).

### 4. PDF Not Generating
**Symptom**: The backend throws an error containing `spawn libreoffice ENOENT` or `Command failed: libreoffice` when generating the Award Letter.
**Root Cause**: The backend relies on LibreOffice being installed on the host machine to convert the `.docx` template into a `.pdf` file before signing. It is not installed or not in the system PATH.
**Fix**: 
1. If running locally, install LibreOffice (`sudo apt install libreoffice` or download the Windows/Mac installer).
2. If running via Docker, ensure the `Dockerfile` includes `RUN apk add --no-cache libreoffice` (or equivalent for Debian).

### 5. Status List Not Updating
**Symptom**: An admin revokes a tender, but scanning the QR code still shows "GENUINE".
**Root Cause**: The `inji-verify` app aggressively caches the `statuslist/1` endpoint. Even though the backend flipped the bit and re-signed the file, the Verifier app is checking a stale cache.
**Fix**: 
1. In the Inji Verify app settings, clear the cache.
2. Ensure your backend serves the Status List with proper Cache-Control headers (`Cache-Control: no-cache, no-store, must-revalidate`).

### 6. Kubernetes Pod Not Starting
**Symptom**: Running `kubectl get pods` shows the backend pod in `CrashLoopBackOff` or `CreateContainerConfigError`.
**Root Cause**: Essential environment variables are missing from the `ConfigMap` or `Secret`, preventing the Node.js application from booting up.
**Fix**: 
1. Run `kubectl describe pod <pod-name> -n tender-portal`.
2. Check the "Events" section at the bottom. It will likely say `Couldn't find key DB_PASSWORD in Secret tender-portal-secrets`.
3. Apply the missing configuration via `kubectl apply -f k8s/secrets.yaml`.
