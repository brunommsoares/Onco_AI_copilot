/**
 * Test Simple RAG System
 * This demonstrates RAG without PDF processing
 */

import simpleRAGService from './src/services/simpleRAGService.js';

async function testSimpleRAG() {
  console.log('🧪 Testing Simple RAG System\n');

  try {
    // Step 1: Initialize RAG system
    console.log('📚 Initializing Simple RAG system...');
    const initResult = await simpleRAGService.initialize();
    
    if (initResult.success) {
      console.log('✅ RAG system initialized successfully');
      console.log(`📊 Loaded ${initResult.documentCount} documents\n`);
    } else {
      console.log('❌ RAG system initialization failed');
      return;
    }

    // Step 2: Test search
    console.log('🔍 Testing search functionality...');
    const searchResult = await simpleRAGService.search('immunotherapy breast cancer');
    
    if (searchResult.success) {
      console.log(`✅ Search successful - found ${searchResult.results.length} relevant documents`);
      
      searchResult.results.forEach((result, index) => {
        console.log(`\n📄 Document ${index + 1}:`);
        console.log(`   Title: ${result.title}`);
        console.log(`   Similarity: ${(result.similarity * 100).toFixed(1)}%`);
        console.log(`   Citation: ${result.amaReference}`);
        console.log(`   Content: ${result.content.substring(0, 100)}...`);
      });
    } else {
      console.log('❌ Search failed');
    }

    // Step 3: Test response generation
    console.log('\n\n🤖 Testing response generation...');
    const responseResult = await simpleRAGService.generateResponse(
      'What are the latest treatments for triple-negative breast cancer?',
      { maxContextDocs: 2, language: 'pt' }
    );

    if (responseResult.success) {
      console.log('✅ Response generation successful');
      console.log(`\n📝 Response:\n${responseResult.response}\n`);
      
      if (responseResult.references.length > 0) {
        console.log('📚 References:');
        responseResult.references.forEach((ref, index) => {
          console.log(`   ${ref.number}. ${ref.amaReference}`);
        });
      }
    } else {
      console.log('❌ Response generation failed');
    }

    // Step 4: System status
    console.log('\n📊 System Status:');
    const status = simpleRAGService.getStatus();
    console.log(`   Initialized: ${status.isInitialized}`);
    console.log(`   Total Documents: ${status.totalDocuments}`);
    console.log(`   Total Embeddings: ${status.totalEmbeddings}`);

    console.log('\n🎉 Simple RAG test completed successfully!');
    console.log('\n💡 This demonstrates how RAG works:');
    console.log('   1. Documents are stored with embeddings');
    console.log('   2. Queries are converted to embeddings');
    console.log('   3. Similar documents are found using cosine similarity');
    console.log('   4. AI generates responses using relevant documents');
    console.log('   5. Proper citations are automatically included');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run the test
testSimpleRAG().catch(console.error);
