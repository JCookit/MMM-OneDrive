// Optimized configuration with integrated face detection
// Face detection now happens during photo preparation - no extra round trips!

const optimizedConfig = {
  module: "MMM-OneDrive",
  position: "fullscreen_below",
  config: {
    updateInterval: 15000, // 15 seconds per photo
    albumId: "root", // or your specific album ID
    
    // Ken Burns effect with intelligent focal points
    kenBurnsEffect: true,
    
    // Face detection configuration (processed during photo prep)
    faceDetection: {
      enabled: true,           // Enable face detection
      minFaceSize: 50,         // Minimum face size in pixels
      maxFaceSize: 300,        // Maximum face size in pixels  
      confidenceThreshold: 0.5, // Detection confidence (0-1)
      debugMode: false,        // Set to true to save debug images
    },
    
    // Other settings
    shuffleAlbumPhotos: true,
    timeFormat: "relative",
    showProgressBar: false,
    showLocation: true,
    leftMargin: null, // or "200px" if you want left margin
  }
};

console.log("OPTIMIZED MMM-OneDrive Configuration:");
console.log("====================================");
console.log(JSON.stringify(optimizedConfig, null, 2));

console.log("\n🚀 PERFORMANCE IMPROVEMENTS:");
console.log("✓ Eliminated extra notification round-trip");
console.log("✓ Face detection happens during photo preparation");
console.log("✓ Frontend receives complete package: image + focal point");
console.log("✓ Focal point rectangles burned into images for visualization");
console.log("✓ Faster transition between photos");

console.log("\n📊 NEW CONTROL FLOW:");
console.log("1. Timer triggers → photo preparation (with face detection)");
console.log("2. Single RENDER_PHOTO notification → frontend");
console.log("3. Immediate Ken Burns animation with intelligent focal point");

console.log("\n🎯 FEATURES:");
console.log("• 1-second fade-in");
console.log("• Zoom out from intelligent focal point");
console.log("• 1-second fade-out");
console.log("• Red rectangles show focal areas");
console.log("• Fallback to random focal points if no faces detected");

module.exports = optimizedConfig;
