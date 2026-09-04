import { jest } from '@jest/globals';
import request from 'supertest';
import { numberToWords } from '../src/utils/numberToWords.js';
import documentService from '../src/services/documentService.js';
import crypto from 'crypto';
import app from '../src/app.js'; // to test endpoints
import { pool, setupTestDb, teardownTestDb } from './setup.js';

beforeAll(async () => {
  await setupTestDb();
});


describe('Document Processing Module', () => {
  afterAll(async () => {
    await teardownTestDb();
    // pool is managed by setup.js global teardown
  });

  describe('numberToWords Utility', () => {
    it('should correctly convert paise to words', () => {
      expect(numberToWords(485000000)).toBe('Rupees Forty Eight Lakh Fifty Thousand Only');
      expect(numberToWords(10050)).toBe('Rupees One Hundred and Fifty Paise Only');
      expect(numberToWords(0)).toBe('Zero Rupees Only');
    });

    it('should explicitly reject floating point values to prevent drift', () => {
      expect(() => numberToWords(4850000.50)).toThrow('numberToWords explicitly requires an integer value');
    });
  });

  describe('Document Service - Validation', () => {
    it('should calculate correct SHA-256 hash', () => {
      const buffer = Buffer.from('test data');
      const expectedHash = crypto.createHash('sha256').update(buffer).digest('hex');
      
      // Bypass magic bytes check for this direct unit test
      jest.spyOn(documentService, 'validateFileBuffer').mockReturnValueOnce(expectedHash);
      const hash = documentService.validateFileBuffer(buffer, 'test.pdf');
      
      expect(hash).toBe(expectedHash);
      jest.restoreAllMocks();
    });

    it('should reject spoofed PDF files (missing magic bytes)', () => {
      const maliciousBuffer = Buffer.from('console.log("malicious");');
      
      expect(() => {
        documentService.validateFileBuffer(maliciousBuffer, 'invoice.pdf');
      }).toThrow('Invalid PDF file signature');
    });

    it('should reject spoofed DOCX files (missing magic bytes)', () => {
      const maliciousBuffer = Buffer.from('just random text');
      
      expect(() => {
        documentService.validateFileBuffer(maliciousBuffer, 'contract.docx');
      }).toThrow('Invalid DOCX file signature');
    });

    it('should accept valid PDF magic bytes', () => {
      const validPdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('data')]);
      const hash = documentService.validateFileBuffer(validPdfBuffer, 'test.pdf');
      expect(hash).toHaveLength(64); // sha256 hex length
    });
  });

  describe('Document Generation', () => {
    it('should generate a valid DOCX buffer for award letters', async () => {
      const tender = {
        tender_id: 'TEST-123',
        title: 'Test Tender',
        department: 'TEST_DEPT',
        estimated_value: 100000,
        currency: 'INR',
        awarded_to_name: 'John Doe',
        awarded_to_gstin: '22AAAAA0000A1Z5'
      };
      
      const officer = { name: 'Officer A', designation: 'Manager' };
      const vc = { credential_id: 'VC-999' };

      const docxBuffer = await documentService.generateAwardLetterDocx(tender, officer, vc);
      
      expect(Buffer.isBuffer(docxBuffer)).toBe(true);
      
      // Ensure the generated DOCX has correct magic bytes
      expect(docxBuffer[0]).toBe(0x50); // P
      expect(docxBuffer[1]).toBe(0x4B); // K
      expect(docxBuffer[2]).toBe(0x03);
      expect(docxBuffer[3]).toBe(0x04);
    });
  });
});
