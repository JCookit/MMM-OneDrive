/**
 * Test Saliency Detection Capabilities in OpenCV4nodejs
 * Tests various saliency algorithms and fallback options
 */

const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

console.log('=== Testing Saliency Detection ===');
console.log(`OpenCV version: ${cv.version}`);
console.log('');

async function testSaliencyMethods(imagePath) {
  if (!fs.existsSync(imagePath)) {
    console.log('❌ Test image not found. Please provide a test image path.');
    return;
  }

  console.log(`Loading test image: ${imagePath}`);
  const image = cv.imread(imagePath);
  console.log(`Image dimensions: ${image.cols}x${image.rows}`);
  console.log('');

  // Test 1: Check if cv.saliency exists
  console.log('1. Testing cv.saliency availability...');
  if (typeof cv.saliency === 'function') {
    console.log('✅ cv.saliency function is available');
    
    // Test different saliency algorithms
    const algorithms = [
      'SPECTRAL_RESIDUAL',
      'FINE_GRAINED', 
      'BING',
      'BinWangApr2014'
    ];

    for (const algo of algorithms) {
      try {
        console.log(`\n  Testing ${algo}...`);
        const saliency = cv.saliency(algo);
        console.log(`  ✅ ${algo} saliency object created`);
        
        const startTime = Date.now();
        const saliencyMap = saliency.computeSaliency(image);
        const processingTime = Date.now() - startTime;
        
        console.log(`  ✅ ${algo} computed successfully in ${processingTime}ms`);
        console.log(`  📊 Saliency map: ${saliencyMap.cols}x${saliencyMap.rows} channels: ${saliencyMap.channels}`);
        
        // Save saliency map for inspection
        const outputPath = path.join(__dirname, 'cache', `saliency_${algo.toLowerCase()}.jpg`);
        
        // Convert to 8-bit for saving if needed
        let saveMap = saliencyMap;
        if (saliencyMap.type !== cv.CV_8UC1 && saliencyMap.type !== cv.CV_8UC3) {
          saveMap = new cv.Mat();
          saliencyMap.convertTo(saveMap, cv.CV_8UC1, 255);
        }
        
        cv.imwrite(outputPath, saveMap);
        console.log(`  💾 Saved saliency map: ${outputPath}`);
        
      } catch (error) {
        console.log(`  ❌ ${algo} failed: ${error.message}`);
      }
    }
    
  } else {
    console.log('❌ cv.saliency function not available');
  }

  // Test 2: Alternative fast interest point methods
  console.log('\n2. Testing alternative interest point detection...');
  
  try {
    console.log('  Testing cornerHarris...');
    const gray = image.bgrToGray();
    const startTime = Date.now();
    const corners = cv.cornerHarris(gray, 2, 3, 0.04);
    const processingTime = Date.now() - startTime;
    console.log(`  ✅ cornerHarris completed in ${processingTime}ms`);
    
    // Save corner detection result
    const cornerOutputPath = path.join(__dirname, 'cache', 'corners_harris.jpg');
    let cornerDisplay = new cv.Mat();
    corners.convertTo(cornerDisplay, cv.CV_8UC1, 255);
    cv.imwrite(cornerOutputPath, cornerDisplay);
    console.log(`  💾 Saved corner detection: ${cornerOutputPath}`);
    
  } catch (error) {
    console.log(`  ❌ cornerHarris failed: ${error.message}`);
  }

  try {
    console.log('  Testing goodFeaturesToTrack...');
    const gray = image.bgrToGray();
    const startTime = Date.now();
    const corners = cv.goodFeaturesToTrack(gray, 100, 0.01, 10);
    const processingTime = Date.now() - startTime;
    console.log(`  ✅ goodFeaturesToTrack found ${corners.length} features in ${processingTime}ms`);
    
    // Draw features on image
    const featureImage = image.copy();
    corners.forEach(corner => {
      featureImage.drawCircle(corner, 3, new cv.Vec3(0, 255, 0), 2);
    });
    
    const featureOutputPath = path.join(__dirname, 'cache', 'features_goodfeatures.jpg');
    cv.imwrite(featureOutputPath, featureImage);
    console.log(`  💾 Saved feature detection: ${featureOutputPath}`);
    
  } catch (error) {
    console.log(`  ❌ goodFeaturesToTrack failed: ${error.message}`);
  }

  // Test 3: Edge-based interest regions
  try {
    console.log('  Testing Canny edge detection...');
    const gray = image.bgrToGray();
    const startTime = Date.now();
    const edges = cv.canny(gray, 100, 200);
    const processingTime = Date.now() - startTime;
    console.log(`  ✅ Canny edge detection completed in ${processingTime}ms`);
    
    const edgeOutputPath = path.join(__dirname, 'cache', 'edges_canny.jpg');
    cv.imwrite(edgeOutputPath, edges);
    console.log(`  💾 Saved edge detection: ${edgeOutputPath}`);
    
  } catch (error) {
    console.log(`  ❌ Canny edge detection failed: ${error.message}`);
  }

  console.log('\n=== Test Complete ===');
  console.log('Check the cache/ folder for output images to evaluate results.');
}

// Check if image path provided as argument
const testImagePath = process.argv[2];
if (!testImagePath) {
  console.log('Usage: node test-saliency.js <path-to-test-image>');
  console.log('Example: node test-saliency.js ./cache/test_image.jpg');
  console.log('');
  console.log('Please provide a test image path and run again.');
  process.exit(1);
}

testSaliencyMethods(testImagePath).catch(console.error);
