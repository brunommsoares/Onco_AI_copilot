import { logger } from '../utils/logger.js';

/**
 * Quality Report Service - Armazena e gere relatórios de qualidade
 * Permite análise posterior e melhoria contínua do sistema
 */
class QualityReportService {
  constructor() {
    this.reports = new Map(); // Cache em memória (em produção seria uma base de dados)
    this.analytics = {
      totalReports: 0,
      averageScore: 0,
      criticalIssuesCount: 0,
      improvementSuggestions: 0,
      lastUpdated: new Date()
    };
  }

  /**
   * Armazena um relatório de qualidade
   * @param {string} question - Pergunta original
   * @param {string} response - Resposta gerada
   * @param {Object} qualityReport - Relatório de qualidade
   * @param {Object} metadata - Metadados adicionais
   */
  async storeQualityReport(question, response, qualityReport, metadata = {}) {
    try {
      const reportId = this.generateReportId();
      const timestamp = new Date().toISOString();
      
      const report = {
        id: reportId,
        question: question.substring(0, 200), // Limitar tamanho
        response: response.substring(0, 500), // Primeiros 500 chars
        qualityReport,
        metadata: {
          ...metadata,
          timestamp,
          responseLength: response.length,
          questionLength: question.length
        },
        createdAt: timestamp
      };
      
      // Armazenar em cache (em produção seria uma base de dados)
      this.reports.set(reportId, report);
      
      // Atualizar analytics
      this.updateAnalytics(report);
      
      logger.info(`Quality report stored: ${reportId} (score: ${qualityReport.score.toFixed(2)})`);
      
      return reportId;
      
    } catch (error) {
      logger.error(`Failed to store quality report: ${error.message}`);
      throw error;
    }
  }

  /**
   * Armazena uma resposta melhorada para análise
   * @param {string} question - Pergunta original
   * @param {string} originalResponse - Resposta original
   * @param {string} improvedResponse - Resposta melhorada
   * @param {Object} metadata - Metadados adicionais
   */
  async storeImprovedResponse(question, originalResponse, improvedResponse, metadata = {}) {
    try {
      const reportId = this.generateReportId();
      const timestamp = new Date().toISOString();
      
      const report = {
        id: reportId,
        type: 'improvement',
        question: question.substring(0, 200),
        originalResponse: originalResponse.substring(0, 500),
        improvedResponse: improvedResponse.substring(0, 500),
        metadata: {
          ...metadata,
          timestamp,
          improvementTriggered: true
        },
        createdAt: timestamp
      };
      
      this.reports.set(reportId, report);
      logger.info(`Improvement report stored: ${reportId}`);
      
      return reportId;
      
    } catch (error) {
      logger.error(`Failed to store improvement report: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtém um relatório de qualidade por ID
   * @param {string} reportId - ID do relatório
   */
  async getQualityReport(reportId) {
    return this.reports.get(reportId) || null;
  }

  /**
   * Obtém todos os relatórios (com paginação)
   * @param {Object} options - Opções de paginação e filtros
   */
  async getAllReports(options = {}) {
    const {
      page = 1,
      limit = 20,
      minScore = 0,
      maxScore = 1,
      hasCriticalIssues = null,
      startDate = null,
      endDate = null
    } = options;
    
    let filteredReports = Array.from(this.reports.values());
    
    // Filtrar por pontuação
    if (minScore > 0 || maxScore < 1) {
      filteredReports = filteredReports.filter(report => 
        report.qualityReport && 
        report.qualityReport.score >= minScore && 
        report.qualityReport.score <= maxScore
      );
    }
    
    // Filtrar por problemas críticos
    if (hasCriticalIssues !== null) {
      filteredReports = filteredReports.filter(report => {
        if (!report.qualityReport) return false;
        const hasIssues = report.qualityReport.criticalIssues && 
                         report.qualityReport.criticalIssues.length > 0;
        return hasIssues === hasCriticalIssues;
      });
    }
    
    // Filtrar por data
    if (startDate || endDate) {
      filteredReports = filteredReports.filter(report => {
        const reportDate = new Date(report.createdAt);
        if (startDate && reportDate < new Date(startDate)) return false;
        if (endDate && reportDate > new Date(endDate)) return false;
        return true;
      });
    }
    
    // Ordenar por data (mais recente primeiro)
    filteredReports.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // Paginação
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedReports = filteredReports.slice(startIndex, endIndex);
    
    return {
      reports: paginatedReports,
      pagination: {
        page,
        limit,
        total: filteredReports.length,
        totalPages: Math.ceil(filteredReports.length / limit),
        hasNext: endIndex < filteredReports.length,
        hasPrev: page > 1
      }
    };
  }

  /**
   * Obtém estatísticas de qualidade
   */
  async getQualityStats(timeRange = '7d') {
    const now = new Date();
    let startDate;
    
    switch (timeRange) {
      case '24h':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(0); // Desde o início
    }
    
    const recentReports = Array.from(this.reports.values()).filter(report => 
      new Date(report.createdAt) >= startDate && report.qualityReport
    );
    
    if (recentReports.length === 0) {
      return {
        totalReports: 0,
        averageScore: 0,
        scoreDistribution: { low: 0, medium: 0, high: 0 },
        criticalIssuesCount: 0,
        topIssues: [],
        topSuggestions: [],
        timeRange
      };
    }
    
    // Calcular estatísticas
    const scores = recentReports.map(r => r.qualityReport.score);
    const averageScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    
    // Distribuição de pontuações
    const scoreDistribution = {
      low: scores.filter(s => s < 0.6).length,
      medium: scores.filter(s => s >= 0.6 && s < 0.8).length,
      high: scores.filter(s => s >= 0.8).length
    };
    
    // Problemas críticos
    const allCriticalIssues = recentReports.flatMap(r => 
      r.qualityReport.criticalIssues || []
    );
    
    const issueCounts = {};
    allCriticalIssues.forEach(issue => {
      const key = `${issue.category}:${issue.type}`;
      issueCounts[key] = (issueCounts[key] || 0) + 1;
    });
    
    const topIssues = Object.entries(issueCounts)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    // Sugestões de melhoria
    const allSuggestions = recentReports.flatMap(r => 
      r.qualityReport.suggestions || []
    );
    
    const suggestionCounts = {};
    allSuggestions.forEach(suggestion => {
      const key = suggestion.category;
      suggestionCounts[key] = (suggestionCounts[key] || 0) + 1;
    });
    
    const topSuggestions = Object.entries(suggestionCounts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    return {
      totalReports: recentReports.length,
      averageScore: parseFloat(averageScore.toFixed(3)),
      scoreDistribution,
      criticalIssuesCount: allCriticalIssues.length,
      topIssues,
      topSuggestions,
      timeRange,
      lastUpdated: now.toISOString()
    };
  }

  /**
   * Obtém relatórios com problemas críticos
   */
  async getCriticalIssuesReports(limit = 10) {
    const criticalReports = Array.from(this.reports.values())
      .filter(report => 
        report.qualityReport && 
        report.qualityReport.criticalIssues && 
        report.qualityReport.criticalIssues.length > 0
      )
      .sort((a, b) => 
        (b.qualityReport.criticalIssues.length - a.qualityReport.criticalIssues.length) ||
        (a.qualityReport.score - b.qualityReport.score)
      )
      .slice(0, limit);
    
    return criticalReports;
  }

  /**
   * Obtém relatórios de melhoria
   */
  async getImprovementReports(limit = 10) {
    const improvementReports = Array.from(this.reports.values())
      .filter(report => report.type === 'improvement')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
    
    return improvementReports;
  }

  /**
   * Gera relatório de qualidade para administradores
   */
  async generateAdminReport() {
    const stats = await this.getQualityStats('30d');
    const criticalReports = await this.getCriticalIssuesReports(5);
    const improvementReports = await this.getImprovementReports(5);
    
    return {
      summary: {
        totalReports: this.analytics.totalReports,
        averageScore: this.analytics.averageScore,
        criticalIssuesCount: this.analytics.criticalIssuesCount,
        improvementSuggestions: this.analytics.improvementSuggestions,
        lastUpdated: this.analytics.lastUpdated
      },
      recentStats: stats,
      criticalIssues: criticalReports.map(r => ({
        id: r.id,
        question: r.question,
        score: r.qualityReport.score,
        criticalIssues: r.qualityReport.criticalIssues,
        timestamp: r.createdAt
      })),
      improvements: improvementReports.map(r => ({
        id: r.id,
        question: r.question,
        timestamp: r.createdAt
      })),
      recommendations: this.generateRecommendations(stats, criticalReports)
    };
  }

  /**
   * Gera recomendações baseadas nos dados
   */
  generateRecommendations(stats, criticalReports) {
    const recommendations = [];
    
    if (stats.averageScore < 0.7) {
      recommendations.push({
        priority: 'high',
        category: 'overall_quality',
        message: 'Qualidade geral das respostas está abaixo do esperado. Revisar prompts e configurações.',
        action: 'Review system prompts and quality thresholds'
      });
    }
    
    if (stats.criticalIssuesCount > stats.totalReports * 0.3) {
      recommendations.push({
        priority: 'high',
        category: 'critical_issues',
        message: 'Alta incidência de problemas críticos. Implementar verificações adicionais.',
        action: 'Implement additional quality checks'
      });
    }
    
    const citationIssues = criticalReports.filter(r => 
      r.qualityReport.criticalIssues.some(issue => 
        issue.category === 'citation_integrity'
      )
    ).length;
    
    if (citationIssues > 0) {
      recommendations.push({
        priority: 'medium',
        category: 'citations',
        message: `${citationIssues} problemas com integridade de citações. Melhorar sistema de referências.`,
        action: 'Improve citation system and validation'
      });
    }
    
    return recommendations;
  }

  /**
   * Limpa relatórios antigos (manutenção)
   */
  async cleanupOldReports(daysToKeep = 90) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      let deletedCount = 0;
      for (const [id, report] of this.reports.entries()) {
        if (new Date(report.createdAt) < cutoffDate) {
          this.reports.delete(id);
          deletedCount++;
        }
      }
      
      logger.info(`Cleaned up ${deletedCount} old quality reports (older than ${daysToKeep} days)`);
      return deletedCount;
      
    } catch (error) {
      logger.error(`Failed to cleanup old reports: ${error.message}`);
      throw error;
    }
  }

  // ===== UTILITÁRIOS =====

  /**
   * Gera ID único para relatório
   */
  generateReportId() {
    return `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Atualiza analytics com novo relatório
   */
  updateAnalytics(report) {
    this.analytics.totalReports++;
    
    if (report.qualityReport) {
      const currentTotal = this.analytics.averageScore * (this.analytics.totalReports - 1);
      this.analytics.averageScore = (currentTotal + report.qualityReport.score) / this.analytics.totalReports;
      
      if (report.qualityReport.criticalIssues) {
        this.analytics.criticalIssuesCount += report.qualityReport.criticalIssues.length;
      }
      
      if (report.qualityReport.suggestions) {
        this.analytics.improvementSuggestions += report.qualityReport.suggestions.length;
      }
    }
    
    this.analytics.lastUpdated = new Date().toISOString();
  }
}

export default new QualityReportService();
