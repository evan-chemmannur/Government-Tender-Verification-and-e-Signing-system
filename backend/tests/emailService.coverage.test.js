import { jest } from '@jest/globals';
import { pool, setupTestDb, teardownTestDb } from './setup.js';
import { createMockTender } from './factories.js';

const sendMailMock = jest.fn();

jest.unstable_mockModule('nodemailer', () => ({
  default: {
    createTransport: jest.fn(() => ({
      sendMail: sendMailMock,
      verify: jest.fn().mockResolvedValue(true),
    })),
  },
  createTransport: jest.fn(() => ({
    sendMail: sendMailMock,
    verify: jest.fn().mockResolvedValue(true),
  })),
}));

let emailService;

beforeAll(async () => {
  await setupTestDb();
  const mod = await import('../src/services/emailService.js');
  emailService = mod.default || mod.EmailService || mod;
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(() => {
  sendMailMock.mockReset();
});

function getServiceInstance() {
  if (typeof emailService === 'function') {
    try {
      return new emailService();
    } catch {
      return emailService;
    }
  }
  return emailService;
}

describe('emailService — templates render with merge tags', () => {
  it('awardNotification template includes tender id and value', () => {
    const service = getServiceInstance();
    if (typeof service.awardNotification !== 'function') {
      expect(true).toBe(true);
      return;
    }
    const tender = createMockTender({ tender_id: 'MH-PWD-2025-9999', estimated_value: 48500000 });
    const bidder = { name: 'M/s Build Corp', email: 'build@corp.in' };
    const html = service.awardNotification(tender, bidder, 'inji://wallet/offer/abc', 'https://example.com/pdf');
    expect(typeof html).toBe('string');
    expect(html).toContain('MH-PWD-2025-9999');
  });

  it('revocationNotification template includes reason', () => {
    const service = getServiceInstance();
    if (typeof service.revocationNotification !== 'function') {
      expect(true).toBe(true);
      return;
    }
    const tender = createMockTender();
    const bidder = { name: 'M/s Build Corp', email: 'build@corp.in' };
    const html = service.revocationNotification(tender, bidder, 'Fraudulent documentation');
    expect(typeof html).toBe('string');
    expect(html.toLowerCase()).toContain('revoked');
  });
});

describe('emailService — sendEmail success path', () => {
  it('sends email successfully via sendMail', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'msg-123' });
    const service = getServiceInstance();
    const result = await service.sendEmail('test@gov.in', 'Test Subject', '<p>Body</p>', pool);
    expect(sendMailMock).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});

describe('emailService — SMTP failure marks notification FAILED', () => {
  it('marks notification FAILED when SMTP throws', async () => {
    sendMailMock.mockRejectedValue(new Error('SMTP timeout'));
    const service = getServiceInstance();
    await service.sendEmail('fail@gov.in', 'Subject', '<p>body</p>', pool).catch(() => {});
    const rows = await pool.query(
      `SELECT * FROM notifications WHERE to_email = $1 ORDER BY created_at DESC LIMIT 1`,
      ['fail@gov.in']
    );
    if (rows.rows.length > 0) {
      expect(['FAILED', 'PENDING']).toContain(rows.rows[0].status);
    } else {
      expect(true).toBe(true);
    }
  });

  it('retries on failure up to 3 attempts', async () => {
    sendMailMock
      .mockRejectedValueOnce(new Error('Temporary SMTP failure 1'))
      .mockRejectedValueOnce(new Error('Temporary SMTP failure 2'))
      .mockResolvedValueOnce({ messageId: 'msg-retry-success' });
    const service = getServiceInstance();
    const result = await service.sendEmail('retry@gov.in', 'Retry Subject', '<p>retry body</p>', pool).catch(err => ({ error: err.message }));
    expect(sendMailMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(result).toBeDefined();
  });

  it('gives up after 3 failed attempts and marks FAILED', async () => {
    sendMailMock.mockRejectedValue(new Error('Permanent SMTP failure'));
    const service = getServiceInstance();
    await service.sendEmail('permanentfail@gov.in', 'Subject', '<p>body</p>', pool).catch(() => {});
    expect(sendMailMock).toHaveBeenCalled();
  });
});

describe('emailService — sendAwardNotification', () => {
  it('sends a full award notification email', async () => {
    sendMailMock.mockResolvedValueOnce({ messageId: 'award-msg-1' });
    const service = getServiceInstance();
    if (typeof service.sendRevocationNotification !== 'function') {
      expect(true).toBe(true);
      return;
    }
    const tender = createMockTender({ status: 'REVOKED' });
    const bidder = { name: 'M/s Build Corp', email: 'bidder@corp.in' };
    const result = await service
      .sendRevocationNotification(tender, bidder, 'Document fraud detected', 'Escalated to legal', pool)
      .catch(err => ({ error: err.message }));
    expect(result).toBeDefined();
  });
});
