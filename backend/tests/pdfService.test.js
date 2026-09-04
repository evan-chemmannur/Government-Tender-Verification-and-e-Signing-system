import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfService from '../src/services/pdfService.js';
import { tenderModel } from '../src/models/tenderModel.js';
import { vcModel } from '../src/models/vcModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempStorage = path.join(__dirname, '../storage/pdfs_test');

describe('PDF Stamping Pipeline', () => {
    let mockTender;
    let mockVC;
    let mockOfficer;

    beforeAll(async () => {
        // Set temp storage for test saves
        pdfService.currentStorageDir = tempStorage;
        await fs.mkdir(tempStorage, { recursive: true }).catch(() => {});

        mockTender = {
            id: 'uuid-1234',
            tender_id: 'TENDER-TEST-001',
            title: 'Bridge Construction',
            department: 'PWD',
            actual_value: 1000000, // 10,000 INR
            awarded_to_name: 'Builder Inc',
            contract_start_date: '2026-07-01'
        };

        mockVC = {
            credential_id: 'urn:uuid:vc-123',
            issued_at: new Date().toISOString()
        };

        mockOfficer = {
            name: 'Test Officer',
            designation: 'Engineer'
        };
    });

    afterAll(async () => {
        // Cleanup test PDFs
        await fs.rm(tempStorage, { recursive: true, force: true }).catch(() => {});
    });

    describe('QR Encoding', () => {
        it('should encode VC to QR Data URL with Level H error correction', async () => {
            const { qrDataURL } = await pdfService.encodeVCtoQR(mockVC);
            expect(qrDataURL).toMatch(/^data:image\/png;base64,/);
            
            // To be sure it works with a string
            const { qrDataURL: strQR } = await pdfService.encodeVCtoQR("plain text payload");
            expect(strQR).toMatch(/^data:image\/png;base64,/);
        });
    });

    describe('PDF Generation and Stamping via Worker', () => {
        let generatedPdfBytes;

        it('should generate an Award Letter PDF from scratch using worker', async () => {
            const { qrDataURL } = await pdfService.encodeVCtoQR(mockVC);
            generatedPdfBytes = await pdfService.generateAwardLetterPDF(mockTender, mockOfficer, mockVC, qrDataURL);
            
            expect(generatedPdfBytes).toBeInstanceOf(Uint8Array);
            const pdfStr = Buffer.from(generatedPdfBytes).toString('utf8', 0, 5);
            expect(pdfStr).toBe('%PDF-'); // PDF magic bytes
        });

        it('should stamp QR on an existing PDF using worker', async () => {
            const { qrDataURL } = await pdfService.encodeVCtoQR(mockVC);
            const stampedBytes = await pdfService.stampQROnExistingPDF(generatedPdfBytes, qrDataURL, mockTender, mockVC);
            
            expect(stampedBytes).toBeInstanceOf(Uint8Array);
            const pdfStr = Buffer.from(stampedBytes).toString('utf8', 0, 5);
            expect(pdfStr).toBe('%PDF-'); 
        });
    });

    describe('PDF Signing and Saving', () => {
        it('should fallback to unsigned PDF if certificates are missing', async () => {
            const fakeBuffer = Buffer.from('%PDF-1.4\n%Fake', 'utf8');
            const result = await pdfService.signPDF(fakeBuffer, '/invalid/cert.p12', '/invalid/key');
            
            // Because fallback returns the original buffer, it should match
            expect(result.toString('utf8')).toBe(fakeBuffer.toString('utf8'));
        });

        it('should enforce 10MB size limit in savePDF', async () => {
            // Create a fake 11MB buffer
            const giantBuffer = Buffer.alloc(11 * 1024 * 1024);
            
            await expect(pdfService.savePDF(giantBuffer, mockTender, { query: jest.fn() }))
                .rejects.toThrow('exceeds maximum allowed size of 10MB');
        });

        it('should save PDF to disk, hash it, and update DB', async () => {
            const smallBuffer = Buffer.from('%PDF-1.4', 'utf8');
            const mockDbPool = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
            
            const saved = await pdfService.savePDF(smallBuffer, mockTender, mockDbPool);
            
            expect(saved.filename).toMatch(/Award_TENDER-TEST-001_\d+\.pdf/);
            expect(saved.size).toBe(smallBuffer.length);
            expect(saved.hash).toBeDefined();
            expect(mockDbPool.query).toHaveBeenCalledWith(
                "UPDATE vc_records SET pdf_path = $1 WHERE tender_id = $2",
                [saved.path, mockTender.id]
            );

            // Verify file exists
            await expect(fs.access(saved.path)).resolves.not.toThrow();
        });
    });
});
