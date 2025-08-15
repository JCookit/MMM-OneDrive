#!/usr/bin/env node

/**
 * Simple test script for OpenCV face detection
 */

const path = require('path');

async function testFaceDetection() {
  try {
    console.log('Testing OpenCV face detection setup...');
    
    // Import our face detection module
    const { faceDetector, FACE_DETECTION_CONFIG } = await import('./src/vision/faceDetection.js');
    
    console.log('✓ Face detection module imported successfully');
    console.log('Configuration:', FACE_DETECTION_CONFIG);
    
    // Try to create a simple test image for detection
    const testImagePath = path.join(__dirname, 'images', 'screenshot.jpg'); // Use existing screenshot
    
    if (require('fs').existsSync(testImagePath)) {
      console.log(`Testing with image: ${testImagePath}`);
      
      const startTime = Date.now();
      const result = await faceDetector.detectFaces(testImagePath, true);
      const endTime = Date.now();
      
      console.log('Face detection results:');
      console.log(`  - Processing time: ${endTime - startTime}ms`);
      console.log(`  - Face count: ${result.faceCount}`);
      console.log(`  - Faces detected:`, result.faces);
      console.log(`  - Focal point:`, result.focalPoint);
      
      if (result.debugImageBuffer) {
        const debugPath = path.join(__dirname, 'cache', 'face_detection_debug.jpg');
        await require('fs/promises').writeFile(debugPath, result.debugImageBuffer);
        console.log(`  - Debug image saved to: ${debugPath}`);
      }
      
      console.log('✓ Face detection test completed successfully!');
    } else {
      console.log('⚠ Test image not found, but module loads correctly');
    }
    
  } catch (error) {
    console.error('✗ Face detection test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

testFaceDetection();
