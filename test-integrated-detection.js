/**
 * Test the integrated Face Detection + Interest Detection system
 */

const fs = require('fs');
const path = require('path');
const { FaceDetector } = require('./src/vision/faceDetection');

async function testIntegratedDetection(imagePath) {
  console.log('=== Integrated Face + Interest Detection Test ===\n');
  
  try {
    // Load test image
    const imageBuffer = fs.readFileSync(imagePath);
    console.log(`Loading: ${imagePath} (${imageBuffer.length} bytes)\n`);
    
    // Initialize detector
    const detector = new FaceDetector();
    
    // Run detection
    const startTime = Date.now();
    const result = await detector.detectFacesFromBuffer(imageBuffer, true);
    const totalTime = Date.now() - startTime;
    
    console.log('\n=== DETECTION RESULTS ===');
    console.log(`Total processing time: ${totalTime}ms`);
    console.log(`Face detection time: ${result.processingTime}ms`);
    
    if (result.faceCount > 0) {
      console.log(`✅ Found ${result.faceCount} face(s)`);
      result.faces.forEach((face, i) => {
        console.log(`   Face ${i + 1}: ${face.width}x${face.height} at (${face.x}, ${face.y}) - confidence: ${face.confidence.toFixed(3)}`);
      });
    } else {
      console.log(`❌ No faces detected`);
    }
    
    console.log('\n=== FOCAL POINT ===');
    console.log(`Type: ${result.focalPoint.type || 'default'}`);
    console.log(`Position: ${(result.focalPoint.x * 100).toFixed(1)}%, ${(result.focalPoint.y * 100).toFixed(1)}%`);
    console.log(`Size: ${(result.focalPoint.width * 100).toFixed(1)}% x ${(result.focalPoint.height * 100).toFixed(1)}%`);
    
    if (result.focalPoint.method) {
      console.log(`Method: ${result.focalPoint.method}`);
      console.log(`Score: ${result.focalPoint.score?.toFixed(1)}`);
      console.log(`Confidence: ${result.focalPoint.confidence?.toFixed(3)}`);
      console.log(`Interest detection time: ${result.focalPoint.processingTime}ms`);
    }
    
    // Save result image
    if (result.markedImageBuffer) {
      const outputPath = path.join(__dirname, 'cache', 'integrated_detection_result.jpg');
      fs.writeFileSync(outputPath, result.markedImageBuffer);
      console.log(`\n💾 Result image saved: ${outputPath}`);
    }
    
    console.log('\n🎯 Color Legend:');
    console.log('   🟢 Green rectangles = Individual faces');
    console.log('   🔴 Red rectangle = Face-based focal area');
    console.log('   🟠 Orange rectangle = Interest-based focal area');
    console.log('   ⬜ Gray rectangle = Default center fallback');
    
    return result;
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return null;
  }
}

// Test with different types of images
async function runTests() {
  console.log('🧪 Testing integrated detection system...\n');
  
  // Test 1: Image with faces
  console.log('='.repeat(60));
  console.log('TEST 1: Image with faces (should use face detection)');
  console.log('='.repeat(60));
  const result1 = await testIntegratedDetection('cache/20250609_091819362_iOS.jpg');
  
  // Test 2: Image with no faces (should use interest detection)
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: Image with no faces (should use interest detection)');
  console.log('='.repeat(60));
  const result2 = await testIntegratedDetection('cache/20250610_090934992_iOS.jpg');
  
  console.log('\n🎉 All tests completed!');
  
  // Summary
  console.log('\n=== SUMMARY ===');
  if (result1) {
    console.log(`Test 1: ${result1.faceCount} faces → ${result1.focalPoint.type} focal point`);
  }
  if (result2) {
    console.log(`Test 2: ${result2.faceCount} faces → ${result2.focalPoint.type} focal point`);
  }
}

// Run if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testIntegratedDetection };
