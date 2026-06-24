import admin from 'firebase-admin';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Initialize Firebase Admin
const initializeFirebase = () => {
  try {
    // Check if Firebase is already initialized
    if (admin.apps.length > 0) {
      logger.info('Firebase Admin already initialized');
      return admin.apps[0];
    }

    // Try to initialize with service account from environment variable
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

        if (serviceAccount.project_id) {
          const firebaseApp = admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: process.env.FIREBASE_DATABASE_URL,
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET
          });

          logger.info('Firebase Admin initialized successfully with service account (env)');
          return firebaseApp;
        }
      } catch (parseError) {
        logger.warn(`Failed to parse FIREBASE_SERVICE_ACCOUNT: ${parseError.message}`);
      }
    }

    // Try to initialize with service account JSON file
    const saFilePaths = [
      join(__dirname, '..', '..', 'firebase-service-account.json'),
      join(__dirname, '..', '..', '..', 'firebase-service-account.json'),
      process.env.GOOGLE_APPLICATION_CREDENTIALS
    ].filter(Boolean);

    for (const saPath of saFilePaths) {
      if (existsSync(saPath)) {
        try {
          const serviceAccount = JSON.parse(readFileSync(saPath, 'utf-8'));
          if (serviceAccount.project_id) {
            const firebaseApp = admin.initializeApp({
              credential: admin.credential.cert(serviceAccount),
              databaseURL: process.env.FIREBASE_DATABASE_URL,
              storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`
            });
            logger.info(`Firebase Admin initialized with service account file: ${saPath}`);
            return firebaseApp;
          }
        } catch (fileError) {
          logger.warn(`Failed to read Firebase service account from ${saPath}: ${fileError.message}`);
        }
      }
    }

    // Try to initialize with project ID only (for development)
    if (process.env.FIREBASE_PROJECT_ID) {
      try {
        const firebaseApp = admin.initializeApp({
          projectId: process.env.FIREBASE_PROJECT_ID
        });

        logger.info('Firebase Admin initialized with project ID only (development mode)');
        return firebaseApp;
      } catch (fallbackError) {
        logger.warn(`Firebase initialization with project ID failed: ${fallbackError.message}`);
      }
    }

    // If all initialization attempts fail, log warning but don't crash
    logger.warn('Firebase Admin SDK not initialized; authentication features will be limited');
    return null;
  } catch (error) {
    logger.warn(`Firebase initialization error: ${error.message} - running without Firebase features`);
    return null;
  }
};

// Export initialized Firebase Admin instance (may be null)
export const firebaseApp = initializeFirebase();
export default admin;
