#!/usr/bin/env node

const cv = require('@u4/opencv4nodejs');
const path = require('path');

async function findSecondFace() {
    console.log('=== Finding the Second Face ===\n');
    
    // Load model and image
    const modelPath = path.join(__dirname, 'models', 'opencv_face_detector_uint8.pb');
    const configPath = path.join(__dirname, 'models', 'opencv_face_detector.pbtxt');
    const net = cv.readNetFromTensorflow(modelPath, configPath);
    
    const testImagePath = path.join(__dirname, 'cache', 'image_with_faces.jpg');
    const image = cv.imread(testImagePath);
    console.log(`✓ Test image loaded: ${image.rows}x${image.cols}`);
    
    // Run inference
    const blob = cv.blobFromImage(image, 1.0, new cv.Size(300, 300), new cv.Vec3(104.0, 177.0, 123.0));
    net.setInput(blob);
    const outputs = net.forward(['mbox_conf', 'mbox_loc']);
    
    const mbox_conf = outputs[0];
    const mbox_loc = outputs[1];
    const numAnchors = Math.floor(mbox_conf.sizes[1] / 2);
    
    // Get ALL detections and sort by confidence
    const allDetections = [];
    
    for (let i = 0; i < numAnchors; i++) {
        const backgroundConf = mbox_conf.at(0, i * 2 + 0);
        const faceConf = mbox_conf.at(0, i * 2 + 1);
        
        const expBg = Math.exp(backgroundConf);
        const expFace = Math.exp(faceConf);
        const sumExp = expBg + expFace;
        const faceConfidence = expFace / sumExp;
        
        if (faceConfidence > 0.5) { // Reasonable threshold
            // Use the "center=0.5" approach that worked
            const scale = 0.1;
            const baseSize = 0.2;
            
            const dx = mbox_loc.at(0, i * 4 + 0) * scale;
            const dy = mbox_loc.at(0, i * 4 + 1) * scale;
            const dw = mbox_loc.at(0, i * 4 + 2) * scale;
            const dh = mbox_loc.at(0, i * 4 + 3) * scale;
            
            const centerX = 0.5 + dx;
            const centerY = 0.5 + dy;
            const width = Math.exp(dw) * baseSize;
            const height = Math.exp(dh) * baseSize;
            
            const x = Math.max(0, (centerX - width / 2) * image.cols);
            const y = Math.max(0, (centerY - height / 2) * image.rows);
            const w = Math.min(image.cols - x, width * image.cols);
            const h = Math.min(image.rows - y, height * image.rows);
            
            if (w > 100 && h > 100 && w < image.cols * 0.7 && h < image.rows * 0.7) {
                const aspectRatio = w / h;
                if (aspectRatio >= 0.6 && aspectRatio <= 1.8) { // Face-like aspect ratios
                    allDetections.push({
                        x: Math.round(x),
                        y: Math.round(y),
                        width: Math.round(w),
                        height: Math.round(h),
                        confidence: faceConfidence,
                        aspectRatio: aspectRatio,
                        index: i
                    });
                }
            }
        }
    }
    
    // Sort by confidence
    allDetections.sort((a, b) => b.confidence - a.confidence);
    
    // Show top 15 candidates
    console.log(`Found ${allDetections.length} total candidates. Top 15:`);
    allDetections.slice(0, 15).forEach((det, i) => {
        const sizePercent = ((det.width * det.height) / (image.rows * image.cols) * 100).toFixed(1);
        const isGoodFace = det.index === 8254 ? ' ← KNOWN GOOD FACE' : '';
        console.log(`  ${i + 1}: (${det.x}, ${det.y}) ${det.width}x${det.height}, conf: ${(det.confidence * 100).toFixed(1)}%, size: ${sizePercent}%, ratio: ${det.aspectRatio.toFixed(2)}, idx: ${det.index}${isGoodFace}`);
    });
    
    // Create visualization showing top 10 candidates
    let resultImage = image.copy();
    const colors = [
        new cv.Vec3(0, 255, 0),      // Green - #1
        new cv.Vec3(255, 0, 0),      // Red - #2
        new cv.Vec3(0, 0, 255),      // Blue - #3 (known good)
        new cv.Vec3(255, 255, 0),    // Cyan - #4
        new cv.Vec3(255, 0, 255),    // Magenta - #5
        new cv.Vec3(0, 255, 255),    // Yellow - #6
        new cv.Vec3(128, 255, 128),  // Light Green - #7
        new cv.Vec3(255, 128, 128),  // Light Red - #8
        new cv.Vec3(128, 128, 255),  // Light Blue - #9
        new cv.Vec3(255, 255, 128)   // Light Yellow - #10
    ];
    
    allDetections.slice(0, 10).forEach((det, i) => {
        const color = colors[i % colors.length];
        const rect = new cv.Rect(det.x, det.y, det.width, det.height);
        
        // Use thicker line for the known good face
        const thickness = det.index === 8254 ? 6 : 3;
        resultImage.drawRectangle(rect, color, thickness);
        
        // Add detection number and confidence
        const text = `#${i + 1}: ${(det.confidence * 100).toFixed(1)}%`;
        const textPos = new cv.Point2(det.x, det.y - 10);
        resultImage.putText(text, textPos, cv.FONT_HERSHEY_SIMPLEX, 0.8, color, 2);
        
        // Mark the known good face
        if (det.index === 8254) {
            const goodText = 'GOOD';
            const goodPos = new cv.Point2(det.x, det.y + det.height + 25);
            resultImage.putText(goodText, goodPos, cv.FONT_HERSHEY_SIMPLEX, 1.0, color, 3);
        }
    });
    
    // Save the visualization
    const outputPath = path.join(__dirname, 'cache', 'find_second_face_results.jpg');
    cv.imwrite(outputPath, resultImage);
    console.log(`\n✓ Visualization saved: ${path.basename(outputPath)}`);
    console.log('\nPlease examine this image to identify which detection corresponds to the second clear face.');
    console.log('The blue box with thick border (#3) is the known good face you identified.');
}

findSecondFace().catch(console.error);
