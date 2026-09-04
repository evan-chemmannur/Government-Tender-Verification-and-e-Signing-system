// tests/factories.js — Mock object factories for use across all test files
// Matches the exact column names in the real migration SQL.

import crypto from 'crypto';

export function createMockOfficial(overrides = {}) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return {
    id:          `official_${suffix}`,
    aadhaar_sub: `aadhaar_${suffix}`,
    name:        'Test Official',
    email:       `official_${suffix}@gov.in`,
    role:        'OFFICER',
    department:  'PWD',
    loa:         1,
    is_active:   true,
    created_at:  new Date().toISOString(),
    ...overrides,
  };
}

export function createMockAdmin(overrides = {}) {
  return createMockOfficial({ role: 'ADMIN', loa: 3, ...overrides });
}

export function createMockSeniorOfficer(overrides = {}) {
  return createMockOfficial({ role: 'SENIOR_OFFICER', loa: 2, ...overrides });
}

export function createMockTender(overrides = {}) {
  const suffix    = crypto.randomBytes(4).toString('hex');
  const seqNum    = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  const id        = `tender_${suffix}`;
  const tenderId  = `MH-PWD-2025-${seqNum}`;
  return {
    id,
    tender_id:            tenderId,
    reference_no:         `REF-2025-${suffix}`,
    title:                'Test Tender for Road Works',
    description:          'A test tender description',
    department:           'PWD',
    category:             'INFRASTRUCTURE',
    status:               'DRAFT',
    estimated_value:      48500000,
    actual_value:         48500000,
    awarded_to_name:      'M/s Test Corp',
    awarded_to_gstin:     '27AABCU9603R1ZM',
    awarded_to_email:     'test@corp.in',
    submission_deadline:  new Date(Date.now() + 30 * 86400000).toISOString(),
    contract_start_date:  new Date(Date.now() + 60 * 86400000).toISOString(),
    contract_end_date:    new Date(Date.now() + 365 * 86400000).toISOString(),
    created_by:           'official_admin_001',
    created_at:           new Date().toISOString(),
    updated_at:           new Date().toISOString(),
    ...overrides,
  };
}

export function createMockVcRecord(overrides = {}) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return {
    id:                `vc_${suffix}`,
    tender_id:         'tender_signed_001',
    credential_id:     `cred_${suffix}`,
    vc_json:           JSON.stringify({
      '@context':          ['https://www.w3.org/2018/credentials/v1'],
      id:                  `https://certify.inji.io/vc/${suffix}`,
      type:                ['VerifiableCredential', 'TenderAwardCredential'],
      issuer:              'did:web:tender.maharashtra.gov.in',
      issuanceDate:        new Date().toISOString(),
      credentialSubject:   {
        id:            'did:web:test',
        tenderTitle:   'Test Tender',
        awardedTo:     'M/s Test Corp',
        contractValue: '₹4,85,00,000',
      },
    }),
    status:            'ACTIVE',
    status_list_index: 42,
    issued_at:         new Date().toISOString(),
    ...overrides,
  };
}

// Alias kept for backward compat (models.test.js used createMockVC)
export const createMockVC = createMockVcRecord;

export function createMockCredentialOffer(overrides = {}) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return {
    id:                  `offer_${suffix}`,
    vc_id:               'vc_test_001',
    pre_authorized_code: `pre_auth_${suffix}`,
    expires_at:          new Date(Date.now() + 7 * 86400000).toISOString(),
    bidder_email:        'bidder@corp.in',
    redeemed_at:         null,
    created_at:          new Date().toISOString(),
    ...overrides,
  };
}

export function createMockAuditLog(overrides = {}) {
  return {
    tender_id:   'tender_draft_001',
    official_id: 'official_admin_001',
    action:      'TENDER_CREATED',
    old_status:  null,
    new_status:  'DRAFT',
    details:     JSON.stringify({ test: true }),
    ip_address:  '127.0.0.1',
    created_at:  new Date().toISOString(),
    ...overrides,
  };
}

export function createMockStatusList(overrides = {}) {
  return {
    year:                new Date().getFullYear(),
    encoded_list:        Buffer.alloc(Math.ceil(100000 / 8)).toString('base64'),
    next_available_index: 0,
    ...overrides,
  };
}

export function createMockSession(overrides = {}) {
  return {
    officialId:  'official_admin_001',
    officialName:'Admin Officer',
    role:        'ADMIN',
    department:  'PWD',
    loa:         3,
    aadhaarSub:  'aadhaar_admin_001',
    createdAt:   Date.now(),
    ...overrides,
  };
}
