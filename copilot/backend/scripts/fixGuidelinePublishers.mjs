#!/usr/bin/env node
// ---------------------------------------------------------------------------
// One-off migration: tag each guideline row with its issuing body.
//
// The guideline corpus was ingested through a single "ESMO" pipeline, but
// ~20 of the PDFs are NCCN Clinical Practice Guidelines. Presentation-layer
// code now reads payload.publisher (see esmoGuidelinesService._publisherFromRow);
// this script backfills that field for rows ingested before publisher
// detection existed, by re-reading each guideline's source PDF.
//
// Usage:  node scripts/fixGuidelinePublishers.mjs [--dry-run]
// ---------------------------------------------------------------------------
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const pdfParse = require('pdf-parse');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..');
const dbPath = process.env.ESMO_SQLITE_PATH || path.join(backendRoot, 'data', 'esmo_guidelines.sqlite');
const dryRun = process.argv.includes('--dry-run');

// Phrase matches first: an ESMO guideline can cite NCCN in passing.
const detectPublisher = (text, title) => {
  const head = `${title}\n${String(text).slice(0, 8000)}`;
  if (/national comprehensive cancer network|NCCN (?:clinical practice )?guidelines/i.test(head)) return 'NCCN';
  if (/european society for medical oncology|ESMO (?:clinical practice|living) guideline/i.test(head)) return 'ESMO';
  if (/\bNCCN\b/.test(head)) return 'NCCN';
  if (/\bESMO\b/.test(head)) return 'ESMO';
  return '';
};

const db = new Database(dbPath);
const rows = db.prepare('SELECT id, title, file_path, status, payload FROM guidelines').all();
const update = db.prepare('UPDATE guidelines SET payload = @payload WHERE id = @id');

let tagged = 0, alreadyTagged = 0, missingFile = 0, unknown = 0;
const counts = { ESMO: 0, NCCN: 0 };

for (const row of rows) {
  let payload = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { payload = {}; }

  if (payload.publisher) {
    alreadyTagged++;
    counts[payload.publisher] = (counts[payload.publisher] || 0) + 1;
    continue;
  }

  const pdfPath = path.isAbsolute(row.file_path)
    ? row.file_path
    : path.join(backendRoot, row.file_path);

  let publisher = '';
  if (row.file_path && fs.existsSync(pdfPath)) {
    try {
      const data = await pdfParse(fs.readFileSync(pdfPath));
      publisher = detectPublisher(data.text || '', row.title);
    } catch (err) {
      console.warn(`  parse failed for ${row.title}: ${err.message}`);
    }
  } else {
    missingFile++;
    // Fall back to the title alone (catches e.g. "ESMO Living Guidelines" slide sets)
    publisher = detectPublisher('', row.title);
  }

  if (!publisher) { unknown++; console.log(`  UNKNOWN: ${row.title} (${row.status})`); continue; }

  counts[publisher] = (counts[publisher] || 0) + 1;
  tagged++;
  if (!dryRun) {
    payload.publisher = publisher;
    update.run({ id: row.id, payload: JSON.stringify(payload) });
  }
  if (publisher === 'NCCN') console.log(`  NCCN: ${row.title}`);
}

console.log(`\n${dryRun ? '[dry-run] ' : ''}guidelines: ${rows.length} | newly tagged: ${tagged} | already tagged: ${alreadyTagged} | unknown: ${unknown} | missing file: ${missingFile}`);
console.log(`publisher counts: ESMO=${counts.ESMO || 0} NCCN=${counts.NCCN || 0}`);
db.close();
