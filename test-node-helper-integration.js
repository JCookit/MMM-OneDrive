// Test the actual node helper integration
const path = require('path');

// Simulate the node helper's prepareShowPhoto function
async function testNodeHelperIntegration() {
  console.log('Testing complete node helper integration...');
  
  try {
    // Import the face detection module 
    const { faceDetector } = require('./src/vision/faceDetection.js');
    
    const testImagePath = path.join(__dirname, 'images', 'screenshot.jpg');
    const config = {
      faceDetection: {
        enabled: true,
        debug: true
      }
    };
    
    console.log('Testing with configuration:', config);
    console.log('Image path:', testImagePath);
    
    // Perform face detection (this is what the node helper does)
    const result = await faceDetector.detectFaces(testImagePath, config.faceDetection.debug);
    
    console.log('\n=== Face Detection Results ===');
    console.log('Processing time:', result.processingTime + 'ms');
    console.log('Faces detected:', result.faces.length);
    console.log('Focal point (percentages):', {
      x: result.focalPoint.x.toFixed(4),
      y: result.focalPoint.y.toFixed(4),
      width: result.focalPoint.width.toFixed(4),
      height: result.focalPoint.height.toFixed(4)
    });
    
    if (result.faces.length > 0) {
      console.log('\n=== Individual Faces ===');
      result.faces.forEach((face, index) => {
        console.log(`Face ${index + 1}:`, {
          x: face.x,
          y: face.y,
          width: face.width,
          height: face.height,
          aspectRatio: face.aspectRatio.toFixed(2),
          area: face.width * face.height
        });
      });
    }
    
    // Test the marked image creation
    if (config.faceDetection.debug) {
      console.log('\n=== Debug Image Generation ===');
      const image = await faceDetector.loadImage(testImagePath);
      const markedBuffer = await faceDetector.drawAllDetections(image, result.faces, result.focalPoint);
      
      const debugPath = path.join(__dirname, 'cache', 'node_helper_test.jpg');
      require('fs').writeFileSync(debugPath, markedBuffer);
      console.log('Debug image saved to:', debugPath);
      console.log('File size:', markedBuffer.length, 'bytes');
    }
    
    // Simulate what gets sent to frontend
    const frontendData = {
      focalPoint: result.focalPoint,
      faceCount: result.faces.length,
      processingTime: result.processingTime,
      debugImageAvailable: config.faceDetection.debug
    };
    
    console.log('\n=== Data for Frontend ===');
    console.log(JSON.stringify(frontendData, null, 2));
    
    console.log('\n✓ Node helper integration test completed successfully!');
    
  } catch (error) {
    console.error('✗ Integration test failed:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

testNodeHelperIntegration();
