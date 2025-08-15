# Face Detection for Intelligent Ken Burns Effect

## Overview

The MMM-OneDrive module now includes **intelligent face detection** to automatically determine optimal focal points for the Ken Burns crop-and-zoom effect. Instead of using random crop positions, the module can detect faces in your photos and center the Ken Burns animation on them for more engaging photo displays.

## Features

### 🎯 Intelligent Focal Points
- **Face Detection**: Uses OpenCV to detect faces in photos
- **Smart Cropping**: Centers Ken Burns effect on detected faces
- **Multi-Face Support**: Handles photos with multiple faces by creating a bounding box around all faces
- **Fallback Mode**: Uses random focal points when no faces are detected

### ⚡ Performance Optimized
- **Asynchronous Processing**: Face detection runs in background without blocking photo transitions
- **Configurable Timing**: Adjustable detection parameters for optimal performance
- **Timing Metrics**: Logs processing times for performance monitoring

### 🔧 Highly Configurable
- **Detection Sensitivity**: Adjustable face size constraints and confidence thresholds
- **Debug Mode**: Visual debugging with face detection rectangles
- **Enable/Disable**: Can be toggled on/off per your preference

## Installation Requirements

### System Dependencies
The face detection feature requires OpenCV and related system libraries:

```bash
# Install system dependencies
sudo apt update
sudo apt install -y pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev libopencv-dev python3-opencv

# Navigate to your MMM-OneDrive directory
cd ~/MagicMirror/modules/MMM-OneDrive

# Install Node.js dependencies
npm install @u4/opencv4nodejs canvas sharp

# Build OpenCV bindings (Ubuntu-specific)
node node_modules/@u4/opencv4nodejs/bin/install.js --incDir /usr/include/opencv4/ --libDir /lib/x86_64-linux-gnu/ --binDir=/usr/bin/ --nobuild rebuild
```

### Testing Installation
Test that face detection is working properly:

```bash
cd ~/MagicMirror/modules/MMM-OneDrive
node test-face-detection.js
```

## Configuration

### Basic Configuration
Add face detection to your MMM-OneDrive config:

```javascript
{
  module: "MMM-OneDrive",
  position: "fullscreen_below",
  config: {
    kenBurnsEffect: true, // Enable Ken Burns effect
    faceDetection: {
      enabled: true, // Enable face detection
    },
    // ... other config options
  }
}
```

### Advanced Configuration
Fine-tune face detection parameters:

```javascript
faceDetection: {
  enabled: true, // Enable/disable face detection
  minFaceSize: 50, // Minimum face size in pixels
  maxFaceSize: 300, // Maximum face size in pixels  
  confidenceThreshold: 0.5, // Detection confidence (0-1)
  debugMode: false, // Save debug images with detection rectangles
},
```

### Configuration Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable face detection |
| `minFaceSize` | number | `50` | Minimum face size in pixels for detection |
| `maxFaceSize` | number | `300` | Maximum face size in pixels for detection |
| `confidenceThreshold` | number | `0.5` | Detection confidence threshold (0-1) |
| `debugMode` | boolean | `false` | Save debug images with face rectangles |

## How It Works

### Detection Process
1. **Photo Loading**: When a new photo is loaded, the system checks if face detection is enabled
2. **Image Analysis**: The photo is analyzed using OpenCV's Haar cascade face detector
3. **Focal Point Calculation**: 
   - **Single Face**: Centers on the face with some expansion
   - **Multiple Faces**: Creates bounding box around all faces
   - **No Faces**: Falls back to random focal point
4. **Ken Burns Animation**: Creates dynamic CSS keyframes with the calculated focal point
5. **Timing Logging**: Records processing time for performance monitoring

### Face Detection Algorithm
- Uses OpenCV's `HAAR_FRONTALFACE_ALT2` cascade classifier
- Configurable scale factor and minimum neighbors for accuracy vs. speed
- Size constraints prevent false positives from small artifacts
- Smart focal area expansion ensures faces aren't cut off during zoom

### Performance Considerations
- Face detection runs asynchronously to avoid blocking photo transitions
- Processing typically takes 100-500ms depending on image size and system performance
- Results are cached per photo session (not persisted between restarts)
- Failed detections gracefully fall back to random focal points

## Debug Mode

Enable debug mode to visualize face detection results:

```javascript
faceDetection: {
  enabled: true,
  debugMode: true, // Enable debug mode
},
```

Debug mode will:
- Save debug images to `cache/face_detection_debug.jpg`
- Draw green rectangles around detected faces
- Draw red rectangle around calculated focal point
- Log detailed detection information to console

## Troubleshooting

### Common Issues

**Face detection not working:**
- Verify OpenCV installation: `node test-face-detection.js`
- Check system dependencies are installed
- Review console logs for error messages

**Poor detection accuracy:**
- Adjust `minFaceSize` and `maxFaceSize` based on your photo collection
- Try different `confidenceThreshold` values
- Enable `debugMode` to see what's being detected

**Performance issues:**
- Monitor processing times in logs
- Consider increasing `updateInterval` for longer photo display times
- Adjust face size constraints to reduce processing load

### Performance Tuning

For optimal performance:
- **Faster Detection**: Increase `minFaceSize` to reduce false positives
- **Better Accuracy**: Decrease `minFaceSize` but expect longer processing times
- **Memory Usage**: Face detection is memory-efficient but may use more CPU

## Example Configurations

### Portrait Photos
```javascript
faceDetection: {
  enabled: true,
  minFaceSize: 80, // Larger minimum for portrait photos
  maxFaceSize: 400,
  confidenceThreshold: 0.6, // Higher confidence for better accuracy
},
```

### Group Photos
```javascript
faceDetection: {
  enabled: true,
  minFaceSize: 30, // Smaller minimum for distant faces
  maxFaceSize: 200,
  confidenceThreshold: 0.4, // Lower confidence to catch more faces
},
```

### High Performance
```javascript
faceDetection: {
  enabled: true,
  minFaceSize: 100, // Larger minimum for faster processing
  maxFaceSize: 250,
  confidenceThreshold: 0.7, // Higher confidence, fewer false positives
},
```

## Logging and Monitoring

The face detection feature provides detailed logging:

```
[MMM-OneDrive] Face detection result:
  - Processing time: 156ms
  - Face count: 2
  - Using face-detected focal point: 45.2%, 38.7%

[MMM-OneDrive] Ken Burns animation:
  - Animation name: ken-burns-1625097600000-123
  - Origin: 45.2% 38.7%
  - Start scale: 1.42
  - Total duration: 32s
  - Filename: family_photo.jpg
```

Monitor these logs to:
- Track face detection success rates
- Optimize performance parameters
- Debug detection issues
- Ensure proper functionality

## Future Enhancements

Potential future improvements:
- **Object Detection**: Detect pets, landmarks, or other interesting objects
- **Face Recognition**: Remember specific people and prioritize them
- **Quality Assessment**: Avoid blurry or poorly lit faces
- **Emotion Detection**: Prefer smiling faces for focal points
- **Performance Optimization**: GPU acceleration for faster processing

## Contributing

If you encounter issues or have suggestions for the face detection feature:
1. Check existing issues on GitHub
2. Enable debug mode and include debug output
3. Provide sample photos (if privacy allows)
4. Include system information and console logs
