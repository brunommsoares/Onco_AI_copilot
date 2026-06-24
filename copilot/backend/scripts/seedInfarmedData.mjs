#!/usr/bin/env node
/**
 * Seeds the INFARMED reimbursement database with known oncology drugs
 * and their Portuguese reimbursement status. Uses the dedicated LLM
 * to extract structured indications.
 *
 * Run: node scripts/seedInfarmedData.mjs
 */

import { createInfarmedReimbursementStore } from '../infarmedReimbursementStore.js';
import { normalizeSubstance } from '../infarmedScraper.js';
import crypto from 'crypto';

const hashId = (raw) =>
  crypto.createHash('sha1').update(String(raw)).digest('hex').slice(0, 12);

// Curated list of oncology drugs with known Portuguese reimbursement context.
// Sources: EMA product database, INFARMED AUE public lists, ESMO guidelines.
// This is the ground truth until live INFARMED scraping works reliably.
const ONCOLOGY_DRUGS = [
  // ── Checkpoint inhibitors ────────────────────────────────────────────
  {
    activeSubstance: 'pembrolizumab',
    tradeNames: ['Keytruda'],
    atcCode: 'L01FF02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'PD-L1 TPS ≥50%', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'PD-L1 TPS ≥1%', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'colorectal cancer', biomarker: 'MSI-H/dMMR', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'colorectal cancer', biomarker: 'MSI-H/dMMR', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'melanoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic/unresectable', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'melanoma', biomarker: '', lineOfTherapy: 'adjuvant', stage: 'resected stage III', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'head and neck squamous cell carcinoma', biomarker: 'PD-L1 CPS ≥1', lineOfTherapy: '1L', stage: 'metastatic/recurrent', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'urothelial carcinoma', biomarker: 'PD-L1 CPS ≥10', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with axitinib or lenvatinib', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'endometrial cancer', biomarker: 'dMMR/MSI-H', lineOfTherapy: '1L', stage: 'advanced/metastatic', combination: 'with lenvatinib or monotherapy', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'cervical cancer', biomarker: 'PD-L1 CPS ≥1', lineOfTherapy: '1L', stage: 'metastatic/recurrent', combination: 'with chemotherapy ± bevacizumab', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'triple-negative breast cancer', biomarker: 'PD-L1 CPS ≥10', lineOfTherapy: 'neoadjuvant + adjuvant', stage: 'early stage', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'gastric/GEJ adenocarcinoma', biomarker: 'PD-L1 CPS ≥5', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'esophageal cancer', biomarker: 'PD-L1 CPS ≥10', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'biliary tract cancer', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with gemcitabine and cisplatin', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'MSI-H/dMMR solid tumors', biomarker: 'MSI-H/dMMR', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'TMB-H solid tumors', biomarker: 'TMB-H ≥10 mut/Mb', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'low' },
    ]
  },
  {
    activeSubstance: 'nivolumab',
    tradeNames: ['Opdivo'],
    atcCode: 'L01FF01',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with ipilimumab ± chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: 'neoadjuvant', stage: 'resectable', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'melanoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic/unresectable', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'melanoma', biomarker: '', lineOfTherapy: 'adjuvant', stage: 'resected stage III/IV', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with ipilimumab or cabozantinib', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'colorectal cancer', biomarker: 'MSI-H/dMMR', lineOfTherapy: '2L+', stage: 'metastatic', combination: 'with ipilimumab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'hepatocellular carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with ipilimumab', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'esophageal/GEJ cancer', biomarker: '', lineOfTherapy: 'adjuvant', stage: 'resected', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'urothelial carcinoma', biomarker: '', lineOfTherapy: 'adjuvant', stage: 'muscle-invasive', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'gastric/GEJ adenocarcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'head and neck squamous cell carcinoma', biomarker: '', lineOfTherapy: '2L+', stage: 'recurrent/metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'atezolizumab',
    tradeNames: ['Tecentriq'],
    atcCode: 'L01FF05',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with bevacizumab + chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'extensive stage', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'hepatocellular carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with bevacizumab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'PD-L1 TC ≥50% or IC ≥10%', lineOfTherapy: 'adjuvant', stage: 'resected stage II-IIIA', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'durvalumab',
    tradeNames: ['Imfinzi'],
    atcCode: 'L01FF03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'PD-L1 ≥1%', lineOfTherapy: 'consolidation', stage: 'stage III unresectable', combination: 'after chemoradiation', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'extensive stage', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'biliary tract cancer', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with gemcitabine and cisplatin', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'hepatocellular carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with tremelimumab', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'endometrial cancer', biomarker: 'dMMR', lineOfTherapy: '1L', stage: 'advanced/recurrent', combination: 'with carboplatin and paclitaxel', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'ipilimumab',
    tradeNames: ['Yervoy'],
    atcCode: 'L01FX04',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'melanoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with nivolumab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with nivolumab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'colorectal cancer', biomarker: 'MSI-H/dMMR', lineOfTherapy: '2L+', stage: 'metastatic', combination: 'with nivolumab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'mesothelioma', biomarker: '', lineOfTherapy: '1L', stage: 'unresectable', combination: 'with nivolumab', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with nivolumab ± chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'esophageal cancer', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with nivolumab + chemotherapy', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  // ── Targeted therapy — HER2 ──────────────────────────────────────────
  {
    activeSubstance: 'trastuzumab deruxtecan',
    tradeNames: ['Enhertu'],
    atcCode: 'L01FD04',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HER2-positive', lineOfTherapy: '2L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: 'HER2-low', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'HER2 mutation', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'gastric cancer', biomarker: 'HER2-positive', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  // ── PARP inhibitors ──────────────────────────────────────────────────
  {
    activeSubstance: 'olaparib',
    tradeNames: ['Lynparza'],
    atcCode: 'L01XK01',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'ovarian cancer', biomarker: 'BRCA1/2 mutation', lineOfTherapy: 'maintenance', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: 'gBRCA mutation, HER2-negative', lineOfTherapy: 'adjuvant', stage: 'early high-risk', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: 'gBRCA mutation, HER2-negative', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'prostate cancer', biomarker: 'BRCA1/2 or ATM mutation', lineOfTherapy: '2L+', stage: 'mCRPC', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'pancreatic cancer', biomarker: 'gBRCA mutation', lineOfTherapy: 'maintenance', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  // ── CDK4/6 inhibitors ────────────────────────────────────────────────
  {
    activeSubstance: 'ribociclib',
    tradeNames: ['Kisqali'],
    atcCode: 'L01EF02',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HR+/HER2-negative', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with aromatase inhibitor or fulvestrant', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: 'HR+/HER2-negative', lineOfTherapy: '2L', stage: 'metastatic', combination: 'with fulvestrant', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'palbociclib',
    tradeNames: ['Ibrance'],
    atcCode: 'L01EF01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HR+/HER2-negative', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with aromatase inhibitor', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: 'HR+/HER2-negative', lineOfTherapy: '2L', stage: 'metastatic', combination: 'with fulvestrant', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'abemaciclib',
    tradeNames: ['Verzenios'],
    atcCode: 'L01EF03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HR+/HER2-negative', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with aromatase inhibitor', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: 'HR+/HER2-negative, Ki-67 ≥20%', lineOfTherapy: 'adjuvant', stage: 'early high-risk', combination: 'with endocrine therapy', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  // ── EGFR/ALK inhibitors ──────────────────────────────────────────────
  {
    activeSubstance: 'osimertinib',
    tradeNames: ['Tagrisso'],
    atcCode: 'L01EB04',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'EGFR mutation (ex19del/L858R)', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'EGFR T790M', lineOfTherapy: '2L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'EGFR mutation', lineOfTherapy: 'adjuvant', stage: 'resected stage IB-IIIA', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'alectinib',
    tradeNames: ['Alecensa'],
    atcCode: 'L01ED03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'ALK-positive', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'ALK-positive', lineOfTherapy: 'adjuvant', stage: 'resected stage IB-IIIA', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'lorlatinib',
    tradeNames: ['Lorviqua'],
    atcCode: 'L01ED05',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'ALK-positive', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'ALK-positive', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  // ── KRAS ──────────────────────────────────────────────────────────────
  {
    activeSubstance: 'sotorasib',
    tradeNames: ['Lumakras'],
    atcCode: 'L01XX73',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'KRAS G12C', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  // ── ADCs ──────────────────────────────────────────────────────────────
  {
    activeSubstance: 'sacituzumab govitecan',
    tradeNames: ['Trodelvy'],
    atcCode: 'L01FX17',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'triple-negative breast cancer', biomarker: '', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: 'HR+/HER2-negative', lineOfTherapy: '3L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
      { cancerType: 'urothelial carcinoma', biomarker: '', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'enfortumab vedotin',
    tradeNames: ['Padcev'],
    atcCode: 'L01FX13',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'urothelial carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with pembrolizumab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'urothelial carcinoma', biomarker: '', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  // ── RCC TKIs ─────────────────────────────────────────────────────────
  {
    activeSubstance: 'cabozantinib',
    tradeNames: ['Cabometyx'],
    atcCode: 'L01EX07',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with nivolumab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'hepatocellular carcinoma', biomarker: '', lineOfTherapy: '2L', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'lenvatinib',
    tradeNames: ['Lenvima', 'Kisplyx'],
    atcCode: 'L01EX08',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with pembrolizumab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'endometrial cancer', biomarker: 'non-dMMR', lineOfTherapy: '2L+', stage: 'advanced', combination: 'with pembrolizumab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'hepatocellular carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'thyroid cancer', biomarker: '', lineOfTherapy: '1L', stage: 'advanced DTC', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  // ── Prostate ─────────────────────────────────────────────────────────
  {
    activeSubstance: 'enzalutamide',
    tradeNames: ['Xtandi'],
    atcCode: 'L02BB04',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'prostate cancer', biomarker: '', lineOfTherapy: '1L', stage: 'mCRPC', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'prostate cancer', biomarker: '', lineOfTherapy: '1L', stage: 'mHSPC', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'abiraterone',
    tradeNames: ['Zytiga'],
    atcCode: 'L02BX03',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'prostate cancer', biomarker: '', lineOfTherapy: '1L', stage: 'mCRPC', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'prostate cancer', biomarker: '', lineOfTherapy: '1L', stage: 'mHSPC', combination: 'with prednisone', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  // ── BRAF/MEK ─────────────────────────────────────────────────────────
  {
    activeSubstance: 'dabrafenib + trametinib',
    tradeNames: ['Tafinlar + Mekinist'],
    atcCode: 'L01EC02+L01EE01',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'melanoma', biomarker: 'BRAF V600', lineOfTherapy: '1L', stage: 'metastatic/unresectable', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'melanoma', biomarker: 'BRAF V600', lineOfTherapy: 'adjuvant', stage: 'resected stage III', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'BRAF V600E', lineOfTherapy: '1L or 2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'encorafenib',
    tradeNames: ['Braftovi'],
    atcCode: 'L01EC03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'colorectal cancer', biomarker: 'BRAF V600E', lineOfTherapy: '2L+', stage: 'metastatic', combination: 'with cetuximab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'melanoma', biomarker: 'BRAF V600', lineOfTherapy: '1L', stage: 'metastatic/unresectable', combination: 'with binimetinib', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  // ── Checkpoint inhibitors (additional) ──────────────────────────────
  {
    activeSubstance: 'cemiplimab',
    tradeNames: ['Libtayo'],
    atcCode: 'L01FF06',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'cutaneous squamous cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic/locally advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'PD-L1 TPS ≥50%', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'basal cell carcinoma', biomarker: '', lineOfTherapy: '2L+', stage: 'locally advanced/metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'dostarlimab',
    tradeNames: ['Jemperli'],
    atcCode: 'L01FF07',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'endometrial cancer', biomarker: 'dMMR/MSI-H', lineOfTherapy: '1L', stage: 'advanced/recurrent', combination: 'with carboplatin and paclitaxel', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'dMMR solid tumors', biomarker: 'dMMR', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'avelumab',
    tradeNames: ['Bavencio'],
    atcCode: 'L01FF04',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'Merkel cell carcinoma', biomarker: '', lineOfTherapy: '1L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'urothelial carcinoma', biomarker: '', lineOfTherapy: 'maintenance', stage: 'metastatic', combination: 'after platinum-based chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'tremelimumab',
    tradeNames: ['Imjudo'],
    atcCode: 'L01FX24',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'hepatocellular carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with durvalumab', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  // ── HER2 agents ────────────────────────────────────────────────────
  {
    activeSubstance: 'trastuzumab',
    tradeNames: ['Herceptin'],
    atcCode: 'L01FD01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HER2-positive', lineOfTherapy: '1L', stage: 'early/metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'gastric cancer', biomarker: 'HER2-positive', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'pertuzumab',
    tradeNames: ['Perjeta'],
    atcCode: 'L01FD02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HER2-positive', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with trastuzumab and docetaxel', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: 'HER2-positive', lineOfTherapy: 'neoadjuvant', stage: 'early stage', combination: 'with trastuzumab and chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'tucatinib',
    tradeNames: ['Tukysa'],
    atcCode: 'L01EH03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HER2-positive', lineOfTherapy: '2L+', stage: 'metastatic including brain metastases', combination: 'with trastuzumab and capecitabine', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'margetuximab',
    tradeNames: ['Margenza'],
    atcCode: 'L01FD03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HER2-positive', lineOfTherapy: '3L+', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'trastuzumab emtansine',
    tradeNames: ['Kadcyla'],
    atcCode: 'L01FD03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HER2-positive', lineOfTherapy: '2L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: 'HER2-positive', lineOfTherapy: 'adjuvant', stage: 'residual disease after neoadjuvant', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  // ── VEGF/TKI ───────────────────────────────────────────────────────
  {
    activeSubstance: 'bevacizumab',
    tradeNames: ['Avastin'],
    atcCode: 'L01FG01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'colorectal cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic non-squamous', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'ovarian cancer', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'cervical cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic/recurrent', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with interferon-alpha', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'glioblastoma', biomarker: '', lineOfTherapy: '2L', stage: 'recurrent', reimbursementStatus: 'AIM+SNS', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'sunitinib',
    tradeNames: ['Sutent'],
    atcCode: 'L01EX01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'gastrointestinal stromal tumor', biomarker: '', lineOfTherapy: '2L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'pazopanib',
    tradeNames: ['Votrient'],
    atcCode: 'L01EX03',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'soft tissue sarcoma', biomarker: '', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'axitinib',
    tradeNames: ['Inlyta'],
    atcCode: 'L01EK01',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '2L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with pembrolizumab', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'regorafenib',
    tradeNames: ['Stivarga'],
    atcCode: 'L01EX05',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'colorectal cancer', biomarker: '', lineOfTherapy: '3L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'hepatocellular carcinoma', biomarker: '', lineOfTherapy: '2L', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'gastrointestinal stromal tumor', biomarker: '', lineOfTherapy: '3L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'sorafenib',
    tradeNames: ['Nexavar'],
    atcCode: 'L01EX02',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'hepatocellular carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'thyroid cancer', biomarker: '', lineOfTherapy: '1L', stage: 'advanced DTC', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '2L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'ramucirumab',
    tradeNames: ['Cyramza'],
    atcCode: 'L01FG02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'gastric/GEJ adenocarcinoma', biomarker: '', lineOfTherapy: '2L', stage: 'metastatic', combination: 'with paclitaxel', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '2L', stage: 'metastatic', combination: 'with docetaxel', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'hepatocellular carcinoma', biomarker: 'AFP ≥400 ng/mL', lineOfTherapy: '2L', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  // ── EGFR ───────────────────────────────────────────────────────────
  {
    activeSubstance: 'erlotinib',
    tradeNames: ['Tarceva'],
    atcCode: 'L01EB02',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'EGFR mutation', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'gefitinib',
    tradeNames: ['Iressa'],
    atcCode: 'L01EB01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'EGFR mutation', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'afatinib',
    tradeNames: ['Giotrif'],
    atcCode: 'L01EB03',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'EGFR mutation', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'cetuximab',
    tradeNames: ['Erbitux'],
    atcCode: 'L01FE01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'colorectal cancer', biomarker: 'RAS wild-type', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'colorectal cancer', biomarker: 'RAS wild-type', lineOfTherapy: '2L+', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'head and neck squamous cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'locally advanced/recurrent/metastatic', combination: 'with radiotherapy or chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'panitumumab',
    tradeNames: ['Vectibix'],
    atcCode: 'L01FE02',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'colorectal cancer', biomarker: 'RAS wild-type', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'colorectal cancer', biomarker: 'RAS wild-type', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'amivantamab',
    tradeNames: ['Rybrevant'],
    atcCode: 'L01FX18',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'EGFR exon 20 insertion', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'EGFR exon 20 insertion', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  // ── ALK/ROS1/RET/NTRK ─────────────────────────────────────────────
  {
    activeSubstance: 'crizotinib',
    tradeNames: ['Xalkori'],
    atcCode: 'L01ED01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'ALK-positive', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'ROS1-positive', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'brigatinib',
    tradeNames: ['Alunbrig'],
    atcCode: 'L01ED04',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'ALK-positive', lineOfTherapy: '2L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'ALK-positive', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'ceritinib',
    tradeNames: ['Zykadia'],
    atcCode: 'L01ED02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'ALK-positive', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'ALK-positive', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'entrectinib',
    tradeNames: ['Rozlytrek'],
    atcCode: 'L01EX14',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'NTRK fusion-positive solid tumors', biomarker: 'NTRK fusion', lineOfTherapy: '1L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'ROS1-positive', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'larotrectinib',
    tradeNames: ['Vitrakvi'],
    atcCode: 'L01EX12',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'NTRK fusion-positive solid tumors', biomarker: 'NTRK fusion', lineOfTherapy: '1L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'selpercatinib',
    tradeNames: ['Retevmo'],
    atcCode: 'L01EX22',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'RET fusion', lineOfTherapy: '1L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'thyroid cancer', biomarker: 'RET-mutant MTC', lineOfTherapy: '1L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'thyroid cancer', biomarker: 'RET fusion', lineOfTherapy: '1L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'pralsetinib',
    tradeNames: ['Gavreto'],
    atcCode: 'L01EX21',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'RET fusion', lineOfTherapy: '1L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'capmatinib',
    tradeNames: ['Tabrecta'],
    atcCode: 'L01EX19',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'MET exon 14 skipping', lineOfTherapy: '1L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'tepotinib',
    tradeNames: ['Tepmetko'],
    atcCode: 'L01EX20',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'MET exon 14 skipping', lineOfTherapy: '1L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  // ── PARP inhibitors (additional) ───────────────────────────────────
  {
    activeSubstance: 'niraparib',
    tradeNames: ['Zejula'],
    atcCode: 'L01XK02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'ovarian cancer', biomarker: '', lineOfTherapy: 'maintenance', stage: 'advanced', combination: 'after platinum response', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'ovarian cancer', biomarker: 'BRCA1/2 mutation', lineOfTherapy: '3L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'rucaparib',
    tradeNames: ['Rubraca'],
    atcCode: 'L01XK03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'ovarian cancer', biomarker: 'BRCA1/2 mutation', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'talazoparib',
    tradeNames: ['Talzenna'],
    atcCode: 'L01XK04',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'gBRCA mutation, HER2-negative', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'prostate cancer', biomarker: 'HRD (BRCA1/2)', lineOfTherapy: '2L+', stage: 'mCRPC', combination: 'with enzalutamide', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  // ── Breast other ───────────────────────────────────────────────────
  {
    activeSubstance: 'alpelisib',
    tradeNames: ['Piqray'],
    atcCode: 'L01EM04',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HR+/HER2-negative, PIK3CA mutated', lineOfTherapy: '2L+', stage: 'metastatic', combination: 'with fulvestrant', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'capivasertib',
    tradeNames: ['Truqap'],
    atcCode: 'L01EM05',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HR+/HER2-negative, AKT pathway alteration', lineOfTherapy: '2L+', stage: 'metastatic', combination: 'with fulvestrant', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'everolimus',
    tradeNames: ['Afinitor'],
    atcCode: 'L01EG02',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: 'HR+/HER2-negative', lineOfTherapy: '2L+', stage: 'metastatic', combination: 'with exemestane', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '2L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'neuroendocrine tumors', biomarker: '', lineOfTherapy: '1L+', stage: 'advanced', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  // ── Hematology / Myeloma ───────────────────────────────────────────
  {
    activeSubstance: 'ibrutinib',
    tradeNames: ['Imbruvica'],
    atcCode: 'L01EL01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'chronic lymphocytic leukemia', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'chronic lymphocytic leukemia', biomarker: '', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'mantle cell lymphoma', biomarker: '', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'acalabrutinib',
    tradeNames: ['Calquence'],
    atcCode: 'L01EL02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'chronic lymphocytic leukemia', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'chronic lymphocytic leukemia', biomarker: '', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'zanubrutinib',
    tradeNames: ['Brukinsa'],
    atcCode: 'L01EL03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'chronic lymphocytic leukemia', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'mantle cell lymphoma', biomarker: '', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'Waldenström macroglobulinemia', biomarker: '', lineOfTherapy: '1L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'venetoclax',
    tradeNames: ['Venclexta'],
    atcCode: 'L01XX52',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'chronic lymphocytic leukemia', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with rituximab or obinutuzumab', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'chronic lymphocytic leukemia', biomarker: 'del(17p)/TP53 mutation', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'acute myeloid leukemia', biomarker: '', lineOfTherapy: '1L', stage: 'newly diagnosed unfit', combination: 'with azacitidine', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'rituximab',
    tradeNames: ['MabThera'],
    atcCode: 'L01FA01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-Hodgkin lymphoma', biomarker: 'CD20-positive', lineOfTherapy: '1L', stage: 'advanced', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'chronic lymphocytic leukemia', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'diffuse large B-cell lymphoma', biomarker: 'CD20-positive', lineOfTherapy: '1L', stage: 'advanced', combination: 'with CHOP', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'obinutuzumab',
    tradeNames: ['Gazyva'],
    atcCode: 'L01FA02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'chronic lymphocytic leukemia', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with chlorambucil or venetoclax', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'follicular lymphoma', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'daratumumab',
    tradeNames: ['Darzalex'],
    atcCode: 'L01FC01',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'multiple myeloma', biomarker: '', lineOfTherapy: '1L', stage: 'newly diagnosed', combination: 'with VMP or Rd', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'multiple myeloma', biomarker: '', lineOfTherapy: '2L+', stage: 'relapsed/refractory', combination: 'with lenalidomide + dexamethasone or bortezomib + dexamethasone', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'isatuximab',
    tradeNames: ['Sarclisa'],
    atcCode: 'L01FC02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'multiple myeloma', biomarker: '', lineOfTherapy: '2L+', stage: 'relapsed/refractory', combination: 'with pomalidomide + dexamethasone or carfilzomib + dexamethasone', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'lenalidomide',
    tradeNames: ['Revlimid'],
    atcCode: 'L04AX04',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'multiple myeloma', biomarker: '', lineOfTherapy: '1L', stage: 'newly diagnosed', combination: 'with dexamethasone', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'multiple myeloma', biomarker: '', lineOfTherapy: 'maintenance', stage: 'post-transplant', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'myelodysplastic syndromes', biomarker: 'del(5q)', lineOfTherapy: '1L+', stage: 'advanced', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'pomalidomide',
    tradeNames: ['Imnovid'],
    atcCode: 'L04AX06',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'multiple myeloma', biomarker: '', lineOfTherapy: '3L+', stage: 'relapsed/refractory', combination: 'with dexamethasone', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'bortezomib',
    tradeNames: ['Velcade'],
    atcCode: 'L01XG01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'multiple myeloma', biomarker: '', lineOfTherapy: '1L', stage: 'newly diagnosed', combination: 'with melphalan + prednisone or dexamethasone', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'multiple myeloma', biomarker: '', lineOfTherapy: '2L+', stage: 'relapsed/refractory', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'mantle cell lymphoma', biomarker: '', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'carfilzomib',
    tradeNames: ['Kyprolis'],
    atcCode: 'L01XG02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'multiple myeloma', biomarker: '', lineOfTherapy: '2L+', stage: 'relapsed/refractory', combination: 'with dexamethasone ± lenalidomide', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'brentuximab vedotin',
    tradeNames: ['Adcetris'],
    atcCode: 'L01FX05',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'Hodgkin lymphoma', biomarker: 'CD30-positive', lineOfTherapy: '2L+', stage: 'relapsed/refractory', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'Hodgkin lymphoma', biomarker: 'CD30-positive', lineOfTherapy: '1L', stage: 'advanced', combination: 'with AVD', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'anaplastic large cell lymphoma', biomarker: 'CD30-positive', lineOfTherapy: '2L+', stage: 'relapsed/refractory', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'polatuzumab vedotin',
    tradeNames: ['Polivy'],
    atcCode: 'L01FX14',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'diffuse large B-cell lymphoma', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with R-CHP', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'diffuse large B-cell lymphoma', biomarker: '', lineOfTherapy: '2L+', stage: 'relapsed/refractory', combination: 'with bendamustine + rituximab', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'tisagenlecleucel',
    tradeNames: ['Kymriah'],
    atcCode: 'L01XL03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'acute lymphoblastic leukemia', biomarker: 'CD19-positive', lineOfTherapy: '2L+', stage: 'relapsed/refractory', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'diffuse large B-cell lymphoma', biomarker: 'CD19-positive', lineOfTherapy: '3L+', stage: 'relapsed/refractory', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'axicabtagene ciloleucel',
    tradeNames: ['Yescarta'],
    atcCode: 'L01XL02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'diffuse large B-cell lymphoma', biomarker: 'CD19-positive', lineOfTherapy: '2L+', stage: 'relapsed/refractory', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  // ── Other targeted ─────────────────────────────────────────────────
  {
    activeSubstance: 'imatinib',
    tradeNames: ['Glivec'],
    atcCode: 'L01EA01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'chronic myeloid leukemia', biomarker: 'BCR-ABL positive', lineOfTherapy: '1L', stage: 'chronic/accelerated/blast phase', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'gastrointestinal stromal tumor', biomarker: 'KIT-positive', lineOfTherapy: '1L', stage: 'metastatic/unresectable', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'gastrointestinal stromal tumor', biomarker: 'KIT-positive', lineOfTherapy: 'adjuvant', stage: 'resected high-risk', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'dasatinib',
    tradeNames: ['Sprycel'],
    atcCode: 'L01EA02',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'chronic myeloid leukemia', biomarker: 'BCR-ABL positive', lineOfTherapy: '2L', stage: 'chronic/accelerated/blast phase', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'nilotinib',
    tradeNames: ['Tasigna'],
    atcCode: 'L01EA03',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'chronic myeloid leukemia', biomarker: 'BCR-ABL positive', lineOfTherapy: '1L', stage: 'chronic phase', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'chronic myeloid leukemia', biomarker: 'BCR-ABL positive', lineOfTherapy: '2L+', stage: 'chronic/accelerated phase', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'bosutinib',
    tradeNames: ['Bosulif'],
    atcCode: 'L01EA04',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'chronic myeloid leukemia', biomarker: 'BCR-ABL positive', lineOfTherapy: '2L+', stage: 'chronic/accelerated/blast phase', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'ponatinib',
    tradeNames: ['Iclusig'],
    atcCode: 'L01EA05',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'chronic myeloid leukemia', biomarker: 'BCR-ABL T315I', lineOfTherapy: '2L+', stage: 'chronic/accelerated/blast phase', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'gilteritinib',
    tradeNames: ['Xospata'],
    atcCode: 'L01EX13',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'acute myeloid leukemia', biomarker: 'FLT3 mutation', lineOfTherapy: '2L+', stage: 'relapsed/refractory', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'midostaurina',
    tradeNames: ['Rydapt'],
    atcCode: 'L01EX10',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'acute myeloid leukemia', biomarker: 'FLT3 mutation', lineOfTherapy: '1L', stage: 'newly diagnosed', combination: 'with chemotherapy', reimbursementStatus: 'AUE', confidence: 'high' },
      { cancerType: 'systemic mastocytosis', biomarker: '', lineOfTherapy: '1L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'azacitidina',
    tradeNames: ['Vidaza'],
    atcCode: 'L01BC07',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'acute myeloid leukemia', biomarker: '', lineOfTherapy: '1L', stage: 'newly diagnosed unfit for intensive chemo', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'myelodysplastic syndromes', biomarker: '', lineOfTherapy: '1L', stage: 'higher-risk', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'decitabina',
    tradeNames: ['Dacogen'],
    atcCode: 'L01BC08',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'acute myeloid leukemia', biomarker: '', lineOfTherapy: '1L', stage: 'newly diagnosed elderly unfit', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'futibatinib',
    tradeNames: ['Lytgobi'],
    atcCode: 'L01EN02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'cholangiocarcinoma', biomarker: 'FGFR2 fusion/rearrangement', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'pemigatinib',
    tradeNames: ['Pemazyre'],
    atcCode: 'L01EN01',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'cholangiocarcinoma', biomarker: 'FGFR2 fusion/rearrangement', lineOfTherapy: '2L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'erdafitinib',
    tradeNames: ['Balversa'],
    atcCode: 'L01EN03',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'urothelial carcinoma', biomarker: 'FGFR alteration', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'belzutifan',
    tradeNames: ['Welireg'],
    atcCode: 'L01XX75',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'renal cell carcinoma', biomarker: 'VHL disease-associated', lineOfTherapy: '1L+', stage: 'advanced', reimbursementStatus: 'AUE', confidence: 'medium' },
    ]
  },
  {
    activeSubstance: 'tivozanib',
    tradeNames: ['Fotivda'],
    atcCode: 'L01EK02',
    reimbursementType: 'AUE',
    status: 'AUE - Autorizado',
    emaApproved: true,
    indications: [
      { cancerType: 'renal cell carcinoma', biomarker: '', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AUE', confidence: 'high' },
    ]
  },
  // ── Chemotherapy (key agents) ──────────────────────────────────────
  {
    activeSubstance: 'docetaxel',
    tradeNames: ['Taxotere'],
    atcCode: 'L01CD02',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: '', lineOfTherapy: '1L+', stage: 'metastatic/adjuvant', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '1L+', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'prostate cancer', biomarker: '', lineOfTherapy: '1L', stage: 'mCRPC', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'gastric cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with chemotherapy regimen', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'paclitaxel',
    tradeNames: ['Taxol'],
    atcCode: 'L01CD01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'breast cancer', biomarker: '', lineOfTherapy: '1L+', stage: 'metastatic/adjuvant', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'ovarian cancer', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with carboplatin', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with carboplatin', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'carboplatin',
    tradeNames: ['Paraplatin'],
    atcCode: 'L01XA02',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'ovarian cancer', biomarker: '', lineOfTherapy: '1L', stage: 'advanced', combination: 'with paclitaxel', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with pemetrexed or paclitaxel', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'extensive stage', combination: 'with etoposide', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'cisplatin',
    tradeNames: ['Platinol'],
    atcCode: 'L01XA01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'testicular cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with BEP regimen', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'bladder cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic/neoadjuvant', combination: 'with gemcitabine', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'head and neck squamous cell carcinoma', biomarker: '', lineOfTherapy: '1L', stage: 'locally advanced/metastatic', combination: 'with radiotherapy or chemotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with pemetrexed or other agents', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'oxaliplatin',
    tradeNames: ['Eloxatin'],
    atcCode: 'L01XA03',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'colorectal cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic/adjuvant', combination: 'with FOLFOX regimen', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'capecitabine',
    tradeNames: ['Xeloda'],
    atcCode: 'L01BC06',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'colorectal cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic/adjuvant', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: '', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'gastric cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with platinum', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'gemcitabine',
    tradeNames: ['Gemzar'],
    atcCode: 'L01BC05',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'pancreatic cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with cisplatin', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'bladder cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with cisplatin', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'pemetrexed',
    tradeNames: ['Alimta'],
    atcCode: 'L01BA04',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: 'non-squamous', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with platinum ± pembrolizumab', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'non-small cell lung cancer', biomarker: 'non-squamous', lineOfTherapy: 'maintenance', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'mesothelioma', biomarker: '', lineOfTherapy: '1L', stage: 'unresectable', combination: 'with cisplatin', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'irinotecan',
    tradeNames: ['Camptosar'],
    atcCode: 'L01CE02',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'colorectal cancer', biomarker: '', lineOfTherapy: '2L', stage: 'metastatic', combination: 'with FOLFIRI regimen', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'etoposide',
    tradeNames: ['Vepesid'],
    atcCode: 'L01CB01',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'small cell lung cancer', biomarker: '', lineOfTherapy: '1L', stage: 'extensive/limited stage', combination: 'with platinum', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'testicular cancer', biomarker: '', lineOfTherapy: '1L', stage: 'metastatic', combination: 'with BEP regimen', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'temozolomide',
    tradeNames: ['Temodal'],
    atcCode: 'L01AX03',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'glioblastoma', biomarker: '', lineOfTherapy: '1L', stage: 'newly diagnosed', combination: 'with radiotherapy', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
  {
    activeSubstance: 'vinorelbine',
    tradeNames: ['Navelbine'],
    atcCode: 'L01CA04',
    reimbursementType: 'AIM',
    status: 'AIM - Comparticipado',
    emaApproved: true,
    indications: [
      { cancerType: 'non-small cell lung cancer', biomarker: '', lineOfTherapy: '1L+', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
      { cancerType: 'breast cancer', biomarker: '', lineOfTherapy: '2L+', stage: 'metastatic', reimbursementStatus: 'AIM+SNS', confidence: 'high' },
    ]
  },
];

async function seed() {
  const logger = {
    info: (...args) => console.log('[SEED]', ...args),
    warn: (...args) => console.warn('[SEED]', ...args),
    error: (...args) => console.error('[SEED]', ...args)
  };

  const store = createInfarmedReimbursementStore(
    { store: 'sqlite', sqlitePath: './data/infarmed_reimbursement.sqlite' },
    logger
  );

  // Build drug records
  const drugs = ONCOLOGY_DRUGS.map((drug) => ({
    id: hashId(`seed-${drug.activeSubstance}`),
    source: 'curated_seed',
    sources: ['curated_seed'],
    chnmCode: '',
    tradeName: drug.tradeNames[0] || '',
    tradeNames: drug.tradeNames,
    activeSubstance: drug.activeSubstance,
    activeSubstanceNormalized: normalizeSubstance(drug.activeSubstance),
    atcCode: drug.atcCode,
    reimbursementType: drug.reimbursementType,
    status: drug.status,
    aimStatus: drug.emaApproved ? 'EMA Approved' : '',
    commercialised: '',
    clinicalBenefit: 'well_recognized',
    isOncology: true,
    emaApproved: drug.emaApproved,
    snsCovered: drug.reimbursementType === 'AIM',
    indications: drug.indications.map((ind) => ind.cancerType + (ind.biomarker ? ` [${ind.biomarker}]` : '')),
    indicationsStructured: drug.indications.map((ind) => ({
      ...ind,
      drugId: hashId(`seed-${drug.activeSubstance}`),
      id: hashId(`seed-${drug.activeSubstance}-${ind.cancerType}-${ind.biomarker || ''}-${ind.lineOfTherapy || ''}`),
      cancerType: ind.cancerType,
      cancerSubtype: '',
      indicationText: '',
      source: 'curated_seed',
      llmExtracted: false
    })),
    infomedEntries: [],
    hospitalSpending: [],
    fetchedAt: new Date().toISOString()
  }));

  // Build flattened indications
  const indications = drugs.flatMap((drug) =>
    (drug.indicationsStructured || []).map((ind) => ({
      id: ind.id,
      drugId: drug.id,
      cancerType: ind.cancerType || '',
      cancerSubtype: ind.cancerSubtype || '',
      biomarker: ind.biomarker || '',
      lineOfTherapy: ind.lineOfTherapy || '',
      stage: ind.stage || '',
      indicationText: ind.indicationText || '',
      reimbursementStatus: ind.reimbursementStatus || '',
      source: 'curated_seed',
      confidence: ind.confidence || 'medium',
      llmExtracted: false
    }))
  );

  logger.info(`Seeding ${drugs.length} drugs with ${indications.length} indications...`);

  await store.writeDrugs(drugs);
  await store.writeIndications(indications);
  await store.writeSyncRun({
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: 'completed',
    totalDrugs: drugs.length,
    sourcesSummary: { curated_seed: drugs.length },
    durationMs: 0,
    error: ''
  });

  logger.info('Done!');
  await store.close();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
