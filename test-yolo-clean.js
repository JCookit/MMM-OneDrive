const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

console.log('=== YOLOv8-Face with NMS (Clean Results) ===\n');

async function testYoloWithNMS() {
    try {
        // Load test image
        const testImagePath = path.join(__dirname, 'cache', 'image_with_faces.jpg');
        const img = cv.imread(testImagePath);
        console.log(`✓ Test image loaded: ${img.cols}x${img.rows}`);

        // Load YOLOv8-face model
        const modelPath = path.join(__dirname, 'models', 'yolo', 'yolov8n-face.onnx');
        const net = cv.readNetFromONNX(modelPath);
        net.setPreferableBackend(cv.DNN_BACKEND_OPENCV);
        net.setPreferableTarget(cv.DNN_TARGET_CPU);

        // Prepare input
        const inputSize = 640;
        const blob = cv.blobFromImage(
            img, 
            1.0 / 255.0,
            new cv.Size(inputSize, inputSize), 
            new cv.Vec3(0, 0, 0), 
            true, false
        );

        console.log('Running YOLO inference...');
        const start = Date.now();
        net.setInput(blob);
        const outputs = net.forward();
        const inferenceTime = Date.now() - start;
        console.log(`✓ Inference completed in ${inferenceTime}ms`);

        // Process detections with NMS
        const rawDetections = processYoloDetections(outputs, img.cols, img.rows, inputSize);
        const cleanDetections = applyNMS(rawDetections, 0.5, 0.4); // IoU threshold 0.5, conf threshold 0.4

        console.log(`\nRaw detections: ${rawDetections.length}`);
        console.log(`After NMS: ${cleanDetections.length}`);

        // Show final results
        console.log('\n=== Final Clean Face Detections ===');
        cleanDetections.forEach((detection, i) => {
            const side = detection.centerX < img.cols / 2 ? 'LEFT' : 'RIGHT';
            console.log(`Face ${i + 1}: ${(detection.confidence * 100).toFixed(1)}% confidence | ` +
                       `Center(${Math.round(detection.centerX)}, ${Math.round(detection.centerY)}) | ` +
                       `Size ${Math.round(detection.width)}x${Math.round(detection.height)} | ${side} side`);
        });

        // Create clean visualization
        if (cleanDetections.length > 0) {
            const resultImg = drawCleanDetections(img, cleanDetections);
            cv.imwrite('yolo_clean_face_detection.jpg', resultImg);
            console.log('\n✓ Clean visualization saved: yolo_clean_face_detection.jpg');
        }

        // Success metrics
        const leftFaces = cleanDetections.filter(r => r.centerX < img.cols / 2).length;
        const rightFaces = cleanDetections.filter(r => r.centerX >= img.cols / 2).length;
        console.log(`\nFinal Result: ${leftFaces} left face(s), ${rightFaces} right face(s)`);
        
        if (cleanDetections.length >= 2 && leftFaces > 0 && rightFaces > 0) {
            console.log('🎉 PERFECT: Found exactly what we wanted - faces on both sides!');
        } else if (cleanDetections.length >= 2) {
            console.log('✅ GOOD: Found multiple faces');
        } else {
            console.log('⚠️  Needs improvement: Only found', cleanDetections.length, 'face(s)');
        }

        return cleanDetections;

    } catch (error) {
        console.error('Error:', error.message);
        return [];
    }
}

function processYoloDetections(outputs, imgWidth, imgHeight, inputSize) {
    const detections = [];
    const confidenceThreshold = 0.3; // Higher threshold for cleaner initial results
    
    const numDetections = outputs.sizes[2]; // 8400
    
    for (let i = 0; i < numDetections; i++) {
        const x_center = outputs.at(0, 0, i);
        const y_center = outputs.at(0, 1, i);
        const width = outputs.at(0, 2, i);
        const height = outputs.at(0, 3, i);
        const confidence = outputs.at(0, 4, i);
        
        if (confidence > confidenceThreshold) {
            // Convert from input coordinates to image coordinates
            const scaleX = imgWidth / inputSize;
            const scaleY = imgHeight / inputSize;
            
            const centerX = x_center * scaleX;
            const centerY = y_center * scaleY;
            const w = width * scaleX;
            const h = height * scaleY;
            
            // Validation
            if (w > 50 && h > 50 && w < imgWidth * 0.8 && h < imgHeight * 0.8 &&
                centerX > 0 && centerY > 0 && centerX < imgWidth && centerY < imgHeight) {
                
                detections.push({
                    confidence: confidence,
                    centerX: centerX,
                    centerY: centerY,
                    width: w,
                    height: h,
                    x1: Math.max(0, centerX - w / 2),
                    y1: Math.max(0, centerY - h / 2),
                    x2: Math.min(imgWidth, centerX + w / 2),
                    y2: Math.min(imgHeight, centerY + h / 2)
                });
            }
        }
    }
    
    return detections.sort((a, b) => b.confidence - a.confidence);
}

function applyNMS(detections, iouThreshold = 0.5, confThreshold = 0.4) {
    // Filter by confidence threshold
    const filtered = detections.filter(d => d.confidence >= confThreshold);
    
    if (filtered.length === 0) return [];
    
    // Convert to OpenCV format for NMS
    const boxes = [];
    const scores = [];
    
    filtered.forEach(det => {
        boxes.push([det.x1, det.y1, det.x2 - det.x1, det.y2 - det.y1]); // [x, y, w, h]
        scores.push(det.confidence);
    });
    
    // Apply NMS using OpenCV
    const indices = cv.dnn.NMSBoxes(
        boxes,
        scores,
        confThreshold,
        iouThreshold
    );
    
    // Return filtered detections
    const result = [];
    for (const idx of indices) {
        result.push(filtered[idx]);
    }
    
    return result;
}

function drawCleanDetections(img, detections) {
    const result = img.copy();
    
    detections.forEach((det, i) => {
        // High confidence = thick green, medium = yellow, low = blue
        let color, thickness;
        if (det.confidence > 0.7) {
            color = new cv.Vec3(0, 255, 0); // Green
            thickness = 4;
        } else if (det.confidence > 0.5) {
            color = new cv.Vec3(0, 255, 255); // Yellow
            thickness = 3;
        } else {
            color = new cv.Vec3(255, 0, 0); // Blue
            thickness = 2;
        }
        
        // Draw rectangle
        result.drawRectangle(
            new cv.Point2(det.x1, det.y1),
            new cv.Point2(det.x2, det.y2),
            color,
            thickness
        );
        
        // Draw label with face number and confidence
        const label = `Face ${i + 1}: ${(det.confidence * 100).toFixed(1)}%`;
        const labelPos = new cv.Point2(det.x1, Math.max(det.y1 - 15, 25));
        result.putText(label, labelPos, cv.FONT_HERSHEY_SIMPLEX, 0.9, color, 2);
        
        // Draw center point
        const center = new cv.Point2(Math.round(det.centerX), Math.round(det.centerY));
        result.circle(center, 5, color, -1);
    });
    
    return result;
}

// Run the test
testYoloWithNMS().catch(console.error);
