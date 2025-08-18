// Test improved SSD coordinate decoding vs current approach
// This will help determine if better coordinate processing fixes the "body detection" issue

const cv = require('@u4/opencv4nodejs');
const path = require('path');
const { improvedProcessRawDetections, improvedSimpleProcessing } = require('./improve-ssd-coordinates.js');

async function testImprovedCoordinateDecoding() {
    console.log('=== Testing Improved SSD Coordinate Decoding ===\n');
    
    // Load the model
    const modelPath = path.join(__dirname, 'models', 'opencv_face_detector_uint8.pb');
    const configPath = path.join(__dirname, 'models', 'opencv_face_detector.pbtxt');
    
    if (!require('fs').existsSync(modelPath) || !require('fs').existsSync(configPath)) {
        console.error('Model files not found. Please ensure models are in the models/ directory.');
        return;
    }
    
    const net = cv.readNetFromTensorflow(modelPath, configPath);
    console.log('✓ Model loaded successfully');
    
    // Use the test image with known faces
    const testImagePath = path.join(__dirname, 'cache', 'image_with_faces.jpg');
    let image;
    
    try {
        image = cv.imread(testImagePath);
        console.log(`✓ Test image loaded: ${image.rows}x${image.cols} from ${path.basename(testImagePath)}`);
        console.log(`✓ This image contains 2 faces for testing`);
    } catch (error) {
        console.error(`❌ Could not load test image: ${testImagePath}`);
        console.error('Please ensure image_with_faces.jpg exists in the cache directory');
        return;
    }
    
    const imageWidth = image.cols;
    const imageHeight = image.rows;
    
    // Create blob and run inference
    const blob = cv.blobFromImage(image, 1.0, new cv.Size(300, 300), new cv.Vec3(104, 117, 123), false, false);
    net.setInput(blob);
    
    console.log('\n--- Running DNN inference ---');
    const start = Date.now();
    
    // Use the same API as the working code
    const outputs = net.forward(['mbox_conf', 'mbox_loc']);
    const inferenceTime = Date.now() - start;
    
    const mbox_conf = outputs[0];
    const mbox_loc = outputs[1];
    
    console.log(`Inference completed in ${inferenceTime}ms`);
    console.log(`mbox_conf shape: [${mbox_conf.sizes.join(', ')}]`);
    console.log(`mbox_loc shape: [${mbox_loc.sizes.join(', ')}]`);
    
    // Test current approach (simplified)
    console.log('\n--- Current Approach Results ---');
    const currentDetections = processCurrentMethod(mbox_conf, mbox_loc, imageWidth, imageHeight, 0.01); // Very low threshold
    console.log(`Current method found ${currentDetections.length} detections:`);
    currentDetections.forEach((det, i) => {
        console.log(`  Detection ${i + 1}: (${det.x}, ${det.y}) ${det.width}x${det.height}, conf: ${det.confidence.toFixed(3)}`);
        console.log(`    Size: ${(det.width * det.height / (imageWidth * imageHeight) * 100).toFixed(1)}% of image`);
    });
    
    // Test improved simple approach
    console.log('\n--- Improved Simple Approach Results ---');
    const improvedSimpleDetections = improvedSimpleProcessing(mbox_conf, mbox_loc, imageWidth, imageHeight, 0.01); // Very low threshold
    console.log(`Improved simple method found ${improvedSimpleDetections.length} detections:`);
    improvedSimpleDetections.forEach((det, i) => {
        console.log(`  Detection ${i + 1}: (${det.x}, ${det.y}) ${det.width}x${det.height}, conf: ${det.confidence.toFixed(3)}`);
        console.log(`    Size: ${(det.width * det.height / (imageWidth * imageHeight) * 100).toFixed(1)}% of image`);
    });
    
    // Test full improved approach (with proper SSD anchors)
    console.log('\n--- Full Improved Approach Results ---');
    try {
        const fullImprovedDetections = improvedProcessRawDetections(mbox_conf, mbox_loc, imageWidth, imageHeight, 0.15);
        console.log(`Full improved method found ${fullImprovedDetections.length} detections:`);
        fullImprovedDetections.forEach((det, i) => {
            console.log(`  Detection ${i + 1}: (${det.x}, ${det.y}) ${det.width}x${det.height}, conf: ${det.confidence.toFixed(3)}`);
            console.log(`    Size: ${(det.width * det.height / (imageWidth * imageHeight) * 100).toFixed(1)}% of image`);
        });
    } catch (error) {
        console.log(`Full improved approach failed: ${error.message}`);
        console.log('This is expected - the anchor generation needs model-specific tuning');
    }
    
    // Visualize results
    console.log('\n--- Creating Visualization ---');
    
    // Create visualization images
    const currentImage = image.copy();
    const improvedImage = image.copy();
    
    // Draw current detections in red
    currentDetections.forEach(det => {
        currentImage.drawRectangle(
            new cv.Point2(det.x, det.y),
            new cv.Point2(det.x + det.width, det.y + det.height),
            new cv.Vec3(0, 0, 255), // Red
            2
        );
        currentImage.putText(
            `${det.confidence.toFixed(2)}`,
            new cv.Point2(det.x, det.y - 5),
            cv.FONT_HERSHEY_SIMPLEX,
            0.5,
            new cv.Vec3(0, 0, 255),
            1
        );
    });
    
    // Draw improved detections in green
    improvedSimpleDetections.forEach(det => {
        improvedImage.drawRectangle(
            new cv.Point2(det.x, det.y),
            new cv.Point2(det.x + det.width, det.y + det.height),
            new cv.Vec3(0, 255, 0), // Green
            2
        );
        improvedImage.putText(
            `${det.confidence.toFixed(2)}`,
            new cv.Point2(det.x, det.y - 5),
            cv.FONT_HERSHEY_SIMPLEX,
            0.5,
            new cv.Vec3(0, 255, 0),
            1
        );
    });
    
    // Save results
    cv.imwrite(path.join(__dirname, 'cache', 'current_method_results.jpg'), currentImage);
    cv.imwrite(path.join(__dirname, 'cache', 'improved_method_results.jpg'), improvedImage);
    
    console.log('✓ Results saved:');
    console.log('  - cache/current_method_results.jpg (red boxes)');
    console.log('  - cache/improved_method_results.jpg (green boxes)');
    
    // Analysis
    console.log('\n--- Analysis ---');
    const currentAvgSize = currentDetections.reduce((sum, det) => sum + (det.width * det.height), 0) / currentDetections.length || 0;
    const improvedAvgSize = improvedSimpleDetections.reduce((sum, det) => sum + (det.width * det.height), 0) / improvedSimpleDetections.length || 0;
    
    console.log(`Current method average detection size: ${currentAvgSize.toFixed(0)} pixels²`);
    console.log(`Improved method average detection size: ${improvedAvgSize.toFixed(0)} pixels²`);
    
    if (improvedAvgSize > 0 && currentAvgSize > 0) {
        const sizeReduction = ((currentAvgSize - improvedAvgSize) / currentAvgSize * 100);
        console.log(`Size reduction: ${sizeReduction.toFixed(1)}%`);
        
        if (sizeReduction > 20) {
            console.log('✓ Improved method produces significantly smaller (more face-like) detections!');
        } else if (sizeReduction > 0) {
            console.log('✓ Improved method produces slightly smaller detections');
        } else {
            console.log('→ Improved method needs further tuning');
        }
    }
    
    return {
        current: currentDetections,
        improved: improvedSimpleDetections,
        inferenceTime
    };
}

// Current method for comparison (from your existing code)
function processCurrentMethod(mbox_conf, mbox_loc, imageWidth, imageHeight, confidenceThreshold = 0.25) {
    const detections = [];
    
    // The mbox_conf output contains confidence scores for multiple classes
    // For face detection, we typically have background (class 0) and face (class 1)
    // The shape [1, 17784] suggests 8892 anchor boxes * 2 classes = 17784
    const numAnchors = Math.floor(mbox_conf.sizes[1] / 2);
    
    console.log(`Processing ${numAnchors} anchor predictions`);
    
    let maxConfidence = 0;
    let confidenceCount = { above_01: 0, above_05: 0, above_10: 0, above_25: 0 };
    
    for (let i = 0; i < numAnchors; i++) {
        // Get confidence scores for background (class 0) and face (class 1)
        const backgroundConf = mbox_conf.at(0, i * 2 + 0);
        const faceConf = mbox_conf.at(0, i * 2 + 1);
        
        // Apply softmax to convert raw scores to probabilities
        const expBg = Math.exp(backgroundConf);
        const expFace = Math.exp(faceConf);
        const sumExp = expBg + expFace;
        const faceConfidence = expFace / sumExp;
        
        // Track confidence statistics
        maxConfidence = Math.max(maxConfidence, faceConfidence);
        if (faceConfidence > 0.01) confidenceCount.above_01++;
        if (faceConfidence > 0.05) confidenceCount.above_05++;
        if (faceConfidence > 0.10) confidenceCount.above_10++;
        if (faceConfidence > 0.25) confidenceCount.above_25++;
        
        if (faceConfidence > confidenceThreshold) {
            // Get bounding box coordinates (4 values per anchor)
            const x = mbox_loc.at(0, i * 4 + 0);
            const y = mbox_loc.at(0, i * 4 + 1);
            const w = mbox_loc.at(0, i * 4 + 2);
            const h = mbox_loc.at(0, i * 4 + 3);
            
            // Current scaling (this is what causes "body detection")
            const halfWidth = w * 0.1;  // Current scaling
            const halfHeight = h * 0.2; // Current scaling
            
            const x1 = (x - halfWidth) * imageWidth;
            const y1 = (y - halfHeight) * imageHeight;
            const width = halfWidth * 2 * imageWidth;
            const height = halfHeight * 2 * imageHeight;
            
            if (width > 20 && height > 20) {
                detections.push({
                    x: Math.max(0, Math.round(x1)),
                    y: Math.max(0, Math.round(y1)),
                    width: Math.round(width),
                    height: Math.round(height),
                    confidence: faceConfidence
                });
            }
        }
    }
    
    console.log(`Confidence statistics - Max: ${maxConfidence.toFixed(4)}, >1%: ${confidenceCount.above_01}, >5%: ${confidenceCount.above_05}, >10%: ${confidenceCount.above_10}, >25%: ${confidenceCount.above_25}`);
    
    return detections;
}

// Run the test
if (require.main === module) {
    testImprovedCoordinateDecoding().catch(console.error);
}

module.exports = { testImprovedCoordinateDecoding };
