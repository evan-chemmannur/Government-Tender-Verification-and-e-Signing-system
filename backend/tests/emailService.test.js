import { jest } from '@jest/globals';
import nodemailer from 'nodemailer';
import emailService from '../src/services/emailService.js';
import fs from 'fs/promises';

// Mock DB
const mockQuery = jest.fn();
const mockDb = { query: mockQuery };

// Mock Transporter
const mockSendMail = jest.fn();

beforeAll(() => {
    // Override the real transporter with a mock one
    emailService.transporter = { sendMail: mockSendMail };
});

beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [{ id: 'mock-uuid' }] });
    mockSendMail.mockResolvedValue({ messageId: '12345' });
});

describe('EmailService', () => {

    describe('sendEmail', () => {
        it('sends email successfully and updates DB status to SENT', async () => {
            await emailService.sendEmail('test@test.com', 'Subject', '<p>HTML</p>', 'Plain text', mockDb, 'tender-123');

            // Insert pending notification
            expect(mockQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('INSERT INTO notifications'), expect.any(Array));
            expect(mockQuery.mock.calls[0][1]).toEqual(expect.arrayContaining(['tender-123', 'test@test.com', 'EMAIL']));

            // Transporter send
            expect(mockSendMail).toHaveBeenCalledTimes(1);

            // Update to SENT
            expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("UPDATE notifications SET status = 'SENT'"), expect.arrayContaining([0, 'mock-uuid']));
        });

        it('retries on failure and sets FAILED after 3 attempts', async () => {
            mockSendMail.mockRejectedValue(new Error('SMTP Error'));

            await expect(
                emailService.sendEmail('test@test.com', 'Subject', '<p>HTML</p>', 'Plain text', mockDb)
            ).rejects.toThrow('Email delivery failed after 3 attempts: SMTP Error');

            expect(mockSendMail).toHaveBeenCalledTimes(3);

            // Check retry increments
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE notifications SET retry_count = $1"), [1, 'mock-uuid']);
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE notifications SET retry_count = $1"), [2, 'mock-uuid']);
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE notifications SET retry_count = $1"), [3, 'mock-uuid']);

            // Final check for FAILED status
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE notifications SET status = 'FAILED'"), ['SMTP Error', 'mock-uuid']);
        }, 10000); // increase timeout for retries

        it('recovers on 2nd attempt and sets SENT', async () => {
            mockSendMail
                .mockRejectedValueOnce(new Error('Transient Error'))
                .mockResolvedValueOnce({ messageId: '12345' });

            await emailService.sendEmail('test@test.com', 'Subject', '<p>HTML</p>', 'Plain text', mockDb);

            expect(mockSendMail).toHaveBeenCalledTimes(2);

            // First attempt failed
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE notifications SET retry_count = $1"), [1, 'mock-uuid']);
            
            // Second attempt success
            expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("UPDATE notifications SET status = 'SENT'"), [1, 'mock-uuid']);
        });
    });

    describe('Email Templates Integration', () => {
        it('compiles awardNotification template with all tags', async () => {
            const html = await emailService.loadTemplate('awardNotification');
            const result = html({
                BIDDER_NAME: 'John Doe',
                TENDER_ID: 'TNDR-001',
                CONTRACT_VALUE: 'Rs. 500,000',
                WALLET_URL: 'http://wallet',
                PDF_URL: 'http://pdf',
                VERIFICATION_URL: 'http://verify',
                CONTACT_EMAIL: 'support@pwd.gov.in',
                CONTACT_PHONE: '123456'
            });

            expect(result).toContain('John Doe');
            expect(result).toContain('TNDR-001');
            expect(result).toContain('Rs. 500,000');
            expect(result).toContain('http://wallet');
            expect(result).toContain('http://pdf');
            expect(result).toContain('support@pwd.gov.in');
        });
        
        it('compiles revocationNotification template', async () => {
            const html = await emailService.loadTemplate('revocationNotification');
            const result = html({
                BIDDER_NAME: 'John Doe',
                REASON: 'Document fraud',
                NOTES: 'Blacklisted for 2 years'
            });
            expect(result).toContain('John Doe');
            expect(result).toContain('Document fraud');
            expect(result).toContain('Blacklisted');
        });
    });
});
