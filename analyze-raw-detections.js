#!/usr/bin/env node

const cv = require('@u4/opencv4nodejs');
const path = require('path');

async function analyzeRawDetections() {
    console.log('=== Analyzing Raw Detection Data ===\n');
    
    // Load the model
    const modelPath = path.join(__dirname, 'models', 'opencv_face_detector_uint8.pb');
    const configPath = path.join(__dirname, 'models', 'opencv_face_detector.pbtxt');
    
    const net = cv.readNetFromTensorflow(modelPath, configPath);
    console.log('✓ Model loaded successfully');
    
    // Load the test image
    const testImagePath = path.join(__dirname, 'cache', 'image_with_faces.jpg');
    const image = cv.imread(testImagePath);
    console.log(`✓ Test image loaded: ${image.rows}x${image.cols}\n`);
    
    // Create blob and run inference
    const blob = cv.blobFromImage(image, 1.0, new cv.Size(300, 300), new cv.Vec3(104.0, 177.0, 123.0));
    net.setInput(blob);
    const outputs = net.forward(['mbox_conf', 'mbox_loc']);
    
    const mbox_conf = outputs[0];
    const mbox_loc = outputs[1];
    const numAnchors = Math.floor(mbox_conf.sizes[1] / 2);
    
    console.log(`Processing ${numAnchors} anchors\n`);
    
    // Analyze raw confidence distribution
    console.log('--- Raw Confidence Analysis ---');
    const rawConfidences = [];
    const softmaxConfidences = [];
    
    for (let i = 0; i < numAnchors; i++) {
        const backgroundConf = mbox_conf.at(0, i * 2 + 0);
        const faceConf = mbox_conf.at(0, i * 2 + 1);
        
        rawConfidences.push({ background: backgroundConf, face: faceConf, index: i });
        
        // Apply softmax
        const expBg = Math.exp(backgroundConf);
        const expFace = Math.exp(faceConf);
        const sumExp = expBg + expFace;
        const faceConfidence = expFace / sumExp;
        
        if (faceConfidence > 0.05) { // Very low threshold to see all possibilities
            softmaxConfidences.push({ confidence: faceConfidence, index: i });
        }
    }
    
    // Sort by raw face confidence
    rawConfidences.sort((a, b) => b.face - a.face);
    console.log('Top 10 raw face confidences:');
    rawConfidences.slice(0, 10).forEach((conf, i) => {
        console.log(`  ${i + 1}: Raw face=${conf.face.toFixed(3)}, bg=${conf.background.toFixed(3)}, index=${conf.index}`);
    });
    
    console.log('\n--- Softmax Confidence Analysis ---');
    softmaxConfidences.sort((a, b) => b.confidence - a.confidence);
    console.log(`Found ${softmaxConfidences.length} detections above 0.05 softmax confidence:`);
    softmaxConfidences.slice(0, 10).forEach((conf, i) => {
        console.log(`  ${i + 1}: Softmax=${conf.confidence.toFixed(3)}, index=${conf.index}`);
    });
    
    // Try alternative coordinate decoding approaches
    console.log('\n--- Testing Alternative Coordinate Decoding ---');
    
    const approaches = [
        { name: 'Current (scale=0.08, base=0.1)', scale: 0.08, baseSize: 0.1 },
        { name: 'Larger scale (scale=0.1, base=0.2)', scale: 0.1, baseSize: 0.2 },
        { name: 'Smaller scale (scale=0.05, base=0.05)', scale: 0.05, baseSize: 0.05 },
        { name: 'No grid offset (center=0.5)', scale: 0.1, baseSize: 0.2, noGrid: true },
    ];
    
    for (const approach of approaches) {
        console.log(`\n${approach.name}:`);
        const validDetections = [];
        
        // Use top 5 softmax confidence detections for testing
        for (const conf of softmaxConfidences.slice(0, 5)) {
            const i = conf.index;
            
            const dx = mbox_loc.at(0, i * 4 + 0) * approach.scale;
            const dy = mbox_loc.at(0, i * 4 + 1) * approach.scale;
            const dw = mbox_loc.at(0, i * 4 + 2) * approach.scale;
            const dh = mbox_loc.at(0, i * 4 + 3) * approach.scale;
            
            let centerX, centerY;
            if (approach.noGrid) {
                // Simple center approach
                centerX = 0.5 + dx;
                centerY = 0.5 + dy;
            } else {
                // Grid-based approach
                const gridSize = Math.sqrt(numAnchors / 6);
                const anchorX = (i % gridSize) / gridSize;
                const anchorY = Math.floor(i / gridSize) / gridSize;
                centerX = anchorX + dx;
                centerY = anchorY + dy;
            }
            
            const width = Math.exp(dw) * approach.baseSize;
            const height = Math.exp(dh) * approach.baseSize;
            
            const x = Math.max(0, (centerX - width / 2) * image.cols);
            const y = Math.max(0, (centerY - height / 2) * image.rows);
            const w = Math.min(image.cols - x, width * image.cols);
            const h = Math.min(image.rows - y, height * image.rows);
            
            // Check if detection is reasonable
            if (w > 50 && h > 50 && w < image.cols * 0.5 && h < image.rows * 0.5) {
                const aspectRatio = w / h;
                if (aspectRatio >= 0.5 && aspectRatio <= 2.0) { // Broader aspect ratio for testing
                    validDetections.push({
                        x: Math.round(x),
                        y: Math.round(y),
                        width: Math.round(w),
                        height: Math.round(h),
                        confidence: conf.confidence,
                        aspectRatio: aspectRatio
                    });
                }
            }
        }
        
        console.log(`  Valid detections: ${validDetections.length}`);
        validDetections.forEach((det, j) => {
            const sizePercent = ((det.width * det.height) / (image.rows * image.cols) * 100).toFixed(1);
            console.log(`    ${j + 1}: (${det.x}, ${det.y}) ${det.width}x${det.height}, conf: ${det.confidence.toFixed(3)}, size: ${sizePercent}%, ratio: ${det.aspectRatio.toFixed(2)}`);
        });
    }
}

analyzeRawDetections().catch(console.error);
