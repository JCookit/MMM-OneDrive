#!/usr/bin/env node

const cv = require('@u4/opencv4nodejs');
const path = require('path');

async function testPreciseFaceDetection() {
    console.log('=== Testing Precise Face Detection ===\n');
    
    // Load the model
    const modelPath = path.join(__dirname, 'models', 'opencv_face_detector_uint8.pb');
    const configPath = path.join(__dirname, 'models', 'opencv_face_detector.pbtxt');
    
    let net;
    try {
        net = cv.readNetFromTensorflow(modelPath, configPath);
        console.log('✓ Model loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load model:', error.message);
        return;
    }
    
    // Load the test image
    const testImagePath = path.join(__dirname, 'cache', 'image_with_faces.jpg');
    let image;
    
    try {
        image = cv.imread(testImagePath);
        console.log(`✓ Test image loaded: ${image.rows}x${image.cols}`);
        console.log(`✓ This image should contain exactly 2 clear faces\n`);
    } catch (error) {
        console.error(`❌ Could not load test image: ${testImagePath}`);
        return;
    }
    
    // Create blob
    const blob = cv.blobFromImage(image, 1.0, new cv.Size(300, 300), new cv.Vec3(104.0, 177.0, 123.0));
    net.setInput(blob);
    
    // Run inference
    console.log('--- Running DNN inference ---');
    const start = Date.now();
    const outputs = net.forward(['mbox_conf', 'mbox_loc']);
    const inferenceTime = Date.now() - start;
    console.log(`Inference completed in ${inferenceTime}ms`);
    
    const mbox_conf = outputs[0];
    const mbox_loc = outputs[1];
    console.log(`mbox_conf shape: [${mbox_conf.sizes.join(', ')}]`);
    console.log(`mbox_loc shape: [${mbox_loc.sizes.join(', ')}]\n`);
    
    // Test multiple approaches to find the 2 clear faces
    await testDifferentApproaches(mbox_conf, mbox_loc, image);
    
    // Create visualization for the best approach
    await createBestVisualization(mbox_conf, mbox_loc, image);
}

async function testDifferentApproaches(mbox_conf, mbox_loc, image) {
    const approaches = [
        { name: 'High Confidence (0.5+)', threshold: 0.5 },
        { name: 'Medium-High Confidence (0.3+)', threshold: 0.3 },
        { name: 'Medium Confidence (0.2+)', threshold: 0.2 },
        { name: 'Low-Medium Confidence (0.15+)', threshold: 0.15 },
        { name: 'Current Approach (0.1+)', threshold: 0.1 }
    ];
    
    const numAnchors = Math.floor(mbox_conf.sizes[1] / 2);
    
    for (const approach of approaches) {
        console.log(`--- ${approach.name} ---`);
        const detections = [];
        
        for (let i = 0; i < numAnchors; i++) {
            // Get confidence scores and apply softmax
            const backgroundConf = mbox_conf.at(0, i * 2 + 0);
            const faceConf = mbox_conf.at(0, i * 2 + 1);
            
            const expBg = Math.exp(backgroundConf);
            const expFace = Math.exp(faceConf);
            const sumExp = expBg + expFace;
            const faceConfidence = expFace / sumExp;
            
            if (faceConfidence > approach.threshold) {
                // Apply improved coordinate processing
                const scale = 0.08;
                const dx = mbox_loc.at(0, i * 4 + 0) * scale;
                const dy = mbox_loc.at(0, i * 4 + 1) * scale;
                const dw = mbox_loc.at(0, i * 4 + 2) * scale;
                const dh = mbox_loc.at(0, i * 4 + 3) * scale;
                
                const gridSize = Math.sqrt(numAnchors / 6);
                const anchorX = (i % gridSize) / gridSize;
                const anchorY = Math.floor(i / gridSize) / gridSize;
                
                const centerX = anchorX + dx;
                const centerY = anchorY + dy;
                const width = Math.exp(dw) * 0.1;
                const height = Math.exp(dh) * 0.1;
                
                const x = Math.max(0, (centerX - width / 2) * image.cols);
                const y = Math.max(0, (centerY - height / 2) * image.rows);
                const w = Math.min(image.cols - x, width * image.cols);
                const h = Math.min(image.rows - y, height * image.rows);
                
                // Face aspect ratio filtering
                const aspectRatio = w / h;
                if (aspectRatio >= 0.7 && aspectRatio <= 1.4 && w > 50 && h > 50) {
                    detections.push({
                        x: Math.round(x),
                        y: Math.round(y),
                        width: Math.round(w),
                        height: Math.round(h),
                        confidence: faceConfidence,
                        aspectRatio: aspectRatio
                    });
                }
            }
        }
        
        // Sort by confidence
        detections.sort((a, b) => b.confidence - a.confidence);
        
        console.log(`Found ${detections.length} detections:`);
        detections.slice(0, 5).forEach((det, i) => {
            const sizePercent = ((det.width * det.height) / (image.rows * image.cols) * 100).toFixed(1);
            console.log(`  ${i + 1}: (${det.x}, ${det.y}) ${det.width}x${det.height}, conf: ${det.confidence.toFixed(3)}, size: ${sizePercent}%, ratio: ${det.aspectRatio.toFixed(2)}`);
        });
        
        // Check if this approach finds exactly 2 faces with high confidence
        const highConfDetections = detections.filter(d => d.confidence > 0.8);
        if (highConfDetections.length === 2) {
            console.log(`🎯 PERFECT! Found exactly 2 high-confidence faces!`);
        } else if (detections.length === 2) {
            console.log(`✓ Good! Found exactly 2 faces (may need confidence tuning)`);
        }
        console.log('');
    }
}

async function createBestVisualization(mbox_conf, mbox_loc, image) {
    console.log('--- Creating Visualization for Best Detections ---');
    
    // Use a threshold that should give us the 2 clearest faces
    const threshold = 0.2;
    const detections = [];
    const numAnchors = Math.floor(mbox_conf.sizes[1] / 2);
    
    for (let i = 0; i < numAnchors; i++) {
        const backgroundConf = mbox_conf.at(0, i * 2 + 0);
        const faceConf = mbox_conf.at(0, i * 2 + 1);
        
        const expBg = Math.exp(backgroundConf);
        const expFace = Math.exp(faceConf);
        const sumExp = expBg + expFace;
        const faceConfidence = expFace / sumExp;
        
        if (faceConfidence > threshold) {
            const scale = 0.08;
            const dx = mbox_loc.at(0, i * 4 + 0) * scale;
            const dy = mbox_loc.at(0, i * 4 + 1) * scale;
            const dw = mbox_loc.at(0, i * 4 + 2) * scale;
            const dh = mbox_loc.at(0, i * 4 + 3) * scale;
            
            const gridSize = Math.sqrt(numAnchors / 6);
            const anchorX = (i % gridSize) / gridSize;
            const anchorY = Math.floor(i / gridSize) / gridSize;
            
            const centerX = anchorX + dx;
            const centerY = anchorY + dy;
            const width = Math.exp(dw) * 0.1;
            const height = Math.exp(dh) * 0.1;
            
            const x = Math.max(0, (centerX - width / 2) * image.cols);
            const y = Math.max(0, (centerY - height / 2) * image.rows);
            const w = Math.min(image.cols - x, width * image.cols);
            const h = Math.min(image.rows - y, height * image.rows);
            
            const aspectRatio = w / h;
            if (aspectRatio >= 0.7 && aspectRatio <= 1.4 && w > 50 && h > 50) {
                detections.push({
                    x: Math.round(x),
                    y: Math.round(y),
                    width: Math.round(w),
                    height: Math.round(h),
                    confidence: faceConfidence
                });
            }
        }
    }
    
    // Sort and take top 2
    detections.sort((a, b) => b.confidence - a.confidence);
    const top2 = detections.slice(0, 2);
    
    console.log(`Top 2 face candidates:`);
    top2.forEach((det, i) => {
        const sizePercent = ((det.width * det.height) / (image.rows * image.cols) * 100).toFixed(1);
        console.log(`  Face ${i + 1}: (${det.x}, ${det.y}) ${det.width}x${det.height}, conf: ${det.confidence.toFixed(3)}, size: ${sizePercent}%`);
    });
    
    // Draw rectangles on image
    let resultImage = image.copy();
    top2.forEach((det, i) => {
        const color = i === 0 ? new cv.Vec3(0, 255, 0) : new cv.Vec3(255, 0, 0); // Green for #1, Red for #2
        const rect = new cv.Rect(det.x, det.y, det.width, det.height);
        resultImage.drawRectangle(rect, color, 3);
        
        // Add confidence text
        const text = `${(det.confidence * 100).toFixed(1)}%`;
        const textPos = new cv.Point2(det.x, det.y - 10);
        resultImage.putText(text, textPos, cv.FONT_HERSHEY_SIMPLEX, 0.7, color, 2);
    });
    
    // Save result
    const outputPath = path.join(__dirname, 'cache', 'precise_face_detection_results.jpg');
    cv.imwrite(outputPath, resultImage);
    console.log(`✓ Visualization saved: ${path.basename(outputPath)}`);
}

// Run the test
testPreciseFaceDetection().catch(console.error);
