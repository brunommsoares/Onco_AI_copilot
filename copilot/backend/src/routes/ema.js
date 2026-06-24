import express from 'express';

import emaService from '../services/emaService.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/ema/search
//
// Query EMA marketing authorisation data by substance, cancer type, biomarker.
// ---------------------------------------------------------------------------
router.get('/search', async (req, res, next) => {
  try {
    const payload = await emaService.findEmaData({
      question: req.query.q || req.query.question || '',
      substance: req.query.substance || req.query.drug || '',
      cancerType: req.query.cancerType || req.query.cancer || '',
      biomarker: req.query.biomarker || '',
      lineOfTherapy: req.query.lineOfTherapy || req.query.line || '',
      population: req.query.population || '',
      intervention: req.query.intervention || ''
    });

    res.json({
      success: true,
      ...payload
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/ema/status
//
// Service health, sync status, product/indication counts.
// ---------------------------------------------------------------------------
router.get('/status', async (req, res, next) => {
  try {
    const status = await emaService.getStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/ema/sync
//
// Manual sync trigger. Re-downloads EMA dataset and re-runs LLM extraction.
// ---------------------------------------------------------------------------
router.post('/sync', async (req, res, next) => {
  try {
    const meta = await emaService.runSync({
      reason: 'manual',
      force: true
    });
    res.json({
      success: true,
      meta
    });
  } catch (error) {
    next(error);
  }
});

export default router;
