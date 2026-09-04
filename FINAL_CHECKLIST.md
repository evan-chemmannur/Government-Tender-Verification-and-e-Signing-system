# Pre-Production Final Checklist

This is the mandatory pre-production checklist. All 90 items below must be verified and marked with a `[x]` before the Government Tender Portal can be approved for live production deployment.

## Security (30 Items)
- [ ] 1. TLS 1.3 is enforced on all external endpoints.
- [ ] 2. HSTS headers are active with `max-age=31536000`.
- [ ] 3. Content Security Policy (CSP) restricts `script-src` and `frame-ancestors`.
- [ ] 4. All Database passwords are automatically generated and securely stored in Kubernetes Secrets.
- [ ] 5. JWT tokens use a securely generated signing key.
- [ ] 6. OIDC Private Key (`Ed25519`) is securely stored and inaccessible to the frontend.
- [ ] 7. Session secrets are rotated regularly.
- [ ] 8. Express sessions utilize `HttpOnly`, `Secure`, and `SameSite=Lax` flags.
- [ ] 9. CORS is strictly configured to only allow requests from the exact frontend origin.
- [ ] 10. Request rate-limiting is active (max 100 req/min for standard APIs).
- [ ] 11. Login rate-limiting is active (max 5 req/15min).
- [ ] 12. Verification rate-limiting is active (max 1000 req/min).
- [ ] 13. SQL Injection protections are in place via parameterized queries (`pg`).
- [ ] 14. Input sanitization is applied globally to all `req.body` and `req.query` inputs.
- [ ] 15. The 10MB JSON request body limit is strictly enforced.
- [ ] 16. CSRF tokens are required for all mutation endpoints (`POST`, `PUT`, `DELETE`).
- [ ] 17. The `/.well-known/did.json` endpoint is completely read-only.
- [ ] 18. Audit logs capture the exact `officer_id` and `ip_address` for every action.
- [ ] 19. All passwords (if any) are hashed with Argon2 or bcrypt (N/A if only using OIDC, but check external dependencies).
- [ ] 20. Biometric LOA3 checks (`X-Biometric-Acr: true`) are verified before triggering Inji Certify.
- [ ] 21. Docker containers run as non-root users.
- [ ] 22. Kubernetes namespaces are isolated with Network Policies preventing cross-namespace traffic.
- [ ] 23. Egress traffic is restricted to only allowed external APIs (MOSIP, SMTP).
- [ ] 24. No sensitive data (PII) is written to application logs.
- [ ] 25. Vulnerability scanning (e.g. Trivy) is active on the CI pipeline.
- [ ] 26. Third-party npm packages have been audited (`npm audit`).
- [ ] 27. The Kubernetes API server is not exposed to the public internet.
- [ ] 28. Ingress controller blocks known malicious User-Agents.
- [ ] 29. Default Nginx server tokens are disabled (`server_tokens off`).
- [ ] 30. Secret rotation procedures have been successfully tested.

## Functionality (20 Items)
- [ ] 31. eSignet login flow completes successfully with OTP.
- [ ] 32. eSignet login flow completes successfully with Biometric authentication.
- [ ] 33. Session idle timeout correctly logs out inactive users after 30 minutes.
- [ ] 34. Absolute session timeout forces logout after 8 hours.
- [ ] 35. "Create Tender" API correctly inserts rows into the database.
- [ ] 36. Tender listing API correctly paginates results.
- [ ] 37. Tender status updates enforce state machine rules (e.g., Draft -> Published -> Awarded).
- [ ] 38. Admin role modifications instantly reflect in the UI and Backend middleware.
- [ ] 39. Tenders can only be approved by Admins or Senior Officers.
- [ ] 40. The DOCX to PDF Award Letter generation succeeds without memory leaks.
- [ ] 41. Inji Certify successfully issues a W3C Verifiable Credential payload.
- [ ] 42. PDF stamping process correctly embeds the QR code onto the last page.
- [ ] 43. SMTP email notifications successfully deliver the generated PDF.
- [ ] 44. OID4VCI flow correctly allows bidders to save the VC to the Inji Wallet.
- [ ] 45. The public verify endpoint correctly validates valid QR data.
- [ ] 46. The `init-status-list.js` script correctly generates a signed, zeroed bitstring.
- [ ] 47. Revoking a tender successfully flips the precise index bit in the Status List.
- [ ] 48. Re-scanning a revoked QR code instantly returns `REVOKED`.
- [ ] 49. The Infinite Scroll in the Audit Log correctly fetches the next page natively.
- [ ] 50. The CSV Export function successfully streams all matched rows to the client.

## Performance (10 Items)
- [ ] 51. The frontend React app is bundled using Vite's production build.
- [ ] 52. Assets are compressed (gzip/brotli) prior to delivery.
- [ ] 53. The backend successfully sustains 100 RPS without dropping connections.
- [ ] 54. Database connection pooling is active with a max pool size suited for production (e.g., 20).
- [ ] 55. PostgreSQL indexes exist on frequently queried columns (`status`, `department`, `created_at`).
- [ ] 56. The Status List bitstring is aggressively compressed (`zlib`) to minimize bandwidth.
- [ ] 57. The Horizontal Pod Autoscaler (HPA) successfully scales up when CPU exceeds 70%.
- [ ] 58. HPA correctly stabilizes and scales down when CPU drops below 30%.
- [ ] 59. Node memory usage stays below 512Mi under sustained load.
- [ ] 60. PDF generation time is logged and consistently remains under 5 seconds.

## Legal/Compliance (10 Items)
- [ ] 61. A Privacy Policy is accessible from the login page.
- [ ] 62. A Terms of Service agreement is accepted upon first login.
- [ ] 63. No Aadhaar numbers or direct biometric data are stored in the database.
- [ ] 64. The Audit Log is immutable (no UPDATE/DELETE endpoints exist).
- [ ] 65. The `audit_log` table captures data required for standard government compliance audits.
- [ ] 66. Issued credentials comply exactly with the registered `TenderAwardCredential` schema.
- [ ] 67. The system uses official Government of Maharashtra domain names.
- [ ] 68. The DID Document correctly identifies the issuing department.
- [ ] 69. PDF templates include official government seals and disclaimers.
- [ ] 70. Data retention policies conform to local regulations regarding PDF storage.

## Monitoring (10 Items)
- [ ] 71. The `/health` endpoint reliably returns HTTP 200.
- [ ] 72. The `/health/ready` endpoint strictly verifies database connectivity.
- [ ] 73. Prometheus ServiceMonitor successfully scrapes metrics every 15 seconds.
- [ ] 74. The Grafana Dashboard imports successfully and displays CPU/Memory usage.
- [ ] 75. Winston logger outputs structured JSON logs for centralized aggregation (e.g. ELK/Splunk).
- [ ] 76. The `BackendPodCrashLooping` alert correctly fires when a pod crashes repeatedly.
- [ ] 77. The `DatabaseDown` alert correctly triggers an immediate notification to the on-call team.
- [ ] 78. The `HighVCIssuanceFailures` alert fires if the external Inji Certify API goes down.
- [ ] 79. Disk usage for the `/var/lib/tender-portal/storage/pdfs` volume is monitored.
- [ ] 80. Real-time admin dashboard statistics match the actual database counts.

## Backup/Recovery (5 Items)
- [ ] 81. A daily `pg_dump` cronjob is configured and successfully uploading to S3.
- [ ] 82. Automated block-level Volume Snapshots are scheduled every 6 hours.
- [ ] 83. The restoration procedure from an SQL dump has been successfully tested.
- [ ] 84. A disaster recovery drill for rebuilding the entire Kubernetes cluster from manifests has been performed.
- [ ] 85. Private keys are securely backed up in an external encrypted vault.

## Documentation (5 Items)
- [ ] 86. The `INTEGRATION_GUIDE.md` is complete and understandable without prior MOSIP knowledge.
- [ ] 87. The `TROUBLESHOOTING.md` guide covers the top 6 most common failure scenarios.
- [ ] 88. The `RUNBOOK.md` contains accurate, copy-pasteable `kubectl` commands for scaling and debugging.
- [ ] 89. Developer onboarding (`setup-dev-environment.sh`) is fully documented.
- [ ] 90. Architecture diagrams (if any) match the current implementation exactly.
