const path = require('path');
const { FaceDetector } = require('./src/vision/faceDetection');

async function testProductionYolo() {
    console.log('=== Testing Production YOLO Integration ===\n');
    
    try {
        // Initialize face detector (should use YOLO method)
        const faceDetector = new FaceDetector();
        
        // Test with our known test image
        const testImagePath = path.join(__dirname, 'cache', 'image_with_faces.jpg');
        
        console.log('Loading test image from buffer...');
        const fs = require('fs');
        const imageBuffer = fs.readFileSync(testImagePath);
        
        console.log('Running face detection...');
        const result = await faceDetector.detectFacesFromBuffer(imageBuffer, false);
        
        console.log('\n=== Production Results ===');
        console.log(`Faces detected: ${result.faceCount}`);
        console.log(`Processing time: ${result.processingTime}ms`);
        console.log(`Focal point: (${result.focalPoint.x}, ${result.focalPoint.y})`);
        
        if (result.faces && result.faces.length > 0) {
            console.log('\nFace details:');
            result.faces.forEach((face, i) => {
                const side = face.centerX < 1544 ? 'LEFT' : 'RIGHT'; // 3088/2 = 1544
                console.log(`  Face ${i + 1}: ${(face.confidence * 100).toFixed(1)}% confidence | ` +
                           `Center(${face.centerX || face.x + face.width/2}, ${face.centerY || face.y + face.height/2}) | ` +
                           `Size ${face.width}x${face.height} | ${side} side`);
            });
            
            const leftFaces = result.faces.filter(f => (f.centerX || f.x + f.width/2) < 1544).length;
            const rightFaces = result.faces.filter(f => (f.centerX || f.x + f.width/2) >= 1544).length;
            console.log(`\nSpatial distribution: ${leftFaces} left, ${rightFaces} right`);
            
            if (leftFaces > 0 && rightFaces > 0) {
                console.log('🎉 SUCCESS: Production system finds faces on both sides!');
            } else {
                console.log('⚠️  Issue: Missing faces on one side');
            }
        } else {
            console.log('❌ No faces detected');
        }
        
        return result;
        
    } catch (error) {
        console.error('❌ Production test failed:', error.message);
        console.error(error.stack);
    }
}

// Run the test
testProductionYolo().catch(console.error);
