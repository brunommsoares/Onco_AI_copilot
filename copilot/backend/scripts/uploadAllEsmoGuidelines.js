#!/usr/bin/env node

/**
 * Batch upload all ESMO guideline PDFs from the Silver/esmo folder.
 * Processes files sequentially to avoid overloading the LLM.
 *
 * Usage: node scripts/uploadAllEsmoGuidelines.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ESMO_DIR = path.resolve(__dirname, '..', '..', 'Silver', 'esmo');
const API_BASE = process.env.API_BASE || 'http://localhost:3004';

// Map filenames to cancer types for better metadata
const inferCancerType = (filename) => {
  const f = filename.toLowerCase();
  const patterns = [
    [/breast|mbc|ebc|tnbc|abc5/i, 'breast cancer'],
    [/colorectal|crc|colon|rectal|retal/i, 'colorectal cancer'],
    [/gastric|gastrico|stomach/i, 'gastric cancer'],
    [/lung|nsclc|sclc|nsc\b|pequenas/i, 'lung cancer'],
    [/melanoma/i, 'melanoma'],
    [/renal|kidney|rcc|rim\b/i, 'renal cell carcinoma'],
    [/bladder|urothelial/i, 'urothelial carcinoma'],
    [/hepato|hcc|liver/i, 'hepatocellular carcinoma'],
    [/ovarian|ovary/i, 'ovarian cancer'],
    [/prostate|prostata/i, 'prostate cancer'],
    [/endometrial|uterine/i, 'endometrial cancer'],
    [/cervical|cervix/i, 'cervical cancer'],
    [/pancreatic|pancreas/i, 'pancreatic cancer'],
    [/esophageal|oesophageal|esofa/i, 'esophageal cancer'],
    [/biliar|cholangiocarcinoma|trato biliar/i, 'biliary tract cancer'],
    [/thyroid/i, 'thyroid cancer'],
    [/testis|testicular/i, 'testicular cancer'],
    [/penile/i, 'penile cancer'],
    [/anal/i, 'anal cancer'],
    [/lymphoma|dlbcl|hodgkin|mcl|mzl|cns lymphoma/i, 'lymphoma'],
    [/myeloma/i, 'multiple myeloma'],
    [/leuk/i, 'leukemia'],
    [/mesothelioma|meso/i, 'mesothelioma'],
    [/sarcoma/i, 'sarcoma'],
    [/gist/i, 'gastrointestinal stromal tumour'],
    [/head.and.neck|hnscc|naso|salivary/i, 'head and neck cancer'],
    [/thymic|timo/i, 'thymic cancer'],
    [/vulvar/i, 'vulvar cancer'],
    [/oncogen/i, 'oncogene-addicted NSCLC'],
    [/nononcogen|non.oncogen/i, 'non-oncogene-addicted NSCLC'],
    [/hival/i, 'HIV-associated cancers'],
    [/mcc|merkel/i, 'Merkel cell carcinoma'],
    [/wilms/i, 'Wilms tumour'],
    [/gtn/i, 'gestational trophoblastic neoplasia'],
    [/small.bowel/i, 'small bowel cancer'],
    [/hereditary|risk.reduction/i, 'hereditary cancer syndromes'],
    [/bone.health/i, 'bone health in cancer'],
    [/cachexia/i, 'cancer cachexia'],
    [/palliative/i, 'palliative care'],
    [/neutropaenia|febrile/i, 'febrile neutropenia'],
    [/anxiety|depression/i, 'cancer-related anxiety and depression'],
    [/venous.access/i, 'central venous access'],
    [/mucositis/i, 'mucositis'],
    [/b.cell/i, 'B-cell lymphoma'],
    [/ampullary/i, 'ampullary cancer'],
    [/carcinoma escamoso/i, 'squamous cell carcinoma'],
  ];

  for (const [pattern, type] of patterns) {
    if (pattern.test(f)) return type;
  }
  return '';
};

const uploadFile = async (filePath) => {
  const filename = path.basename(filePath);
  const cancerType = inferCancerType(filename);
  const title = filename
    .replace(/\.pdf$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const formData = new FormData();
  const fileBuffer = fs.readFileSync(filePath);
  formData.append('file', new Blob([fileBuffer], { type: 'application/pdf' }), filename);
  formData.append('title', title);
  if (cancerType) formData.append('cancerType', cancerType);

  const res = await fetch(`${API_BASE}/api/esmo-guidelines/upload`, {
    method: 'POST',
    body: formData
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return await res.json();
};

// Check which guidelines are already uploaded
const getUploadedTitles = async () => {
  try {
    const res = await fetch(`${API_BASE}/api/esmo-guidelines/status`);
    const data = await res.json();
    return new Set((data.guidelines || [])
      .filter(g => g.status === 'completed' && g.total_recommendations > 0)
      .map(g => g.title?.toLowerCase()));
  } catch { return new Set(); }
};

// Main
const files = fs.readdirSync(ESMO_DIR)
  .filter(f => f.toLowerCase().endsWith('.pdf'))
  .map(f => path.join(ESMO_DIR, f));

const alreadyUploaded = await getUploadedTitles();
console.log(`Found ${files.length} ESMO PDFs (${alreadyUploaded.size} already uploaded)`);
console.log(`Server: ${API_BASE}`);
console.log('');

let uploaded = 0;
let failed = 0;
let skipped = 0;
let totalRecs = 0;
const startTime = Date.now();
const CONCURRENCY = parseInt(process.env.UPLOAD_CONCURRENCY || '4', 10);

// Filter out already uploaded files
const pending = [];
for (let i = 0; i < files.length; i++) {
  const filename = path.basename(files[i]);
  const titleNorm = filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (alreadyUploaded.has(titleNorm)) {
    skipped++;
  } else {
    pending.push({ file: files[i], idx: i });
  }
}

console.log(`Skipping ${skipped} already uploaded. Processing ${pending.length} remaining (${CONCURRENCY} concurrent).`);
console.log('');

// Process in parallel batches
for (let b = 0; b < pending.length; b += CONCURRENCY) {
  const batch = pending.slice(b, b + CONCURRENCY);

  const results = await Promise.allSettled(batch.map(async ({ file, idx }) => {
    const filename = path.basename(file);
    const cancerType = inferCancerType(filename);
    const label = `[${idx + 1}/${files.length}]`;
    try {
      const result = await uploadFile(file);
      return { label, filename, cancerType, recs: result.totalRecommendations || 0, ms: result.durationMs, ok: true };
    } catch (err) {
      return { label, filename, cancerType, error: err.message, ok: false };
    }
  }));

  for (const r of results) {
    const val = r.value;
    if (val.ok) {
      uploaded++;
      totalRecs += val.recs;
      console.log(`${val.label} ${val.filename.slice(0, 50).padEnd(50)} ✓ ${val.recs} recs (${(val.ms / 1000).toFixed(1)}s) [${val.cancerType || 'general'}]`);
    } else {
      failed++;
      console.log(`${val.label} ${val.filename.slice(0, 50).padEnd(50)} ✗ ${val.error.slice(0, 80)}`);
    }
  }

  const pct = Math.round(((b + batch.length) / pending.length) * 100);
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`  --- ${pct}% (${uploaded} ok, ${failed} failed, ${elapsed}min elapsed) ---`);
}

const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
console.log('');
console.log(`Done in ${elapsed} minutes`);
console.log(`Uploaded: ${uploaded} | Failed: ${failed} | Skipped: ${skipped} | Total recommendations: ${totalRecs}`);
