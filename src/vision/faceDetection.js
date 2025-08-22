/**
 * Face Detection for Ken Burns Effect Focal Point
 * Uses OpenCV to detect faces and determine optimal crop areas
 */

const cv = require('@u4/opencv4nodejs');
const sharp = require('sharp');
const path = require('path');
const InterestDetector = require('./interestDetection');
const { trackMat, safeRelease, logMatMemory } = require('./matManager');

// Configuration constants for face detection
const FACE_DETECTION_CONFIG = {
  // Detection method: 'yolo' or 'haar'
  METHOD: 'yolo', // YOLO for best accuracy, fallback to haar
  
  // YOLO Configuration
  YOLO_CONFIDENCE_THRESHOLD: 0.6, // Increased from 0.4 to 0.6
  YOLO_NMS_THRESHOLD: 0.5,
  YOLO_INPUT_SIZE: 640, // Restored to 640 for better quality
  
  // Face size filtering (percentage of image dimensions)
  MIN_FACE_SIZE_PERCENT: 0.05, // Ignore faces smaller than 5% of image width/height
  
  // Haar Configuration (fallback)
  HAAR_SCALE_FACTOR: 1.05,
  HAAR_MIN_NEIGHBORS: 3,
  HAAR_MIN_SIZE: 80,
  HAAR_MAX_SIZE: 400,
  
  // Focal point expansion (percentage of face size)
  FOCAL_AREA_EXPANSION: 0.5,
};

class FaceDetector {
  constructor() {
    this.method = FACE_DETECTION_CONFIG.METHOD;
    
    // Initialize Interest Detector for fallback when no faces found
    this.interestDetector = new InterestDetector({
      sizeMode: 'adaptive', // Balanced sizing
      minConfidenceThreshold: 0.65, // Require decent confidence
      minScoreThreshold: 30, // Minimum interest score
      enableDebugLogs: false // Set to true for detailed logging
    });
    
    // Initialize Haar cascade (always available as fallback)
    try {
      this.faceCascade = new cv.CascadeClassifier(cv.HAAR_FRONTALFACE_ALT2);
    } catch (error) {
      console.error('[FaceDetector] Failed to load face cascade:', error);
      throw new Error('Could not initialize Haar face detector');
    }
    
    // Initialize YOLO model if method is set to 'yolo'
    if (this.method === 'yolo') {
      try {
        console.log('[FaceDetector] Loading YOLOv8-face model...');
        const yoloModelPath = path.join(__dirname, 'models', 'yolo', 'yolov8n-face.onnx');
        
        // Verify YOLO model exists
        const fs = require('fs');
        if (!fs.existsSync(yoloModelPath)) {
          throw new Error(`YOLO model file not found: ${yoloModelPath}`);
        }
        
        this.yoloNet = cv.readNetFromONNX(yoloModelPath);
        this.yoloNet.setPreferableBackend(cv.DNN_BACKEND_OPENCV);
        this.yoloNet.setPreferableTarget(cv.DNN_TARGET_CPU);
        console.log('[FaceDetector] YOLOv8-face model loaded successfully');
      } catch (error) {
        console.warn('[FaceDetector] Failed to load YOLO model, falling back to Haar:', error.message);
        this.method = 'haar'; // Fallback to Haar
        this.yoloNet = null;
      }
    }
    
    console.log(`[FaceDetector] Initialized using ${this.method} detection method`);
  }

  /**
   * Detect faces using YOLOv8-face model
   * @param {cv.Mat} image - OpenCV image
   * @returns {Array} Array of face objects with confidence scores
   */
  async detectFacesYOLO(image) {
    let blob = null;
    let outputs = null;
    try {
      const inputSize = FACE_DETECTION_CONFIG.YOLO_INPUT_SIZE;
      
      // CRITICAL: Add safety check before blob creation
      if (!image || image.empty || image.cols === 0 || image.rows === 0) {
        throw new Error('Invalid image for YOLO processing');
      }
      
      console.debug(`[FaceDetector] Creating YOLO blob ${inputSize}x${inputSize}...`);
      blob = cv.blobFromImage(
        image, 
        1.0 / 255.0,  // Scale to [0,1]
        new cv.Size(inputSize, inputSize), 
        new cv.Vec3(0, 0, 0), 
        true,  // swapRB
        false  // crop
      );
      trackMat(blob, 'YOLO blob');
      console.debug(`[FaceDetector] YOLO blob created successfully`);

      // Run inference with additional safety
      console.debug(`[FaceDetector] Running YOLO inference...`);
      this.yoloNet.setInput(blob);
      outputs = this.yoloNet.forward();
      trackMat(outputs, 'YOLO outputs');
      console.debug(`[FaceDetector] YOLO inference completed`);
      
      // Process YOLO detections
      const rawDetections = this.processYoloDetections(outputs, image.cols, image.rows, inputSize);
      const cleanDetections = this.applyNMS(rawDetections, 
        FACE_DETECTION_CONFIG.YOLO_NMS_THRESHOLD, 
        FACE_DETECTION_CONFIG.YOLO_CONFIDENCE_THRESHOLD
      );
      
      console.log(`[FaceDetector] YOLO found ${cleanDetections.length} faces`);
      
      // Convert to standard face format
      const faces = cleanDetections.map(det => ({
        x: Math.round(det.x1),
        y: Math.round(det.y1),
        width: Math.round(det.x2 - det.x1),
        height: Math.round(det.y2 - det.y1),
        confidence: det.confidence,
        centerX: Math.round(det.centerX),
        centerY: Math.round(det.centerY)
      }));
      
      // Return raw faces without size filtering (filtering happens in detectFacesOnly)
      return faces;
      
    } catch (error) {
      console.error('[FaceDetector] YOLO detection failed:', error.message);
      console.error('[FaceDetector] YOLO error stack:', error.stack);
      throw error;
    } finally {
      // CRITICAL: Release OpenCV Mat objects
      safeRelease(blob, 'YOLO blob');
      safeRelease(outputs, 'YOLO outputs');
    }
    
  }

  /**
   * Process YOLO output tensor to extract face detections
   */
  processYoloDetections(outputs, imgWidth, imgHeight, inputSize) {
    const detections = [];
    const numDetections = outputs.sizes[2]; // 8400
    
    for (let i = 0; i < numDetections; i++) {
      const x_center = outputs.at(0, 0, i);
      const y_center = outputs.at(0, 1, i);
      const width = outputs.at(0, 2, i);
      const height = outputs.at(0, 3, i);
      const confidence = outputs.at(0, 4, i);
      
      if (confidence > 0.1) { // Initial filter
        // Convert from input coordinates to image coordinates
        const scaleX = imgWidth / inputSize;
        const scaleY = imgHeight / inputSize;
        
        const centerX = x_center * scaleX;
        const centerY = y_center * scaleY;
        const w = width * scaleX;
        const h = height * scaleY;
        
        // Basic validation
        if (w > 30 && h > 30 && w < imgWidth * 0.9 && h < imgHeight * 0.9 &&
            centerX > 0 && centerY > 0 && centerX < imgWidth && centerY < imgHeight) {
          
          detections.push({
            confidence: confidence,
            centerX: centerX,
            centerY: centerY,
            width: w,
            height: h,
            x1: Math.max(0, centerX - w / 2),
            y1: Math.max(0, centerY - h / 2),
            x2: Math.min(imgWidth, centerX + w / 2),
            y2: Math.min(imgHeight, centerY + h / 2)
          });
        }
      }
    }
    
    return detections.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Apply Non-Maximum Suppression to remove duplicate detections
   */
  applyNMS(detections, iouThreshold = 0.5, confThreshold = 0.4) {
    const filtered = detections.filter(d => d.confidence >= confThreshold);
    if (filtered.length === 0) return [];
    
    // Simple NMS implementation (fallback if cv.dnn.NMSBoxes not available)
    try {
      // Try OpenCV's NMS first
      if (cv.dnn && cv.dnn.NMSBoxes) {
        const boxes = filtered.map(det => [det.x1, det.y1, det.x2 - det.x1, det.y2 - det.y1]);
        const scores = filtered.map(det => det.confidence);
        const indices = cv.dnn.NMSBoxes(boxes, scores, confThreshold, iouThreshold);
        return indices.map(idx => filtered[idx]);
      }
    } catch (error) {
      console.warn('[FaceDetector] OpenCV NMS not available, using simple NMS:', error.message);
    }
    
    // Fallback: Simple manual NMS
    const result = [];
    const sorted = filtered.sort((a, b) => b.confidence - a.confidence);
    
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      let shouldKeep = true;
      
      // Check overlap with already selected boxes
      for (const kept of result) {
        const iou = this.calculateIOU(current, kept);
        if (iou > iouThreshold) {
          shouldKeep = false;
          break;
        }
      }
      
      if (shouldKeep) {
        result.push(current);
      }
    }
    
    return result;
  }

  /**
   * Calculate Intersection over Union (IoU) between two bounding boxes
   */
  calculateIOU(box1, box2) {
    const x1 = Math.max(box1.x1, box2.x1);
    const y1 = Math.max(box1.y1, box2.y1);
    const x2 = Math.min(box1.x2, box2.x2);
    const y2 = Math.min(box1.y2, box2.y2);
    
    if (x2 <= x1 || y2 <= y1) return 0;
    
    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
    const area2 = (box2.x2 - box2.x1) * (box2.y2 - box2.y1);
    const union = area1 + area2 - intersection;
    
    return union > 0 ? intersection / union : 0;
  }



  /**
   * Detect faces using Haar cascades
   * @param {cv.Mat} image - OpenCV image (color)
   * @returns {Array} Array of face objects
   */
  async detectFacesHaar(image) {
    let grayImage = null;
    try {
      grayImage = image.bgrToGray();

      // Detect faces with configured parameters
      const detectParams = {
        scaleFactor: FACE_DETECTION_CONFIG.HAAR_SCALE_FACTOR,
        minNeighbors: FACE_DETECTION_CONFIG.HAAR_MIN_NEIGHBORS,
        minSize: new cv.Size(FACE_DETECTION_CONFIG.HAAR_MIN_SIZE, FACE_DETECTION_CONFIG.HAAR_MIN_SIZE),
        maxSize: new cv.Size(FACE_DETECTION_CONFIG.HAAR_MAX_SIZE, FACE_DETECTION_CONFIG.HAAR_MAX_SIZE)
      };

      const faceRects = this.faceCascade.detectMultiScale(
        grayImage,
        detectParams.scaleFactor,
        detectParams.minNeighbors,
        0,
        detectParams.minSize,
        detectParams.maxSize
      );

      console.log(`[FaceDetector] Haar found ${faceRects.objects.length} faces`);

      // Convert OpenCV rectangles to our format with validation
      const faces = faceRects.objects
        .map((rect, index) => {
          const isValid = rect.x >= 0 && rect.y >= 0 && 
                         rect.width > 0 && rect.height > 0 &&
                         rect.x + rect.width <= image.cols &&
                         rect.y + rect.height <= image.rows;
          
          const face = {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            confidence: 1.0, // Haar cascades don't provide confidence
            isValid,
            aspectRatio: rect.width / rect.height
          };
          
          if (!isValid) {
            console.warn(`[FaceDetector] Invalid Haar face rectangle ${index}:`, face);
          }
          
          return face;
        })
        .filter(face => face.isValid);
      
      return faces;
      
    } catch (error) {
      console.error('[FaceDetector] Haar detection failed:', error);
      throw error;
    } finally {
      // CRITICAL: Release the decoded image
      safeRelease(grayImage, 'Haar gray image');
    }
  }

  /**
   * Filter faces by minimum size threshold
   * @param {Array} faces - Array of face objects
   * @param {number} imageWidth - Image width in pixels
   * @param {number} imageHeight - Image height in pixels
   * @returns {Array} Filtered array of face objects
   */
  filterFacesBySize(faces, imageWidth, imageHeight) {
    const minWidth = imageWidth * FACE_DETECTION_CONFIG.MIN_FACE_SIZE_PERCENT;
    const minHeight = imageHeight * FACE_DETECTION_CONFIG.MIN_FACE_SIZE_PERCENT;
    
    const sizeFilteredFaces = faces.filter(face => {
      const widthOk = face.width >= minWidth;
      const heightOk = face.height >= minHeight;
      return widthOk && heightOk;
    });
    
    if (sizeFilteredFaces.length < faces.length) {
      console.debug(`[FaceDetector] Filtered out ${faces.length - sizeFilteredFaces.length} small faces (keeping ${sizeFilteredFaces.length})`);
    }
    return sizeFilteredFaces;
  }


  /**
   * Load image from buffer using OpenCV with proper EXIF orientation handling
   * @param {Buffer} imageBuffer - Image data as Buffer
   * @returns {Promise<cv.Mat>} OpenCV Mat object
   */
  async loadImageFromBuffer(imageBuffer) {
    let cvImage = null;
    
    try {
      // Debug buffer information
      console.debug(`[FaceDetector] Loading image from buffer: length=${imageBuffer?.length}, type=${typeof imageBuffer}, isBuffer=${Buffer.isBuffer(imageBuffer)}`);
      
      if (!imageBuffer) {
        throw new Error('No image buffer provided');
      }
      
      // Convert to Buffer if needed (IPC might serialize it differently)
      let buffer = imageBuffer;
      if (!Buffer.isBuffer(imageBuffer)) {
        if (imageBuffer.type === 'Buffer' && Array.isArray(imageBuffer.data)) {
          // Handle Node.js buffer serialization from IPC
          buffer = Buffer.from(imageBuffer.data);
          console.log(`[FaceDetector] Converted serialized buffer: ${buffer.length} bytes`);
        } else {
          throw new Error(`Invalid buffer type: ${typeof imageBuffer}, isArray: ${Array.isArray(imageBuffer)}`);
        }
      }
      
      // Use Sharp to handle EXIF orientation and get consistent results
      const sharpImage = sharp(buffer);
      
      // Get metadata to check orientation
      const metadata = await sharpImage.metadata();
      console.log(`[FaceDetector] Image metadata: ${metadata.width}x${metadata.height}, format=${metadata.format}`);
      
      // Auto-rotate based on EXIF and convert to JPEG
      const processedBuffer = await sharpImage
        .rotate() // This automatically handles EXIF orientation
        .jpeg({ quality: 95 }) // Higher quality for face detection
        .toBuffer();
      
      // Load into OpenCV
      cvImage = cv.imdecode(processedBuffer);
      
      if (!cvImage || cvImage.empty) {
        throw new Error('Failed to decode image with OpenCV');
      }
      
      console.log(`[FaceDetector] Image loaded successfully: ${cvImage.cols}x${cvImage.rows}`);
      return cvImage;
      
    } catch (error) {
      console.error(`[FaceDetector] Failed to load image from buffer:`, error.message);
      console.error(`[FaceDetector] Image loading error stack:`, error.stack);
      console.error(`[FaceDetector] Buffer info: length=${imageBuffer?.length}, type=${typeof imageBuffer}, isBuffer=${Buffer.isBuffer(imageBuffer)}`);

      // Clean up on error
      if (cvImage && !cvImage.empty) {
        cvImage.release();
      }
      throw error;
    } 
  }

  /**
   * Load image using OpenCV with proper EXIF orientation handling
   */
  async loadImage(imagePath) {
    try {
      // Use Sharp to handle EXIF orientation and get consistent results
      const sharpImage = sharp(imagePath);
      
      // Get metadata to check orientation
      const metadata = await sharpImage.metadata();
      
      // Auto-rotate based on EXIF and convert to JPEG
      const buffer = await sharpImage
        .rotate() // This automatically handles EXIF orientation
        .jpeg({ quality: 95 }) // Higher quality for face detection
        .toBuffer();
      
      // Load into OpenCV
      const cvImage = cv.imdecode(buffer);
      
      return cvImage;
    } catch (error) {
      console.error(`[FaceDetector] Failed to load image ${imagePath}:`, error);
      throw error;
    }
  }

  /**
   * Calculate optimal focal point based on detected faces or interesting regions
   * Returns coordinates as percentages (0.0 to 1.0)
   */
  async calculateFocalPoint(faces, imageWidth, imageHeight, cvImage) {
    
    if (faces.length === 0) {
      console.log('[FaceDetector] No faces detected, using interest detection fallback');
      
      try {
        const interestRegion = await this.interestDetector.findInterestingRegion(cvImage);
        
        if (interestRegion) {
          console.log(`[FaceDetector] Found ${interestRegion.type} region (score: ${interestRegion.score.toFixed(1)})`);
          
          // Convert to percentages and return with special marking
          const focalPoint = {
            x: interestRegion.x / imageWidth,
            y: interestRegion.y / imageHeight,
            width: interestRegion.width / imageWidth,
            height: interestRegion.height / imageHeight,
            type: 'interest_region',
            method: interestRegion.method,
            score: interestRegion.score,
            confidence: interestRegion.confidence,
            processingTime: interestRegion.processingTime
          };
          
          return focalPoint;
        } else {
          console.log('[FaceDetector] No suitable interest regions found, using center fallback');
        }
      } catch (error) {
        console.warn('[FaceDetector] Interest detection failed:', error.message);
      }
      
      // Final fallback to center
      return this.getDefaultFocalPoint();
    }

    if (faces.length === 1) {
      // Single face - use exact face boundaries (no expansion/padding)
      const face = faces[0];
      
      // Use exact face dimensions without expansion
      const pixelFocal = {
        x: face.x,
        y: face.y,
        width: face.width,
        height: face.height
      };
      
      // Convert to percentages
      return {
        x: pixelFocal.x / imageWidth,
        y: pixelFocal.y / imageHeight,
        width: pixelFocal.width / imageWidth,
        height: pixelFocal.height / imageHeight,
        type: 'single_face'
      };
    }

    // Multiple faces - find tight bounding box that contains all faces (no buffer)
    let minX = Math.min(...faces.map(f => f.x));
    let minY = Math.min(...faces.map(f => f.y));
    let maxX = Math.max(...faces.map(f => f.x + f.width));
    let maxY = Math.max(...faces.map(f => f.y + f.height));

    // No buffer - use exact bounding box around faces
    // (removed the buffer calculation and expansion)

    // Convert to percentages
    return {
      x: minX / imageWidth,
      y: minY / imageHeight,
      width: (maxX - minX) / imageWidth,
      height: (maxY - minY) / imageHeight,
      type: 'multiple_faces'
    };
  }

  /**
   * Get default focal point (center of image)
   */
  getDefaultFocalPoint() {
    // Default to center region - will be adjusted by caller based on actual image dimensions
    return {
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5
    };
  }

  /**
   * Draw ALL face rectangles and focal point rectangle on image
   */
  // async drawAllDetections(image, faces, focalPoint) {
  //   try {
  //     // Clone the image for drawing
  //     const markedImage = image.copy();

  //     // Draw ALL individual face rectangles in bright green
  //     faces.forEach((face, index) => {
  //       markedImage.drawRectangle(
  //         new cv.Point2(face.x, face.y),
  //         new cv.Point2(face.x + face.width, face.y + face.height),
  //         new cv.Vec3(0, 255, 0), // Bright Green for individual faces
  //         3
  //       );
        
  //       // Add face number label
  //       markedImage.putText(
  //         `Face ${index + 1}`,
  //         new cv.Point2(face.x, face.y - 5),
  //         cv.FONT_HERSHEY_SIMPLEX,
  //         0.6,
  //         new cv.Vec3(0, 255, 0),
  //         2
  //       );
  //     });

  //     // Draw focal point rectangle with color based on detection type
  //     // Convert focal point from percentage to pixel coordinates  
  //     const focalPixelX = Math.round(focalPoint.x * image.cols);
  //     const focalPixelY = Math.round(focalPoint.y * image.rows);
  //     const focalPixelWidth = Math.round(focalPoint.width * image.cols);
  //     const focalPixelHeight = Math.round(focalPoint.height * image.rows);
      
  //     // Choose color based on focal point type
  //     let focalColor, focalLabel;
  //     if (focalPoint.type === 'interest_region') {
  //       focalColor = new cv.Vec3(255, 165, 0); // Orange for interest regions
  //       focalLabel = `Interest Area (${focalPoint.method})`;
  //     } else if (focalPoint.type === 'single_face') {
  //       focalColor = new cv.Vec3(0, 0, 255); // Red for single face
  //       focalLabel = 'Face Focal Area';
  //     } else if (focalPoint.type === 'multiple_faces') {
  //       focalColor = new cv.Vec3(0, 0, 255); // Red for multiple faces
  //       focalLabel = `Multi-Face Area (${faces.length})`;
  //     } else {
  //       focalColor = new cv.Vec3(128, 128, 128); // Gray for default/center fallback
  //       focalLabel = 'Default Center';
  //     }
      
  //     markedImage.drawRectangle(
  //       new cv.Point2(focalPixelX, focalPixelY),
  //       new cv.Point2(focalPixelX + focalPixelWidth, focalPixelY + focalPixelHeight),
  //       focalColor,
  //       4 // Thicker line for focal point
  //     );
      
  //     // Add focal point label
  //     markedImage.putText(
  //       focalLabel,
  //       new cv.Point2(focalPixelX, focalPixelY - 10),
  //       cv.FONT_HERSHEY_SIMPLEX,
  //       0.7,
  //       focalColor,
  //       2
  //     );

  //     // Convert back to buffer
  //     return cv.imencode('.jpg', markedImage);
  //   } catch (error) {
  //     console.error('[FaceDetector] Error creating marked image with all detections:', error);
  //     throw error;
  //   }
  // }

  /**
   * Draw only the focal point rectangle on image
   */
  // async drawFocalPointOnly(image, focalPoint) {
  //   try {
  //     // Clone the image for drawing
  //     const markedImage = image.copy();

  //     // Convert focal point from percentage to pixel coordinates
  //     const focalPixelX = Math.round(focalPoint.x * image.cols);
  //     const focalPixelY = Math.round(focalPoint.y * image.rows);
  //     const focalPixelWidth = Math.round(focalPoint.width * image.cols);
  //     const focalPixelHeight = Math.round(focalPoint.height * image.rows);

  //     // Draw focal point rectangle in bright red
  //     markedImage.drawRectangle(
  //       new cv.Point2(focalPixelX, focalPixelY),
  //       new cv.Point2(focalPixelX + focalPixelWidth, focalPixelY + focalPixelHeight),
  //       new cv.Vec3(0, 0, 255), // Bright Red
  //       4 // Thicker line for visibility
  //     );

  //     // Convert back to buffer
  //     return cv.imencode('.jpg', markedImage);
  //   } catch (error) {
  //     console.error('[FaceDetector] Error creating marked image:', error);
  //     throw error;
  //   }
  // }

  /**
   * Draw debug information on image
   */
  // async drawDebugInfo(image, faces, focalPoint) {
  //   try {
  //     // Clone the image for drawing
  //     const debugImage = image.copy();

  //     // Draw face rectangles in green
  //     faces.forEach(face => {
  //       debugImage.drawRectangle(
  //         new cv.Point2(face.x, face.y),
  //         new cv.Point2(face.x + face.width, face.y + face.height),
  //         new cv.Vec3(0, 255, 0), // Green
  //         2
  //       );
  //     });

  //     // Draw focal point rectangle in red
  //     debugImage.drawRectangle(
  //       new cv.Point2(focalPoint.x, focalPoint.y),
  //       new cv.Point2(focalPoint.x + focalPoint.width, focalPoint.y + focalPoint.height),
  //       new cv.Vec3(0, 0, 255), // Red
  //       3
  //     );

  //     // Convert back to buffer
  //     return cv.imencode('.jpg', debugImage);
  //   } catch (error) {
  //     console.error('[FaceDetector] Error creating debug image:', error);
  //     throw error;
  //   }
  // }

  /**
   * Pure face detection - only returns array of face objects
   * @param {Buffer} imageBuffer - Image data as Buffer
   * @returns {Promise<Array>} Array of face objects: [{ x, y, width, height, confidence }]
   */
  async detectFacesOnly(imageBuffer) {
    let image = null;
    logMatMemory("BEFORE face detection");
    
    try {
      // Load image from buffer
      image = await this.loadImageFromBuffer(imageBuffer);
      trackMat(image, 'decoded image');
      
      // Detect faces using selected method
      let faces = [];
      if (this.method === 'yolo' && this.yoloNet) {
        try {
          console.log(`[FaceDetector] Using YOLO detection`);
          faces = await this.detectFacesYOLO(image);
          
          // If YOLO finds no faces, try Haar as fallback for better coverage
          if (faces.length === 0) {
            console.log(`[FaceDetector] YOLO found no faces, trying Haar fallback...`);
            const haarFaces = await this.detectFacesHaar(image);
            if (haarFaces.length > 0) {
              console.log(`[FaceDetector] Haar fallback found ${haarFaces.length} faces`);
              faces = haarFaces;
            }
          }
        } catch (error) {
          console.warn('[FaceDetector] YOLO failed, falling back to Haar:', error.message);
          faces = await this.detectFacesHaar(image);
        }
      } else {
        console.log(`[FaceDetector] Using Haar detection`);
        faces = await this.detectFacesHaar(image);
      }
      
      // Filter faces by size
      const sizeFilteredFaces = this.filterFacesBySize(faces, image.cols, image.rows);
      logMatMemory("AFTER face detection");
      console.log(`[FaceDetector] ✅ Face detection complete: ${sizeFilteredFaces.length} faces found`);
      
      return sizeFilteredFaces;
      
    } catch (error) {
      console.error(`[FaceDetector] ❌ Pure face detection failed:`, error.message);
      console.error(`[FaceDetector] Error stack:`, error.stack);
      return []; // Return empty array on failure
    } finally {
      // CRITICAL: Release all Mat objects
      safeRelease(image, 'decoded image');
      logMatMemory("AFTER face detection cleanup");
    }
  }


}

// Export singleton instance
const faceDetector = new FaceDetector();

module.exports = {
  faceDetector,
  FACE_DETECTION_CONFIG,
  FaceDetector
};
