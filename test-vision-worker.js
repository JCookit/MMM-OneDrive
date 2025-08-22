#!/usr/bin/env node
/**
 * Vision Worker Test Script
 * 
 * Test the vision worker process independently by providing a photo file.
 * This allows testing the complete vision processing pipeline outside of MagicMirror.
 * 
 * Usage:
 *   node test-vision-worker.js <image-file-path>
 *   node test-vision-worker.js cache/20250609_091819362_iOS.jpg
 * 
 * The script will:
 * 1. Load the specified image
 * 2. Send it to the vision worker for complete processing
 * 3. Display the resulting focal point and method used
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function showUsage() {
  console.log('Usage: node test-vision-worker.js <image-file-path>');
  console.log('');
  console.log('Examples:');
  console.log('  node test-vision-worker.js cache/20250609_091819362_iOS.jpg');
  console.log('  node test-vision-worker.js /path/to/your/image.jpg');
  console.log('');
  process.exit(1);
}

async function testVisionWorker(imagePath) {
  console.log(`[TestScript] 🧪 Testing vision worker with: ${imagePath}`);
  
  // Check if image file exists
  if (!fs.existsSync(imagePath)) {
    console.error(`[TestScript] ❌ Image file not found: ${imagePath}`);
    process.exit(1);
  }
  
  // Read image file
  let imageBuffer;
  try {
    imageBuffer = fs.readFileSync(imagePath);
    console.log(`[TestScript] 📖 Loaded image: ${imageBuffer.length} bytes`);
  } catch (error) {
    console.error(`[TestScript] ❌ Failed to read image file:`, error.message);
    process.exit(1);
  }
  
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let responseReceived = false;
    
    console.log(`[TestScript] 🚀 Starting vision worker process...`);
    
    // Spawn vision worker process
    const worker = spawn('node', [path.join(__dirname, 'src/vision/vision-worker.js')], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      cwd: __dirname
    });
    
    // Set up timeout
    const timeout = setTimeout(() => {
      if (!responseReceived) {
        console.error('[TestScript] ⏰ Vision worker timeout after 30 seconds');
        worker.kill('SIGTERM');
        reject(new Error('Vision worker timeout'));
      }
    }, 30000);
    
    // Handle worker messages
    worker.on('message', (message) => {
      console.log(`[TestScript] 📨 Received: ${message.type}`);
      
      if (message.type === 'WORKER_READY') {
        console.log(`[TestScript] ✅ Vision worker ready, sending image...`);
        
        // Send image processing request
        worker.send({
          type: 'PROCESS_IMAGE',
          requestId: 'test-001',
          imageBuffer: imageBuffer,
          filename: path.basename(imagePath),
          config: {
            faceDetection: { enabled: true }
          }
        });
        
      } else if (message.type === 'PROCESSING_RESULT') {
        responseReceived = true;
        clearTimeout(timeout);
        
        const { result, processingTime } = message;
        const totalTime = Date.now() - startTime;
        
        console.log(`[TestScript] ✅ Vision processing completed!`);
        console.log(`[TestScript] 📊 Processing time: ${processingTime}ms`);
        console.log(`[TestScript] 📊 Total time: ${totalTime}ms`);
        console.log(`[TestScript] 📊 Method used: ${result.method}`);
        console.log(`[TestScript] 📊 Faces detected: ${result.faces?.length || 0}`);
        console.log(`[TestScript] 📊 Focal point:`, {
          x: (result.focalPoint.x * 100).toFixed(1) + '%',
          y: (result.focalPoint.y * 100).toFixed(1) + '%',
          width: (result.focalPoint.width * 100).toFixed(1) + '%',
          height: (result.focalPoint.height * 100).toFixed(1) + '%',
          type: result.focalPoint.type
        });
        
        if (result.faces && result.faces.length > 0) {
          console.log(`[TestScript] 👥 Face details:`);
          result.faces.forEach((face, i) => {
            console.log(`[TestScript]   Face ${i + 1}: ${face.width}x${face.height} at (${face.x}, ${face.y}) confidence: ${face.confidence?.toFixed(2) || 'N/A'}`);
          });
        }
        
        worker.kill('SIGTERM');
        resolve(result);
        
      } else if (message.type === 'WORKER_ERROR') {
        responseReceived = true;
        clearTimeout(timeout);
        console.error(`[TestScript] ❌ Vision worker error:`, message.error);
        worker.kill('SIGTERM');
        reject(new Error(message.error));
      }
    });
    
    // Handle worker output
    worker.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => console.log(`[Worker] ${line}`));
    });
    
    worker.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => console.error(`[Worker] ${line}`));
    });
    
    worker.on('error', (error) => {
      responseReceived = true;
      clearTimeout(timeout);
      console.error('[TestScript] ❌ Failed to spawn vision worker:', error.message);
      reject(error);
    });
    
    worker.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (!responseReceived) {
        console.error(`[TestScript] ❌ Vision worker exited unexpectedly: code=${code}, signal=${signal}`);
        reject(new Error(`Vision worker exited: code=${code}, signal=${signal}`));
      } else {
        console.log(`[TestScript] 🏁 Vision worker exited: code=${code}`);
      }
    });
  });
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showUsage();
  }
  
  const imagePath = args[0];
  const absolutePath = path.resolve(imagePath);
  
  try {
    const result = await testVisionWorker(absolutePath);
    console.log(`[TestScript] 🎉 Test completed successfully!`);
    process.exit(0);
  } catch (error) {
    console.error(`[TestScript] ❌ Test failed:`, error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(console.error);
}
