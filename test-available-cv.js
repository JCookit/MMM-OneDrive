/**
 * Test Available OpenCV Computer Vision Methods
 * Works with limited OpenCV builds - finds what's actually available
 */

const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

console.log('=== Testing Available CV Methods ===');
console.log(`OpenCV version info: ${JSON.stringify(cv.version, null, 2)}`);
console.log('');

async function testAvailableMethods(imagePath) {
  if (!fs.existsSync(imagePath)) {
    console.log('❌ Test image not found.');
    return;
  }

  console.log(`Loading test image: ${imagePath}`);
  const image = cv.imread(imagePath);
  const gray = image.bgrToGray();
  console.log(`Image dimensions: ${image.cols}x${image.rows}`);
  console.log('');

  // Test what methods are actually available
  const results = {};

  // Test 1: goodFeaturesToTrack (we know this works)
  console.log('1. Testing goodFeaturesToTrack...');
  try {
    const startTime = Date.now();
    const corners = cv.goodFeaturesToTrack(gray, 100, 0.01, 10);
    const processingTime = Date.now() - startTime;
    console.log(`  ✅ Found ${corners.length} features in ${processingTime}ms`);
    results.goodFeaturesToTrack = { available: true, time: processingTime, count: corners.length };
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
    results.goodFeaturesToTrack = { available: false };
  }

  // Test 2: Try different Canny syntax
  console.log('2. Testing Canny edge detection variants...');
  
  try {
    const startTime = Date.now();
    const edges = gray.canny(100, 200);
    const processingTime = Date.now() - startTime;
    console.log(`  ✅ gray.canny() worked in ${processingTime}ms`);
    cv.imwrite(path.join(__dirname, 'cache', 'edges_canny_method1.jpg'), edges);
    results.canny = { available: true, method: 'gray.canny()', time: processingTime };
  } catch (error) {
    console.log(`  ❌ gray.canny() failed: ${error.message}`);
    
    try {
      const startTime = Date.now();
      const edges = cv.canny(gray, 100, 200);
      const processingTime = Date.now() - startTime;
      console.log(`  ✅ cv.canny() worked in ${processingTime}ms`);
      cv.imwrite(path.join(__dirname, 'cache', 'edges_canny_method2.jpg'), edges);
      results.canny = { available: true, method: 'cv.canny()', time: processingTime };
    } catch (error2) {
      console.log(`  ❌ cv.canny() also failed: ${error2.message}`);
      results.canny = { available: false };
    }
  }

  // Test 3: Alternative corner detection methods
  console.log('3. Testing corner detection variants...');
  
  // Try different cornerHarris syntax
  try {
    const startTime = Date.now();
    const corners = gray.cornerHarris(2, 3, 0.04);
    const processingTime = Date.now() - startTime;
    console.log(`  ✅ gray.cornerHarris() worked in ${processingTime}ms`);
    let cornerDisplay = new cv.Mat();
    corners.convertTo(cornerDisplay, cv.CV_8UC1, 255);
    cv.imwrite(path.join(__dirname, 'cache', 'corners_harris_method1.jpg'), cornerDisplay);
    results.cornerHarris = { available: true, method: 'gray.cornerHarris()', time: processingTime };
  } catch (error) {
    console.log(`  ❌ gray.cornerHarris() failed: ${error.message}`);
    results.cornerHarris = { available: false };
  }

  // Test 4: Morphological operations for interest detection
  console.log('4. Testing morphological operations...');
  try {
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(15, 15));
    const startTime = Date.now();
    const tophat = gray.morphologyEx(kernel, cv.MORPH_TOPHAT);
    const processingTime = Date.now() - startTime;
    console.log(`  ✅ Top-hat transform worked in ${processingTime}ms`);
    cv.imwrite(path.join(__dirname, 'cache', 'tophat_transform.jpg'), tophat);
    results.tophat = { available: true, time: processingTime };
  } catch (error) {
    console.log(`  ❌ Morphological operations failed: ${error.message}`);
    results.tophat = { available: false };
  }

  // Test 5: Histogram-based interest detection
  console.log('5. Testing histogram operations...');
  try {
    const startTime = Date.now();
    // Simple brightness/contrast analysis
    const mean = gray.mean();
    const std = gray.meanStdDev();
    const processingTime = Date.now() - startTime;
    console.log(`  ✅ Histogram stats: mean=${mean[0].toFixed(2)}, std=${std.stddev[0].toFixed(2)} (${processingTime}ms)`);
    results.histogram = { available: true, mean: mean[0], std: std.stddev[0], time: processingTime };
  } catch (error) {
    console.log(`  ❌ Histogram operations failed: ${error.message}`);
    results.histogram = { available: false };
  }

  // Test 6: Template matching (for finding specific patterns)
  console.log('6. Testing template matching capability...');
  try {
    // Create a small template from the image itself
    const template = gray.getRegion(new cv.Rect(100, 100, 50, 50));
    const startTime = Date.now();
    const match = gray.matchTemplate(template, cv.TM_CCOEFF_NORMED);
    const processingTime = Date.now() - startTime;
    console.log(`  ✅ Template matching worked in ${processingTime}ms`);
    results.templateMatching = { available: true, time: processingTime };
  } catch (error) {
    console.log(`  ❌ Template matching failed: ${error.message}`);
    results.templateMatching = { available: false };
  }

  console.log('\n=== SUMMARY ===');
  console.log('Available methods for interest point detection:');
  Object.entries(results).forEach(([method, result]) => {
    if (result.available) {
      console.log(`✅ ${method}: ${result.time}ms${result.count ? ` (found ${result.count} points)` : ''}`);
    } else {
      console.log(`❌ ${method}: Not available`);
    }
  });

  return results;
}

// Run the test
const testImagePath = process.argv[2] || 'cache/20250609_091819362_iOS.jpg';
testAvailableMethods(testImagePath).catch(console.error);
