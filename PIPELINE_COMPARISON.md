# Face Detection Pipeline Comparison

## Original System Flow (BEFORE Refactor)
```
Photo Processing → buffer (unchanged)
    ↓
node_helper.js:findInterestingRectangle(buffer, filename)
    ↓
node_helper.js:performFaceDetection(imageBuffer, filename)
    ↓
dynamic import { faceDetector } from './src/vision/faceDetection.js'
    ↓
faceDetector.detectFacesOnly(imageBuffer)  [singleton instance]
    ↓
FaceDetector.loadImageFromBuffer(imageBuffer)
    ↓
Sharp Processing:
    - sharp(imageBuffer)
    - .rotate()  // EXIF orientation handling
    - .jpeg({ quality: 95 })
    - .toBuffer()
    ↓
cv.imdecode(buffer) → cvImage
    ↓
FaceDetector.detectFacesYOLO(cvImage)
    ↓
YOLO Processing:
    - cv.blobFromImage(image, 1.0/255.0, Size(640,640), Vec3(0,0,0), true, false)
    - yoloNet.setInput(blob)
    - outputs = yoloNet.forward()
    - processYoloDetections(outputs, image.cols, image.rows, 640)
```

## Current System Flow (AFTER Refactor)
```
Photo Processing → buffer (unchanged)
    ↓
node_helper.js:findInterestingRectangle(buffer, filename)
    ↓
sendVisionWorkerMessage({ type: 'PROCESS_IMAGE', imageBuffer: buffer, ... })
    ↓
[IPC BOUNDARY - Process Separation]
    ↓
vision-worker.js:performCompleteVisionProcessing(imageBuffer, filename)
    ↓
this.faceDetector.detectFacesOnly(imageBuffer)  [new instance]
    ↓
FaceDetector.loadImageFromBuffer(imageBuffer)
    ↓
IPC Buffer Handling:
    - Check if Buffer.isBuffer(imageBuffer)
    - Convert serialized buffer: Buffer.from(imageBuffer.data) if needed
    ↓
Sharp Processing:
    - sharp(buffer)
    - .rotate()  // EXIF orientation handling 
    - .jpeg({ quality: 95 })
    - .toBuffer()
    ↓
cv.imdecode(processedBuffer) → cvImage
    ↓
FaceDetector.detectFacesYOLO(cvImage)
    ↓
YOLO Processing:
    - cv.blobFromImage(image, 1.0/255.0, Size(640,640), Vec3(0,0,0), true, false)
    - yoloNet.setInput(blob)
    - outputs = yoloNet.forward()
    - processYoloDetections(outputs, image.cols, image.rows, 640)
```

## Key Differences Identified

### 1. **Buffer Serialization/Deserialization (IPC)**
- **Original**: Direct Buffer object passed through functions
- **Current**: Buffer serialized through IPC, needs deserialization
- **Potential Issue**: `imageBuffer.type === 'Buffer' && Array.isArray(imageBuffer.data)`
- **Impact**: Could affect image data integrity

### 2. **FaceDetector Instance**
- **Original**: Singleton instance `faceDetector` (shared state)
- **Current**: New instance `new FaceDetector()` (fresh state)
- **Potential Issue**: Different initialization state
- **Impact**: Model loading, configuration differences

### 3. **Error Handling Context**
- **Original**: Errors occur in main process
- **Current**: Errors occur in worker process, serialized back
- **Potential Issue**: Error context may be lost
- **Impact**: Different error recovery paths

### 4. **Memory Management**
- **Original**: Direct OpenCV Mat lifecycle in main process
- **Current**: OpenCV Mats in isolated worker process
- **Potential Issue**: Mat tracking across IPC boundary
- **Impact**: Memory leaks or premature releases

### 5. **Import Method**
- **Original**: Dynamic `await import()` with ES modules
- **Current**: Regular `require()` with CommonJS
- **Potential Issue**: Module loading timing differences
- **Impact**: Different module resolution or caching

## Hypothesis for YOLO Failure

**Most Likely Cause**: IPC Buffer Serialization Issue

The buffer serialization/deserialization across the IPC boundary may be corrupting the image data. When Node.js serializes a Buffer through IPC, it converts it to:

```javascript
{
  type: 'Buffer',
  data: [byte array]
}
```

The current code handles this with:
```javascript
if (imageBuffer.type === 'Buffer' && Array.isArray(imageBuffer.data)) {
  buffer = Buffer.from(imageBuffer.data);
}
```

However, this reconstruction might introduce subtle differences in:
1. **Data alignment** - Buffer reconstruction may change memory alignment
2. **Metadata loss** - Original buffer properties might be lost
3. **Timing** - Sharp processing on reconstructed buffer might behave differently

## Verification Strategy

1. **Test Buffer Integrity**: Compare original vs reconstructed buffer byte-for-byte
2. **Test Sharp Output**: Compare Sharp output between original and reconstructed buffers
3. **Test OpenCV Decoding**: Compare cv.imdecode results
4. **Test YOLO Input**: Compare blob creation from both image sources

## Next Steps

1. Create test that compares buffer integrity across IPC boundary
2. Test YOLO with direct buffer vs reconstructed buffer
3. If buffer corruption confirmed, implement alternative IPC mechanism (shared memory/file)
