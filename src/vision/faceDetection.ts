/**
 * Face Detection for Ken Burns Effect Focal Point
 * Uses OpenCV to detect faces and determine optimal crop areas
 */

import * as cv from '@u4/opencv4nodejs';
import sharp from 'sharp';

// Configuration constants for face detection
export const FACE_DETECTION_CONFIG = {
  // Face size constraints (pixels)
  MIN_FACE_SIZE: 50,
  MAX_FACE_SIZE: 300,
  
  // Distance from image edges (percentage)
  EDGE_BUFFER_PERCENT: 0.1,
  
  // Detection confidence
  CONFIDENCE_THRESHOLD: 0.5,
  
  // Scale factor for cascade detection
  SCALE_FACTOR: 1.1,
  
  // Minimum neighbors for face detection
  MIN_NEIGHBORS: 3,
  
  // Focal point expansion (percentage of face size)
  FOCAL_AREA_EXPANSION: 0.5,
};

export interface DetectionResult {
  faceCount: number;
  faces: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    confidence?: number;
  }>;
  focalPoint: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  processingTime: number;
  debugImageBuffer?: Buffer;
}

export class FaceDetector {
  private faceCascade: any; // cv.CascadeClassifier - using any to avoid TS issues
  
  constructor() {
    // Load the face cascade classifier
    try {
      this.faceCascade = new cv.CascadeClassifier(cv.HAAR_FRONTALFACE_ALT2);
    } catch (error) {
      console.error('[FaceDetector] Failed to load face cascade:', error);
      throw new Error('Could not initialize face detector');
    }
  }

  /**
   * Detect faces in an image and determine optimal focal point
   */
  async detectFaces(imagePath: string, drawDebugInfo = false): Promise<DetectionResult> {
    const startTime = Date.now();
    
    try {
      console.log(`[FaceDetector] Starting face detection for: ${imagePath}`);
      
      // Load and process the image
      const image = await this.loadImage(imagePath);
      const grayImage = image.bgrToGray();
      
      // Detect faces
      const faceRects = this.faceCascade.detectMultiScale(
        grayImage,
        FACE_DETECTION_CONFIG.SCALE_FACTOR,
        FACE_DETECTION_CONFIG.MIN_NEIGHBORS,
        0,
        new cv.Size(
          FACE_DETECTION_CONFIG.MIN_FACE_SIZE,
          FACE_DETECTION_CONFIG.MIN_FACE_SIZE
        ),
        new cv.Size(
          FACE_DETECTION_CONFIG.MAX_FACE_SIZE,
          FACE_DETECTION_CONFIG.MAX_FACE_SIZE
        )
      );

      console.log(`[FaceDetector] Detected ${faceRects.objects.length} faces`);

      // Convert OpenCV rectangles to our format
      const faces = faceRects.objects.map(rect => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        confidence: 1.0 // OpenCV's detectMultiScale doesn't return confidence
      }));

      // Calculate optimal focal point
      const focalPoint = this.calculateFocalPoint(faces, image.cols, image.rows);
      
      const processingTime = Date.now() - startTime;
      console.log(`[FaceDetector] Processing completed in ${processingTime}ms`);

      const result: DetectionResult = {
        faceCount: faces.length,
        faces,
        focalPoint,
        processingTime
      };

      // Generate debug image if requested
      if (drawDebugInfo) {
        result.debugImageBuffer = await this.drawDebugInfo(image, faces, focalPoint);
      }

      return result;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[FaceDetector] Error during detection (${processingTime}ms):`, error);
      
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
   * Load image using OpenCV
   */
  private async loadImage(imagePath: string): Promise<any> { // cv.Mat - using any for TS
    try {
      // Use Sharp to ensure we can read various formats and get consistent results
      const buffer = await sharp(imagePath)
        .jpeg({ quality: 90 })
        .toBuffer();
      
      // Load into OpenCV
      return cv.imdecode(buffer);
    } catch (error) {
      console.error(`[FaceDetector] Failed to load image ${imagePath}:`, error);
      throw error;
    }
  }

  /**
   * Calculate optimal focal point based on detected faces
   */
  private calculateFocalPoint(
    faces: Array<{ x: number; y: number; width: number; height: number }>,
    imageWidth: number,
    imageHeight: number
  ): { x: number; y: number; width: number; height: number } {
    
    if (faces.length === 0) {
      return this.getDefaultFocalPoint();
    }

    if (faces.length === 1) {
      // Single face - center on it with expansion
      const face = faces[0];
      const expansion = Math.max(face.width, face.height) * FACE_DETECTION_CONFIG.FOCAL_AREA_EXPANSION;
      
      return {
        x: Math.max(0, face.x - expansion / 2),
        y: Math.max(0, face.y - expansion / 2),
        width: Math.min(imageWidth, face.width + expansion),
        height: Math.min(imageHeight, face.height + expansion)
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

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Get default focal point (center of image)
   */
  private getDefaultFocalPoint(): { x: number; y: number; width: number; height: number } {
    // Default to center region - will be adjusted by caller based on actual image dimensions
    return {
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5
    };
  }

  /**
   * Draw debug information on image
   */
  private async drawDebugInfo(
    image: any, // cv.Mat - using any for TS
    faces: Array<{ x: number; y: number; width: number; height: number }>,
    focalPoint: { x: number; y: number; width: number; height: number }
  ): Promise<Buffer> {
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
export const faceDetector = new FaceDetector();
