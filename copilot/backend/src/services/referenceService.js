import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';

export class ReferenceService {
  constructor() {
    this.referenceCache = new Map();
    this.referenceCounter = 1;
  }

  /**
   * Format citation in AMA style
   */
  formatAMAReference(citation) {
    try {
      const {
        authors,
        title,
        journal,
        year,
        volume,
        issue,
        pages,
        doi,
        pmid,
        url,
        publisher,
        bookTitle,
        conference,
        institution,
        type = 'journal_article'
      } = citation;

      let reference = '';

      switch (type) {
        case 'journal_article':
          reference = this.formatJournalArticle(authors, title, journal, year, volume, issue, pages, doi);
          break;
        case 'book':
          reference = this.formatBook(authors, title, year, publisher, pages);
          break;
        case 'book_chapter':
          reference = this.formatBookChapter(authors, title, bookTitle, year, pages);
          break;
        case 'conference':
          reference = this.formatConference(authors, title, conference, year, pages);
          break;
        case 'thesis':
          reference = this.formatThesis(authors, title, year, institution);
          break;
        default:
          reference = this.formatGeneric(authors, title, journal || 'Unknown', year);
      }

      return reference.trim();

    } catch (error) {
      logger.error(`AMA reference formatting failed: ${error.message}`);
      return this.formatGeneric(citation.authors, citation.title, citation.journal, citation.year);
    }
  }

  /**
   * Format journal article in AMA style
   */
  formatJournalArticle(authors, title, journal, year, volume, issue, pages, doi) {
    const formattedAuthors = this.formatAuthors(authors);
    const journalFormatted = this.formatJournalName(journal);
    
    let reference = `${formattedAuthors}. ${title}. ${journalFormatted}.`;
    
    if (year) {
      reference += ` ${year};`;
    }
    
    if (volume) {
      reference += ` ${volume}`;
    }
    
    if (issue) {
      reference += `(${issue})`;
    }
    
    if (pages) {
      reference += `:${pages}`;
    }
    
    if (doi) {
      reference += `. doi:${doi}`;
    }
    
    return reference + '.';
  }

  /**
   * Format book in AMA style
   */
  formatBook(authors, title, year, publisher, pages) {
    const formattedAuthors = this.formatAuthors(authors);
    let reference = `${formattedAuthors}. ${title}.`;
    
    if (publisher) {
      reference += ` ${publisher};`;
    }
    
    if (year) {
      reference += ` ${year}`;
    }
    
    if (pages) {
      reference += `. ${pages}`;
    }
    
    return reference + '.';
  }

  /**
   * Format book chapter in AMA style
   */
  formatBookChapter(authors, title, bookTitle, year, pages) {
    const formattedAuthors = this.formatAuthors(authors);
    return `${formattedAuthors}. ${title}. In: ${bookTitle}. ${year}. ${pages}.`;
  }

  /**
   * Format conference presentation in AMA style
   */
  formatConference(authors, title, conference, year, pages) {
    const formattedAuthors = this.formatAuthors(authors);
    return `${formattedAuthors}. ${title}. Presented at: ${conference}; ${year}. ${pages}.`;
  }

  /**
   * Format thesis in AMA style
   */
  formatThesis(authors, title, year, institution) {
    const formattedAuthors = this.formatAuthors(authors);
    return `${formattedAuthors}. ${title} [thesis]. ${institution}; ${year}.`;
  }

  /**
   * Format generic reference
   */
  formatGeneric(authors, title, source, year) {
    const formattedAuthors = this.formatAuthors(authors);
    return `${formattedAuthors}. ${title}. ${source}. ${year}.`;
  }

  /**
   * Format authors list in AMA style
   */
  formatAuthors(authors) {
    if (!authors || authors.length === 0) {
      return 'Unknown authors';
    }

    if (typeof authors === 'string') {
      return this.formatAuthorString(authors);
    }

    if (Array.isArray(authors)) {
      if (authors.length === 1) {
        return this.formatAuthorString(authors[0]);
      } else if (authors.length <= 6) {
        return authors.map(author => this.formatAuthorString(author)).join(', ');
      } else {
        const firstAuthor = this.formatAuthorString(authors[0]);
        return `${firstAuthor}, et al`;
      }
    }

    return 'Unknown authors';
  }

  /**
   * Format individual author string
   */
  formatAuthorString(author) {
    if (typeof author !== 'string') {
      return 'Unknown author';
    }

    // Handle different author formats
    const parts = author.trim().split(/\s+/);
    
    if (parts.length === 1) {
      return parts[0];
    } else if (parts.length === 2) {
      return `${parts[1]} ${parts[0]}`;
    } else {
      // Last name first, then first name and middle initials
      const lastName = parts[parts.length - 1];
      const firstName = parts[0];
      const middleNames = parts.slice(1, -1).map(name => name.charAt(0)).join(' ');
      return `${lastName} ${firstName} ${middleNames}`.trim();
    }
  }

  /**
   * Format journal name (abbreviate if possible)
   */
  formatJournalName(journal) {
    if (!journal) return 'Unknown Journal';
    
    // Common journal abbreviations
    const abbreviations = {
      'New England Journal of Medicine': 'N Engl J Med',
      'Journal of the American Medical Association': 'JAMA',
      'The Lancet': 'Lancet',
      'Nature': 'Nature',
      'Science': 'Science',
      'Cancer Research': 'Cancer Res',
      'Journal of Clinical Oncology': 'J Clin Oncol',
      'Annals of Oncology': 'Ann Oncol',
      'Breast Cancer Research': 'Breast Cancer Res',
      'Journal of the National Cancer Institute': 'J Natl Cancer Inst',
      'Clinical Cancer Research': 'Clin Cancer Res',
      'Cancer Cell': 'Cancer Cell',
      'Nature Medicine': 'Nat Med',
      'Nature Reviews Cancer': 'Nat Rev Cancer',
      'Cell': 'Cell',
      'Proceedings of the National Academy of Sciences': 'Proc Natl Acad Sci USA'
    };

    return abbreviations[journal] || journal;
  }

  /**
   * Create in-text citation (superscript number)
   */
  createInTextCitation(referenceId) {
    return `^${referenceId}^`;
  }

  /**
   * Generate reference list with numbering
   */
  generateReferenceList(citations) {
    try {
      const referenceList = [];
      
      for (let i = 0; i < citations.length; i++) {
        const citation = citations[i];
        const referenceNumber = i + 1;
        const formattedReference = this.formatAMAReference(citation);
        
        referenceList.push({
          number: referenceNumber,
          reference: formattedReference,
          citation: citation,
          inTextCitation: this.createInTextCitation(referenceNumber)
        });
      }
      
      return referenceList;
    } catch (error) {
      logger.error(`Reference list generation failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract citation metadata from PDF text using AI
   */
  async extractCitationMetadata(text, fileName) {
    try {
      // This would typically use an AI service to extract citation info
      // For now, we'll use pattern matching and heuristics
      
      const citation = {
        fileName,
        type: 'journal_article',
        authors: this.extractAuthors(text),
        title: this.extractTitle(text),
        journal: this.extractJournal(text),
        year: this.extractYear(text),
        volume: this.extractVolume(text),
        issue: this.extractIssue(text),
        pages: this.extractPages(text),
        doi: this.extractDOI(text),
        pmid: this.extractPMID(text),
        abstract: this.extractAbstract(text)
      };

      return citation;
    } catch (error) {
      logger.error(`Citation extraction failed for ${fileName}: ${error.message}`);
      return this.createFallbackCitation(fileName);
    }
  }

  /**
   * Extract authors from text
   */
  extractAuthors(text) {
    // Look for author patterns
    const authorPatterns = [
      /^([A-Z][a-z]+ [A-Z][a-z]+(?:, [A-Z][a-z]+ [A-Z][a-z]+)*)/m,
      /Authors?: ([^\.]+)/i,
      /By ([^\.]+)/i
    ];

    for (const pattern of authorPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].split(',').map(author => author.trim());
      }
    }

    return ['Unknown authors'];
  }

  /**
   * Extract title from text
   */
  extractTitle(text) {
    // Look for title patterns
    const titlePatterns = [
      /^([^\.\n]+\.)/m,
      /Title: ([^\.]+)/i,
      /^([A-Z][^\.]+\.)/m
    ];

    for (const pattern of titlePatterns) {
      const match = text.match(pattern);
      if (match && match[1].length > 10 && match[1].length < 200) {
        return match[1].trim();
      }
    }

    return 'Unknown title';
  }

  /**
   * Extract journal from text
   */
  extractJournal(text) {
    const journalPatterns = [
      /Published in: ([^\.]+)/i,
      /Journal: ([^\.]+)/i,
      /In: ([^\.]+)/i
    ];

    for (const pattern of journalPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return 'Unknown Journal';
  }

  /**
   * Extract year from text
   */
  extractYear(text) {
    const yearPattern = /(19|20)\d{2}/;
    const match = text.match(yearPattern);
    return match ? parseInt(match[0]) : new Date().getFullYear();
  }

  /**
   * Extract volume from text
   */
  extractVolume(text) {
    const volumePattern = /Vol\.?\s*(\d+)/i;
    const match = text.match(volumePattern);
    return match ? match[1] : null;
  }

  /**
   * Extract issue from text
   */
  extractIssue(text) {
    const issuePattern = /No\.?\s*(\d+)/i;
    const match = text.match(issuePattern);
    return match ? match[1] : null;
  }

  /**
   * Extract pages from text
   */
  extractPages(text) {
    const pagePattern = /pp?\.?\s*(\d+[-–]\d+)/i;
    const match = text.match(pagePattern);
    return match ? match[1] : null;
  }

  /**
   * Extract DOI from text
   */
  extractDOI(text) {
    const doiPattern = /doi:?\s*(10\.\d+\/[^\s]+)/i;
    const match = text.match(doiPattern);
    return match ? match[1] : null;
  }

  /**
   * Extract PMID from text
   */
  extractPMID(text) {
    const pmidPattern = /PMID:?\s*(\d+)/i;
    const match = text.match(pmidPattern);
    return match ? match[1] : null;
  }

  /**
   * Extract abstract from text
   */
  extractAbstract(text) {
    const abstractPattern = /Abstract[:\s]*([^]+?)(?=Introduction|Methods|Background|$)/i;
    const match = text.match(abstractPattern);
    return match ? match[1].trim() : null;
  }

  /**
   * Create fallback citation when extraction fails
   */
  createFallbackCitation(fileName) {
    return {
      fileName,
      type: 'journal_article',
      authors: ['Unknown authors'],
      title: fileName.replace(/\.(pdf|PDF)$/, ''),
      journal: 'Unknown Journal',
      year: new Date().getFullYear(),
      volume: null,
      issue: null,
      pages: null,
      doi: null,
      pmid: null,
      abstract: null
    };
  }

  /**
   * Track reference usage
   */
  trackReferenceUsage(referenceId, chunkId, context) {
    if (!this.referenceCache.has(referenceId)) {
      this.referenceCache.set(referenceId, {
        id: referenceId,
        usageCount: 0,
        chunks: [],
        contexts: []
      });
    }

    const reference = this.referenceCache.get(referenceId);
    reference.usageCount++;
    reference.chunks.push(chunkId);
    reference.contexts.push(context);

    return reference;
  }

  /**
   * Get reference usage statistics
   */
  getReferenceUsageStats() {
    const stats = {
      totalReferences: this.referenceCache.size,
      mostUsed: [],
      totalUsage: 0
    };

    for (const [id, reference] of this.referenceCache) {
      stats.totalUsage += reference.usageCount;
      stats.mostUsed.push({
        id,
        usageCount: reference.usageCount,
        chunks: reference.chunks.length
      });
    }

    stats.mostUsed.sort((a, b) => b.usageCount - a.usageCount);
    return stats;
  }

  /**
   * Clear reference cache
   */
  clearReferenceCache() {
    this.referenceCache.clear();
    this.referenceCounter = 1;
    logger.info('Reference cache cleared');
  }
}

export default new ReferenceService();
