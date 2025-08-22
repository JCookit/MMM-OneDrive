# Vision Processing Refactor - Complete Process Isolation

## Overview

This refactor implements complete process separation for all computer vision operations in MMM-OneDrive. The OpenCV/YOLO processing now runs in an isolated child process to prevent crashes from affecting the main MagicMirror application.

## Architecture

### Before: Monolithic Processing
- All vision processing (face detection, interest detection, focal point calculation) in main MagicMirror process
- OpenCV crashes would kill entire MagicMirror
- Memory leaks affected main application
- No crash recovery

### After: Complete Process Isolation
- **Vision Worker Process**: Isolated OpenCV/YOLO processing with complete pipeline
- **Main Process**: Clean interface with no OpenCV dependencies
- **IPC Communication**: Message-based communication with timeouts and error handling
- **Automatic Recovery**: Worker restarts automatically on crashes
- **Unified Logging**: All output flows through main process

## Components

### 1. Vision Worker (`src/vision/vision-worker.js`)
**Purpose**: Complete isolated vision processing
- **Face Detection**: YOLO and Haar cascade detection
- **Interest Detection**: Fallback when no faces found  
- **Focal Point Calculation**: Complete logic from original `findInterestingRectangleFallback`
- **Process Management**: IPC communication, health checks, graceful shutdown
- **Memory Isolation**: 512MB memory limit, separate memory space
- **Crash Isolation**: Process crashes don't affect main MagicMirror

**Key Features**:
- Standalone mode for testing: `node src/vision/vision-worker.js --standalone`
- Complete processing pipeline: Face → Interest → Center fallback
- Configuration support via IPC messages
- Comprehensive error handling and crash recovery
- Mat object tracking and memory leak detection

### 2. Enhanced Node Helper (`node_helper.js`)
**Purpose**: Vision worker lifecycle management
- **Worker Management**: Spawn, monitor, restart worker processes
- **IPC Protocol**: Message routing with timeouts and error handling
- **Fallback Processing**: Minimal center-crop when worker unavailable  
- **Unified Logging**: Captures worker stdout/stderr for consistent logs
- **Clean Interface**: No OpenCV dependencies in main process

**Key Features**:
- Automatic worker restart on crashes
- Configurable memory limits and timeouts
- Request/response correlation with unique IDs
- Health monitoring and statistics collection
- Process cleanup on shutdown

### 3. Test Script (`test-vision-worker.js`)
**Purpose**: Independent testing of vision worker
```bash
node test-vision-worker.js cache/20250609_091819362_iOS.jpg
```

## IPC Protocol

### Main Process → Vision Worker
- `PROCESS_IMAGE`: Complete image processing request
- `UPDATE_CONFIG`: Configuration updates
- `HEALTH_CHECK`: Worker health verification
- `GET_STATS`: Memory and performance statistics
- `SHUTDOWN`: Graceful shutdown request

### Vision Worker → Main Process  
- `WORKER_READY`: Worker initialization complete
- `PROCESSING_RESULT`: Complete processing results
- `WORKER_ERROR`: Error during processing
- `HEALTH_CHECK_RESULT`: Health check response
- `STATS_RESULT`: Statistics response

## Complete Processing Pipeline

The vision worker implements the full original processing logic:

1. **Configuration Check**: Face detection enabled/disabled
2. **Face Detection**: YOLO (primary) or Haar (fallback)
3. **Focal Point from Faces**: Single face, multiple face bounding box
4. **Interest Detection**: Feature clustering and gradient analysis (no faces)
5. **Center Fallback**: Default center crop (final fallback)

## Benefits Achieved

### ✅ Crash Isolation
- OpenCV SIGSEGV crashes only kill worker process
- Main MagicMirror continues running normally
- Automatic worker restart for next image

### ✅ Memory Separation
- Worker runs with 512MB memory limit
- Memory leaks contained in worker process
- Main process remains clean

### ✅ Unified Logging
- All worker output captured by main process
- Consistent log format across platforms
- Clear distinction of worker vs main process logs

### ✅ Automatic Recovery
- Worker crashes detected immediately
- Automatic restart on next processing request
- Graceful degradation to center fallback

### ✅ Performance  
- Same processing performance as original
- Memory isolation equivalent to PM2
- IPC overhead minimal for single-threaded use case

## Configuration

Worker process configuration in `node_helper.js`:
```javascript
// Vision worker spawn options
const workerOptions = {
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  cwd: __dirname,
  env: { ...process.env },
  execArgv: ['--max-old-space-size=512'] // 512MB limit
};
```

Communication timeout (configurable):
```javascript
const VISION_WORKER_TIMEOUT = 30000; // 30 seconds
```

## Testing

### Standalone Worker Test
```bash
# Test vision worker initialization
node src/vision/vision-worker.js --standalone

# Test with actual image
node test-vision-worker.js cache/20250609_091819362_iOS.jpg
```

### Integration Test
```bash
# Full MagicMirror test with face detection enabled
npm start
```

## Backward Compatibility

- Original `findInterestingRectangle` interface unchanged
- Same focal point format returned
- Configuration options preserved
- Fallback behavior identical when worker unavailable

## Debugging

Worker process debugging:
```bash
# Enable detailed OpenCV debugging
DEBUG=opencv* node src/vision/vision-worker.js --standalone

# Test specific image processing
node test-vision-worker.js path/to/image.jpg 2>&1 | grep -E "(Error|Warn|YOLO|Face)"
```

## Future Enhancements

- Multiple worker processes for parallel processing
- Shared memory for large images (currently using IPC buffer)
- Worker process pooling and load balancing
- GPU acceleration support in worker
- WebAssembly OpenCV for browser compatibility

## Files Modified

### Core Components
- `src/vision/vision-worker.js` - **NEW**: Complete isolated vision processing
- `node_helper.js` - Enhanced with worker management, removed OpenCV imports
- `test-vision-worker.js` - **NEW**: Standalone testing script

### Vision Modules (Isolated to Worker)
- `src/vision/faceDetection.js` - Face detection (YOLO + Haar)
- `src/vision/interestDetection.js` - Interest region detection  
- `src/vision/matManager.js` - OpenCV memory management
- `models/yolo/yolov8n-face.onnx` - YOLO model (accessible to worker)

### Configuration
- Face detection configuration passed to worker via IPC
- No changes to module configuration format
- Backward compatible with existing configs

This refactor provides complete crash isolation while maintaining all original functionality and performance characteristics.
