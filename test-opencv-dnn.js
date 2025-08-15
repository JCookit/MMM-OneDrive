#!/usr/bin/env node

// Test OpenCV DNN support
const cv = require('@u4/opencv4nodejs');

console.log('[Test] OpenCV version:', cv.version);
console.log('[Test] Available modules:', Object.keys(cv));

// Check if DNN module is available
if (cv.dnn) {
    console.log('[Test] ✅ DNN module is available');
    console.log('[Test] DNN functions:', Object.keys(cv.dnn));
} else {
    console.log('[Test] ❌ DNN module is NOT available');
}

// Check for readNetFromTensorflow
if (cv.readNetFromTensorflow) {
    console.log('[Test] ✅ readNetFromTensorflow is available');
} else {
    console.log('[Test] ❌ readNetFromTensorflow is NOT available');
}

// Check if we can create an empty net
try {
    console.log('[Test] Testing basic DNN functionality...');
    const testNet = new cv.dnn.Net();
    console.log('[Test] ✅ Basic DNN Net creation works');
} catch (error) {
    console.log('[Test] ❌ Basic DNN Net creation failed:', error.message);
}
