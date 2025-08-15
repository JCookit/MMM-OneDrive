const fs = require('fs');
const https = require('https');
const path = require('path');

const modelsDir = path.join(__dirname, 'models');

// Create models directory
if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir);
}

const downloads = [
  {
    url: 'https://github.com/opencv/opencv_3rdparty/raw/dnn_samples_face_detector_20180205_fp16/opencv_face_detector_uint8.pb',
    filename: 'opencv_face_detector_uint8.pb'
  },
  {
    url: 'https://github.com/opencv/opencv/raw/master/samples/dnn/face_detector/opencv_face_detector.pbtxt',
    filename: 'opencv_face_detector.pbtxt'
  }
];

async function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(modelsDir, filename);
    const file = fs.createWriteStream(filePath);
    
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`✅ Downloaded: ${filename}`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => {}); // Delete the file on error
      reject(err);
    });
  });
}

async function downloadModels() {
  console.log('Downloading DNN face detection models...');
  
  try {
    for (const download of downloads) {
      await downloadFile(download.url, download.filename);
    }
    console.log('\n🎉 All models downloaded successfully!');
    console.log(`Models saved to: ${modelsDir}`);
  } catch (error) {
    console.error('❌ Download failed:', error.message);
  }
}

downloadModels();
