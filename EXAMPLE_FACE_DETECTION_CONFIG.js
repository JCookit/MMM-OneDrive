/* MagicMirror² config sample for MMM-OneDrive with Face Detection Ken Burns

This is an example configuration for the MMM-OneDrive module showcasing 
the new intelligent Ken Burns effect with face detection.

The face detection feature will:
1. Analyze each photo for faces using OpenCV
2. Use detected faces as focal points for the Ken Burns crop-and-zoom effect
3. Fall back to random focal points when no faces are detected
4. Log processing times and detection results for performance monitoring

Configuration options for face detection:
- enabled: Enable/disable face detection (default: true)
- minFaceSize: Minimum face size in pixels (default: 50)
- maxFaceSize: Maximum face size in pixels (default: 300) 
- confidenceThreshold: Detection confidence threshold 0-1 (default: 0.5)
- debugMode: Save debug images with face detection rectangles (default: false)

*/

{
  modules: [
    {
      module: "MMM-OneDrive",
      position: "fullscreen_below",
      config: {
        albums: [".*"], // Show all albums
        updateInterval: 30000, // 30 seconds between photos
        sort: "random",
        showWidth: 1920,
        showHeight: 1080,
        
        // Ken Burns effect configuration
        kenBurnsEffect: true, // Enable Ken Burns crop-and-zoom effect
        
        // Face detection for intelligent focal points
        faceDetection: {
          enabled: true, // Enable face detection for Ken Burns focal points
          minFaceSize: 50, // Minimum face size in pixels (adjustable based on your photos)
          maxFaceSize: 300, // Maximum face size in pixels (adjustable based on your photos)
          confidenceThreshold: 0.5, // Detection confidence threshold (0-1)
          debugMode: false, // Set to true to save debug images with face detection rectangles
        },
        
        // Optional: Leave space for left sidebar modules
        leftMargin: null, // e.g. "25vw" or "400px"
        
        // Standard photo filtering
        condition: {
          fromDate: null,
          toDate: null,
          minWidth: 800, // Minimum resolution for better quality
          maxWidth: null,
          minHeight: 600,
          maxHeight: null,
          minWHRatio: null,
          maxWHRatio: null,
        },
        
        timeFormat: "YYYY/MM/DD HH:mm",
        autoInfoPosition: false,
      }
    }
  ]
}
