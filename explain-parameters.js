const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

console.log('=== Understanding Coordinate Parameters ===\n');

// Load the test image
const testImagePath = path.join(__dirname, 'cache', 'image_with_faces.jpg');
const img = cv.imread(testImagePath);
console.log(`✓ Test image loaded: ${img.cols}x${img.rows}`);

// Load the face detection model
const modelPath = path.join(__dirname, 'models', 'opencv_face_detector_uint8.pb');
const configPath = path.join(__dirname, 'models', 'opencv_face_detector.pbtxt');
const net = cv.readNetFromTensorflow(modelPath, configPath);
net.setPreferableBackend(cv.DNN_BACKEND_OPENCV);
net.setPreferableTarget(cv.DNN_TARGET_CPU);

// Create blob from image
const inputSize = new cv.Size(300, 300);
const blob = cv.blobFromImage(img, 1.0, inputSize, new cv.Vec3(104, 177, 123), false, false);

// Set input and perform detection
net.setInput(blob);
const outputs = net.forward(['mbox_conf', 'mbox_loc']);

const confidences = outputs[0];
const locations = outputs[1];

// Get tensor data
console.log(`Confidence tensor shape: [${confidences.sizes}]`);
console.log(`Location tensor shape: [${locations.sizes}]`);
console.log(`Total confidence values: ${confidences.sizes[1]}`);
console.log(`Total location values: ${locations.sizes[1]}`);

// Calculate number of anchors
const numAnchors = confidences.sizes[1] / 2; // 2 classes (bg, face)
console.log(`Number of anchors: ${numAnchors}`);

console.log('\n=== Parameter Breakdown ===');
console.log('For each detection candidate, we have:');
console.log('1. confidence: Probability this is a face (0-1)');
console.log('2. dx, dy: Center offset deltas from anchor center');
console.log('3. dw, dh: Width/height scaling factors (logarithmic)');
console.log('4. anchor.cx, anchor.cy: Anchor center position (in 300x300 space)');
console.log('5. anchor.w, anchor.h: Anchor width/height (in 300x300 space)');

// Show a few examples of the raw data
console.log('\n=== Raw Data Examples (first 5 anchors) ===');
for (let i = 0; i < Math.min(5, numAnchors); i++) {
    const bgConf = confidences.at(0, i * 2);
    const faceConf = confidences.at(0, i * 2 + 1);
    const dx = locations.at(0, i * 4);
    const dy = locations.at(0, i * 4 + 1);
    const dw = locations.at(0, i * 4 + 2);
    const dh = locations.at(0, i * 4 + 3);
    
    console.log(`Anchor ${i}:`);
    console.log(`  Raw confidences: bg=${bgConf.toFixed(3)}, face=${faceConf.toFixed(3)}`);
    console.log(`  Location deltas: dx=${dx.toFixed(3)}, dy=${dy.toFixed(3)}, dw=${dw.toFixed(3)}, dh=${dh.toFixed(3)}`);
}

// Find high confidence detections and show their parameters
console.log('\n=== High Confidence Detections ===');
const highConfDetections = [];

for (let i = 0; i < numAnchors; i++) {
    const bgConf = confidences.at(0, i * 2);
    const faceConf = confidences.at(0, i * 2 + 1);
    
    // Apply softmax
    const maxConf = Math.max(bgConf, faceConf);
    const expBg = Math.exp(bgConf - maxConf);
    const expFace = Math.exp(faceConf - maxConf);
    const sum = expBg + expFace;
    const confidence = expFace / sum;
    
    if (confidence > 0.5) {
        const dx = locations.at(0, i * 4);
        const dy = locations.at(0, i * 4 + 1);
        const dw = locations.at(0, i * 4 + 2);
        const dh = locations.at(0, i * 4 + 3);
        
        highConfDetections.push({ i, confidence, dx, dy, dw, dh });
    }
}

console.log(`Found ${highConfDetections.length} high-confidence detections (>50%)`);

// Show details for each high-confidence detection
highConfDetections.slice(0, 10).forEach((det, idx) => {
    console.log(`\nDetection ${idx + 1} (anchor ${det.i}):`);
    console.log(`  Confidence: ${(det.confidence * 100).toFixed(1)}%`);
    console.log(`  Parameters available:`);
    console.log(`    dx (center X offset): ${det.dx.toFixed(4)}`);
    console.log(`    dy (center Y offset): ${det.dy.toFixed(4)}`);
    console.log(`    dw (width scale): ${det.dw.toFixed(4)}`);
    console.log(`    dh (height scale): ${det.dh.toFixed(4)}`);
    console.log(`  These are the raw parameters you asked about!`);
});

console.log('\n=== Coordinate Decoding Explanation ===');
console.log('To get final coordinates, we:');
console.log('1. Generate anchor positions based on SSD grid');
console.log('2. Apply deltas: centerX = anchor.cx + dx * anchor.w * variance[0]');
console.log('3. Apply deltas: centerY = anchor.cy + dy * anchor.h * variance[1]'); 
console.log('4. Scale sizes: width = anchor.w * exp(dw * variance[2])');
console.log('5. Scale sizes: height = anchor.h * exp(dh * variance[3])');
console.log('6. Convert from 300x300 space to actual image size');
console.log('\nThe "ratio" you mentioned is width/height after decoding');
console.log('The "center" you mentioned is (centerX, centerY) after decoding');
