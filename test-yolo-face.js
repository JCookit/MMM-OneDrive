const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

console.log('=== YOLOv8-Face Detection Test ===\n');

async function testYoloFaceDetection() {
    try {
        // Load the test image
        const testImagePath = path.join(__dirname, 'cache', 'image_with_faces.jpg');
        if (!fs.existsSync(testImagePath)) {
            console.error('Test image not found!');
            return;
        }

        const img = cv.imread(testImagePath);
        console.log(`✓ Test image loaded: ${img.cols}x${img.rows}`);

        // Load YOLOv8-face model
        const modelPath = path.join(__dirname, 'models', 'yolo', 'yolov8n-face.onnx');
        if (!fs.existsSync(modelPath)) {
            console.error('YOLOv8-face model not found!');
            return;
        }

        console.log('Loading YOLOv8-face model...');
        const net = cv.readNetFromONNX(modelPath);
        net.setPreferableBackend(cv.DNN_BACKEND_OPENCV);
        net.setPreferableTarget(cv.DNN_TARGET_CPU);
        console.log('✓ YOLOv8-face model loaded successfully');

        // Prepare input for YOLO (640x640 is typical for YOLOv8)
        const inputSize = 640;
        const blob = cv.blobFromImage(
            img, 
            1.0 / 255.0,  // Scale pixel values to [0,1]
            new cv.Size(inputSize, inputSize), 
            new cv.Vec3(0, 0, 0), 
            true,  // swapRB
            false  // crop
        );

        console.log('Running YOLO inference...');
        const start = Date.now();
        
        // Set input and run inference
        net.setInput(blob);
        const outputs = net.forward();
        
        const inferenceTime = Date.now() - start;
        console.log(`✓ Inference completed in ${inferenceTime}ms`);

        // Check output format
        console.log(`\nOutput tensor shape: [${outputs.sizes.join(', ')}]`);

        // YOLOv8 output format is typically [1, num_detections, 85] 
        // where 85 = x, y, w, h, confidence, class_probs...
        if (outputs.sizes.length === 3) {
            const [batch, detections, features] = outputs.sizes;
            console.log(`Batch size: ${batch}`);
            console.log(`Number of detections: ${detections}`);
            console.log(`Features per detection: ${features}`);

            // Process detections
            const results = processYoloDetections(outputs, img.cols, img.rows, inputSize);
            console.log(`\nFound ${results.length} face detections:`);

            // Show results
            results.forEach((detection, i) => {
                const side = detection.centerX < img.cols / 2 ? 'LEFT' : 'RIGHT';
                console.log(`  ${i + 1}: ${(detection.confidence * 100).toFixed(1)}% confidence | ` +
                           `Center(${Math.round(detection.centerX)}, ${Math.round(detection.centerY)}) | ` +
                           `Size ${Math.round(detection.width)}x${Math.round(detection.height)} | ${side} side`);
            });

            // Create visualization
            if (results.length > 0) {
                const resultImg = drawDetections(img, results);
                cv.imwrite('yolo_face_detection_results.jpg', resultImg);
                console.log('\n✓ Visualization saved: yolo_face_detection_results.jpg');
            }

            // Check if we found faces on both sides
            const leftFaces = results.filter(r => r.centerX < img.cols / 2).length;
            const rightFaces = results.filter(r => r.centerX >= img.cols / 2).length;
            console.log(`\nSpatial distribution: ${leftFaces} left, ${rightFaces} right`);
            
            if (leftFaces > 0 && rightFaces > 0) {
                console.log('✅ SUCCESS: Found faces on both sides!');
            } else {
                console.log('⚠️  Issue: Missing faces on one side');
            }

        } else {
            console.error('Unexpected output tensor format');
            console.log('Expected 3D tensor [batch, detections, features]');
        }

    } catch (error) {
        console.error('Error in YOLO face detection:', error.message);
        console.error(error.stack);
    }
}

function processYoloDetections(outputs, imgWidth, imgHeight, inputSize) {
    const detections = [];
    const confidenceThreshold = 0.1; // Lower threshold to catch more candidates
    
    // YOLOv8 output format: [1, 5, 8400] 
    // where 5 = [x_center, y_center, width, height, confidence]
    // and 8400 = number of detection candidates
    const numDetections = outputs.sizes[2]; // 8400
    
    console.log(`Processing ${numDetections} detections...`);
    
    for (let i = 0; i < numDetections; i++) {
        // Extract detection data (note transposed indexing)
        const x_center = outputs.at(0, 0, i);  // In pixels (relative to input size 640x640)
        const y_center = outputs.at(0, 1, i);  // In pixels (relative to input size 640x640)
        const width = outputs.at(0, 2, i);     // In pixels (relative to input size 640x640)  
        const height = outputs.at(0, 3, i);    // In pixels (relative to input size 640x640)
        const confidence = outputs.at(0, 4, i); // Confidence score
        
        if (confidence > confidenceThreshold) {
            // Convert from input coordinates (640x640) to original image coordinates
            const scaleX = imgWidth / inputSize;   // 3088 / 640
            const scaleY = imgHeight / inputSize;  // 2316 / 640
            
            const centerX = x_center * scaleX;
            const centerY = y_center * scaleY;
            const w = width * scaleX;
            const h = height * scaleY;
            
            // Calculate bounding box
            const x1 = centerX - w / 2;
            const y1 = centerY - h / 2;
            const x2 = centerX + w / 2;
            const y2 = centerY + h / 2;
            
            // Basic validation - reject unreasonable detections
            if (w > 20 && h > 20 && w < imgWidth * 0.8 && h < imgHeight * 0.8 &&
                centerX > 0 && centerY > 0 && centerX < imgWidth && centerY < imgHeight) {
                
                detections.push({
                    confidence: confidence,
                    centerX: centerX,
                    centerY: centerY,
                    width: w,
                    height: h,
                    x1: Math.max(0, x1),
                    y1: Math.max(0, y1),
                    x2: Math.min(imgWidth, x2),
                    y2: Math.min(imgHeight, y2)
                });
            }
        }
    }
    
    // Sort by confidence and return top candidates
    detections.sort((a, b) => b.confidence - a.confidence);
    
    console.log(`Found ${detections.length} valid detections above ${confidenceThreshold} threshold`);
    
    return detections.slice(0, 10); // Return top 10 candidates
}

function drawDetections(img, detections) {
    const result = img.copy();
    
    detections.forEach((det, i) => {
        // Color based on confidence and position
        let color;
        if (det.confidence > 0.8) {
            color = new cv.Vec3(0, 255, 0); // Green for high confidence
        } else if (det.confidence > 0.5) {
            color = new cv.Vec3(0, 255, 255); // Yellow for medium
        } else {
            color = new cv.Vec3(255, 0, 0); // Blue for low
        }
        
        const thickness = det.confidence > 0.8 ? 3 : 2;
        
        // Draw rectangle
        result.drawRectangle(
            new cv.Point2(det.x1, det.y1),
            new cv.Point2(det.x2, det.y2),
            color,
            thickness
        );
        
        // Draw confidence label
        const label = `${(det.confidence * 100).toFixed(1)}%`;
        const labelPos = new cv.Point2(det.x1, Math.max(det.y1 - 10, 20));
        result.putText(label, labelPos, cv.FONT_HERSHEY_SIMPLEX, 0.8, color, 2);
    });
    
    // Draw center line for left/right reference
    const centerX = Math.floor(img.cols / 2);
    result.drawLine(
        new cv.Point2(centerX, 0),
        new cv.Point2(centerX, img.rows),
        new cv.Vec3(255, 255, 255),
        2
    );
    
    return result;
}

// Run the test
testYoloFaceDetection().catch(console.error);
