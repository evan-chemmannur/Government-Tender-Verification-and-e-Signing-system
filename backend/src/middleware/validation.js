import { z } from 'zod';
import logger from '../utils/logger.js';

export const validateBody = (schema) => {
  return (req, res, next) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
      }
      next(error);
    }
  };
};

export const CreateTenderSchema = z.object({
  title: z.string().min(5).max(500),
  description: z.string().min(10),
  department: z.string().min(2).max(255),
  category: z.enum(['WORKS', 'GOODS', 'SERVICES', 'CONSULTANCY']),
  estimatedValue: z.number().positive(),
  submissionDeadline: z.string().datetime(),
  awardedToName: z.string().optional().nullable(),
  awardedToGstin: z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, "Invalid GSTIN format").optional().nullable(),
  awardedToEmail: z.string().email().optional().nullable(),
  contractStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional().nullable(),
  contractEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional().nullable()
});

export const UpdateTenderSchema = CreateTenderSchema.partial().omit({ department: true });

export const RevokeReasonSchema = z.object({
  reason: z.enum(['COURT_ORDER', 'ADMINISTRATIVE_ERROR', 'FRAUD_DETECTED', 'POLICY_CHANGE', 'APPEAL_UPHELD', 'OTHER']),
  notes: z.string().min(5)
});
