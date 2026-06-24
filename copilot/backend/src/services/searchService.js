import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import { OpenAI } from '../lib/bedrockOpenAICompat.js';
import { Pinecone } from '@pinecone-database/pinecone';
import trialRegistryService, { buildTrialRegistryInput } from './trialRegistryService.js';

export class SearchService {
  constructor() {
    this.openai = new OpenAI({
      region: process.env.AWS_REGION || process.env.BEDROCK_REGION || process.env.BEDROCK_AWS_REGION,
      model: process.env.BEDROCK_MODEL_ID || process.env.BEDROCK_CHAT_MODEL,
      embeddingModel: process.env.BEDROCK_EMBEDDING_MODEL_ID || process.env.BEDROCK_EMBED_MODEL
    });

    this.pinecone = null;
    this.pineconeIndex = null;
    this.vectorSearchAvailable = false;

    const pineconeApiKey = String(process.env.PINECONE_API_KEY || '').trim();
    const pineconeIndexName = String(process.env.PINECONE_INDEX_NAME || '').trim();

    if (!pineconeApiKey || !pineconeIndexName) {
      logger.warn('Pinecone vector search disabled: missing PINECONE_API_KEY or PINECONE_INDEX_NAME.');
      return;
    }

    try {
      this.pinecone = new Pinecone({
        apiKey: pineconeApiKey
      });
      this.pineconeIndex = this.pinecone.index(pineconeIndexName);
      this.vectorSearchAvailable = true;
    } catch (error) {
      logger.warn(`Pinecone vector search disabled: ${error.message}`);
      this.pinecone = null;
      this.pineconeIndex = null;
      this.vectorSearchAvailable = false;
    }
  }

  /**
   * Legacy route adapter used by the advanced search endpoint.
   */
  async advancedSearch(searchParams) {
    const results = await this.multiSourceSearch(searchParams);
    return {
      items: results,
      total: results.length
    };
  }

  /**
   * Multi-source search across different evidence databases
   */
  async multiSourceSearch(searchParams) {
    try {
      const { query, sources = ['pubmed'], filters, maxResults, includeAbstracts, sortBy } = searchParams;

      logger.info(`Multi-source search initiated: ${query} across ${sources.join(', ')}`);

      const allResults = [];
      const searchPromises = [];

      // Search each source in parallel
      for (const source of sources) {
        switch (source) {
          case 'pubmed':
            searchPromises.push(this.searchPubMed(query, filters, maxResults, includeAbstracts));
            break;
          case 'cochrane':
            searchPromises.push(this.searchCochrane(query, filters, maxResults));
            break;
          case 'clinicaltrials':
            searchPromises.push(this.searchClinicalTrials(query, filters, maxResults));
            break;
          case 'guidelines':
            searchPromises.push(this.searchGuidelines(query, filters, maxResults));
            break;
          default:
            logger.warn(`Unknown source: ${source}`);
        }
      }

      // Wait for all searches to complete
      const results = await Promise.allSettled(searchPromises);
      
      // Combine and deduplicate results
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          allResults.push(...result.value);
        }
      }

      // Sort and limit results
      const sortedResults = this.sortResults(allResults, sortBy);
      const limitedResults = sortedResults.slice(0, maxResults || 20);

      logger.info(`Multi-source search completed: ${limitedResults.length} results found`);

      return limitedResults;
    } catch (error) {
      logger.error(`Multi-source search failed: ${error.message}`);
      throw new AppError('Search failed', 500);
    }
  }

  /**
   * Semantic search using AI-powered understanding
   */
  async semanticSearch(searchParams, userId) {
    try {
      const { query, context, maxResults } = searchParams;

      logger.info(`Semantic search initiated: ${query} by user ${userId}`);

      // Generate semantic query using AI
      const semanticQuery = await this.generateSemanticQuery(query, context);

      // Search vector database
      const vectorResults = await this.searchVectorDatabase(semanticQuery, maxResults);

      // Enhance with traditional search
      const traditionalResults = await this.searchPubMed(query, {}, Math.floor(maxResults / 2), true);

      // Combine and rank results
      const combinedResults = this.combineAndRankResults(vectorResults, traditionalResults, query);

      // Log semantic search activity
      await this.logSemanticSearchActivity(userId, query, semanticQuery, combinedResults.length);

      return combinedResults.slice(0, maxResults);
    } catch (error) {
      logger.error(`Semantic search failed: ${error.message}`);
      throw new AppError('Semantic search failed', 500);
    }
  }

  /**
   * Search PubMed database
   */
  async searchPubMed(query, filters, maxResults, includeAbstracts) {
    try {
      const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
      const apiKey = process.env.NCBI_API_KEY;
      
      // Build search query
      let searchQuery = query;
      if (filters?.dateRange) {
        searchQuery += ` AND (${filters.dateRange.start}[PDAT]:${filters.dateRange.end}[PDAT])`;
      }
      if (filters?.cancerType) {
        searchQuery += ` AND ${filters.cancerType}[MESH]`;
      }

      // Search for article IDs
      const searchUrl = `${baseUrl}esearch.fcgi?db=pubmed&term=${encodeURIComponent(searchQuery)}&retmax=${maxResults}&api_key=${apiKey}`;
      const searchResponse = await fetch(searchUrl);
      const searchXml = await searchResponse.text();

      // Parse search results
      const articleIds = this.parsePubMedSearchResults(searchXml);
      
      if (articleIds.length === 0) {
        return [];
      }

      // Fetch article details
      const fetchUrl = `${baseUrl}efetch.fcgi?db=pubmed&id=${articleIds.join(',')}&retmode=xml&api_key=${apiKey}`;
      const fetchResponse = await fetch(fetchUrl);
      const fetchXml = await fetchResponse.text();

      // Parse article details
      const articles = this.parsePubMedArticles(fetchXml, includeAbstracts);

      return articles;
    } catch (error) {
      logger.error(`PubMed search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Search Cochrane database
   */
  async searchCochrane(query, filters, maxResults = 5) {
    try {
      logger.info(`Cochrane search for: ${query}`);

      // Run PubMed-Cochrane filter AND Epistemonikos in parallel
      const [cochraneResults, epistemonikosResults] = await Promise.allSettled([
        this._searchCochranePubMed(query, maxResults),
        this._searchEpistemonikos(query, maxResults)
      ]);

      const cochrane = cochraneResults.status === 'fulfilled' ? cochraneResults.value : [];
      const epistemonikos = epistemonikosResults.status === 'fulfilled' ? epistemonikosResults.value : [];

      // Merge and deduplicate by title similarity
      const combined = [...cochrane];
      const existingTitles = new Set(cochrane.map((r) => (r.title || '').toLowerCase().slice(0, 60)));

      for (const result of epistemonikos) {
        const titleKey = (result.title || '').toLowerCase().slice(0, 60);
        if (!existingTitles.has(titleKey)) {
          combined.push(result);
          existingTitles.add(titleKey);
        }
      }

      logger.info(`Cochrane+Epistemonikos: ${cochrane.length} Cochrane + ${epistemonikos.length} Epistemonikos = ${combined.length} unique`);
      return combined.slice(0, maxResults * 2); // Allow more results from combined sources
    } catch (error) {
      logger.error(`Cochrane search failed: ${error.message}`);
      return [];
    }
  }

  async _searchCochranePubMed(query, maxResults = 5) {
    // Search Cochrane Library via PubMed filter (Cochrane Database of Systematic Reviews)
    const cochranePubmedQuery = `${query} AND "Cochrane Database Syst Rev"[Journal]`;
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(cochranePubmedQuery)}&retmax=${maxResults}&sort=relevance&retmode=json${process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : ''}`;

    const searchResponse = await fetch(searchUrl);
    if (!searchResponse.ok) {
      logger.warn(`Cochrane/PubMed search HTTP ${searchResponse.status}`);
      return [];
    }

    const searchData = await searchResponse.json();
    const ids = searchData?.esearchresult?.idlist || [];
    if (ids.length === 0) return [];

    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json${process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : ''}`;
    const fetchResponse = await fetch(fetchUrl);
    if (!fetchResponse.ok) return [];

    const fetchData = await fetchResponse.json();
    const result = fetchData?.result || {};

    return ids.map((id) => {
      const article = result[id];
      if (!article || !article.title) return null;
      const authors = (article.authors || []).map((a) => a.name).filter(Boolean);
      return {
        id: `cochrane_${id}`,
        pmid: id,
        title: article.title,
        authors: authors.slice(0, 5),
        source: 'cochrane',
        journal: 'Cochrane Database of Systematic Reviews',
        type: 'systematic_review',
        date: article.pubdate || article.sortpubdate || '',
        year: (article.pubdate || '').slice(0, 4),
        relevance: 0.9,
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
      };
    }).filter(Boolean);
  }

  async _searchEpistemonikos(query, maxResults = 5) {
    try {
      const { searchEpistemonikos } = await import('./search/epistemonikosClient.js');
      return await searchEpistemonikos(query, { maxResults, logger });
    } catch (err) {
      logger.warn(`Epistemonikos search skipped: ${err.message}`);
      return [];
    }
  }

  /**
   * Search ClinicalTrials.gov
   */
  async searchClinicalTrials(query, filters, maxResults) {
    try {
      logger.info(`ClinicalTrials search for: ${query}`);

      const payload = await trialRegistryService.findMatches(
        buildTrialRegistryInput(query, {
          population: filters?.population,
          biomarker: filters?.biomarker,
          lineOfTherapy: filters?.lineOfTherapy,
          intervention: filters?.intervention,
          comparator: filters?.comparator,
          outcomes: filters?.outcomes,
          trialPhases: filters?.trialPhases || filters?.phases,
          trialStatuses: filters?.trialStatuses || filters?.statuses,
          trialRegions: filters?.trialRegions || filters?.regions,
          trialRecruitingInPortugalOnly:
            filters?.trialRecruitingInPortugalOnly ??
            filters?.recruitingInPortugalOnly ??
            true,
          maxTrials: maxResults
        })
      );

      if (!payload.available) {
        return [];
      }

      return (payload.trials || []).map((trial) => ({
        id: trial.nctId,
        title: trial.title,
        abstract: trial.briefSummary || trial.eligibilitySummary || '',
        source: 'clinicaltrials',
        type: 'clinical_trial',
        date:
          trial.referenceDate ||
          trial.lastUpdatePostDate ||
          trial.studyFirstPostDate ||
          new Date().toISOString(),
        relevance: trial.matchScore || 0.6,
        url: trial.sourceUrl,
        status: trial.overallStatus,
        phase: Array.isArray(trial.phases) ? trial.phases.join(', ') : '',
        conditions: trial.conditions,
        interventions: (trial.interventions || []).map((item) => item.name).filter(Boolean),
        recruitingInPortugal: trial.recruitingInPortugal === true,
        metadata: {
          eligibilitySummary: trial.eligibilitySummary,
          sponsor: trial.sponsor?.leadSponsorName || '',
          portugalSiteCount: trial.portugalSiteCount || 0
        }
      }));
    } catch (error) {
      logger.error(`ClinicalTrials search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Search clinical guidelines
   */
  async searchGuidelines(query, filters, maxResults = 5) {
    try {
      logger.info(`Guidelines search (ESMO + European) for: ${query}`);

      // Search PubMed for ESMO guidelines, ESMO clinical practice guidelines, and Annals of Oncology guidelines
      const guidelineQuery = `${query} AND (("Ann Oncol"[Journal] AND (guideline[ti] OR recommendation[ti] OR "clinical practice"[ti] OR "ESMO"[ti])) OR ("ESMO"[tiab] AND ("guideline"[tiab] OR "recommendation"[tiab])) OR ("Lancet Oncol"[Journal] AND "practice guideline"[pt]))`;
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(guidelineQuery)}&retmax=${maxResults}&sort=relevance&retmode=json${process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : ''}`;

      const searchResponse = await fetch(searchUrl);
      if (!searchResponse.ok) {
        logger.warn(`Guidelines/PubMed search HTTP ${searchResponse.status}`);
        return [];
      }

      const searchData = await searchResponse.json();
      const ids = searchData?.esearchresult?.idlist || [];
      if (ids.length === 0) return [];

      const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json${process.env.NCBI_API_KEY ? `&api_key=${process.env.NCBI_API_KEY}` : ''}`;
      const fetchResponse = await fetch(fetchUrl);
      if (!fetchResponse.ok) return [];

      const fetchData = await fetchResponse.json();
      const result = fetchData?.result || {};

      return ids.map((id) => {
        const article = result[id];
        if (!article || !article.title) return null;
        const authors = (article.authors || []).map((a) => a.name).filter(Boolean);
        return {
          id: `guideline_${id}`,
          pmid: id,
          title: article.title,
          authors: authors.slice(0, 5),
          source: 'guidelines',
          journal: article.fulljournalname || article.source || '',
          type: 'guideline',
          date: article.pubdate || article.sortpubdate || '',
          year: (article.pubdate || '').slice(0, 4),
          relevance: 0.95,
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`
        };
      }).filter(Boolean);
    } catch (error) {
      logger.error(`Guidelines search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate semantic query using AI
   */
  async generateSemanticQuery(query, context) {
    try {
      const prompt = `Generate a semantic search query for medical literature based on this query: "${query}"
      
      Context: ${context || 'General oncology research'}
      
      Expand the query with relevant medical terms, synonyms, and related concepts. Focus on oncology and evidence-based medicine.`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3
      });

      return response.choices[0].message.content;
    } catch (error) {
      logger.warn(`Semantic query generation failed: ${error.message}`);
      return query; // Fallback to original query
    }
  }

  /**
   * Search vector database using Pinecone
   */
  async searchVectorDatabase(query, maxResults) {
    try {
      if (!this.vectorSearchAvailable || !this.pineconeIndex) {
        logger.warn('Vector database search skipped: Pinecone is not configured.');
        return [];
      }

      // Generate embeddings for the query
      const embedding = await this.generateEmbedding(query);
      
      // Search vector database
      const searchResponse = await this.pineconeIndex.query({
        vector: embedding,
        topK: maxResults,
        includeMetadata: true
      });

      // Transform results
      const results = searchResponse.matches.map(match => ({
        id: match.id,
        title: match.metadata?.title || 'Unknown Title',
        abstract: match.metadata?.abstract || '',
        source: match.metadata?.source || 'vector_db',
        score: match.score,
        relevance: match.score
      }));

      return results;
    } catch (error) {
      logger.warn(`Vector database search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate embeddings using Bedrock
   */
  async generateEmbedding(text) {
    try {
      const response = await this.openai.embeddings.create({
        model:
          process.env.BEDROCK_EMBEDDING_MODEL_ID ||
          process.env.BEDROCK_EMBED_MODEL ||
          'amazon.titan-embed-text-v1',
        input: text
      });

      return response.data[0].embedding;
    } catch (error) {
      logger.error(`Embedding generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sort search results
   */
  sortResults(results, sortBy) {
    switch (sortBy) {
      case 'date':
        return results.sort((a, b) => new Date(b.date) - new Date(a.date));
      case 'citations':
        return results.sort((a, b) => (b.citations || 0) - (a.citations || 0));
      case 'impact_factor':
        return results.sort((a, b) => (b.impactFactor || 0) - (a.impactFactor || 0));
      case 'relevance':
      default:
        return results.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
    }
  }

  /**
   * Combine and rank results from different sources
   */
  combineAndRankResults(vectorResults, traditionalResults, query) {
    const allResults = [...vectorResults, ...traditionalResults];
    
    // Remove duplicates based on title similarity
    const uniqueResults = this.removeDuplicates(allResults);
    
    // Re-rank based on query relevance
    const rankedResults = uniqueResults.map(result => ({
      ...result,
      relevance: this.calculateRelevanceScore(result, query)
    }));
    
    return rankedResults.sort((a, b) => b.relevance - a.relevance);
  }

  /**
   * Remove duplicate results
   */
  removeDuplicates(results) {
    const seen = new Set();
    return results.filter(result => {
      const title = result.title.toLowerCase().trim();
      if (seen.has(title)) {
        return false;
      }
      seen.add(title);
      return true;
    });
  }

  /**
   * Calculate relevance score
   */
  calculateRelevanceScore(result, query) {
    let score = result.relevance || 0.5;
    
    // Boost score for exact title matches
    if (result.title.toLowerCase().includes(query.toLowerCase())) {
      score += 0.2;
    }
    
    // Boost score for recent publications
    if (result.date) {
      const daysSincePublication = (new Date() - new Date(result.date)) / (1000 * 60 * 60 * 24);
      if (daysSincePublication < 365) {
        score += 0.1;
      }
    }
    
    return Math.min(score, 1.0);
  }

  /**
   * Parse PubMed search results XML
   */
  parsePubMedSearchResults(xml) {
    try {
      const idMatches = xml.match(/<Id>(\d+)<\/Id>/g);
      if (!idMatches) return [];
      
      return idMatches.map(match => match.replace(/<\/?Id>/g, ''));
    } catch (error) {
      logger.error(`Failed to parse PubMed search results: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse PubMed articles XML
   */
  parsePubMedArticles(xml, includeAbstracts) {
    try {
      const articles = [];
      const articleMatches = xml.match(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g);
      
      if (!articleMatches) return articles;
      
      for (const articleXml of articleMatches) {
        try {
          const article = this.parseSinglePubMedArticle(articleXml, includeAbstracts);
          if (article) {
            articles.push(article);
          }
        } catch (error) {
          logger.warn(`Failed to parse individual PubMed article: ${error.message}`);
        }
      }
      
      return articles;
    } catch (error) {
      logger.error(`Failed to parse PubMed articles: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse single PubMed article XML
   */
  parseSinglePubMedArticle(articleXml, includeAbstracts) {
    try {
      // Extract basic information
      const pmidMatch = articleXml.match(/<PMID>(\d+)<\/PMID>/);
      const titleMatch = articleXml.match(/<ArticleTitle>([^<]+)<\/ArticleTitle>/);
      const abstractMatch = includeAbstracts ? articleXml.match(/<AbstractText>([^<]+)<\/AbstractText>/) : null;
      const dateMatch = articleXml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
      
      if (!pmidMatch || !titleMatch) return null;
      
      return {
        id: `pmid_${pmidMatch[1]}`,
        title: titleMatch[1],
        abstract: abstractMatch ? abstractMatch[1] : null,
        source: 'pubmed',
        type: 'research_article',
        date: dateMatch ? `${dateMatch[1]}-01-01` : new Date().toISOString(),
        relevance: 0.8,
        pmid: pmidMatch[1]
      };
    } catch (error) {
      logger.warn(`Failed to parse PubMed article: ${error.message}`);
      return null;
    }
  }

  /**
   * Get search suggestions
   */
  async getSuggestions(query, type = 'general') {
    try {
      // Placeholder implementation for suggestions
      // In a real implementation, this would use various sources for autocomplete
      
      const suggestions = [
        `${query} cancer`,
        `${query} treatment`,
        `${query} clinical trial`,
        `${query} guidelines`,
        `${query} systematic review`
      ];
      
      return suggestions.slice(0, 5);
    } catch (error) {
      logger.error(`Failed to get suggestions: ${error.message}`);
      return [];
    }
  }

  /**
   * Get search trends
   */
  async getSearchTrends(period, specialty) {
    try {
      // Placeholder implementation for search trends
      // In a real implementation, this would analyze search history and patterns
      
      return {
        period,
        specialty,
        trends: [
          { term: 'immunotherapy', count: 150, change: '+25%' },
          { term: 'precision medicine', count: 120, change: '+18%' },
          { term: 'liquid biopsy', count: 95, change: '+32%' }
        ]
      };
    } catch (error) {
      logger.error(`Failed to get search trends: ${error.message}`);
      return { period, specialty, trends: [] };
    }
  }

  /**
   * Get user search history
   */
  async getUserSearchHistory(userId, options) {
    void userId;
    void options;

    // Placeholder implementation until search history persistence exists.
    return {
      items: [],
      total: 0
    };
  }

  /**
   * Log semantic search activity
   */
  async logSemanticSearchActivity(userId, originalQuery, semanticQuery, resultCount) {
    try {
      // Log to database (placeholder implementation)
      const activity = {
        userId,
        originalQuery,
        semanticQuery,
        resultCount,
        timestamp: new Date().toISOString(),
        type: 'semantic_search'
      };

      // await this.database.searchActivity.create(activity);
      logger.info(`Semantic search activity logged: ${originalQuery} -> ${semanticQuery}`);
    } catch (error) {
      logger.warn(`Failed to log semantic search activity: ${error.message}`);
    }
  }
}

