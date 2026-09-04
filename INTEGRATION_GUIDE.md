# Government Tender Portal - Integration Guide

Welcome to the Government Tender Verification and e-Signing system integration guide! 
This guide assumes **zero prior knowledge of MOSIP** (Modular Open Source Identity Platform). We will walk you step-by-step through connecting the tender portal to the MOSIP ecosystem to enable authentication (eSignet), credential issuance (Inji Certify), and verification (Inji Verify).

---

## 1. MOSIP Sandbox Setup (eSignet Authentication)

MOSIP provides **eSignet**, an OpenID Connect (OIDC) compliant Identity Provider (IdP). This allows government officials to log into the Tender Portal using their Aadhaar/National ID.

### Step 1.1: Create a Sandbox Account
1. Go to [sandbox.mosip.net](https://sandbox.mosip.net).
2. Sign up for a developer account and verify your email.

### Step 1.2: Register an OIDC Client via PMS
To allow eSignet to redirect users back to our portal, we must register our application in the **Partner Management System (PMS)**.
1. Log into the MOSIP PMS dashboard on the Sandbox.
2. Click **Create New Partner**.
3. Select **OIDC Client** as the partner type.
4. **Configure Redirect URIs**: You must whitelist the exact URL where users will land after logging in. For local development, add: `http://localhost:3000/auth/callback`. For production, use `https://tender.maharashtra.gov.in/api/auth/callback`.
5. Upon saving, the system will generate a `CLIENT_ID`. Copy this value; you will put this in your `.env` file as `CLIENT_ID`.

### Step 1.3: Obtain Private Keys
For security, the portal uses asymmetric cryptography (Ed25519) to sign requests to MOSIP. 
1. In the PMS portal, download the provided test private key for your client.
2. Save it to `keys/private.key` in your project root. (If using the automated dev script, a key is generated for you locally).

### Step 1.4: Test Login with Demo Aadhaar
1. The Sandbox portal provides "Demo Identity Data" (e.g., 999999999999 as a Virtual ID).
2. Start your local server and click "Login with eSignet".
3. Use the demo ID to log in and confirm you are redirected back to the portal successfully.

---

## 2. Inji Certify Setup

**Inji Certify** is MOSIP's module for issuing Verifiable Credentials (VCs). When an official signs a tender, the backend talks to Inji Certify to generate a VC.

### Step 2.1: Register Backend as a Credential Requester
1. In your MOSIP Sandbox dashboard, navigate to the **Certify** module.
2. Register a new "Issuer Application" to get your `INJI_CLIENT_ID` and `INJI_CLIENT_SECRET`.
3. Add these to your `.env` file.

### Step 2.2: Configure the TenderAwardCredential Schema
Credentials must adhere to a strict JSON schema.
1. In the Certify portal, create a new Schema.
2. Name it `TenderAwardCredential`.
3. Add the required fields: `tenderId`, `tenderTitle`, `department`, `awardedTo`, `contractValue`, and `signedBy`.
4. Publish the schema.

### Step 2.3: Test Credential Issuance
1. With your backend running, trigger the `/api/tenders/:id/sign` endpoint.
2. The backend will package the tender data and send it to Inji Certify.
3. Certify returns a signed JWT or W3C Verifiable Credential. The backend automatically saves this to the database.

---

## 3. DID Web Setup

A **DID (Decentralized Identifier)** is how other systems (like Inji Verify) verify that *our portal* genuinely issued a credential. We use the `did:web` method, which ties our identity to our domain name.

### Step 3.1: Create the did.json File
1. Your DID document must contain the public keys corresponding to the private keys you use to sign status lists and credentials.
2. The backend is configured to automatically serve this file via the `didRoutes.js` file at `/.well-known/did.json`.

### Step 3.2: Deploy to Production
1. When you deploy the system to `tender.maharashtra.gov.in`, the URL `https://tender.maharashtra.gov.in/.well-known/did.json` will become live.
2. This establishes your DID as `did:web:tender.maharashtra.gov.in`.

### Step 3.3: Register in Inji Verify
1. Log into the Inji Verify admin portal.
2. Add `did:web:tender.maharashtra.gov.in` to the Trusted Issuers Registry.
3. Now, any QR code scanned by the Inji Verify mobile app that points to your DID will be marked as "Trusted".

---

## 4. Status List Setup (Revocation)

To revoke a tender (e.g., if fraud is detected), we use a W3C Bitstring Status List. This is a highly compressed file where each "bit" (0 or 1) represents whether a specific credential is valid or revoked.

### Step 4.1: Initialize the List
1. Run the command: `node scripts/init-status-list.js`.
2. This creates an initial `.gz` zip file containing 131,072 bits (all set to `0` / valid) and signs it using your Ed25519 private key.

### Step 4.2: Verify the Public Endpoint
1. Navigate to `http://localhost:3000/.well-known/statuslist/1`.
2. You should receive a signed JWT containing the compressed bitstring.

### Step 4.3: Test Revocation
1. Use the Admin Dashboard to revoke a tender.
2. The backend will flip that specific tender's bit to `1`, re-compress, and re-sign the list.

---

## 5. Email Configuration

When a tender is awarded and signed, the system automatically emails the winning bidder.

### Step 5.1: Configure SMTP
1. In your `.env` file, configure your SMTP server credentials:
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASS=your-app-password
   ```

### Step 5.2: Test Award Notification
1. Ensure the bidder email on the test tender is valid.
2. Complete the signing process in the portal.
3. Check your inbox for the DOCX Award Letter and the generic tender notification.

---

## 6. Full Flow Test (End-to-End Walkthrough)

To verify the entire system works cohesively, execute this manual flow:

1. **Officer logs in**: An officer navigates to the portal, clicks "Login with eSignet", authenticates via OTP/Biometrics, and is redirected to the dashboard.
2. **Creates tender**: The officer fills out the form for a new tender (e.g., "Highway Construction") and submits it.
3. **Approves tender**: The officer (or an Admin) reviews the bids and marks the tender as "Awarded".
4. **Signs tender**: The officer clicks "Sign & Issue VC". They undergo biometric authentication (LOA3). The backend calls Inji Certify, receives a VC, generates an Award Letter PDF, and stamps a secure QR code on it.
5. **Bidder receives email**: The winning bidder receives an email with the PDF attached and a link to add the credential to their digital wallet.
6. **Bidder adds to wallet**: The bidder clicks the link, initiating an OID4VCI flow that drops the credential into their Inji Wallet app.
7. **Verifier scans QR**: A third-party auditor uses the Inji Verify app to scan the QR code on the printed PDF. The app queries the DID, checks the signature, and displays **GENUINE**.
8. **Admin revokes tender**: An Admin discovers a compliance issue, logs into the portal, and clicks "Revoke". The Status List bit is flipped to `1`.
9. **Verifier scans QR again**: The auditor scans the exact same printed piece of paper. The Inji Verify app checks the status list URL, sees bit `1`, and now displays **REVOKED**.
