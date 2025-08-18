// Improved SSD coordinate decoding for better face detection accuracy
// This addresses the "detecting most of a person" issue by properly implementing SSD anchor box decoding

const cv = require('@u4/opencv4nodejs');

function improvedProcessRawDetections(mbox_conf, mbox_loc, imageWidth, imageHeight, confidenceThreshold = 0.25) {
    const detections = [];
    
    // Get tensor dimensions
    const [batchSize, numBoxes, numClasses] = mbox_conf.sizes;
    const [, , coordsPerBox] = mbox_loc.sizes; // Should be 4 (x, y, w, h)
    
    console.log(`Processing ${numBoxes} potential detections with ${numClasses} classes`);
    
    // SSD uses anchor boxes at different scales and aspect ratios
    // Common SSD anchor configurations for face detection
    const anchorScales = [0.1, 0.2, 0.37, 0.54, 0.71, 0.88];
    const aspectRatios = [1.0, 2.0, 0.5]; // Common for faces: square, wide, tall
    
    // Generate anchor boxes (this is a simplified version - the actual model may use different anchors)
    function generateAnchors() {
        const anchors = [];
        const gridSizes = [38, 19, 10, 5, 3, 1]; // Feature map sizes for SSD300
        
        for (let gridIdx = 0; gridIdx < gridSizes.length; gridIdx++) {
            const gridSize = gridSizes[gridIdx];
            const scale = anchorScales[gridIdx];
            const nextScale = anchorScales[gridIdx + 1] || 1.0;
            
            for (let i = 0; i < gridSize; i++) {
                for (let j = 0; j < gridSize; j++) {
                    const centerX = (j + 0.5) / gridSize;
                    const centerY = (i + 0.5) / gridSize;
                    
                    // Add anchors for different aspect ratios
                    for (const aspectRatio of aspectRatios) {
                        const width = scale * Math.sqrt(aspectRatio);
                        const height = scale / Math.sqrt(aspectRatio);
                        
                        anchors.push({
                            centerX,
                            centerY,
                            width,
                            height
                        });
                        
                        // Add extra anchor box
                        if (aspectRatio === 1.0) {
                            const extraScale = Math.sqrt(scale * nextScale);
                            anchors.push({
                                centerX,
                                centerY,
                                width: extraScale,
                                height: extraScale
                            });
                        }
                    }
                }
            }
        }
        return anchors;
    }
    
    const anchors = generateAnchors();
    console.log(`Generated ${anchors.length} anchor boxes`);
    
    // Process each detection
    for (let i = 0; i < Math.min(numBoxes, anchors.length); i++) {
        // Get confidence for face class (assuming class 1 is face, class 0 is background)
        const confidence = mbox_conf.at([0, i, 1]);
        
        if (confidence > confidenceThreshold) {
            // Get bounding box deltas
            const dx = mbox_loc.at([0, i, 0]);
            const dy = mbox_loc.at([0, i, 1]);
            const dw = mbox_loc.at([0, i, 2]);
            const dh = mbox_loc.at([0, i, 3]);
            
            // Get corresponding anchor
            const anchor = anchors[i] || anchors[0]; // Fallback to first anchor
            
            // Decode coordinates using SSD formula:
            // center_x = anchor_center_x + dx * anchor_width * variance[0]
            // center_y = anchor_center_y + dy * anchor_height * variance[1]  
            // width = anchor_width * exp(dw * variance[2])
            // height = anchor_height * exp(dh * variance[3])
            
            const variance = [0.1, 0.1, 0.2, 0.2]; // Common SSD variance values
            
            const centerX = anchor.centerX + dx * anchor.width * variance[0];
            const centerY = anchor.centerY + dy * anchor.height * variance[1];
            const width = anchor.width * Math.exp(dw * variance[2]);
            const height = anchor.height * Math.exp(dh * variance[3]);
            
            // Convert to pixel coordinates
            const x1 = Math.max(0, (centerX - width / 2) * imageWidth);
            const y1 = Math.max(0, (centerY - height / 2) * imageHeight);
            const x2 = Math.min(imageWidth, (centerX + width / 2) * imageWidth);
            const y2 = Math.min(imageHeight, (centerY + height / 2) * imageHeight);
            
            const detectedWidth = x2 - x1;
            const detectedHeight = y2 - y1;
            
            // Filter out invalid or too large boxes (likely body detections)
            const maxFaceSize = Math.min(imageWidth, imageHeight) * 0.5; // Max 50% of image
            const minFaceSize = 20; // Minimum 20 pixels
            
            if (detectedWidth > minFaceSize && detectedHeight > minFaceSize &&
                detectedWidth < maxFaceSize && detectedHeight < maxFaceSize) {
                
                detections.push({
                    x: Math.round(x1),
                    y: Math.round(y1),
                    width: Math.round(detectedWidth),
                    height: Math.round(detectedHeight),
                    confidence: confidence,
                    anchorIndex: i
                });
            }
        }
    }
    
    console.log(`Found ${detections.length} face candidates before NMS`);
    
    // Apply Non-Maximum Suppression to remove duplicates
    if (detections.length > 0) {
        const boxes = detections.map(d => new cv.Rect(d.x, d.y, d.width, d.height));
        const scores = detections.map(d => d.confidence);
        
        // Use OpenCV's NMSBoxes
        const indices = cv.NMSBoxes(boxes, scores, confidenceThreshold, 0.4); // 0.4 IoU threshold
        
        const filteredDetections = [];
        for (const idx of indices) {
            filteredDetections.push(detections[idx]);
        }
        
        console.log(`After NMS: ${filteredDetections.length} final detections`);
        return filteredDetections;
    }
    
    return detections;
}

// Alternative simpler approach - just improve the current method
function improvedSimpleProcessing(mbox_conf, mbox_loc, imageWidth, imageHeight, confidenceThreshold = 0.25) {
    const detections = [];
    
    // The mbox_conf output contains confidence scores for multiple classes
    const numAnchors = Math.floor(mbox_conf.sizes[1] / 2);
    
    console.log(`Processing ${numAnchors} anchor predictions with improved scaling`);
    
    for (let i = 0; i < numAnchors; i++) {
        // Get confidence scores for background (class 0) and face (class 1)
        const backgroundConf = mbox_conf.at(0, i * 2 + 0);
        const faceConf = mbox_conf.at(0, i * 2 + 1);
        
        // Apply softmax to convert raw scores to probabilities
        const expBg = Math.exp(backgroundConf);
        const expFace = Math.exp(faceConf);
        const sumExp = expBg + expFace;
        const faceConfidence = expFace / sumExp;
        
        if (faceConfidence > confidenceThreshold) {
            // Get bounding box coordinates (4 values per anchor)
            const x = mbox_loc.at(0, i * 4 + 0);
            const y = mbox_loc.at(0, i * 4 + 1);
            const w = mbox_loc.at(0, i * 4 + 2);
            const h = mbox_loc.at(0, i * 4 + 3);
            
            // Improved scaling factors - these need to be tuned for face detection
            const scaleX = 0.08; // Much smaller than current 0.1 to get tighter boxes
            const scaleY = 0.08; // Much smaller than current 0.2 to get tighter boxes
            const offsetX = 0.02; // Small offset to center better
            const offsetY = 0.02; // Small offset to center better
            
            // Calculate box coordinates with improved scaling
            const halfWidth = w * scaleX;
            const halfHeight = h * scaleY;
            
            const x1 = Math.max(0, (x - halfWidth + offsetX) * imageWidth);
            const y1 = Math.max(0, (y - halfHeight + offsetY) * imageHeight);
            const x2 = Math.min(imageWidth, (x + halfWidth + offsetX) * imageWidth);
            const y2 = Math.min(imageHeight, (y + halfHeight + offsetY) * imageHeight);
            
            const detectedWidth = x2 - x1;
            const detectedHeight = y2 - y1;
            
            // Better size filtering for faces
            const maxFaceSize = Math.min(imageWidth, imageHeight) * 0.35; // Reduced from 0.4
            const minFaceSize = 25; // Slightly smaller minimum
            const aspectRatio = detectedWidth / detectedHeight;
            
            // Face aspect ratio should be between 0.7 and 1.4 (roughly square to slightly rectangular)
            if (detectedWidth > minFaceSize && detectedHeight > minFaceSize &&
                detectedWidth < maxFaceSize && detectedHeight < maxFaceSize &&
                aspectRatio > 0.7 && aspectRatio < 1.4) {
                
                detections.push({
                    x: Math.round(x1),
                    y: Math.round(y1), 
                    width: Math.round(detectedWidth),
                    height: Math.round(detectedHeight),
                    confidence: faceConfidence
                });
            }
        }
    }
    
    console.log(`Found ${detections.length} face detections with improved scaling`);
    return detections;
}

module.exports = {
    improvedProcessRawDetections,
    improvedSimpleProcessing
};
