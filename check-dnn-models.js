// Test script to check for DNN face detection models
const cv = require('@u4/opencv4nodejs');
const fs = require('fs');

console.log("Checking for DNN face detection models...");

// Common paths where OpenCV models might be installed
const possiblePaths = [
  '/usr/local/share/opencv4/haarcascades/',
  '/usr/share/opencv4/',
  '/opt/opencv/share/opencv4/',
  './models/', // Local models directory
  '../models/',
  process.env.OPENCV_DIR ? `${process.env.OPENCV_DIR}/share/opencv4/` : null
].filter(Boolean);

console.log("Checking paths:", possiblePaths);

const requiredFiles = [
  'opencv_face_detector_uint8.pb',
  'opencv_face_detector.pbtxt'
];

let modelsFound = false;
let modelPath = null;

for (const basePath of possiblePaths) {
  console.log(`Checking: ${basePath}`);
  try {
    if (fs.existsSync(basePath)) {
      const files = fs.readdirSync(basePath);
      console.log(`  Found files: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`);
      
      const hasAllFiles = requiredFiles.every(file => 
        files.includes(file) || fs.existsSync(`${basePath}/${file}`)
      );
      
      if (hasAllFiles) {
        console.log(`✅ DNN models found at: ${basePath}`);
        modelsFound = true;
        modelPath = basePath;
        break;
      }
    }
  } catch (error) {
    console.log(`  ❌ Cannot access ${basePath}: ${error.message}`);
  }
}

if (!modelsFound) {
  console.log("\n❌ DNN face detection models NOT found!");
  console.log("\nYou have several options:");
  console.log("1. Download the models manually");
  console.log("2. Use a different DNN model");
  console.log("3. Stick with Haar cascades (current working solution)");
  
  console.log("\nTo download the models:");
  console.log("wget https://github.com/opencv/opencv_3rdparty/raw/dnn_samples_face_detector_20180205_fp16/opencv_face_detector_uint8.pb");
  console.log("wget https://github.com/opencv/opencv/raw/master/samples/dnn/face_detector/opencv_face_detector.pbtxt");
} else {
  console.log(`\n✅ Models available at: ${modelPath}`);
  console.log("You can implement DNN face detection!");
  
  // Test if we can actually load the models
  try {
    const net = cv.readNetFromTensorflow(
      `${modelPath}/opencv_face_detector_uint8.pb`,
      `${modelPath}/opencv_face_detector.pbtxt`
    );
    console.log("✅ Successfully loaded DNN model!");
  } catch (error) {
    console.log(`❌ Failed to load DNN model: ${error.message}`);
  }
}
