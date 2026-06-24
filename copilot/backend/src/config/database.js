// Database and external service configurations
import { Pinecone } from '@pinecone-database/pinecone';
import Redis from 'redis';

// Pinecone configuration
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

const pineconeIndex = pinecone.index(process.env.PINECONE_INDEX_NAME || 'oncology-research');

// Redis configuration (optional)
let redisClient = null;
if (process.env.REDIS_URL) {
  redisClient = Redis.createClient({
    url: process.env.REDIS_URL
  });
  
  redisClient.on('error', (err) => {
    console.log('Redis Client Error:', err);
  });
  
  redisClient.on('connect', () => {
    console.log('✅ Redis connected');
  });
}

export { pinecone, pineconeIndex, redisClient };
