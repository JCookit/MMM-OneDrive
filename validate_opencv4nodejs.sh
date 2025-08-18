#!/bin/bash

echo "🔧 opencv4nodejs DNN Validation Script (Corrected)"
echo "================================================="
echo ""

cd /home/cookits/MagicMirror/modules/MMM-OneDrive

echo "🧪 Testing actual DNN methods used by face detection..."
node -e "
const cv = require('@u4/opencv4nodejs');

console.log('✅ Module loaded - Version:', cv.version.major + '.' + cv.version.minor + '.' + cv.version.revision);

// Test the actual methods your face detection uses
const tests = [
  { name: 'cv.readNetFromONNX', method: 'readNetFromONNX' },
  { name: 'cv.blobFromImage', method: 'blobFromImage' },
  { name: 'cv.DNN_BACKEND_OPENCV', method: 'DNN_BACKEND_OPENCV' },
  { name: 'cv.DNN_TARGET_CPU', method: 'DNN_TARGET_CPU' },
  { name: 'cv.CascadeClassifier', method: 'CascadeClassifier' },
  { name: 'cv.HAAR_FRONTALFACE_ALT2', method: 'HAAR_FRONTALFACE_ALT2' }
];

let allGood = true;
tests.forEach(test => {
  if (typeof cv[test.method] !== 'undefined') {
    console.log('✅', test.name, 'available');
  } else {
    console.log('❌', test.name, 'missing');
    allGood = false;
  }
});

// Test cv.dnn.NMSBoxes specifically
if (cv.dnn && typeof cv.dnn.NMSBoxes === 'function') {
  console.log('✅ cv.dnn.NMSBoxes available');
} else {
  console.log('⚠️  cv.dnn.NMSBoxes missing (will use fallback NMS)');
}

console.log('');
if (allGood) {
  console.log('🎉 All essential methods available for face detection!');
} else {
  console.log('❌ Some methods missing');
  process.exit(1);
}
"

echo ""
echo "🧪 Testing basic functionality..."
node -e "
const cv = require('@u4/opencv4nodejs');

try {
  // Test Mat creation
  const mat = new cv.Mat(100, 100, cv.CV_8UC3, [255, 0, 0]);
  console.log('✅ Mat creation works');
  
  // Test blob creation
  const blob = cv.blobFromImage(mat);
  console.log('✅ blobFromImage works - shape:', blob.sizes);
  
  // Test Haar cascade
  const cascade = new cv.CascadeClassifier(cv.HAAR_FRONTALFACE_ALT2);
  console.log('✅ Haar cascade creation works');
  
  console.log('🎉 All core functionality working!');
} catch (error) {
  console.log('❌ Functionality test failed:', error.message);
  process.exit(1);
}
"

echo ""
echo "✅ opencv4nodejs is ready for your face detection system!"
echo "🎉 Pi5 deployment validation complete!"
