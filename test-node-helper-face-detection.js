const path = require('path');

// Test the face detection module directly
async function testNodeHelperFaceDetection() {
  console.log('Testing node helper face detection integration...');
  
  try {
    // Use the exported singleton instance
    const { faceDetector } = require('./src/vision/faceDetection.js');
    
    const testImagePath = path.join(__dirname, 'images', 'screenshot.jpg');
    console.log('Testing with image:', testImagePath);
    
    const result = await faceDetector.detectFaces(testImagePath, true);
    
    console.log('Face detection result:', {
      faceCount: result.faces.length,
      processingTime: result.processingTime,
      focalPoint: result.focalPoint,
      debugImageSaved: result.debugImagePath ? 'Yes' : 'No'
    });
    
    if (result.faces.length > 0) {
      console.log('Face details:', result.faces.map(face => ({
        x: face.x,
        y: face.y,
        width: face.width,
        height: face.height,
        aspectRatio: face.aspectRatio.toFixed(2)
      })));
    }
    
    console.log('✓ Node helper face detection test completed successfully!');
    
  } catch (error) {
    console.error('✗ Test failed:', error);
    console.error('Error details:', error.stack);
    process.exit(1);
  }
}

testNodeHelperFaceDetection();
