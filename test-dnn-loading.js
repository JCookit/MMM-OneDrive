#!/usr/bin/env node

// Quick test to verify DNN model loading
const cv = require('@u4/opencv4nodejs');
const path = require('path');

async function testDNNLoading() {
    try {
        console.log('[Test] Testing DNN model loading...');
        
        const modelPath = path.join(__dirname, 'models', 'opencv_face_detector_uint8.pb');
        const configPath = path.join(__dirname, 'models', 'opencv_face_detector.pbtxt');
        
        console.log(`[Test] Model path: ${modelPath}`);
        console.log(`[Test] Config path: ${configPath}`);
        
        // Check if files exist
        const fs = require('fs');
        if (!fs.existsSync(modelPath)) {
            throw new Error(`Model file not found: ${modelPath}`);
        }
        if (!fs.existsSync(configPath)) {
            throw new Error(`Config file not found: ${configPath}`);
        }
        
        console.log('[Test] Model files exist, attempting to load...');
        
        console.log('[Test] Calling cv.readNetFromTensorflow...');
        const net = cv.readNetFromTensorflow(modelPath, configPath);
        
        if (!net) {
            throw new Error('readNetFromTensorflow returned null/undefined');
        }
        
        console.log('[Test] ✅ DNN model loaded successfully!');
        console.log('[Test] Net object type:', typeof net);
        
        // Test basic properties
        try {
            const layerNames = net.getLayerNames();
            console.log(`[Test] Model has ${layerNames.length} layers`);
        } catch (layerError) {
            console.warn('[Test] Could not get layer names:', layerError.message);
        }
        
        return true;
    } catch (error) {
        console.error('[Test] ❌ DNN model loading failed:', error.message);
        return false;
    }
}

testDNNLoading().then(success => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('[Test] Unexpected error:', error);
    process.exit(1);
});
