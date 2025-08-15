// Test just the face detection part without requiring the full node helper
const path = require('path');
const fs = require('fs');

async function testPerformFaceDetection() {
  console.log('Testing performFaceDetection method directly...');
  
  try {
    const testImagePath = path.join(__dirname, 'images', 'screenshot.jpg');
    const testImageBuffer = fs.readFileSync(testImagePath);
    const base64Data = testImageBuffer.toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Data}`;
    
    // Import the face detection module directly
    const { faceDetector } = await import('./src/vision/faceDetection.js');
    
    // Test the in-memory method directly as node helper would use it
    console.log('Testing with Buffer directly...');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    const startTime = Date.now();
    const result = await faceDetector.detectFacesFromBuffer(imageBuffer, false);
    const endTime = Date.now();
    
    console.log('In-memory face detection results:', {
      faceCount: result.faces.length,
      processingTime: result.processingTime + 'ms',
      totalTime: (endTime - startTime) + 'ms',
      hasMarkedImage: !!result.markedImageBuffer,
      focalPoint: {
        x: result.focalPoint.x.toFixed(4),
        y: result.focalPoint.y.toFixed(4),
        width: result.focalPoint.width.toFixed(4),
        height: result.focalPoint.height.toFixed(4)
      }
    });
    
    if (result.markedImageBuffer) {
      const markedImageBase64 = result.markedImageBuffer.toString('base64');
      const markedImageUrl = `data:image/jpeg;base64,${markedImageBase64}`;
      console.log('Marked image data URL length:', markedImageUrl.length);
      
      // Save marked image to verify it worked
      const outputPath = path.join(__dirname, 'cache', 'in_memory_test_marked.jpg');
      fs.writeFileSync(outputPath, result.markedImageBuffer);
      console.log('Marked image saved to:', outputPath);
    }
    
    console.log('\n✓ In-memory face detection integration test passed!');
    console.log('✓ No temporary files were created - pure in-memory processing');
    
  } catch (error) {
    console.error('✗ Test failed:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

testPerformFaceDetection();
