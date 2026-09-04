import nodemailer from 'nodemailer';
import Bottleneck from 'bottleneck';
import Handlebars from 'handlebars';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } from '../config/constants.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EmailService {
    constructor() {
        this.transporter = nodemailer.createTransport({
            host: SMTP_HOST || 'smtp.ethereal.email',
            port: SMTP_PORT || 587,
            pool: true,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS
            }
        });

        this.limiter = new Bottleneck({
            minTime: 600, // 100 emails per minute = 1 email per 600ms
            maxConcurrent: 5
        });

        this.templates = {};
    }

    async loadTemplate(templateName) {
        if (this.templates[templateName]) return this.templates[templateName];
        try {
            const templatePath = path.join(__dirname, '..', 'templates', 'emails', `${templateName}.html`);
            const templateHtml = await fs.readFile(templatePath, 'utf8');
            this.templates[templateName] = Handlebars.compile(templateHtml);
            return this.templates[templateName];
        } catch (error) {
            logger.error(`Failed to load template ${templateName}: ${error.message}`);
            throw error;
        }
    }

    generatePlainText(htmlContent) {
        // Simple plain text conversion (strip tags)
        return htmlContent.replace(/<[^>]+>/g, '').replace(/\n\s*\n/g, '\n').trim();
    }

    async sendEmail(to, subject, htmlBody, plainText, db, tenderId = null) {
        const mailOptions = {
            from: EMAIL_FROM || '"Govt Tender Portal" <no-reply@maharashtra.gov.in>',
            to,
            bcc: 'compliance@department.gov.in',
            subject,
            html: htmlBody,
            text: plainText || this.generatePlainText(htmlBody)
        };

        // Insert PENDING notification
        let notificationId = null;
        if (db) {
            const res = await db.query(`
                INSERT INTO notifications (tender_id, recipient_email, notification_type, subject, body, status, retry_count)
                VALUES ($1, $2, $3, $4, $5, 'PENDING', 0)
                RETURNING id
            `, [tenderId, to, 'EMAIL', subject, htmlBody]);
            notificationId = res.rows[0].id;
        }

        let attempts = 0;
        let success = false;
        let lastError = null;

        while (attempts < 3 && !success) {
            attempts++;
            try {
                // Rate-limited send
                await this.limiter.schedule(() => this.transporter.sendMail(mailOptions));
                success = true;
                logger.info(`Email sent successfully to ${to} (Subject: ${subject})`);
                
                if (db && notificationId) {
                    await db.query(`UPDATE notifications SET status = 'SENT', sent_at = NOW(), retry_count = $1 WHERE id = $2`, [attempts - 1, notificationId]);
                }
            } catch (err) {
                lastError = err;
                logger.warn(`Failed to send email to ${to} (Attempt ${attempts}): ${err.message}`);
                
                if (db && notificationId) {
                    await db.query(`UPDATE notifications SET retry_count = $1 WHERE id = $2`, [attempts, notificationId]);
                }
                
                if (attempts < 3) {
                    // Small delay before retry
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                }
            }
        }

        if (!success) {
            logger.error(`Exhausted retries sending email to ${to}. Last error: ${lastError.message}`);
            if (db && notificationId) {
                await db.query(`UPDATE notifications SET status = 'FAILED', error_message = $1 WHERE id = $2`, [lastError.message, notificationId]);
            }
            throw new Error(`Email delivery failed after 3 attempts: ${lastError.message}`);
        }

        return true;
    }

    async sendAwardNotification(tender, bidder, walletURL, pdfURL, db) {
        const template = await this.loadTemplate('awardNotification');
        const html = template({
            TENDER_ID: tender.tender_id || tender.id,
            TENDER_TITLE: tender.title || 'Official Government Tender',
            BIDDER_NAME: bidder.name || 'Valued Bidder',
            CONTRACT_VALUE: tender.contract_value || 'N/A',
            WALLET_URL: walletURL,
            PDF_URL: pdfURL,
            VERIFICATION_URL: 'https://tender.maharashtra.gov.in/verify',
            CONTACT_EMAIL: 'support@pwd.maharashtra.gov.in',
            CONTACT_PHONE: '1800-111-222'
        });
        
        await this.sendEmail(bidder.email, `Tender Award Certificate: ${tender.tender_id || tender.id}`, html, null, db, tender.id);
    }

    async sendRevocationNotification(tender, bidder, reason, notes, db) {
        const template = await this.loadTemplate('revocationNotification');
        const html = template({
            TENDER_ID: tender.tender_id || tender.id,
            TENDER_TITLE: tender.title || 'Official Government Tender',
            BIDDER_NAME: bidder.name || 'Valued Bidder',
            REASON: reason,
            NOTES: notes || 'No additional notes provided.',
            CONTACT_EMAIL: 'support@pwd.maharashtra.gov.in',
            CONTACT_PHONE: '1800-111-222'
        });
        
        await this.sendEmail(bidder.email, `Notice of Revocation: ${tender.tender_id || tender.id}`, html, null, db, tender.id);
    }

    async sendReviewAssignment(tender, officer, db) {
        const template = await this.loadTemplate('reviewAssignment');
        const html = template({
            TENDER_ID: tender.tender_id || tender.id,
            TENDER_TITLE: tender.title || 'Official Government Tender',
            OFFICER_NAME: officer.name || 'Reviewing Officer'
        });
        
        await this.sendEmail(officer.email, `Tender Review Assigned: ${tender.tender_id || tender.id}`, html, null, db, tender.id);
    }

    async sendVerificationReport(tender, verificationResult, db) {
        const template = await this.loadTemplate('verificationReport');
        const html = template({
            TENDER_ID: tender.tender_id || tender.id,
            VERIFICATION_RESULT: verificationResult || 'Verified successfully.'
        });
        
        // Ensure email goes to compliance/admin if not explicitly bidder
        const recipient = 'compliance@department.gov.in'; 
        
        await this.sendEmail(recipient, `Verification Report: ${tender.tender_id || tender.id}`, html, null, db, tender.id);
    }
}

export default new EmailService();
