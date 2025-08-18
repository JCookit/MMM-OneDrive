const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

console.log('=== Fixing SSD MobileNet Coordinate System ===\n');

// Load the test image
const testImagePath = path.join(__dirname, 'cache', 'improved_method_results.jpg');
if (!fs.existsSync(testImagePath)) {
    console.error('Test image not found!');
    process.exit(1);
}

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
const blob = cv.blobFromImage(img, 1.0, inputSize, new cv.Vec3(0, 0, 0), false, false);

// Set input and perform detection
net.setInput(blob);
const outputs = net.forward(['mbox_conf', 'mbox_loc']);

const confidences = outputs[0];
const locations = outputs[1];

// Get tensor data
const confData = confidences.getDataAsArray();
const locData = locations.getDataAsArray();

console.log(`Confidence tensor: ${confData.length} values`);
console.log(`Location tensor: ${locData.length} values`);

// SSD MobileNet anchor configuration for 300x300 input
// Based on the official SSD paper and MobileNet implementation
const anchorSpecs = [
    { feature_size: 19, min_size: 30, max_size: 60, aspect_ratios: [1, 2, 0.5] },
    { feature_size: 10, min_size: 60, max_size: 111, aspect_ratios: [1, 2, 0.5, 3, 1/3] },
    { feature_size: 5, min_size: 111, max_size: 162, aspect_ratios: [1, 2, 0.5, 3, 1/3] },
    { feature_size: 3, min_size: 162, max_size: 213, aspect_ratios: [1, 2, 0.5, 3, 1/3] },
    { feature_size: 2, min_size: 213, max_size: 264, aspect_ratios: [1, 2, 0.5] },
    { feature_size: 1, min_size: 264, max_size: 315, aspect_ratios: [1, 2, 0.5] }
];

// Generate anchors
function generateAnchors() {
    const anchors = [];
    
    for (const spec of anchorSpecs) {
        const { feature_size, min_size, max_size, aspect_ratios } = spec;
        const step = 300 / feature_size; // Step size for this layer
        
        for (let y = 0; y < feature_size; y++) {
            for (let x = 0; x < feature_size; x++) {
                // Center coordinates in the 300x300 space
                const cx = (x + 0.5) * step;
                const cy = (y + 0.5) * step;
                
                // For each aspect ratio
                for (const ratio of aspect_ratios) {
                    // Min size box
                    const w = min_size * Math.sqrt(ratio);
                    const h = min_size / Math.sqrt(ratio);
                    anchors.push({ cx, cy, w, h });
                    
                    // Max size box (only for ratio 1:1)
                    if (ratio === 1) {
                        const w_max = Math.sqrt(min_size * max_size);
                        const h_max = Math.sqrt(min_size * max_size);
                        anchors.push({ cx, cy, w: w_max, h: h_max });
                    }
                }
            }
        }
    }
    
    return anchors;
}

const anchors = generateAnchors();
console.log(`Generated ${anchors.length} anchors`);

// Decode detections using proper SSD anchor system
const detections = [];
const numAnchors = anchors.length;

for (let i = 0; i < numAnchors; i++) {
    // Get confidence for "face" class (index 1)
    const bgConf = confData[i * 2];     // Background
    const faceConf = confData[i * 2 + 1]; // Face
    
    // Apply softmax
    const maxConf = Math.max(bgConf, faceConf);
    const expBg = Math.exp(bgConf - maxConf);
    const expFace = Math.exp(faceConf - maxConf);
    const sum = expBg + expFace;
    const confidence = expFace / sum;
    
    if (confidence > 0.1) {
        // Get location deltas
        const dx = locData[i * 4];
        const dy = locData[i * 4 + 1];
        const dw = locData[i * 4 + 2];
        const dh = locData[i * 4 + 3];
        
        // Get corresponding anchor
        const anchor = anchors[i];
        
        // Decode location using SSD format
        // Center point regression
        const centerX = dx * anchor.w * 0.1 + anchor.cx; // variance[0] = 0.1
        const centerY = dy * anchor.h * 0.1 + anchor.cy; // variance[1] = 0.1
        
        // Size regression
        const width = anchor.w * Math.exp(dw * 0.2);    // variance[2] = 0.2
        const height = anchor.h * Math.exp(dh * 0.2);   // variance[3] = 0.2
        
        // Convert to image coordinates (scale from 300x300 to actual image)
        const scaleX = img.cols / 300;
        const scaleY = img.rows / 300;
        
        const x1 = (centerX - width / 2) * scaleX;
        const y1 = (centerY - height / 2) * scaleY;
        const x2 = (centerX + width / 2) * scaleX;
        const y2 = (centerY + height / 2) * scaleY;
        
        detections.push({
            confidence,
            x1: Math.max(0, x1),
            y1: Math.max(0, y1),
            x2: Math.min(img.cols, x2),
            y2: Math.min(img.rows, y2),
            centerX: centerX * scaleX,
            centerY: centerY * scaleY,
            width: width * scaleX,
            height: height * scaleY
        });
    }
}

console.log(`\nFound ${detections.length} candidate detections`);

// Sort by confidence
detections.sort((a, b) => b.confidence - a.confidence);

// Show top detections with spatial distribution
console.log('\n--- Top 10 Detections with Spatial Distribution ---');
detections.slice(0, 10).forEach((det, i) => {
    const w = Math.round(det.x2 - det.x1);
    const h = Math.round(det.y2 - det.y1);
    const aspectRatio = (w / h).toFixed(2);
    const leftSide = det.centerX < img.cols / 2 ? 'LEFT' : 'RIGHT';
    
    console.log(`${i + 1}: Conf ${(det.confidence * 100).toFixed(1)}% | ` +
               `Center(${Math.round(det.centerX)}, ${Math.round(det.centerY)}) | ` +
               `Size ${w}x${h} | Ratio ${aspectRatio} | ${leftSide} side`);
});

// Filter for reasonable face detections
const validDetections = detections.filter(det => {
    const w = det.x2 - det.x1;
    const h = det.y2 - det.y1;
    const aspectRatio = w / h;
    
    return det.confidence > 0.3 &&
           w > 50 && h > 50 &&
           w < img.cols * 0.8 && h < img.rows * 0.8 &&
           aspectRatio > 0.5 && aspectRatio < 2.0;
});

console.log(`\n--- ${validDetections.length} Valid Face Detections ---`);

// Check for left and right side coverage
let leftSideFaces = 0;
let rightSideFaces = 0;

validDetections.forEach((det, i) => {
    const w = Math.round(det.x2 - det.x1);
    const h = Math.round(det.y2 - det.y1);
    const aspectRatio = (w / h).toFixed(2);
    const side = det.centerX < img.cols / 2 ? 'LEFT' : 'RIGHT';
    
    if (det.centerX < img.cols / 2) {
        leftSideFaces++;
    } else {
        rightSideFaces++;
    }
    
    console.log(`${i + 1}: ${(det.confidence * 100).toFixed(1)}% confidence | ` +
               `Center(${Math.round(det.centerX)}, ${Math.round(det.centerY)}) | ` +
               `${w}x${h} | Ratio ${aspectRatio} | ${side} side`);
});

console.log(`\nSpatial distribution: ${leftSideFaces} left, ${rightSideFaces} right`);

// Create visualization
const result = img.copy();

// Draw all valid detections
validDetections.forEach((det, i) => {
    const color = i === 0 ? new cv.Vec3(0, 255, 0) : new cv.Vec3(255, 0, 0);
    const thickness = i === 0 ? 3 : 2;
    
    result.drawRectangle(
        new cv.Point2(det.x1, det.y1),
        new cv.Point2(det.x2, det.y2),
        color,
        thickness
    );
    
    // Add confidence label
    const label = `${(det.confidence * 100).toFixed(1)}%`;
    const labelPos = new cv.Point2(det.x1, det.y1 - 10);
    result.putText(label, labelPos, cv.FONT_HERSHEY_SIMPLEX, 0.8, color, 2);
});

// Save the result
cv.imwrite('fixed_coordinate_detection.jpg', result);
console.log('\n✓ Visualization saved: fixed_coordinate_detection.jpg');

console.log(`\nAnalysis complete. Found faces on both sides: ${leftSideFaces > 0 && rightSideFaces > 0}`);
