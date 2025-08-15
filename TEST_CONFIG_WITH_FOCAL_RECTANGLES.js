// Simple test configuration with face detection enabled
// This will show the focal point rectangle burned into each image
const testConfig = {
  module: "MMM-OneDrive",
  position: "fullscreen_below",
  config: {
    updateInterval: 10000, // 10 seconds per photo for easier testing
    albumId: "root", // or your specific album ID
    
    // Enable face detection with focal point visualization
    faceDetection: {
      enabled: true,
      minFaceSize: 50,
      maxFaceSize: 300,
      confidenceThreshold: 0.5,
      debugMode: false // Debug mode not needed since we're burning rectangles into images
    },
    
    // Ken Burns effect (simplified for now)
    kenBurnsEffect: true,
    
    // Other standard settings
    shuffleAlbumPhotos: true,
    timeFormat: "relative",
    showProgressBar: false,
    showLocation: true
  }
};

console.log("MMM-OneDrive Test Configuration with Face Detection:");
console.log("==================================================");
console.log(JSON.stringify(testConfig, null, 2));
console.log("\nFeatures enabled:");
console.log("✓ Face detection with focal point rectangles burned into images");
console.log("✓ Intelligent focal points (red rectangle shows Ken Burns focus area)");
console.log("✓ Fallback to default focal points when no faces detected");
console.log("✓ Performance timing logging");
console.log("\nTo use this config:");
console.log("1. Copy the config object above");
console.log("2. Add it to your MagicMirror config.js");
console.log("3. Restart MagicMirror");
console.log("4. Watch for red rectangles on photos showing focal points!");

module.exports = testConfig;
