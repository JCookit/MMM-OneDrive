#!/usr/bin/env node
/**
 * Direct Face Detection Test
 * Test face detection directly without the worker process to isolate algorithm issues
 */

const fs = require('fs');
const path = require('path');

async function testDirectFaceDetection(imagePath) {
  console.log(`[DirectTest] 🧪 Testing direct face detection with: ${imagePath}`);
  
  try {
    // Import face detection directly
    const { faceDetector } = require('./src/vision/faceDetection.js');
    
    // Read image file
    const imageBuffer = fs.readFileSync(imagePath);
    console.log(`[DirectTest] 📖 Loaded image: ${imageBuffer.length} bytes`);
    
    // Test face detection directly
    const startTime = Date.now();
    const faces = await faceDetector.detectFacesOnly(imageBuffer);
    const processingTime = Date.now() - startTime;
    
    console.log(`[DirectTest] ✅ Direct face detection completed!`);
    console.log(`[DirectTest] 📊 Processing time: ${processingTime}ms`);
    console.log(`[DirectTest] 📊 Faces detected: ${faces.length}`);
    
    if (faces.length > 0) {
      console.log(`[DirectTest] 👥 Face details:`);
      faces.forEach((face, i) => {
        console.log(`[DirectTest]   Face ${i + 1}: ${face.width}x${face.height} at (${face.x}, ${face.y}) confidence: ${face.confidence?.toFixed(2) || 'N/A'}`);
      });
    } else {
      console.log(`[DirectTest] 🔍 No faces detected - this might indicate algorithm issue`);
    }
    
    return faces;
    
  } catch (error) {
    console.error(`[DirectTest] ❌ Direct test failed:`, error.message);
    throw error;
  }
}

// Test with different confidence thresholds
async function testWithDifferentThresholds(imagePath) {
  console.log(`[DirectTest] 🔬 Testing with different YOLO confidence thresholds...`);
  
  // Import the config to modify it
  const faceDetection = require('./src/vision/faceDetection.js');
  const originalThreshold = faceDetection.FACE_DETECTION_CONFIG.YOLO_CONFIDENCE_THRESHOLD;
  
  const thresholds = [0.3, 0.4, 0.5, 0.6, 0.7];
  
  for (const threshold of thresholds) {
    console.log(`\n[DirectTest] Testing with confidence threshold: ${threshold}`);
    
    // Modify the threshold temporarily
    faceDetection.FACE_DETECTION_CONFIG.YOLO_CONFIDENCE_THRESHOLD = threshold;
    
    try {
      const faces = await testDirectFaceDetection(imagePath);
      console.log(`[DirectTest] Threshold ${threshold}: Found ${faces.length} faces`);
    } catch (error) {
      console.error(`[DirectTest] Threshold ${threshold}: Error - ${error.message}`);
    }
  }
  
  // Restore original threshold
  faceDetection.FACE_DETECTION_CONFIG.YOLO_CONFIDENCE_THRESHOLD = originalThreshold;
}

async function main() {
  const imagePath = process.argv[2];
  
  if (!imagePath) {
    console.log('Usage: node test-direct-face-detection.js <image-path>');
    console.log('Example: node test-direct-face-detection.js cache/20250609_091819362_iOS.jpg');
    process.exit(1);
  }
  
  if (!fs.existsSync(imagePath)) {
    console.error(`Image file not found: ${imagePath}`);
    process.exit(1);
  }
  
  try {
    // Test direct face detection
    await testDirectFaceDetection(imagePath);
    
    // Test with different thresholds
    await testWithDifferentThresholds(imagePath);
    
  } catch (error) {
    console.error('Test failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
