import test from 'node:test';
import assert from 'node:assert/strict';

import pdfProcessingService from '../src/services/pdfProcessingService.js';

test('createTextChunks uses the tighter default granularity', () => {
  const text = Array.from({ length: 1200 }, (_, index) => `word${index + 1}`).join(' ');
  const chunks = pdfProcessingService.createTextChunks(text);

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].wordCount, 500);
  assert.equal(chunks[1].startIndex, 400);
});

test('createTextChunksFromPages preserves page range metadata across chunk windows', () => {
  const page1 = Array.from({ length: 350 }, (_, index) => `p1_${index + 1}`).join(' ');
  const page2 = Array.from({ length: 350 }, (_, index) => `p2_${index + 1}`).join(' ');
  const page3 = Array.from({ length: 150 }, (_, index) => `p3_${index + 1}`).join(' ');

  const chunks = pdfProcessingService.createTextChunksFromPages([
    { pageNumber: 10, text: page1, wordCount: 350 },
    { pageNumber: 11, text: page2, wordCount: 350 },
    { pageNumber: 12, text: page3, wordCount: 150 }
  ]);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].pageStart, 10);
  assert.equal(chunks[0].pageEnd, 11);
  assert.equal(chunks[1].pageStart, 11);
  assert.equal(chunks[1].pageEnd, 12);
});
