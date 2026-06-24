import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';
import admin from 'firebase-admin';

export class UserService {
  constructor() {
    // Firebase Admin is already initialized in the main server
  }

  /**
   * Get user profile
   */
  async getUserProfile(userId) {
    try {
      // Get user from Firebase Auth
      const userRecord = await admin.auth().getUser(userId);
      
      // Get custom claims
      const customClaims = userRecord.customClaims || {};
      
      // In a real implementation, you would also fetch additional profile data from Firestore
      const profile = {
        id: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        emailVerified: userRecord.emailVerified,
        role: customClaims.role || 'user',
        specialty: customClaims.specialty || null,
        institution: customClaims.institution || null,
        createdAt: userRecord.metadata.creationTime,
        lastSignIn: userRecord.metadata.lastSignInTime,
        permissions: customClaims.permissions || []
      };

      return profile;
    } catch (error) {
      logger.error(`Failed to get user profile: ${error.message}`);
      throw new AppError('Failed to retrieve user profile', 500);
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(userId, updateData) {
    try {
      const allowedFields = ['displayName', 'specialty', 'institution', 'bio'];
      const updateFields = {};
      
      // Filter allowed fields
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          updateFields[field] = updateData[field];
        }
      }

      // Update custom claims if specialty or institution changed
      if (updateFields.specialty || updateFields.institution) {
        const userRecord = await admin.auth().getUser(userId);
        const currentClaims = userRecord.customClaims || {};
        
        const newClaims = {
          ...currentClaims,
          specialty: updateFields.specialty || currentClaims.specialty,
          institution: updateFields.institution || currentClaims.institution
        };

        await admin.auth().setCustomUserClaims(userId, newClaims);
      }

      // Update display name if provided
      if (updateFields.displayName) {
        await admin.auth().updateUser(userId, {
          displayName: updateFields.displayName
        });
      }

      // In a real implementation, you would also update additional profile data in Firestore
      
      logger.info(`User profile updated: ${userId}`);

      // Return updated profile
      return await this.getUserProfile(userId);
    } catch (error) {
      logger.error(`Failed to update user profile: ${error.message}`);
      throw new AppError('Failed to update user profile', 500);
    }
  }

  /**
   * Get user preferences
   */
  async getUserPreferences(userId) {
    try {
      // In a real implementation, this would fetch from Firestore
      // For now, return default preferences
      const preferences = {
        userId,
        searchPreferences: {
          defaultSources: ['pubmed', 'cochrane'],
          defaultMaxResults: 20,
          includeAbstracts: true,
          defaultSortBy: 'relevance'
        },
        notificationPreferences: {
          email: true,
          push: false,
          frequency: 'weekly'
        },
        displayPreferences: {
          theme: 'light',
          language: 'en',
          compactMode: false
        },
        clinicalPreferences: {
          specialty: 'oncology',
          cancerTypes: [],
          evidenceLevels: ['1a', '1b', '2a', '2b'],
          dateRange: '5years'
        }
      };

      return preferences;
    } catch (error) {
      logger.error(`Failed to get user preferences: ${error.message}`);
      throw new AppError('Failed to retrieve user preferences', 500);
    }
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(userId, preferences) {
    try {
      // Validate preferences structure
      this.validatePreferences(preferences);

      // In a real implementation, this would update Firestore
      // For now, just log the update
      logger.info(`User preferences updated: ${userId}`);

      // Return updated preferences
      return await this.getUserPreferences(userId);
    } catch (error) {
      logger.error(`Failed to update user preferences: ${error.message}`);
      throw new AppError('Failed to update user preferences', 500);
    }
  }

  /**
   * Get user activity summary
   */
  async getUserActivity(userId, period) {
    try {
      // In a real implementation, this would aggregate data from various collections
      // For now, return placeholder activity data
      const activity = {
        userId,
        period,
        summary: {
          totalSearches: this.getRandomActivityCount(period),
          totalEvidenceSaved: this.getRandomActivityCount(period),
          totalCitations: this.getRandomActivityCount(period),
          activeDays: this.getRandomActivityCount(period, 1, 30)
        },
        recentActivity: [
          {
            type: 'search',
            query: 'immunotherapy breast cancer',
            timestamp: new Date().toISOString(),
            resultCount: 15
          },
          {
            type: 'evidence_saved',
            title: 'Recent advances in immunotherapy',
            timestamp: new Date(Date.now() - 86400000).toISOString()
          }
        ],
        trends: {
          searches: this.generateTrendData(period),
          evidenceSaved: this.generateTrendData(period),
          citations: this.generateTrendData(period)
        }
      };

      return activity;
    } catch (error) {
      logger.error(`Failed to get user activity: ${error.message}`);
      throw new AppError('Failed to retrieve user activity', 500);
    }
  }

  /**
   * Export user data
   */
  async exportUserData(userId, format, includeData) {
    try {
      const exportData = {
        userId,
        exportDate: new Date().toISOString(),
        format,
        data: {}
      };

      // Gather requested data
      for (const dataType of includeData) {
        switch (dataType) {
          case 'profile':
            exportData.data.profile = await this.getUserProfile(userId);
            break;
          case 'evidence':
            exportData.data.evidence = await this.getUserEvidenceData(userId);
            break;
          case 'searches':
            exportData.data.searches = await this.getUserSearchData(userId);
            break;
          case 'activity':
            exportData.data.activity = await this.getUserActivity(userId, 'year');
            break;
          default:
            logger.warn(`Unknown data type for export: ${dataType}`);
        }
      }

      // Format data according to requested format
      switch (format) {
        case 'json':
          return exportData;
        case 'csv':
          return this.convertToCSV(exportData);
        case 'pdf':
          return this.convertToPDF(exportData);
        default:
          throw new AppError('Unsupported export format', 400);
      }
    } catch (error) {
      logger.error(`Failed to export user data: ${error.message}`);
      throw new AppError('Failed to export user data', 500);
    }
  }

  /**
   * Validate preferences structure
   */
  validatePreferences(preferences) {
    // Basic validation - in a real implementation, this would be more comprehensive
    if (preferences.searchPreferences) {
      if (preferences.searchPreferences.defaultMaxResults && 
          (preferences.searchPreferences.defaultMaxResults < 1 || preferences.searchPreferences.defaultMaxResults > 100)) {
        throw new AppError('Invalid max results value', 400);
      }
    }

    if (preferences.notificationPreferences) {
      if (preferences.notificationPreferences.frequency && 
          !['daily', 'weekly', 'monthly'].includes(preferences.notificationPreferences.frequency)) {
        throw new AppError('Invalid notification frequency', 400);
      }
    }
  }

  /**
   * Get random activity count based on period
   */
  getRandomActivityCount(period, min = 0, max = 100) {
    const multipliers = {
      week: 0.25,
      month: 1,
      quarter: 3,
      year: 12
    };

    const baseCount = Math.floor(Math.random() * (max - min + 1)) + min;
    return Math.floor(baseCount * (multipliers[period] || 1));
  }

  /**
   * Generate trend data
   */
  generateTrendData(period) {
    const dataPoints = {
      week: 7,
      month: 30,
      quarter: 90,
      year: 365
    };

    const points = dataPoints[period] || 30;
    const data = [];

    for (let i = 0; i < points; i++) {
      data.push({
        date: new Date(Date.now() - (points - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        value: Math.floor(Math.random() * 50) + 10
      });
    }

    return data;
  }

  /**
   * Get user evidence data for export
   */
  async getUserEvidenceData(userId) {
    // Placeholder implementation
    return {
      totalCount: 0,
      items: []
    };
  }

  /**
   * Get user search data for export
   */
  async getUserSearchData(userId) {
    // Placeholder implementation
    return {
      totalCount: 0,
      items: []
    };
  }

  /**
   * Convert data to CSV format
   */
  convertToCSV(data) {
    // Placeholder implementation for CSV conversion
    return {
      format: 'csv',
      content: 'placeholder_csv_content',
      filename: `user_data_${data.userId}_${new Date().toISOString().split('T')[0]}.csv`
    };
  }

  /**
   * Convert data to PDF format
   */
  convertToPDF(data) {
    // Placeholder implementation for PDF conversion
    return {
      format: 'pdf',
      content: 'placeholder_pdf_content',
      filename: `user_data_${data.userId}_${new Date().toISOString().split('T')[0]}.pdf`
    };
  }
}
