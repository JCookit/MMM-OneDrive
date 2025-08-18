#!/usr/bin/env node

const cv = require('@u4/opencv4nodejs');
const path = require('path');

async function createManualExamination() {
    console.log('=== Creating Manual Examination Visualization ===\n');
    
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
    
    // Get the high-confidence detections using the working approach
    const highConfDetections = [];
    
    for (let i = 0; i < numAnchors; i++) {
        const backgroundConf = mbox_conf.at(0, i * 2 + 0);
        const faceConf = mbox_conf.at(0, i * 2 + 1);
        
        const expBg = Math.exp(backgroundConf);
        const expFace = Math.exp(faceConf);
        const sumExp = expBg + expFace;
        const faceConfidence = expFace / sumExp;
        
        if (faceConfidence > 0.98) { // Very high confidence only
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
            
            if (w > 50 && h > 50 && w < image.cols * 0.5 && h < image.rows * 0.5) {
                const aspectRatio = w / h;
                if (aspectRatio >= 0.5 && aspectRatio <= 2.0) {
                    highConfDetections.push({
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
    highConfDetections.sort((a, b) => b.confidence - a.confidence);
    
    console.log(`Found ${highConfDetections.length} detections with >98% confidence:`);
    highConfDetections.forEach((det, i) => {
        const sizePercent = ((det.width * det.height) / (image.rows * image.cols) * 100).toFixed(1);
        console.log(`  ${i + 1}: (${det.x}, ${det.y}) ${det.width}x${det.height}, conf: ${(det.confidence * 100).toFixed(1)}%, size: ${sizePercent}%, ratio: ${det.aspectRatio.toFixed(2)}, index: ${det.index}`);
    });
    
    // Create visualization with different colors for each detection
    let resultImage = image.copy();
    const colors = [
        new cv.Vec3(0, 255, 0),    // Green
        new cv.Vec3(255, 0, 0),    // Red  
        new cv.Vec3(0, 0, 255),    // Blue
        new cv.Vec3(255, 255, 0),  // Cyan
        new cv.Vec3(255, 0, 255)   // Magenta
    ];
    
    highConfDetections.forEach((det, i) => {
        const color = colors[i % colors.length];
        const rect = new cv.Rect(det.x, det.y, det.width, det.height);
        resultImage.drawRectangle(rect, color, 4);
        
        // Add detection number and confidence
        const text = `#${i + 1}: ${(det.confidence * 100).toFixed(1)}%`;
        const textPos = new cv.Point2(det.x, det.y - 10);
        resultImage.putText(text, textPos, cv.FONT_HERSHEY_SIMPLEX, 1.0, color, 2);
        
        // Add anchor index for debugging
        const indexText = `idx:${det.index}`;
        const indexPos = new cv.Point2(det.x, det.y + det.height + 25);
        resultImage.putText(indexText, indexPos, cv.FONT_HERSHEY_SIMPLEX, 0.6, color, 2);
    });
    
    // Save the visualization
    const outputPath = path.join(__dirname, 'cache', 'manual_examination_results.jpg');
    cv.imwrite(outputPath, resultImage);
    console.log(`\n✓ Manual examination visualization saved: ${path.basename(outputPath)}`);
    console.log('\nPlease examine this image to see:');
    console.log('- Which detections correspond to the 2 clear faces');
    console.log('- Whether any detections are false positives or duplicates');
    console.log('- The quality and positioning of each detection');
}

createManualExamination().catch(console.error);
