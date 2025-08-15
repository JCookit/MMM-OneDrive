#!/usr/bin/env node

// Test the complete face detection system
const { FaceDetector } = require('./src/vision/faceDetection.js');
const fs = require('fs');

async function testFaceDetection() {
    try {
        console.log('[Test] Creating FaceDetector instance...');
        const detector = new FaceDetector();
        
        console.log(`[Test] Detection method: ${detector.method}`);
        console.log(`[Test] DNN Net available: ${!!detector.dnnNet}`);
        
        // Test with a simple image buffer (create a small test image)
        const cv = require('@u4/opencv4nodejs');
        const testImage = new cv.Mat(200, 200, cv.CV_8UC3, [128, 128, 128]);
        const buffer = cv.imencode('.jpg', testImage);
        
        console.log('[Test] Testing face detection with sample buffer...');
        const result = await detector.detectFacesFromBuffer(buffer);
        
        console.log(`[Test] ✅ Face detection completed, found ${result.faceCount} faces`);
        console.log(`[Test] Processing time: ${result.processingTime}ms`);
        console.log(`[Test] Focal point: ${result.focalPoint.x},${result.focalPoint.y} ${result.focalPoint.width}x${result.focalPoint.height}`);
        
        return true;
    } catch (error) {
        console.error('[Test] ❌ Face detection test failed:', error.message);
        console.error('[Test] Stack trace:', error.stack);
        return false;
    }
}

testFaceDetection().then(success => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('[Test] Unexpected error:', error);
    process.exit(1);
});
