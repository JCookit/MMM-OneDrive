const path = require('path');
const fs = require('fs');

// Test the complete face detection pipeline including rectangle burning
async function testCompleteSystem() {
  console.log('Testing complete face detection with rectangle burning...');
  
  try {
    const { faceDetector } = require('./src/vision/faceDetection.js');
    
    const testImagePath = path.join(__dirname, 'images', 'screenshot.jpg');
    console.log('Testing with image:', testImagePath);
    
    // First detect faces
    const result = await faceDetector.detectFaces(testImagePath, false);
    
    console.log('Face detection completed:', {
      faceCount: result.faces.length,
      processingTime: result.processingTime,
      focalPoint: result.focalPoint
    });
    
    if (result.faces.length > 0) {
      console.log('Detected faces:');
      result.faces.forEach((face, index) => {
        console.log(`  Face ${index + 1}: x=${face.x}, y=${face.y}, w=${face.width}, h=${face.height}, ratio=${face.aspectRatio.toFixed(2)}`);
      });
      
      // Now test the drawAllDetections method
      console.log('\nTesting rectangle burning...');
      
      // Load the image again for drawing
      const cv = require('@u4/opencv4nodejs');
      const sharp = require('sharp');
      
      // Load image properly through the detector's loadImage method
      const image = await faceDetector.loadImage(testImagePath);
      console.log(`Loaded image for drawing: ${image.cols}x${image.rows}`);
      
      // Draw all detections
      const markedImageBuffer = await faceDetector.drawAllDetections(image, result.faces, result.focalPoint);
      
      // Save the marked image
      const outputPath = path.join(__dirname, 'cache', 'test_all_rectangles.jpg');
      fs.writeFileSync(outputPath, markedImageBuffer);
      
      console.log(`✓ Marked image with ALL rectangles saved to: ${outputPath}`);
      console.log(`✓ File size: ${markedImageBuffer.length} bytes`);
      
    } else {
      console.log('No faces detected in the test image');
    }
    
    console.log('✓ Complete system test passed!');
    
  } catch (error) {
    console.error('✗ Test failed:', error);
    console.error('Error stack:', error.stack);
    process.exit(1);
  }
}

testCompleteSystem();
