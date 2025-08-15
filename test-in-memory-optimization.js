// Test in-memory vs file-based face detection performance
const path = require('path');
const fs = require('fs');

async function testInMemoryOptimization() {
  console.log('Testing in-memory face detection optimization...');
  
  try {
    const { faceDetector } = require('./src/vision/faceDetection.js');
    
    const testImagePath = path.join(__dirname, 'images', 'screenshot.jpg');
    const testImageBuffer = fs.readFileSync(testImagePath);
    
    console.log(`\nTesting with image: ${testImagePath}`);
    console.log(`Image size: ${testImageBuffer.length} bytes`);
    
    // Test 1: File-based detection (original method)
    console.log('\n=== File-based Detection (Original) ===');
    const fileStartTime = Date.now();
    const fileResult = await faceDetector.detectFaces(testImagePath, false);
    const fileEndTime = Date.now();
    const fileProcessingTime = fileEndTime - fileStartTime;
    
    console.log('File-based results:', {
      faceCount: fileResult.faces.length,
      detectionTime: fileResult.processingTime + 'ms',
      totalTime: fileProcessingTime + 'ms',
      hasMarkedImage: !!fileResult.markedImageBuffer
    });
    
    // Test 2: In-memory detection (optimized method)
    console.log('\n=== In-Memory Detection (Optimized) ===');
    const memoryStartTime = Date.now();
    const memoryResult = await faceDetector.detectFacesFromBuffer(testImageBuffer, false);
    const memoryEndTime = Date.now();
    const memoryProcessingTime = memoryEndTime - memoryStartTime;
    
    console.log('In-memory results:', {
      faceCount: memoryResult.faces.length,
      detectionTime: memoryResult.processingTime + 'ms',
      totalTime: memoryProcessingTime + 'ms',
      hasMarkedImage: !!memoryResult.markedImageBuffer
    });
    
    // Compare results
    console.log('\n=== Performance Comparison ===');
    const timeSaved = fileProcessingTime - memoryProcessingTime;
    const percentageSaved = ((timeSaved / fileProcessingTime) * 100).toFixed(1);
    
    console.log(`File-based total time: ${fileProcessingTime}ms`);
    console.log(`In-memory total time: ${memoryProcessingTime}ms`);
    console.log(`Time saved: ${timeSaved}ms (${percentageSaved}%)`);
    
    // Verify results are consistent
    console.log('\n=== Result Consistency Check ===');
    const resultsMatch = {
      faceCount: fileResult.faces.length === memoryResult.faces.length,
      focalPointClose: Math.abs(fileResult.focalPoint.x - memoryResult.focalPoint.x) < 0.01,
      bothHaveMarkedImages: !!fileResult.markedImageBuffer === !!memoryResult.markedImageBuffer
    };
    
    console.log('Results consistency:', resultsMatch);
    
    if (resultsMatch.faceCount && resultsMatch.focalPointClose && resultsMatch.bothHaveMarkedImages) {
      console.log('✓ Results are consistent between methods');
    } else {
      console.log('⚠ Results differ between methods');
      console.log('File focal point:', fileResult.focalPoint);
      console.log('Memory focal point:', memoryResult.focalPoint);
    }
    
    // Test the node helper integration
    console.log('\n=== Node Helper Integration Test ===');
    const base64Data = testImageBuffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Data}`;
    
    // Simulate node helper call
    const nodeHelper = require('./node_helper.js');
    const nodeHelperResult = await nodeHelper.performFaceDetection({
      url: dataUrl,
      photo: { filename: 'test.jpg' },
      album: { name: 'Test Album' },
      filename: 'test.jpg'
    });
    
    console.log('Node helper integration:', {
      success: !!nodeHelperResult,
      faceCount: nodeHelperResult?.faceCount || 0,
      hasMarkedImageUrl: !!nodeHelperResult?.markedImageUrl,
      processingTime: nodeHelperResult?.processingTime + 'ms'
    });
    
    console.log('\n✓ In-memory optimization test completed successfully!');
    
  } catch (error) {
    console.error('✗ Test failed:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

testInMemoryOptimization();
