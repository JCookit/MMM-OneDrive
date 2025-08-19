/**
 * Debug utilities for vision processing
 * Handles creation of debug images with face boxes, focal points, etc.
 */

const cv = require('@u4/opencv4nodejs');
const sharp = require('sharp');

class DebugImageCreator {
  
  /**
   * Load image from buffer using OpenCV with proper EXIF orientation handling
   * @param {Buffer} imageBuffer - Image data as Buffer
   * @returns {Promise<cv.Mat>} OpenCV Mat object
   */
  async loadImageFromBuffer(imageBuffer) {
    try {
      // Use Sharp to handle EXIF orientation and get consistent results
      const sharpImage = sharp(imageBuffer);
      
      // Get metadata to check orientation
      const metadata = await sharpImage.metadata();
      
      // Auto-rotate based on EXIF and convert to JPEG
      const buffer = await sharpImage
        .rotate() // This automatically handles EXIF orientation
        .jpeg({ quality: 95 }) // Higher quality for debug images
        .toBuffer();
      
      // Load into OpenCV
      const cvImage = cv.imdecode(buffer);
      
      return cvImage;
    } catch (error) {
      console.error(`[DebugUtils] Failed to load image from buffer:`, error.message);
      console.error(`[DebugUtils] Image loading error stack:`, error.stack);
      console.error(`[DebugUtils] Buffer info: length=${imageBuffer?.length}, type=${typeof imageBuffer}`);
      throw error;
    }
  }

  /**
   * Create debug image with face boxes and focal point
   * @param {Buffer} imageBuffer - Image data as Buffer  
   * @param {Array} faces - Array of face objects
   * @param {Object} focalPoint - Focal point rectangle (in pixel coordinates)
   * @returns {Promise<Object>} Debug result with marked image buffer
   */
  async createDebugImage(imageBuffer, faces, focalPoint) {
    try {
      console.log(`[DebugUtils] Creating debug image with ${faces.length} faces`);
      
      // Load image from buffer
      const image = await this.loadImageFromBuffer(imageBuffer);
      
      // Draw face rectangles in green
      faces.forEach((face, index) => {
        image.drawRectangle(
          new cv.Point2(face.x, face.y),
          new cv.Point2(face.x + face.width, face.y + face.height),
          new cv.Vec3(0, 255, 0), // Green
          2
        );
        
        // Add face number label
        image.putText(
          `Face ${index + 1}`,
          new cv.Point2(face.x, face.y - 5),
          cv.FONT_HERSHEY_SIMPLEX,
          0.5,
          new cv.Vec3(0, 255, 0),
          2
        );
      });

      // Draw focal point rectangle in red
      if (focalPoint) {
        // Convert focal point from percentage to pixel coordinates if needed
        let focalPixelX, focalPixelY, focalPixelWidth, focalPixelHeight;
        
        if (focalPoint.x <= 1.0 && focalPoint.y <= 1.0) {
          // Focal point is in percentage format, convert to pixels
          focalPixelX = Math.round(focalPoint.x * image.cols);
          focalPixelY = Math.round(focalPoint.y * image.rows);
          focalPixelWidth = Math.round(focalPoint.width * image.cols);
          focalPixelHeight = Math.round(focalPoint.height * image.rows);
        } else {
          // Focal point is already in pixel format
          focalPixelX = Math.round(focalPoint.x);
          focalPixelY = Math.round(focalPoint.y);
          focalPixelWidth = Math.round(focalPoint.width);
          focalPixelHeight = Math.round(focalPoint.height);
        }
        
        image.drawRectangle(
          new cv.Point2(focalPixelX, focalPixelY),
          new cv.Point2(focalPixelX + focalPixelWidth, focalPixelY + focalPixelHeight),
          new cv.Vec3(0, 0, 255), // Red
          3
        );
        // draw crosshair on center
        const halfX = focalPoint.x + (focalPoint.width/2);
        const halfY = focalPoint.y + (focalPoint.height/2);
        image.drawLine(
            new cv.Point2(halfX, halfY-50),
            new cv.Point2(halfX, halfY+50),
            new cv.Vec3(0,255,255),
            3);
        image.drawLine(
            new cv.Point2(halfX-50, halfY),
            new cv.Point2(halfX+50, halfY),
            new cv.Vec3(0,255,255),
            3);
        
        // Add focal point label
        const label = focalPoint.type ? `Focal Point (${focalPoint.type})` : 'Focal Point';
        image.putText(
          label,
          new cv.Point2(focalPixelX, focalPixelY - 10),
          cv.FONT_HERSHEY_SIMPLEX,
          0.6,
          new cv.Vec3(0, 0, 255),
          2
        );
      }

      // Convert to buffer
      const markedImageBuffer = cv.imencode('.jpg', image);
      
      return { markedImageBuffer };
      
    } catch (error) {
      console.error(`[DebugUtils] Debug image creation failed:`, error.message);
      throw error;
    }
  }

  /**
   * Create debug image with all detection details (faces, focal point, interest regions, etc.)
   * @param {Buffer} imageBuffer - Image data as Buffer
   * @param {Array} faces - Array of face objects
   * @param {Object} focalPoint - Focal point rectangle
   * @param {Array} interestRegions - Optional array of interest regions
   * @returns {Promise<Object>} Debug result with comprehensive marked image
   */
  async createComprehensiveDebugImage(imageBuffer, faces, focalPoint, interestRegions = []) {
    try {
      console.log(`[DebugUtils] Creating comprehensive debug image with ${faces.length} faces, ${interestRegions.length} interest regions`);
      
      // Load image from buffer
      const image = await this.loadImageFromBuffer(imageBuffer);
      
      // Draw interest regions in blue (if any)
      interestRegions.forEach((region, index) => {
        image.drawRectangle(
          new cv.Point2(region.x, region.y),
          new cv.Point2(region.x + region.width, region.y + region.height),
          new cv.Vec3(255, 128, 0), // Blue
          1
        );
        
        image.putText(
          `Interest ${index + 1}`,
          new cv.Point2(region.x, region.y - 5),
          cv.FONT_HERSHEY_SIMPLEX,
          0.4,
          new cv.Vec3(255, 128, 0),
          1
        );
      });
      
      // Draw face rectangles in green
      faces.forEach((face, index) => {
        image.drawRectangle(
          new cv.Point2(face.x, face.y),
          new cv.Point2(face.x + face.width, face.y + face.height),
          new cv.Vec3(0, 255, 0), // Green
          2
        );
        
        image.putText(
          `Face ${index + 1}`,
          new cv.Point2(face.x, face.y - 5),
          cv.FONT_HERSHEY_SIMPLEX,
          0.5,
          new cv.Vec3(0, 255, 0),
          2
        );
      });

      // Draw focal point rectangle in red (thickest line)
      if (focalPoint) {
        let focalPixelX, focalPixelY, focalPixelWidth, focalPixelHeight;
        
        if (focalPoint.x <= 1.0 && focalPoint.y <= 1.0) {
          focalPixelX = Math.round(focalPoint.x * image.cols);
          focalPixelY = Math.round(focalPoint.y * image.rows);
          focalPixelWidth = Math.round(focalPoint.width * image.cols);
          focalPixelHeight = Math.round(focalPoint.height * image.rows);
        } else {
          focalPixelX = Math.round(focalPoint.x);
          focalPixelY = Math.round(focalPoint.y);
          focalPixelWidth = Math.round(focalPoint.width);
          focalPixelHeight = Math.round(focalPoint.height);
        }
        
        image.drawRectangle(
          new cv.Point2(focalPixelX, focalPixelY),
          new cv.Point2(focalPixelX + focalPixelWidth, focalPixelY + focalPixelHeight),
          new cv.Vec3(0, 0, 255), // Red
          4 // Thickest line
        );
        
        const label = focalPoint.type ? `Focal (${focalPoint.type})` : 'Focal Point';
        image.putText(
          label,
          new cv.Point2(focalPixelX, focalPixelY - 15),
          cv.FONT_HERSHEY_SIMPLEX,
          0.7,
          new cv.Vec3(0, 0, 255),
          2
        );
      }

      const markedImageBuffer = cv.imencode('.jpg', image);
      console.log(`[DebugUtils] Comprehensive debug image created successfully`);
      return { markedImageBuffer };
      
    } catch (error) {
      console.error(`[DebugUtils] Comprehensive debug image creation failed:`, error.message);
      throw error;
    }
  }
}

// Export singleton instance
const debugImageCreator = new DebugImageCreator();

module.exports = {
  debugImageCreator,
  DebugImageCreator
};
