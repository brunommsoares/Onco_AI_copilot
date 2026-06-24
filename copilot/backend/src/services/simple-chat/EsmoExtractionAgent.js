import crypto from 'crypto';

// ---------------------------------------------------------------------------
// ESMO Extraction Agent
//
// LLM-based agent that extracts structured recommendations from ESMO
// guideline PDF text. Returns structured data including:
//   - Drug, cancer type, biomarker, line of therapy, stage
//   - ESMO-MCBS score, ESCAT score, Level of Evidence, Grade of Recommendation
//
// Follows the same agent pattern as EndpointClaimAgent / PublicationExtractionAgent.
// ---------------------------------------------------------------------------

const EXTRACTION_SYSTEM_PROMPT = `You are a clinical oncology expert specialising in ESMO Clinical Practice Guidelines. Your task is to extract structured treatment recommendations from ESMO guideline text.

For EACH treatment recommendation you identify, extract:

1. drug: Active substance name(s) (e.g., "pembrolizumab", "pembrolizumab + chemotherapy")
2. cancer_type: Primary cancer type (e.g., "non-small cell lung cancer", "breast cancer")
3. cancer_subtype: Histological/molecular subtype if specified (e.g., "squamous", "triple-negative")
4. biomarker: Required biomarker (e.g., "PD-L1 TPS ≥50%", "EGFR mutation", "HER2-positive")
5. line_of_therapy: Line of therapy (e.g., "1L", "2L", "adjuvant", "neoadjuvant", "maintenance")
6. stage: Disease stage (e.g., "metastatic", "locally advanced", "early stage")
7. esmo_mcbs_score: ESMO Magnitude of Clinical Benefit Scale score if mentioned (e.g., "4", "3", "A", "B")
8. escat_score: ESMO Scale for Clinical Actionability of molecular Targets if mentioned (e.g., "I-A", "II-B")
9. level_of_evidence: Level of Evidence (e.g., "I", "II", "III", "IV", "V")
10. grade_of_recommendation: Grade of Recommendation (e.g., "A", "B", "C", "D", "E")
11. recommendation_text: The actual recommendation statement (brief, 1-2 sentences)
12. combination: Combination details if applicable
13. confidence: Your extraction confidence — "high" (verbatim from guideline), "medium" (inferred), "low" (uncertain)

Respond in JSON format only. Output an array of recommendation objects.

Important rules:
- Extract EVERY distinct treatment recommendation, even if the same drug appears multiple times for different settings
- Use standardised cancer type names (English, lowercase)
- Use standardised biomarker notation
- ESMO-MCBS scores range from 1-5 (for non-curative) or A-C (for curative intent)
- ESCAT scores use format like "I-A", "II-B", "III-A" etc.
- Level of Evidence: I (highest) to V (lowest)
- Grade of Recommendation: A (strongest) to E (weakest)
- If a score is not explicitly mentioned in the text, leave it empty
- Extract the recommendation verbatim where possible`;

class EsmoExtractionAgent {
  constructor(dependencies = {}) {
    this.openai = dependencies.openai;
    this.logger = dependencies.logger || console;
    this.model = dependencies.model || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
  }

  /**
   * Extract structured recommendations from guideline text chunks.
   * Processes text in chunks to stay within token limits.
   *
   * @param {string[]} textChunks - Array of text chunks from the PDF
   * @param {Object} metadata - Guideline metadata (title, cancerType, etc.)
   * @returns {Object[]} Array of structured recommendation objects
   */
  async extractRecommendations(textChunks, metadata = {}) {
    const allRecommendations = [];
    const guidelineId = metadata.guidelineId || '';
    const batchSize = 3; // Process 3 chunks at a time

    this.logger.info(
      `[EsmoExtractionAgent] Extracting from ${textChunks.length} chunks (guideline: ${metadata.title || 'unknown'})`
    );

    for (let i = 0; i < textChunks.length; i += batchSize) {
      const batch = textChunks.slice(i, i + batchSize);
      const combinedText = batch.join('\n\n---\n\n');

      try {
        const userMessage = [
          `Extract structured oncology treatment recommendations from this ESMO guideline text.`,
          metadata.title ? `Guideline: ${metadata.title}` : '',
          metadata.cancerType ? `Cancer type: ${metadata.cancerType}` : '',
          `\n\n--- GUIDELINE TEXT ---\n\n${combinedText}`
        ].filter(Boolean).join('\n');

        const response = await this.openai.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 4000,
          temperature: 0.1
        });

        const content = response.choices?.[0]?.message?.content || '';

        // Parse JSON from response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);

          for (const rec of parsed) {
            allRecommendations.push({
              id: crypto.createHash('sha1')
                .update(`${guidelineId}-${rec.drug || ''}-${rec.cancer_type || ''}-${rec.biomarker || ''}-${rec.line_of_therapy || ''}`)
                .digest('hex')
                .slice(0, 12),
              guidelineId,
              drug: rec.drug || '',
              cancerType: rec.cancer_type || metadata.cancerType || '',
              cancerSubtype: rec.cancer_subtype || '',
              biomarker: rec.biomarker || '',
              lineOfTherapy: rec.line_of_therapy || '',
              stage: rec.stage || '',
              esmoMcbsScore: rec.esmo_mcbs_score || '',
              escatScore: rec.escat_score || '',
              levelOfEvidence: rec.level_of_evidence || '',
              gradeOfRecommendation: rec.grade_of_recommendation || '',
              recommendationText: rec.recommendation_text || '',
              combination: rec.combination || '',
              sourcePage: String(Math.floor(i / batchSize) + 1),
              confidence: rec.confidence || 'medium'
            });
          }
        }

        this.logger.info(
          `[EsmoExtractionAgent] Chunks ${i + 1}-${Math.min(i + batchSize, textChunks.length)}: ${allRecommendations.length} recommendations extracted so far`
        );
      } catch (err) {
        this.logger.warn(
          `[EsmoExtractionAgent] Extraction failed for chunks ${i + 1}-${Math.min(i + batchSize, textChunks.length)}: ${err.message}`
        );
      }
    }

    // Deduplicate by drug + cancer_type + biomarker + line
    const seen = new Set();
    const deduped = allRecommendations.filter((rec) => {
      const key = `${rec.drug}|${rec.cancerType}|${rec.biomarker}|${rec.lineOfTherapy}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    this.logger.info(
      `[EsmoExtractionAgent] Final: ${deduped.length} unique recommendations (from ${allRecommendations.length} raw)`
    );

    return deduped;
  }
}

export default EsmoExtractionAgent;
export { EsmoExtractionAgent, EXTRACTION_SYSTEM_PROMPT };
