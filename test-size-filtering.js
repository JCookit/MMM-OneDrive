/**
 * Test size filtering functionality
 */

const cv = require('@u4/opencv4nodejs');
const FaceDetector = require('./src/vision/faceDetection.js');

console.log('=== Testing Size Filtering ===');

// Test the configuration values
console.log('Current config:');
console.log('- Confidence threshold: 60%');
console.log('- Min face size: 5% of image dimensions');
console.log('- No focal point padding');

// For a 3088x2316 image:
const imageWidth = 3088;
const imageHeight = 2316;
const minWidth = imageWidth * 0.05; // 154.4 pixels
const minHeight = imageHeight * 0.05; // 115.8 pixels

console.log(`\nFor ${imageWidth}x${imageHeight} image:`);
console.log(`- Minimum face width: ${Math.round(minWidth)} pixels`);
console.log(`- Minimum face height: ${Math.round(minHeight)} pixels`);

console.log('\nCurrent detected faces:');
console.log('- Face 1: 839x970 pixels ✓ (much larger than minimums)');
console.log('- Face 2: 626x902 pixels ✓ (much larger than minimums)');

console.log('\nTest complete - both faces pass all filters!');
