#!/usr/bin/env node

const cv = require('@u4/opencv4nodejs');
const path = require('path');

async function exploreCoordinateDecoding() {
    console.log('=== Exploring Coordinate Decoding Approaches ===\n');
    
    const modelPath = path.join(__dirname, 'models', 'opencv_face_detector_uint8.pb');
    const configPath = path.join(__dirname, 'models', 'opencv_face_detector.pbtxt');
    const net = cv.readNetFromTensorflow(modelPath, configPath);
    
    const testImagePath = path.join(__dirname, 'cache', 'image_with_faces.jpg');
    const image = cv.imread(testImagePath);
    console.log(`✓ Test image loaded: ${image.rows}x${image.cols}`);
    
    const blob = cv.blobFromImage(image, 1.0, new cv.Size(300, 300), new cv.Vec3(104.0, 177.0, 123.0));
    net.setInput(blob);
    const outputs = net.forward(['mbox_conf', 'mbox_loc']);
    
    const mbox_conf = outputs[0];
    const mbox_loc = outputs[1];
    const numAnchors = Math.floor(mbox_conf.sizes[1] / 2);
    
    console.log(`Total anchors: ${numAnchors}`);
    console.log(`Grid size estimate: ${Math.sqrt(numAnchors / 6)} (assuming 6 anchor boxes per grid cell)\n`);
    
    // Test different coordinate decoding approaches
    const approaches = [
        {
            name: "Current: Center + offset",
            decode: (i, dx, dy, dw, dh, scale, baseSize) => {
                const centerX = 0.5 + dx * scale;
                const centerY = 0.5 + dy * scale;
                const width = Math.exp(dw * scale) * baseSize;
                const height = Math.exp(dh * scale) * baseSize;
                return { centerX, centerY, width, height };
            }
        },
        {
            name: "Grid-based approach",
            decode: (i, dx, dy, dw, dh, scale, baseSize) => {
                const gridSize = Math.sqrt(numAnchors / 6);
                const anchorX = (i % gridSize) / gridSize;
                const anchorY = Math.floor(i / gridSize) / gridSize;
                const centerX = anchorX + dx * scale;
                const centerY = anchorY + dy * scale;
                const width = Math.exp(dw * scale) * baseSize;
                const height = Math.exp(dh * scale) * baseSize;
                return { centerX, centerY, width, height };
            }
        },
        {
            name: "Raw coordinate mapping",
            decode: (i, dx, dy, dw, dh, scale, baseSize) => {
                // Try different grid sizes
                const gridSizes = [19, 38, 76]; // Common SSD grid sizes for 300x300 input
                let bestResult = null;
                
                for (const gridSize of gridSizes) {
                    if (i < gridSize * gridSize) {
                        const row = Math.floor(i / gridSize);
                        const col = i % gridSize;
                        const centerX = (col + 0.5 + dx) / gridSize;
                        const centerY = (row + 0.5 + dy) / gridSize;
                        const width = Math.exp(dw) * 0.1;
                        const height = Math.exp(dh) * 0.1;
                        
                        if (!bestResult || (centerX >= 0 && centerX <= 1 && centerY >= 0 && centerY <= 1)) {
                            bestResult = { centerX, centerY, width, height };
                        }
                    }
                }
                return bestResult || { centerX: 0.5, centerY: 0.5, width: 0.1, height: 0.1 };
            }
        }
    ];
    
    // Test each approach with high-confidence detections
    for (const approach of approaches) {
        console.log(`--- ${approach.name} ---`);
        const validDetections = [];
        
        // Get high confidence detections
        const highConfIndices = [];
        for (let i = 0; i < numAnchors; i++) {
            const backgroundConf = mbox_conf.at(0, i * 2 + 0);
            const faceConf = mbox_conf.at(0, i * 2 + 1);
            
            const expBg = Math.exp(backgroundConf);
            const expFace = Math.exp(faceConf);
            const sumExp = expBg + expFace;
            const faceConfidence = expFace / sumExp;
            
            if (faceConfidence > 0.8) {
                highConfIndices.push({ index: i, confidence: faceConfidence });
            }
        }
        
        // Sort by confidence
        highConfIndices.sort((a, b) => b.confidence - a.confidence);
        
        console.log(`Found ${highConfIndices.length} high-confidence detections (>80%)`);
        
        // Decode coordinates for top candidates
        for (const { index: i, confidence } of highConfIndices.slice(0, 10)) {
            const dx = mbox_loc.at(0, i * 4 + 0);
            const dy = mbox_loc.at(0, i * 4 + 1);
            const dw = mbox_loc.at(0, i * 4 + 2);
            const dh = mbox_loc.at(0, i * 4 + 3);
            
            const { centerX, centerY, width, height } = approach.decode(i, dx, dy, dw, dh, 0.1, 0.2);
            
            // Convert to pixel coordinates
            const x = Math.max(0, (centerX - width / 2) * image.cols);
            const y = Math.max(0, (centerY - height / 2) * image.rows);
            const w = Math.min(image.cols - x, width * image.cols);
            const h = Math.min(image.rows - y, height * image.rows);
            
            const pixelCenterX = centerX * image.cols;
            const pixelCenterY = centerY * image.rows;
            
            if (w > 50 && h > 50 && w < image.cols && h < image.rows) {
                validDetections.push({
                    x: Math.round(x),
                    y: Math.round(y),
                    width: Math.round(w),
                    height: Math.round(h),
                    confidence: confidence,
                    centerX: Math.round(pixelCenterX),
                    centerY: Math.round(pixelCenterY),
                    index: i
                });
            }
        }
        
        console.log(`Valid detections: ${validDetections.length}`);
        validDetections.slice(0, 5).forEach((det, j) => {
            const leftSide = det.centerX < image.cols * 0.4 ? " ← LEFT SIDE!" : "";
            const rightSide = det.centerX > image.cols * 0.6 ? " ← RIGHT SIDE!" : "";
            console.log(`  ${j + 1}: Center(${det.centerX}, ${det.centerY}), Box(${det.x}, ${det.y}) ${det.width}x${det.height}, conf: ${(det.confidence * 100).toFixed(1)}%${leftSide}${rightSide}`);
        });
        console.log('');
    }
    
    // Test the most promising approach with visualization
    console.log('--- Creating visualization for Grid-based approach ---');
    const bestDetections = [];
    
    for (let i = 0; i < numAnchors; i++) {
        const backgroundConf = mbox_conf.at(0, i * 2 + 0);
        const faceConf = mbox_conf.at(0, i * 2 + 1);
        
        const expBg = Math.exp(backgroundConf);
        const expFace = Math.exp(faceConf);
        const sumExp = expBg + expFace;
        const faceConfidence = expFace / sumExp;
        
        if (faceConfidence > 0.7) {
            const dx = mbox_loc.at(0, i * 4 + 0);
            const dy = mbox_loc.at(0, i * 4 + 1);
            const dw = mbox_loc.at(0, i * 4 + 2);
            const dh = mbox_loc.at(0, i * 4 + 3);
            
            // Use grid-based approach
            const gridSize = Math.sqrt(numAnchors / 6);
            const anchorX = (i % gridSize) / gridSize;
            const anchorY = Math.floor(i / gridSize) / gridSize;
            const centerX = anchorX + dx * 0.1;
            const centerY = anchorY + dy * 0.1;
            const width = Math.exp(dw * 0.1) * 0.2;
            const height = Math.exp(dh * 0.1) * 0.2;
            
            const x = Math.max(0, (centerX - width / 2) * image.cols);
            const y = Math.max(0, (centerY - height / 2) * image.rows);
            const w = Math.min(image.cols - x, width * image.cols);
            const h = Math.min(image.rows - y, height * image.rows);
            
            if (w > 100 && h > 100 && w < image.cols * 0.8 && h < image.rows * 0.8) {
                const aspectRatio = w / h;
                if (aspectRatio >= 0.5 && aspectRatio <= 2.0) {
                    bestDetections.push({
                        x: Math.round(x),
                        y: Math.round(y),
                        width: Math.round(w),
                        height: Math.round(h),
                        confidence: faceConfidence,
                        centerX: Math.round(centerX * image.cols),
                        centerY: Math.round(centerY * image.rows)
                    });
                }
            }
        }
    }
    
    bestDetections.sort((a, b) => b.confidence - a.confidence);
    
    // Create visualization
    let resultImage = image.copy();
    const colors = [
        new cv.Vec3(0, 255, 0),    // Green
        new cv.Vec3(255, 0, 0),    // Red
        new cv.Vec3(0, 0, 255),    // Blue
        new cv.Vec3(255, 255, 0),  // Cyan
        new cv.Vec3(255, 0, 255),  // Magenta
        new cv.Vec3(0, 255, 255),  // Yellow
    ];
    
    bestDetections.slice(0, 6).forEach((det, i) => {
        const color = colors[i];
        const rect = new cv.Rect(det.x, det.y, det.width, det.height);
        resultImage.drawRectangle(rect, color, 3);
        
        const text = `#${i + 1}: ${(det.confidence * 100).toFixed(1)}%`;
        const textPos = new cv.Point2(det.x, det.y - 10);
        resultImage.putText(text, textPos, cv.FONT_HERSHEY_SIMPLEX, 0.8, color, 2);
        
        // Mark left vs right side
        const sideText = det.centerX < image.cols * 0.5 ? "LEFT" : "RIGHT";
        const sidePos = new cv.Point2(det.x, det.y + det.height + 25);
        resultImage.putText(sideText, sidePos, cv.FONT_HERSHEY_SIMPLEX, 0.6, color, 2);
    });
    
    const outputPath = path.join(__dirname, 'cache', 'coordinate_exploration_results.jpg');
    cv.imwrite(outputPath, resultImage);
    console.log(`✓ Visualization saved: ${path.basename(outputPath)}`);
}

exploreCoordinateDecoding().catch(console.error);
