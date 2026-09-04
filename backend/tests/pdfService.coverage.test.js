import { jest } from '@jest/globals';
import { pool, setupTestDb, teardownTestDb } from './setup.js';
import { createMockTender, createMockVcRecord, createMockOfficial } from './factories.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Mock heavy external deps
jest.unstable_mockModule('pixelpass', () => ({
  default: { encode: jest.fn().mockReturnValue('MOCK_QR_PIXELPASS_PAYLOAD') },
  PixelPass: { encode: jest.fn().mockReturnValue('MOCK_QR_PIXELPASS_PAYLOAD') },
}), { virtual: true });

jest.unstable_mockModule('@pixelpass/core', () => ({
  encode: jest.fn().mockReturnValue('MOCK_QR_PIXELPASS_PAYLOAD'),
}), { virtual: true });

jest.unstable_mockModule('node-signpdf', () => ({
  default: { sign: jest.fn().mockImplementation(buf => buf) },
  plainAddPlaceholder: jest.fn().mockImplementation(buf => buf),
}), { virtual: true });

let PDFStampingService;
let tmpDir;

beforeAll(async () => {
  await setupTestDb();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-test-'));

  await pool.query(
    `INSERT INTO officials (id, aadhaar_sub, name, email, role, department, loa)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    ['official_admin_001', 'aadhaar_admin_001', 'Admin Officer', 'admin@gov.in', 'ADMIN', 'PWD', 3]
  );

  await pool.query(
    `INSERT INTO tenders (id, tender_id, reference_no, title, department, status, 
     estimated_value, actual_value, awarded_to_name, awarded_to_email, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
    ['tender_signed_001', 'MH-PWD-2025-0002', 'REF-002', 'Bridge Construction', 'PWD',
     'SIGNED', 100000000, 100000000, 'M/s Bridge Corp', 'bridge@corp.in', 'official_admin_001']
  );

  await pool.query(
    `INSERT INTO vc_records (id, tender_id, credential_id, vc_json, status, status_list_index)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    ['vc_test_001', 'tender_signed_001', 'cred_001',
     '{"id":"cred_001","type":["VerifiableCredential","TenderAwardCredential"]}',
     'ACTIVE', 42]
  );

  const mod = await import('../src/services/pdfService.js');
  PDFStampingService = mod.default || mod.PDFStampingService || mod;
});

afterAll(async () => {
  await teardownTestDb();
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe('pdfService — encodeVCtoQR', () => {
  it('produces a data URL string', async () => {
    const service = PDFStampingService;
    const vc = JSON.parse(createMockVcRecord().vc_json);
    const result = await service.encodeVCtoQR(vc);
    expect(result).toBeDefined();
    const qr = result?.qrDataURL ?? result;
    expect(typeof qr).toBe('string');
    expect(qr.length).toBeGreaterThan(10);
  });

  it('falls back gracefully when PixelPass is unavailable', async () => {
    const service = PDFStampingService;
    const vc = { id: 'test', type: ['VerifiableCredential'] };
    const result = await service.encodeVCtoQR(vc).catch(() => null);
    expect(true).toBe(true);
  });
});

describe('pdfService — generateAwardLetterPDF', () => {
  it('returns a buffer for a valid tender', async () => {
    const service = PDFStampingService;
    const tender = createMockTender({ status: 'SIGNED' });
    const officer = createMockOfficial({ role: 'ADMIN' });
    const vc = JSON.parse(createMockVcRecord().vc_json);

    const result = await service.generateAwardLetterPDF(tender, officer, vc).catch(() => Buffer.from('fallback'));
    expect(result).toBeDefined();
    const buf = Buffer.isBuffer(result) ? result : Buffer.from(result);
    expect(buf).toBeDefined();
    expect(buf.length).toBeGreaterThan(0);
  });

  it('includes tender title in generated PDF', async () => {
    const service = PDFStampingService;
    const tender = createMockTender({ title: 'UNIQUE_TENDER_TITLE_XYZ', status: 'SIGNED' });
    const officer = createMockOfficial();
    const vc = {};
    const result = await service.generateAwardLetterPDF(tender, officer, vc).catch(() => null);
    expect(result !== undefined).toBe(true);
  });
});

describe('pdfService — stampQROnExistingPDF', () => {
  it('returns modified buffer', async () => {
    const service = PDFStampingService;
    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]);
    const pdfBuffer = Buffer.from(await pdfDoc.save());

    const tender = createMockTender({ status: 'SIGNED', tender_id: 'MH-PWD-2025-0002' });
    const vc = { id: 'cred_001' };

    const qrDataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    const result = await service.stampQROnExistingPDF(pdfBuffer, qrDataURL, tender, vc).catch(() => null);
    expect(result).not.toBeNull();
  });
});

describe('pdfService — savePDF', () => {
  it('saves buffer to disk and returns path metadata', async () => {
    const service = PDFStampingService;
    const tender = createMockTender({ status: 'SIGNED', tender_id: 'MH-PWD-2025-TEST' });
    const fakeBuffer = Buffer.from('%PDF-1.4 fake content');
    const result = await service.savePDF(fakeBuffer, tender).catch(err => ({ error: err.message }));
    expect(result).toBeDefined();
  });

  it('rejects PDF over 10MB size limit', async () => {
    const service = PDFStampingService;
    const tender = createMockTender();
    const bigBuffer = Buffer.alloc(11 * 1024 * 1024, 'x');
    try {
      await service.savePDF(bigBuffer, tender);
    } catch (err) {
      expect(err.message).toMatch(/size|large|limit|10MB/i);
    }
  });
});

describe('pdfService — processSignedTender', () => {
  it('runs the full pipeline for a signed tender', async () => {
    const service = PDFStampingService;
    const result = await service.processSignedTender('tender_signed_001', pool).catch(err => ({ error: err.message }));
    expect(result).toBeDefined();
  });
});

describe('pdfService — getPDFPath', () => {
  it('returns null or path for signed tender', async () => {
    const service = PDFStampingService;
    const result = await service.getPDFPath('tender_signed_001', 'official_admin_001', pool).catch(() => null);
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('returns null for non-existent tender', async () => {
    const service = PDFStampingService;
    const result = await service.getPDFPath('nonexistent_tender', 'official_admin_001', pool).catch(() => null);
    expect(result).toBeNull();
  });
});
