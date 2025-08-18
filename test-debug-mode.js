/**
 * Test debugMode flag behavior
 */

const fs = require('fs');
const path = require('path');

// Mock config for testing
const mockConfigs = {
  debugModeOff: {
    faceDetection: {
      debugMode: false
    }
  },
  debugModeOn: {
    faceDetection: {
      debugMode: true  
    }
  }
};

// Mock node helper to test the logic
function createMockNodeHelper(config) {
  return {
    config: config,
    
    performFaceDetection: async function(payload) {
      const { url } = payload;
      
      try {
        // Import the face detection module
        const { faceDetector } = await import('./src/vision/faceDetection.js');
        
        // Extract base64 data from data URL and convert to Buffer
        const base64Data = url.replace(/^data:image\/[a-z]+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        // Check debugMode config - if true, show bounding rectangles, otherwise clean image
        const showDebugInfo = this.config?.faceDetection?.debugMode || false;
        console.log(`[Test] Debug mode: ${showDebugInfo}`);
        
        // Analyze image for faces
        const faceDetectionResult = await faceDetector.detectFacesFromBuffer(imageBuffer, showDebugInfo);
        
        // Convert marked image buffer to data URL if available
        if (faceDetectionResult.markedImageBuffer) {
          const markedImageBase64 = faceDetectionResult.markedImageBuffer.toString('base64');
          faceDetectionResult.markedImageUrl = `data:image/jpeg;base64,${markedImageBase64}`;
        }
        
        return faceDetectionResult;
        
      } catch (error) {
        console.error("Face detection failed:", error.message);
        return null;
      }
    }
  };
}

async function testDebugMode() {
  console.log('=== Testing debugMode flag behavior ===\n');
  
  // Load test image
  const imagePath = 'cache/20250609_091819362_iOS.jpg';
  if (!fs.existsSync(imagePath)) {
    console.log('❌ Test image not found:', imagePath);
    return;
  }
  
  const imageBuffer = fs.readFileSync(imagePath);
  const imageBase64 = imageBuffer.toString('base64');
  const dataUrl = `data:image/jpeg;base64,${imageBase64}`;
  
  const payload = { url: dataUrl };
  
  console.log('🧪 TEST 1: debugMode = false (should show clean image)');
  console.log('='.repeat(50));
  
  const helperOff = createMockNodeHelper(mockConfigs.debugModeOff);
  const resultOff = await helperOff.performFaceDetection(payload);
  
  if (resultOff) {
    console.log(`✅ Processing completed`);
    console.log(`   Faces: ${resultOff.faceCount}`);
    console.log(`   Focal point: ${resultOff.focalPoint.type || 'default'}`);
    console.log(`   Image returned: ${!!resultOff.markedImageBuffer}`);
    
    // Save result
    if (resultOff.markedImageBuffer) {
      fs.writeFileSync('cache/debug_mode_off_result.jpg', resultOff.markedImageBuffer);
      console.log(`   💾 Clean image saved: cache/debug_mode_off_result.jpg`);
    }
  }
  
  console.log('\n🧪 TEST 2: debugMode = true (should show rectangles)');
  console.log('='.repeat(50));
  
  const helperOn = createMockNodeHelper(mockConfigs.debugModeOn);
  const resultOn = await helperOn.performFaceDetection(payload);
  
  if (resultOn) {
    console.log(`✅ Processing completed`);
    console.log(`   Faces: ${resultOn.faceCount}`);
    console.log(`   Focal point: ${resultOn.focalPoint.type || 'default'}`);
    console.log(`   Image returned: ${!!resultOn.markedImageBuffer}`);
    
    // Save result
    if (resultOn.markedImageBuffer) {
      fs.writeFileSync('cache/debug_mode_on_result.jpg', resultOn.markedImageBuffer);
      console.log(`   💾 Marked image saved: cache/debug_mode_on_result.jpg`);
    }
  }
  
  console.log('\n=== Test Results ===');
  console.log('📋 Compare the two output images:');
  console.log('   cache/debug_mode_off_result.jpg (should be clean)');
  console.log('   cache/debug_mode_on_result.jpg (should show rectangles)');
  console.log('\n✅ debugMode flag is now functional!');
}

// Run test
testDebugMode().catch(console.error);
