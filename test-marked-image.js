// Test script to verify focal point rectangle burning
const { faceDetector } = require('./src/vision/faceDetection.js');
const fs = require('fs');
const path = require('path');

async function testMarkedImage() {
  console.log('Testing marked image generation...');
  
  try {
    const testImage = path.join(__dirname, 'images', 'screenshot.jpg');
    console.log('Testing with image:', testImage);
    
    if (!fs.existsSync(testImage)) {
      console.log('Test image not found, skipping test');
      return;
    }
    
    // Run face detection (will generate marked image even without faces)
    const result = await faceDetector.detectFaces(testImage, false);
    
    console.log('Face detection completed:');
    console.log('  - Face count:', result.faceCount);
    console.log('  - Processing time:', result.processingTime + 'ms');
    console.log('  - Focal point:', result.focalPoint);
    console.log('  - Has marked image buffer:', !!result.markedImageBuffer);
    
    if (result.markedImageBuffer) {
      // Save the marked image to see the focal point rectangle
      const outputPath = path.join(__dirname, 'cache', 'marked_focal_point.jpg');
      fs.writeFileSync(outputPath, result.markedImageBuffer);
      console.log('  - Marked image saved to:', outputPath);
      console.log('  - Marked image size:', result.markedImageBuffer.length, 'bytes');
    }
    
    console.log('✓ Marked image test completed successfully!');
  } catch (error) {
    console.error('✗ Marked image test failed:', error);
  }
}

testMarkedImage();
