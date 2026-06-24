/**
 * Test script for RAG system
 * This script demonstrates how to use the RAG system with the breast cancer PDFs
 */

import ragService from './src/services/ragService.js';
import pdfProcessingService from './src/services/pdfProcessingService.js';
import vectorDatabaseService from './src/services/vectorDatabaseService.js';
import referenceService from './src/services/referenceService.js';

async function testRAGSystem() {
  console.log('🧪 Testing RAG System with Breast Cancer PDFs\n');

  try {
    // Step 1: Initialize RAG system
    console.log('📚 Step 1: Initializing RAG system...');
    const initResult = await ragService.initialize({
      maxFiles: 5, // Process only 5 files for testing
      chunkSize: 1000,
      overlap: 200
    });

    if (initResult.success) {
      console.log('✅ RAG system initialized successfully');
      console.log(`📊 Processed ${initResult.stats.processedFiles} documents`);
      console.log(`📄 Total pages: ${initResult.stats.totalPages}`);
      console.log(`📝 Total text length: ${initResult.stats.totalTextLength} characters\n`);
    } else {
      console.log('❌ RAG system initialization failed');
      return;
    }

    // Step 2: Test search functionality
    console.log('🔍 Step 2: Testing search functionality...');
    const testQueries = [
      'breast cancer treatment',
      'immunotherapy',
      'chemotherapy side effects',
      'mammography screening',
      'genetic mutations'
    ];

    for (const query of testQueries) {
      console.log(`\n🔎 Searching for: "${query}"`);
      
      const searchResult = await ragService.search(query, {
        maxResults: 3,
        includeReferences: true
      });

      if (searchResult.success) {
        console.log(`✅ Found ${searchResult.results.length} relevant chunks`);
        
        searchResult.results.forEach((result, index) => {
          console.log(`\n📄 Result ${index + 1}:`);
          console.log(`   Source: ${result.sourceFile}`);
          console.log(`   Relevance: ${(result.relevanceScore * 100).toFixed(1)}%`);
          console.log(`   Text preview: ${result.textPreview}`);
          
          if (result.citation) {
            console.log(`   Citation: ${result.amaReference}`);
          }
        });
      } else {
        console.log('❌ Search failed');
      }
    }

    // Step 3: Test response generation
    console.log('\n\n🤖 Step 3: Testing response generation...');
    const testQuestions = [
      'What are the latest treatments for breast cancer?',
      'How effective is immunotherapy in breast cancer?',
      'What are the side effects of chemotherapy?'
    ];

    for (const question of testQuestions) {
      console.log(`\n❓ Question: "${question}"`);
      
      const responseResult = await ragService.generateResponse(question, {
        maxContextChunks: 3,
        includeReferences: true,
        language: 'pt'
      });

      if (responseResult.success) {
        console.log(`✅ Generated response with ${responseResult.references.length} references`);
        console.log(`📝 Response: ${responseResult.response.substring(0, 200)}...`);
        
        if (responseResult.references.length > 0) {
          console.log('\n📚 References:');
          responseResult.references.forEach((ref, index) => {
            console.log(`   ${index + 1}. ${ref.amaReference}`);
          });
        }
      } else {
        console.log('❌ Response generation failed');
      }
    }

    // Step 4: Get system statistics
    console.log('\n\n📊 Step 4: System Statistics');
    const status = ragService.getStatus();
    const vectorStats = vectorDatabaseService.getDatabaseStats();
    
    console.log('RAG System Status:');
    console.log(`   Initialized: ${status.isInitialized}`);
    console.log(`   Total Documents: ${status.totalDocuments}`);
    console.log(`   Total Chunks: ${status.totalChunks}`);
    console.log(`   Total Embeddings: ${status.totalEmbeddings}`);
    console.log(`   Average Chunk Length: ${status.averageChunkLength.toFixed(0)} characters`);

    console.log('\nVector Database Stats:');
    console.log(`   Total Chunks: ${vectorStats.totalChunks}`);
    console.log(`   Total Documents: ${vectorStats.totalDocuments}`);
    console.log(`   Total Embeddings: ${vectorStats.totalEmbeddings}`);

    // Step 5: Test reference formatting
    console.log('\n\n📖 Step 5: Testing reference formatting...');
    const sampleCitation = {
      authors: ['Smith, J', 'Johnson, A', 'Brown, M'],
      title: 'Advances in Breast Cancer Treatment',
      journal: 'Journal of Clinical Oncology',
      year: 2023,
      volume: '41',
      issue: '15',
      pages: '1234-1245',
      doi: '10.1200/JCO.2023.41.15.1234'
    };

    const amaReference = referenceService.formatAMAReference(sampleCitation);
    console.log(`📄 Sample AMA Reference: ${amaReference}`);

    console.log('\n✅ RAG system test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run the test
testRAGSystem().catch(console.error);
