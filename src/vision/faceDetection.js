/**
 * Face Detection for Ken Burns Effect Focal Point
 * Uses OpenCV to detect faces and determine optimal crop areas
 */

const cv = require('@u4/opencv4nodejs');
const sharp = require('sharp');
const path = require('path');

// Configuration constants for face detection
const FACE_DETECTION_CONFIG = {
  // Detection method: 'haar' or 'dnn'
  METHOD: 'haar', // Change to 'dnn' when DNN support is available
  
  // DNN Configuration
  DNN_CONFIDENCE_THRESHOLD: 0.7,
  DNN_INPUT_SIZE: 300,
  DNN_MEAN_SUBTRACTION: [104, 117, 123],
  
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
    
    // Initialize Haar cascade (always available as fallback)
    try {
      this.faceCascade = new cv.CascadeClassifier(cv.HAAR_FRONTALFACE_ALT2);
      console.log('[FaceDetector] Haar cascade classifier loaded');
    } catch (error) {
      console.error('[FaceDetector] Failed to load face cascade:', error);
      throw new Error('Could not initialize Haar face detector');
    }
    
    // Initialize DNN model if method is set to 'dnn'
    if (this.method === 'dnn') {
      try {
        // Check if DNN module is available in OpenCV
        if (!cv.dnn) {
          console.warn('[FaceDetector] DNN module not available in OpenCV build, falling back to Haar cascades');
          this.method = 'haar';
        } else {
          console.log('[FaceDetector] Loading DNN face detection model...');
          const modelPath = path.join(__dirname, '..', '..', 'models', 'opencv_face_detector_uint8.pb');
          const configPath = path.join(__dirname, '..', '..', 'models', 'opencv_face_detector.pbtxt');
          this.dnnNet = cv.readNetFromTensorflow(modelPath, configPath);
          console.log('[FaceDetector] DNN model loaded successfully');
        }
      } catch (error) {
        console.warn('[FaceDetector] Failed to load DNN model, falling back to Haar cascades:', error.message);
        this.method = 'haar'; // Fallback to Haar
        this.dnnNet = null;
      }
    }
    
    console.log(`[FaceDetector] Using detection method: ${this.method}`);
  }

  /**
   * Detect faces in an image and determine optimal focal point
   */
//   async detectFaces(imagePath, drawDebugInfo = false) {
//     const startTime = Date.now();
    
//     try {
//       console.log(`[FaceDetector] Starting face detection for: ${imagePath}`);
      
//       // Load and process the image
//       const image = await this.loadImage(imagePath);
//       const grayImage = image.bgrToGray();
      
//       console.log(`[FaceDetector] Converting to grayscale: ${grayImage.cols}x${grayImage.rows}`);

//       // Detect faces with more aggressive parameters
//       const detectParams = {
//         scaleFactor: 1.05,  // More fine-grained scale steps (was 1.1)
//         minNeighbors: 3,    // Less strict neighbor requirement (was 5)
//         minSize: new cv.Size(80, 80),  // Smaller minimum face size
//         maxSize: new cv.Size()  // No maximum size limit
//       };
      
//       console.log(`[FaceDetector] detectMultiScale parameters:`, {
//         scaleFactor: detectParams.scaleFactor,
//         minNeighbors: detectParams.minNeighbors,
//         minSize: `${detectParams.minSize.width}x${detectParams.minSize.height}`,
//         maxSize: detectParams.maxSize.width ? `${detectParams.maxSize.width}x${detectParams.maxSize.height}` : 'unlimited'
//       });

//       const faceRects = this.faceCascade.detectMultiScale(
//         grayImage,
//         detectParams.scaleFactor,
//         detectParams.minNeighbors,
//         0,
//         detectParams.minSize,
//         detectParams.maxSize
//       );

//       console.log(`[FaceDetector] detectMultiScale returned ${faceRects.objects.length} face rectangles`);

//       console.log(`[FaceDetector] Raw face detections:`, faceRects.objects.map((rect, i) => ({
//         index: i,
//         x: rect.x,
//         y: rect.y,
//         width: rect.width,
//         height: rect.height,
//         area: rect.width * rect.height
//       })));

//       // Convert OpenCV rectangles to our format with validation
//       const faces = faceRects.objects
//         .map((rect, index) => {
//           // Validate rectangle bounds
//           const isValid = rect.x >= 0 && rect.y >= 0 && 
//                          rect.width > 0 && rect.height > 0 &&
//                          rect.x + rect.width <= image.cols &&
//                          rect.y + rect.height <= image.rows;
          
//           const face = {
//             x: rect.x,
//             y: rect.y,
//             width: rect.width,
//             height: rect.height,
//             confidence: 1.0, // OpenCV's detectMultiScale doesn't return confidence
//             isValid,
//             aspectRatio: rect.width / rect.height
//           };
          
//           if (!isValid) {
//             console.warn(`[FaceDetector] Invalid face rectangle ${index}:`, face);
//             console.warn(`[FaceDetector] Image bounds: ${image.cols}x${image.rows}`);
//           }
          
//           if (face.aspectRatio < 0.5 || face.aspectRatio > 2.0) {
//             console.warn(`[FaceDetector] Unusual face aspect ratio ${index}: ${face.aspectRatio.toFixed(2)}`);
//           }
          
//           return face;
//         })
//         .filter(face => face.isValid); // Only keep valid faces
        
//       console.log(`[FaceDetector] Valid faces after filtering: ${faces.length}`);

//       // Calculate optimal focal point
//       const focalPoint = this.calculateFocalPoint(faces, image.cols, image.rows);
      
//       const processingTime = Date.now() - startTime;
//       console.log(`[FaceDetector] Processing completed in ${processingTime}ms`);

//       const result = {
//         faceCount: faces.length,
//         faces,
//         focalPoint,
//         processingTime
//       };

//       // Generate debug/marked image with ALL face rectangles AND focal point burned in
//       if (drawDebugInfo) {
//         result.debugImageBuffer = await this.drawDebugInfo(image, faces, focalPoint);
//         result.markedImageBuffer = result.debugImageBuffer; // Same as debug for now
//       } else {
//         // Always burn in ALL face rectangles AND the focal point rectangle for visualization
//         result.markedImageBuffer = await this.drawAllDetections(image, faces, focalPoint);
//       }

//       return result;

//     } catch (error) {
//       const processingTime = Date.now() - startTime;
//       console.error(`[FaceDetector] Error during detection (${processingTime}ms):`, error);
      
//       // Return fallback result
//       return {
//         faceCount: 0,
//         faces: [],
//         focalPoint: this.getDefaultFocalPoint(),
//         processingTime,
//         debugImageBuffer: undefined
//       };
//     }
//   }

  /**
   * Detect faces using DNN model
   * @param {cv.Mat} image - OpenCV image
   * @returns {Array} Array of face objects with confidence scores
   */
  async detectFacesDNN(image) {
    try {
      console.log(`[FaceDetector] Using DNN detection on ${image.cols}x${image.rows} image`);
      
      // Create blob from image
      const blob = cv.blobFromImage(
        image,
        1.0, // scale factor
        new cv.Size(FACE_DETECTION_CONFIG.DNN_INPUT_SIZE, FACE_DETECTION_CONFIG.DNN_INPUT_SIZE),
        FACE_DETECTION_CONFIG.DNN_MEAN_SUBTRACTION
      );
      
      // Set input and run forward pass
      this.dnnNet.setInput(blob);
      const detections = this.dnnNet.forward();
      
      console.log(`[FaceDetector] DNN forward pass completed, detections shape: ${detections.rows}x${detections.cols}`);
      
      const faces = [];
      for (let i = 0; i < detections.rows; i++) {
        const confidence = detections.at(0, 0, i, 2);
        
        if (confidence > FACE_DETECTION_CONFIG.DNN_CONFIDENCE_THRESHOLD) {
          const x = detections.at(0, 0, i, 3) * image.cols;
          const y = detections.at(0, 0, i, 4) * image.rows;
          const width = (detections.at(0, 0, i, 5) - detections.at(0, 0, i, 3)) * image.cols;
          const height = (detections.at(0, 0, i, 6) - detections.at(0, 0, i, 4)) * image.rows;
          
          // Validate bounds
          const isValid = x >= 0 && y >= 0 && width > 0 && height > 0 &&
                         x + width <= image.cols && y + height <= image.rows;
          
          if (isValid) {
            faces.push({
              x: Math.round(x),
              y: Math.round(y),
              width: Math.round(width),
              height: Math.round(height),
              confidence: confidence,
              isValid: true,
              aspectRatio: width / height
            });
          }
        }
      }
      
      console.log(`[FaceDetector] DNN detected ${faces.length} faces above confidence threshold ${FACE_DETECTION_CONFIG.DNN_CONFIDENCE_THRESHOLD}`);
      
      return faces;
      
    } catch (error) {
      console.error('[FaceDetector] DNN detection failed:', error);
      throw error;
    }
  }

  /**
   * Detect faces using Haar cascades
   * @param {cv.Mat} image - OpenCV image (color)
   * @returns {Array} Array of face objects
   */
  async detectFacesHaar(image) {
    try {
      console.log(`[FaceDetector] Using Haar cascade detection on ${image.cols}x${image.rows} image`);
      
      const grayImage = image.bgrToGray();
      console.log(`[FaceDetector] Converting to grayscale: ${grayImage.cols}x${grayImage.rows}`);

      // Detect faces with configured parameters
      const detectParams = {
        scaleFactor: FACE_DETECTION_CONFIG.HAAR_SCALE_FACTOR,
        minNeighbors: FACE_DETECTION_CONFIG.HAAR_MIN_NEIGHBORS,
        minSize: new cv.Size(FACE_DETECTION_CONFIG.HAAR_MIN_SIZE, FACE_DETECTION_CONFIG.HAAR_MIN_SIZE),
        maxSize: new cv.Size(FACE_DETECTION_CONFIG.HAAR_MAX_SIZE, FACE_DETECTION_CONFIG.HAAR_MAX_SIZE)
      };
      
      console.log(`[FaceDetector] Haar detectMultiScale parameters:`, {
        scaleFactor: detectParams.scaleFactor,
        minNeighbors: detectParams.minNeighbors,
        minSize: `${detectParams.minSize.width}x${detectParams.minSize.height}`,
        maxSize: `${detectParams.maxSize.width}x${detectParams.maxSize.height}`
      });

      const faceRects = this.faceCascade.detectMultiScale(
        grayImage,
        detectParams.scaleFactor,
        detectParams.minNeighbors,
        0,
        detectParams.minSize,
        detectParams.maxSize
      );

      console.log(`[FaceDetector] Haar detectMultiScale returned ${faceRects.objects.length} face rectangles`);

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
        
      console.log(`[FaceDetector] Haar valid faces after filtering: ${faces.length}`);
      
      return faces;
      
    } catch (error) {
      console.error('[FaceDetector] Haar detection failed:', error);
      throw error;
    }
  }

  /**
   * Detect faces directly from image buffer (no file I/O required)
   * @param {Buffer} imageBuffer - Image data as Buffer
   * @param {boolean} drawDebugInfo - Whether to create debug images
   * @returns {Promise<{faceCount: number, faces: Array, focalPoint: Object, processingTime: number, markedImageBuffer?: Buffer}>}
   */
  async detectFacesFromBuffer(imageBuffer, drawDebugInfo = false) {
    const startTime = Date.now();
    
    try {
      console.log(`[FaceDetector] Starting face detection from buffer (${imageBuffer.length} bytes)`);
      
      // Load and process the image directly from buffer
      const image = await this.loadImageFromBuffer(imageBuffer);
      
      // Detect faces using selected method (DNN or Haar)
      let faces = [];
      if (this.method === 'dnn' && this.dnnNet) {
        try {
          faces = await this.detectFacesDNN(image);
        } catch (error) {
          console.warn('[FaceDetector] DNN detection failed, falling back to Haar:', error.message);
          faces = await this.detectFacesHaar(image);
        }
      } else {
        faces = await this.detectFacesHaar(image);
      }
      
      // Log detection results
      if (faces.length > 0) {
        console.log(`[FaceDetector] Raw face detections:`, faces.map((face, i) => ({
          index: i,
          x: face.x,
          y: face.y,
          width: face.width,
          height: face.height,
          confidence: face.confidence.toFixed(3),
          area: face.width * face.height
        })));
        
        // Validate aspect ratios
        faces.forEach((face, index) => {
          if (face.aspectRatio < 0.5 || face.aspectRatio > 2.0) {
            console.warn(`[FaceDetector] Unusual face aspect ratio ${index}: ${face.aspectRatio.toFixed(2)}`);
          }
        });
      }
      
      console.log(`[FaceDetector] Final face count: ${faces.length}`);

      // Calculate optimal focal point
      const focalPoint = this.calculateFocalPoint(faces, image.cols, image.rows);
      
      const processingTime = Date.now() - startTime;
      console.log(`[FaceDetector] Processing completed in ${processingTime}ms`);

      const result = {
        faceCount: faces.length,
        faces,
        focalPoint,
        processingTime
      };

      // Create marked image with all detections
      if (drawDebugInfo) {
        result.debugImageBuffer = await this.drawDebugInfo(image, faces, focalPoint);
        result.markedImageBuffer = result.debugImageBuffer; // Same as debug for now
      } else {
        // Always burn in ALL face rectangles AND the focal point rectangle for visualization
        result.markedImageBuffer = await this.drawAllDetections(image, faces, focalPoint);
      }

      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[FaceDetector] Error during buffer detection (${processingTime}ms):`, error);
      
      // Return fallback result
      return {
        faceCount: 0,
        faces: [],
        focalPoint: this.getDefaultFocalPoint(),
        processingTime,
        debugImageBuffer: undefined
      };
    }
  }

  /**
   * Load image from buffer using OpenCV with proper EXIF orientation handling
   * @param {Buffer} imageBuffer - Image data as Buffer
   * @returns {Promise<cv.Mat>} OpenCV Mat object
   */
  async loadImageFromBuffer(imageBuffer) {
    try {
      console.log(`[FaceDetector] Loading image from buffer (${imageBuffer.length} bytes)`);
      
      // Use Sharp to handle EXIF orientation and get consistent results
      const sharpImage = sharp(imageBuffer);
      
      // Get metadata to check orientation
      const metadata = await sharpImage.metadata();
      console.log(`[FaceDetector] Image metadata:`, {
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        format: metadata.format,
        hasProfile: !!metadata.icc,
        exif: !!metadata.exif
      });
      
      // Auto-rotate based on EXIF and convert to JPEG
      const buffer = await sharpImage
        .rotate() // This automatically handles EXIF orientation
        .jpeg({ quality: 95 }) // Higher quality for face detection
        .toBuffer();
      
      console.log(`[FaceDetector] Processed image buffer size: ${buffer.length} bytes`);
      
      // Load into OpenCV
      const cvImage = cv.imdecode(buffer);
      console.log(`[FaceDetector] OpenCV image dimensions: ${cvImage.cols}x${cvImage.rows}, channels: ${cvImage.channels}`);
      
      return cvImage;
    } catch (error) {
      console.error(`[FaceDetector] Failed to load image from buffer:`, error);
      throw error;
    }
  }

  /**
   * Load image using OpenCV with proper EXIF orientation handling
   */
  async loadImage(imagePath) {
    try {
      console.log(`[FaceDetector] Loading image: ${imagePath}`);
      
      // Use Sharp to handle EXIF orientation and get consistent results
      const sharpImage = sharp(imagePath);
      
      // Get metadata to check orientation
      const metadata = await sharpImage.metadata();
      console.log(`[FaceDetector] Image metadata:`, {
        width: metadata.width,
        height: metadata.height,
        orientation: metadata.orientation,
        format: metadata.format,
        hasProfile: !!metadata.icc,
        exif: !!metadata.exif
      });
      
      // Auto-rotate based on EXIF and convert to JPEG
      const buffer = await sharpImage
        .rotate() // This automatically handles EXIF orientation
        .jpeg({ quality: 95 }) // Higher quality for face detection
        .toBuffer();
      
      console.log(`[FaceDetector] Processed image buffer size: ${buffer.length} bytes`);
      
      // Load into OpenCV
      const cvImage = cv.imdecode(buffer);
      console.log(`[FaceDetector] OpenCV image dimensions: ${cvImage.cols}x${cvImage.rows}, channels: ${cvImage.channels}`);
      
      return cvImage;
    } catch (error) {
      console.error(`[FaceDetector] Failed to load image ${imagePath}:`, error);
      throw error;
    }
  }

  /**
   * Calculate optimal focal point based on detected faces
   * Returns coordinates as percentages (0.0 to 1.0)
   */
  calculateFocalPoint(faces, imageWidth, imageHeight) {
    
    if (faces.length === 0) {
      return this.getDefaultFocalPoint();
    }

    if (faces.length === 1) {
      // Single face - center on it with expansion
      const face = faces[0];
      const expansion = Math.max(face.width, face.height) * FACE_DETECTION_CONFIG.FOCAL_AREA_EXPANSION;
      
      // Calculate in pixels first
      const pixelFocal = {
        x: Math.max(0, face.x - expansion / 2),
        y: Math.max(0, face.y - expansion / 2),
        width: Math.min(imageWidth, face.width + expansion),
        height: Math.min(imageHeight, face.height + expansion)
      };
      
      // Convert to percentages
      return {
        x: pixelFocal.x / imageWidth,
        y: pixelFocal.y / imageHeight,
        width: pixelFocal.width / imageWidth,
        height: pixelFocal.height / imageHeight
      };
    }

    // Multiple faces - find bounding box that contains all faces
    let minX = Math.min(...faces.map(f => f.x));
    let minY = Math.min(...faces.map(f => f.y));
    let maxX = Math.max(...faces.map(f => f.x + f.width));
    let maxY = Math.max(...faces.map(f => f.y + f.height));

    // Add buffer around the group
    const groupWidth = maxX - minX;
    const groupHeight = maxY - minY;
    const buffer = Math.max(groupWidth, groupHeight) * FACE_DETECTION_CONFIG.FOCAL_AREA_EXPANSION;

    minX = Math.max(0, minX - buffer / 2);
    minY = Math.max(0, minY - buffer / 2);
    maxX = Math.min(imageWidth, maxX + buffer / 2);
    maxY = Math.min(imageHeight, maxY + buffer / 2);

    // Convert to percentages
    return {
      x: minX / imageWidth,
      y: minY / imageHeight,
      width: (maxX - minX) / imageWidth,
      height: (maxY - minY) / imageHeight
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
  async drawAllDetections(image, faces, focalPoint) {
    try {
      // Clone the image for drawing
      const markedImage = image.copy();

      console.log(`[FaceDetector] Drawing ${faces.length} face rectangles and focal point`);
      console.log(`[FaceDetector] Image dimensions: ${image.cols}x${image.rows}`);

      // Draw ALL individual face rectangles in bright green
      faces.forEach((face, index) => {
        console.log(`[FaceDetector] Face ${index + 1}: x=${face.x}, y=${face.y}, w=${face.width}, h=${face.height}`);
        
        markedImage.drawRectangle(
          new cv.Point2(face.x, face.y),
          new cv.Point2(face.x + face.width, face.y + face.height),
          new cv.Vec3(0, 255, 0), // Bright Green for individual faces
          3
        );
        
        // Add face number label
        markedImage.putText(
          `Face ${index + 1}`,
          new cv.Point2(face.x, face.y - 5),
          cv.FONT_HERSHEY_SIMPLEX,
          0.6,
          new cv.Vec3(0, 255, 0),
          2
        );
      });

      // Draw focal point rectangle in bright red (this is what Ken Burns will use)
      // Convert focal point from percentage to pixel coordinates  
      const focalPixelX = Math.round(focalPoint.x * image.cols);
      const focalPixelY = Math.round(focalPoint.y * image.rows);
      const focalPixelWidth = Math.round(focalPoint.width * image.cols);
      const focalPixelHeight = Math.round(focalPoint.height * image.rows);
      
      console.log(`[FaceDetector] Drawing focal point: ${focalPixelX},${focalPixelY} ${focalPixelWidth}x${focalPixelHeight} (from percentages: ${focalPoint.x},${focalPoint.y} ${focalPoint.width}x${focalPoint.height})`);
      markedImage.drawRectangle(
        new cv.Point2(focalPixelX, focalPixelY),
        new cv.Point2(focalPixelX + focalPixelWidth, focalPixelY + focalPixelHeight),
        new cv.Vec3(0, 0, 255), // Bright Red for focal point
        4 // Thicker line for focal point
      );
      
      // Add focal point label
      markedImage.putText(
        'Focal Area',
        new cv.Point2(focalPixelX, focalPixelY - 10),
        cv.FONT_HERSHEY_SIMPLEX,
        0.7,
        new cv.Vec3(0, 0, 255),
        2
      );

      // Convert back to buffer
      return cv.imencode('.jpg', markedImage);
    } catch (error) {
      console.error('[FaceDetector] Error creating marked image with all detections:', error);
      throw error;
    }
  }

  /**
   * Draw only the focal point rectangle on image
   */
  async drawFocalPointOnly(image, focalPoint) {
    try {
      // Clone the image for drawing
      const markedImage = image.copy();

      // Convert focal point from percentage to pixel coordinates
      const focalPixelX = Math.round(focalPoint.x * image.cols);
      const focalPixelY = Math.round(focalPoint.y * image.rows);
      const focalPixelWidth = Math.round(focalPoint.width * image.cols);
      const focalPixelHeight = Math.round(focalPoint.height * image.rows);
      
      console.log(`[FaceDetector] Drawing focal point: ${focalPixelX},${focalPixelY} ${focalPixelWidth}x${focalPixelHeight} (from percentages: ${focalPoint.x},${focalPoint.y} ${focalPoint.width}x${focalPoint.height})`);

      // Draw focal point rectangle in bright red
      markedImage.drawRectangle(
        new cv.Point2(focalPixelX, focalPixelY),
        new cv.Point2(focalPixelX + focalPixelWidth, focalPixelY + focalPixelHeight),
        new cv.Vec3(0, 0, 255), // Bright Red
        4 // Thicker line for visibility
      );

      // Convert back to buffer
      return cv.imencode('.jpg', markedImage);
    } catch (error) {
      console.error('[FaceDetector] Error creating marked image:', error);
      throw error;
    }
  }

  /**
   * Draw debug information on image
   */
  async drawDebugInfo(image, faces, focalPoint) {
    try {
      // Clone the image for drawing
      const debugImage = image.copy();

      // Draw face rectangles in green
      faces.forEach(face => {
        debugImage.drawRectangle(
          new cv.Point2(face.x, face.y),
          new cv.Point2(face.x + face.width, face.y + face.height),
          new cv.Vec3(0, 255, 0), // Green
          2
        );
      });

      // Draw focal point rectangle in red
      debugImage.drawRectangle(
        new cv.Point2(focalPoint.x, focalPoint.y),
        new cv.Point2(focalPoint.x + focalPoint.width, focalPoint.y + focalPoint.height),
        new cv.Vec3(0, 0, 255), // Red
        3
      );

      // Convert back to buffer
      return cv.imencode('.jpg', debugImage);
    } catch (error) {
      console.error('[FaceDetector] Error creating debug image:', error);
      throw error;
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
