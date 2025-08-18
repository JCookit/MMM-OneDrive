const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

console.log('=== Checking if Left Side Coverage is Possible ===\n');

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
const numAnchors = confidences.sizes[1] / 2;

console.log(`Total anchors: ${numAnchors}`);

// Quick analysis: Check confidence distribution across different anchor ranges
const ranges = [
    { name: 'First 1000 anchors (top-left region)', start: 0, end: 1000 },
    { name: 'Middle 1000 anchors (center region)', start: 3000, end: 4000 },
    { name: 'Anchors 6000-7000 (center-right)', start: 6000, end: 7000 },
    { name: 'Last 1000 anchors (bottom-right)', start: numAnchors - 1000, end: numAnchors }
];

for (const range of ranges) {
    let highConfCount = 0;
    let maxConf = 0;
    
    for (let i = range.start; i < range.end; i++) {
        const bgConf = confidences.at(0, i * 2);
        const faceConf = confidences.at(0, i * 2 + 1);
        
        // Apply softmax
        const maxC = Math.max(bgConf, faceConf);
        const expBg = Math.exp(bgConf - maxC);
        const expFace = Math.exp(faceConf - maxC);
        const confidence = expFace / (expBg + expFace);
        
        if (confidence > 0.3) highConfCount++;
        if (confidence > maxConf) maxConf = confidence;
    }
    
    console.log(`${range.name}:`);
    console.log(`  High confidence (>30%): ${highConfCount} detections`);
    console.log(`  Max confidence: ${(maxConf * 100).toFixed(1)}%\n`);
}

// Check if we have ANY confident detections in the first quarter of anchors
let earlyHighConf = 0;
let lateHighConf = 0;

for (let i = 0; i < numAnchors; i++) {
    const bgConf = confidences.at(0, i * 2);
    const faceConf = confidences.at(0, i * 2 + 1);
    
    const maxC = Math.max(bgConf, faceConf);
    const expBg = Math.exp(bgConf - maxC);
    const expFace = Math.exp(faceConf - maxC);
    const confidence = expFace / (expBg + expFace);
    
    if (confidence > 0.5) {
        if (i < numAnchors / 2) {
            earlyHighConf++;
        } else {
            lateHighConf++;
        }
    }
}

console.log('=== Distribution Analysis ===');
console.log(`High confidence in first half of anchors: ${earlyHighConf}`);
console.log(`High confidence in second half of anchors: ${lateHighConf}`);

if (earlyHighConf > 0) {
    console.log('\n✓ FIXABLE: We have confident detections in early anchors');
    console.log('The issue is likely in our coordinate decoding or filtering logic');
} else {
    console.log('\n⚠ FUNDAMENTAL LIMITATION: No confident detections in early anchor regions');
    console.log('This suggests the model itself is not detecting the left face');
}

// Test if lowering threshold helps
let veryLowThresholdCount = 0;
for (let i = 0; i < numAnchors / 2; i++) {
    const bgConf = confidences.at(0, i * 2);
    const faceConf = confidences.at(0, i * 2 + 1);
    
    const maxC = Math.max(bgConf, faceConf);
    const expBg = Math.exp(bgConf - maxC);
    const expFace = Math.exp(faceConf - maxC);
    const confidence = expFace / (expBg + expFace);
    
    if (confidence > 0.1) veryLowThresholdCount++;
}

console.log(`\nWith 10% threshold in first half: ${veryLowThresholdCount} detections`);

if (veryLowThresholdCount > 50) {
    console.log('✓ DEFINITELY FIXABLE: Many low-confidence detections available');
} else if (veryLowThresholdCount > 10) {
    console.log('? POSSIBLY FIXABLE: Some low-confidence detections available');
} else {
    console.log('✗ MODEL LIMITATION: Very few detections even at low threshold');
}
