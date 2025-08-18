const cv = require('@u4/opencv4nodejs');
const path = require('path');

async function investigateDetectionOut() {
  console.log('🔍 Investigating detection_out Layer Issue');
  console.log('==========================================');
  
  try {
    // Load model
    const modelPath = path.join(__dirname, 'models', 'opencv_face_detector_uint8.pb');
    const configPath = path.join(__dirname, 'models', 'opencv_face_detector.pbtxt');
    const net = cv.readNetFromTensorflow(modelPath, configPath);
    
    console.log('✅ Model loaded');
    console.log(`OpenCV version: ${cv.version.major}.${cv.version.minor}.${cv.version.revision}`);
    
    // Test image
    const imagePath = path.join(__dirname, 'images', 'screenshot.jpg');
    const image = cv.imread(imagePath);
    console.log(`📸 Image: ${image.cols}x${image.rows}`);
    
    // Get layer information
    console.log('\n🧠 Network layer analysis:');
    try {
      const layerNames = net.getLayerNames();
      console.log(`   Total layers: ${layerNames.length}`);
      console.log(`   Last few layers: ${layerNames.slice(-5)}`);
      
      const unconnected = net.getUnconnectedOutLayers();
      console.log(`   Unconnected output layers: [${unconnected.join(', ')}]`);
      
      const unconnectedNames = net.getUnconnectedOutLayersNames();
      console.log(`   Unconnected layer names: [${unconnectedNames.join(', ')}]`);
      
    } catch (error) {
      console.log(`   Layer info failed: ${error.message}`);
    }
    
    // Test 1: Default forward (should use detection_out as final layer)
    console.log('\n🎯 Test 1: Default forward()');
    const blob1 = cv.blobFromImage(image, 1.0, new cv.Size(300, 300), new cv.Vec3(104, 117, 123), false, false);
    net.setInput(blob1);
    
    const defaultOutput = net.forward();
    console.log(`   Default output shape: [${defaultOutput.sizes.join('x')}]`);
    
    // Check for non-zero values
    let maxConf = 0;
    let nonZeroCount = 0;
    const detectionCount = defaultOutput.sizes[2];
    
    for (let i = 0; i < detectionCount; i++) {
      const conf = defaultOutput.at(0, 0, i, 2);
      if (conf > 0) nonZeroCount++;
      if (conf > maxConf) maxConf = conf;
    }
    
    console.log(`   Detections with non-zero confidence: ${nonZeroCount}/${detectionCount}`);
    console.log(`   Max confidence: ${maxConf.toFixed(6)}`);
    
    // Test 2: Explicit detection_out layer
    console.log('\n🎯 Test 2: Explicit detection_out forward');
    net.setInput(blob1);
    
    try {
      const detectionOutput = net.forward('detection_out');
      console.log(`   detection_out shape: [${detectionOutput.sizes.join('x')}]`);
      
      let maxConf2 = 0;
      let nonZeroCount2 = 0;
      const detectionCount2 = detectionOutput.sizes[2];
      
      for (let i = 0; i < detectionCount2; i++) {
        const conf = detectionOutput.at(0, 0, i, 2);
        if (conf > 0) nonZeroCount2++;
        if (conf > maxConf2) maxConf2 = conf;
      }
      
      console.log(`   Detections with non-zero confidence: ${nonZeroCount2}/${detectionCount2}`);
      console.log(`   Max confidence: ${maxConf2.toFixed(6)}`);
      
    } catch (error) {
      console.log(`   Explicit detection_out failed: ${error.message}`);
    }
    
    // Test 3: Different blob parameters (match Python exactly)
    console.log('\n🎯 Test 3: Python-style blob parameters');
    
    // Try Python parameters: scalefactor=1.0, mean=(104, 117, 123), swapRB=False, crop=False
    const blob2 = cv.blobFromImage(image, 1.0, new cv.Size(300, 300), new cv.Vec3(104, 117, 123), false, false);
    net.setInput(blob2);
    
    const pythonStyleOutput = net.forward();
    console.log(`   Python-style output shape: [${pythonStyleOutput.sizes.join('x')}]`);
    
    let maxConf3 = 0;
    let nonZeroCount3 = 0;
    
    for (let i = 0; i < pythonStyleOutput.sizes[2]; i++) {
      const conf = pythonStyleOutput.at(0, 0, i, 2);
      if (conf > 0) nonZeroCount3++;
      if (conf > maxConf3) maxConf3 = conf;
    }
    
    console.log(`   Detections with non-zero confidence: ${nonZeroCount3}/${pythonStyleOutput.sizes[2]}`);
    console.log(`   Max confidence: ${maxConf3.toFixed(6)}`);
    
    // Test 4: Check raw intermediate layers
    console.log('\n🎯 Test 4: Raw intermediate layers');
    net.setInput(blob2);
    
    const rawOutputs = net.forward(['mbox_conf', 'mbox_loc']);
    const confLayer = rawOutputs[0];
    const locLayer = rawOutputs[1];
    
    console.log(`   mbox_conf shape: [${confLayer.sizes.join('x')}]`);
    console.log(`   mbox_loc shape: [${locLayer.sizes.join('x')}]`);
    
    // Check if raw layers have data
    let confMax = 0, confMin = 0;
    let locMax = 0, locMin = 0;
    
    // Sample a few values
    for (let i = 0; i < Math.min(100, confLayer.sizes[1]); i++) {
      const val = confLayer.at(0, i);
      if (val > confMax) confMax = val;
      if (val < confMin) confMin = val;
    }
    
    for (let i = 0; i < Math.min(100, locLayer.sizes[1]); i++) {
      const val = locLayer.at(0, i);
      if (val > locMax) locMax = val;
      if (val < locMin) locMin = val;
    }
    
    console.log(`   mbox_conf range: ${confMin.toFixed(6)} to ${confMax.toFixed(6)}`);
    console.log(`   mbox_loc range: ${locMin.toFixed(6)} to ${locMax.toFixed(6)}`);
    
    // Test 5: Try multiple forward passes with reset
    console.log('\n🎯 Test 5: Fresh network forward');
    
    // Create a completely fresh blob and network call
    const freshBlob = cv.blobFromImage(image, 1.0, new cv.Size(300, 300), new cv.Vec3(104, 117, 123), false, false);
    net.setInput(freshBlob);
    
    // Single forward call
    const freshOutput = net.forward();
    
    console.log(`   Fresh output shape: [${freshOutput.sizes.join('x')}]`);
    
    // Check all detections
    let validDetections = [];
    for (let i = 0; i < freshOutput.sizes[2]; i++) {
      const conf = freshOutput.at(0, 0, i, 2);
      const classId = freshOutput.at(0, 0, i, 1);
      
      if (conf > 0.01) {  // Very low threshold
        validDetections.push({
          index: i,
          classId: classId,
          confidence: conf,
          x1: freshOutput.at(0, 0, i, 3),
          y1: freshOutput.at(0, 0, i, 4),
          x2: freshOutput.at(0, 0, i, 5),
          y2: freshOutput.at(0, 0, i, 6)
        });
      }
    }
    
    console.log(`   Valid detections (>0.01): ${validDetections.length}`);
    if (validDetections.length > 0) {
      console.log(`   Top detection: conf=${validDetections[0].confidence.toFixed(6)}, class=${validDetections[0].classId}`);
    }
    
    // Summary and analysis
    console.log('\n📋 Summary:');
    console.log(`   Raw mbox_conf/mbox_loc: ${confMax > 0 ? 'Has data' : 'No data'}`);
    console.log(`   detection_out layer: ${maxConf > 0 ? 'Has data' : 'All zeros'}`);
    console.log(`   Valid detections found: ${validDetections.length}`);
    
    if (maxConf === 0 && confMax > 0) {
      console.log('\n🚨 ISSUE IDENTIFIED:');
      console.log('   ✅ Raw layers (mbox_conf, mbox_loc) contain data');
      console.log('   ❌ detection_out layer returns all zeros');
      console.log('   💡 This suggests the post-processing/NMS layer is not working in opencv4nodejs');
      console.log('   📝 SOLUTION: Use raw outputs and implement post-processing manually');
    } else if (maxConf > 0) {
      console.log('\n✅ SUCCESS: detection_out layer is working!');
      console.log(`   Max confidence: ${maxConf.toFixed(6)}`);
    } else {
      console.log('\n❌ FAILURE: Neither raw nor processed outputs contain data');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

if (require.main === module) {
  investigateDetectionOut();
}

module.exports = { investigateDetectionOut };
