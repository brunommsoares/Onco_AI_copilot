/**
 * Quick RAG System Starter
 * This script will initialize the RAG system with your breast cancer PDFs
 */

import fetch from 'node-fetch';

const API_BASE = 'http://localhost:3002/api';
const TEST_USER_TOKEN = 'test-token'; // You'll need to replace this with a real token

async function startRAGSystem() {
  console.log('🚀 Starting RAG System with Breast Cancer PDFs...\n');

  try {
    // Step 1: Check server status
    console.log('📡 Checking server status...');
    const healthResponse = await fetch(`${API_BASE.replace('/api', '')}/health`);
    if (healthResponse.ok) {
      console.log('✅ Server is running');
    } else {
      throw new Error('Server is not responding');
    }

    // Step 2: Initialize RAG system
    console.log('\n📚 Initializing RAG system with PDFs...');
    const initResponse = await fetch(`${API_BASE}/rag/initialize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_USER_TOKEN}`
      },
      body: JSON.stringify({
        maxFiles: 5, // Process only 5 files for testing
        chunkSize: 1000,
        overlap: 200,
        forceReprocess: false
      })
    });

    if (initResponse.ok) {
      const initResult = await initResponse.json();
      console.log('✅ RAG system initialized successfully');
      console.log(`📊 Processed ${initResult.stats?.processedFiles || 0} documents`);
      console.log(`📄 Total pages: ${initResult.stats?.totalPages || 0}`);
    } else {
      const error = await initResponse.text();
      console.log('❌ RAG initialization failed:', error);
      console.log('💡 Make sure you have authentication set up or modify the auth middleware');
    }

    // Step 3: Test search functionality
    console.log('\n🔍 Testing search functionality...');
    const searchResponse = await fetch(`${API_BASE}/rag/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_USER_TOKEN}`
      },
      body: JSON.stringify({
        query: 'breast cancer treatment',
        maxResults: 3,
        includeReferences: true
      })
    });

    if (searchResponse.ok) {
      const searchResult = await searchResponse.json();
      console.log('✅ Search test successful');
      console.log(`📊 Found ${searchResult.results?.length || 0} relevant chunks`);
    } else {
      const error = await searchResponse.text();
      console.log('❌ Search test failed:', error);
    }

    // Step 4: Test response generation
    console.log('\n🤖 Testing response generation...');
    const generateResponse = await fetch(`${API_BASE}/rag/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_USER_TOKEN}`
      },
      body: JSON.stringify({
        query: 'What are the latest treatments for breast cancer?',
        maxContextChunks: 3,
        includeReferences: true,
        language: 'pt'
      })
    });

    if (generateResponse.ok) {
      const generateResult = await generateResponse.json();
      console.log('✅ Response generation test successful');
      console.log(`📝 Response preview: ${generateResult.response?.substring(0, 100)}...`);
      console.log(`📚 References: ${generateResult.references?.length || 0}`);
    } else {
      const error = await generateResponse.text();
      console.log('❌ Response generation test failed:', error);
    }

    // Step 5: Get system status
    console.log('\n📊 Getting system status...');
    const statusResponse = await fetch(`${API_BASE}/rag/status`, {
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`
      }
    });

    if (statusResponse.ok) {
      const status = await statusResponse.json();
      console.log('✅ System status retrieved');
      console.log(`📊 Total documents: ${status.status?.totalDocuments || 0}`);
      console.log(`📄 Total chunks: ${status.status?.totalChunks || 0}`);
      console.log(`🧠 Total embeddings: ${status.status?.totalEmbeddings || 0}`);
    }

    console.log('\n🎉 RAG System is ready to use!');
    console.log('\n📋 Available endpoints:');
    console.log('   POST /api/rag/initialize - Initialize RAG system');
    console.log('   POST /api/rag/search - Search with vector similarity');
    console.log('   POST /api/rag/generate - Generate AI responses with citations');
    console.log('   GET /api/rag/status - Get system status');
    console.log('   GET /api/rag/pdfs - List processed PDFs');

  } catch (error) {
    console.error('❌ Error starting RAG system:', error.message);
    console.log('\n💡 Troubleshooting tips:');
    console.log('   1. Make sure the server is running on port 3002');
    console.log('   2. Check that you have PDFs in the Breast/ folder');
    console.log('   3. Verify authentication is set up correctly');
    console.log('   4. Check the server logs for detailed error messages');
  }
}

// Run the starter
startRAGSystem().catch(console.error);
