import { Router } from 'express';
// import { getVcByTenderId } from '../models/index.js';

const router = Router();

// Publicly accessible route to verify a tender
router.get('/:id', async (req, res, next) => {
    try {
        const tenderId = req.params.id;
        // Stub: Fetch VC from DB
        const dummyVc = { 
            id: `urn:vc:tender:${tenderId}`, 
            type: ["VerifiableCredential", "TenderAwardCredential"] 
        };
        
        res.json({ data: dummyVc });
    } catch (err) {
        next(err);
    }
});

export default router;
