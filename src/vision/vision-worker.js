/**
 * Vision Worker Process - Complete Isolated Vision Processing
 * 
 * This worker process handles ALL computer vision operations in isolation
 * to prevent OpenCV crashes from taking down the main MagicMirror process.
 * 
 * Complete processing pipeline:
 * 1. Face Detection (YOLO)  
 * 2. Interest Region Detection (fallback)
 * 3. Color Analysis (theming)
 * 
 * Communication via IPC messages:
 * - Input: { type: 'PROCESS_IMAGE', imageBuffer: Buffer, filename: string, config: Object }
 * - Output: { type: 'PROCESSING_RESULT', result: { faces, interestRegions, colorAnalysis } }
 * 
 * =================================================================================================
 * FILE NAVIGATION:
 * =================================================================================================
 * 1. INITIALIZATION & SETUP      - Lines 30-165  : Constructor, initialization, IPC setup
 * 2. IMAGE PREPROCESSING         - Lines 166-226 : Shared buffer/EXIF/Mat processing  
 * 3. IPC MESSAGE HANDLING        - Lines 227-328 : Message routing and error handling
 * 4. UNIFIED VISION PIPELINE     - Lines 330-468 : Main processing pipeline
 * 5. DEBUG IMAGE CREATION        - Lines 470-688 : Debug visualization with overlays
 * 6. UTILITY & LIFECYCLE METHODS - Lines 690-797 : Config, health checks, shutdown
 * =================================================================================================
 */

const path = require('path');

// Import OpenCV and utilities
const cv = require('@u4/opencv4nodejs');
const sharp = require('sharp');

// Import vision processing modules  
const { FaceDetector } = require('./faceDetection');
const InterestDetector = require('./interestDetection');
const ColorAnalyzer = require('./colorAnalysis');
const { trackMat, safeRelease, logMatMemory, getMatStats } = require('./matManager');

// =================================================================================================
// 1. INITIALIZATION & SETUP
// =================================================================================================

class VisionWorker {
  constructor() {
    this.faceDetector = null;
    this.interestDetector = null;
    this.colorAnalyzer = null;
    this.isInitialized = false;
    this.config = {};
    
    console.log('[VisionWorker] Starting vision worker process...');
    this.initialize();
    this.setupIPC();
  }

  // Helper method to safely send IPC messages
  safeSend(message) {
    if (process.send) {
      process.send(message);
    } else {
      console.log('[VisionWorker] [IPC]', JSON.stringify(message, null, 2));
    }
  }

  async initialize() {
    try {
      console.log('[VisionWorker] Initializing vision processors...');
      
      // Initialize Face Detector
      this.faceDetector = new FaceDetector();
      
      // Initialize Interest Detector
      this.interestDetector = new InterestDetector({
        sizeMode: 'adaptive',
        minConfidenceThreshold: 0.65,
        minScoreThreshold: 30,
        enableDebugLogs: false
      });
      
      // Initialize Color Analyzer
      this.colorAnalyzer = new ColorAnalyzer({
        maxColors: 5, // Return top 3 dominant colors
        kClusters: 6, // Use 4 clusters for better color separation
        maxImageSize: 800, // Resize large images for performance
        minColorPercentage: 0.01, // Lower threshold - ignore colors < 2%
        enableDebugLogs: true // Enable debug logging to diagnose issue
      });
      
      this.isInitialized = true;
      console.log('[VisionWorker] ✅ Vision worker initialized successfully');
      
      // Send ready signal to parent (only if running as child process)
      if (process.send) {
        this.safeSend({
          type: 'WORKER_READY',
          timestamp: Date.now()
        });
      } else {
        console.log('[VisionWorker] ✅ Initialized (standalone mode - no parent process)');
      }
      
    } catch (error) {
      console.error('[VisionWorker] ❌ Failed to initialize vision worker:', error.message);
      console.error('[VisionWorker] Initialization error stack:', error.stack);
      if (process.send) {
        this.safeSend({
          type: 'WORKER_ERROR', 
          error: error.message,
          stack: error.stack,
          timestamp: Date.now()
        });
      }
      process.exit(1);
    }
  }

  setupIPC() {
    // Only set up IPC if running as child process
    if (!process.send) {
      console.log('[VisionWorker] Running in standalone mode - no IPC setup');
      return;
    }
    
    process.on('message', async (message) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        console.error('[VisionWorker] Error handling message:', error.message);
        if (process.send) {
          this.safeSend({
            type: 'ERROR',
            error: error.message,
            requestId: message.requestId,
            timestamp: Date.now()
          });
        }
      }
    });

    process.on('disconnect', () => {
      console.log('[VisionWorker] Parent process disconnected, exiting...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('[VisionWorker] Received SIGTERM, shutting down gracefully...');
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      console.error('[VisionWorker] Uncaught exception:', error.message);
      console.error('[VisionWorker] Stack:', error.stack);
      this.safeSend({
        type: 'WORKER_CRASH',
        error: error.message,
        stack: error.stack,
        timestamp: Date.now()
      });
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('[VisionWorker] Unhandled rejection at:', promise, 'reason:', reason);
      this.safeSend({
        type: 'WORKER_CRASH',
        error: reason?.message || 'Unhandled rejection',
        timestamp: Date.now()
      });
      process.exit(1);
    });
  }

  // =================================================================================================
  // 2. IMAGE PREPROCESSING - Shared buffer handling, EXIF rotation, OpenCV Mat creation
  // =================================================================================================

  /**
   * Shared preprocessing function - handles buffer conversion, EXIF rotation, and OpenCV Mat creation
   * This eliminates redundant processing across face detection, interest detection, and color analysis
   * @param {Buffer} imageBuffer - Raw image buffer from IPC (may be serialized)
   * @param {string} filename - Filename for logging
   * @returns {Promise<cv.Mat>} Preprocessed OpenCV Mat with proper orientation
   */
  async preprocessImageBuffer(imageBuffer, filename = 'unknown') {
    let cvImage = null;
    
    try {
      console.debug(`[VisionWorker] 🔄 Preprocessing image buffer for ${filename}`);
      
      // Step 1: Handle IPC buffer serialization carefully
      let buffer = imageBuffer;
      if (!Buffer.isBuffer(imageBuffer)) {
        if (imageBuffer?.type === 'Buffer' && Array.isArray(imageBuffer?.data)) {
          // Handle Node.js buffer serialization from IPC
          buffer = Buffer.from(imageBuffer.data);
          console.debug(`[VisionWorker] Converted IPC serialized buffer: ${buffer.length} bytes`);
        } else {
          throw new Error(`Invalid buffer type: ${typeof imageBuffer}, isArray: ${Array.isArray(imageBuffer)}`);
        }
      } else {
        console.debug(`[VisionWorker] Using direct buffer: ${buffer.length} bytes`);
      }
      
      if (!buffer || buffer.length === 0) {
        throw new Error('Empty or invalid image buffer after conversion');
      }
      
      // Step 2: Use Sharp for EXIF orientation handling (consistent with face detection)
      console.debug(`[VisionWorker] Applying EXIF rotation and normalizing format...`);
      const sharpImage = sharp(buffer);
      
      // Auto-rotate based on EXIF and convert to JPEG for consistency
      const processedBuffer = await sharpImage
        .rotate() // Automatically handles EXIF orientation
        .jpeg({ quality: 95 }) // High quality for all vision processing
        .toBuffer();
        
      console.debug(`[VisionWorker] Sharp processing complete: ${processedBuffer.length} bytes`);
      
      // Step 3: Create OpenCV Mat from processed buffer
      cvImage = cv.imdecode(processedBuffer);
      
      if (!cvImage || cvImage.empty) {
        throw new Error('Failed to decode processed image buffer with OpenCV');
      }
      
      trackMat(cvImage, `preprocessed image for ${filename}`);
      console.debug(`[VisionWorker] ✅ Image preprocessing complete: ${cvImage.cols}x${cvImage.rows} pixels`);
      
      return cvImage;
      
    } catch (error) {
      console.error(`[VisionWorker] ❌ Image preprocessing failed for ${filename}:`, error.message);
      console.error(`[VisionWorker] Buffer info: length=${imageBuffer?.length}, type=${typeof imageBuffer}, isBuffer=${Buffer.isBuffer(imageBuffer)}`);
      
      // Clean up on error
      if (cvImage && !cvImage.empty) {
        safeRelease(cvImage, `failed preprocessing for ${filename}`);
      }
      
      throw error;
    }
  }

  // =================================================================================================
  // 3. IPC MESSAGE HANDLING - Message routing, error handling, and communication
  // =================================================================================================

  async handleMessage(message) {
    const { type, requestId } = message;
    
    console.debug(`[VisionWorker] Received message: ${type} (${requestId})`);
    
    switch (type) {
      case 'PROCESS_IMAGE':
        await this.handleCompleteImageProcessing(message);
        break;
      
      case 'UPDATE_CONFIG':
        this.handleConfigUpdate(message);
        break;
      
      case 'HEALTH_CHECK':
        this.handleHealthCheck(message);
        break;
      
      case 'GET_STATS':
        this.handleGetStats(message);
        break;
      
      case 'SHUTDOWN':
        console.log('[VisionWorker] Received shutdown request');
        process.exit(0);
        break;
      
      default:
        console.warn(`[VisionWorker] Unknown message type: ${type}`);
        this.safeSend({
          type: 'ERROR',
          error: `Unknown message type: ${type}`,
          requestId,
          timestamp: Date.now()
        });
    }
  }

  /**
   * Complete Image Processing Pipeline
   * This is the main entry point that implements the full findInterestingRectangle logic
   */
  async handleCompleteImageProcessing(message) {
    const { requestId, imageBuffer, filename, config } = message;
    const startTime = Date.now();
    
    try {
      console.debug(`[VisionWorker] 🎯 Starting complete image processing for: ${filename || 'unknown'}`);
      logMatMemory("BEFORE vision processing (worker)");
      
      // Update config if provided
      if (config) {
        this.config = { ...this.config, ...config };
      }
      
      // Run unified processing pipeline with shared preprocessing
      const result = await this.performUnifiedVisionProcessing(imageBuffer, filename);
      
      const processingTime = Date.now() - startTime;
      logMatMemory("AFTER vision processing (worker)");
      
      console.log(`[VisionWorker] ✅ Complete processing completed in ${processingTime}ms`);
      
      // Send result back to parent
      this.safeSend({
        type: 'PROCESSING_RESULT',
        requestId,
        result,
        processingTime,
        timestamp: Date.now()
      });
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[VisionWorker] ❌ Complete processing failed for ${filename || 'unknown'}:`, error.message);
      console.error(`[VisionWorker] Error stack:`, error.stack);
      logMatMemory("AFTER vision processing error (worker)");
      
      // Return error structure for main process to handle
      const errorResult = {
        faces: [],
        interestRegions: [],
        colorAnalysis: null,
        debugImageBase64: null,
        error: error.message
      };
      
      // Send error result back to parent
      this.safeSend({
        type: 'PROCESSING_RESULT',
        requestId,
        result: errorResult,
        processingTime,
        error: error.message,
        timestamp: Date.now()
      });
    }
  }

  // =================================================================================================
  // 4. UNIFIED VISION PIPELINE - Main processing with shared preprocessing
  // =================================================================================================

  /**
   * Unified Vision Processing Pipeline - Core processing method
   * Performs face detection, interest detection, and color analysis with shared preprocessing
   */
  async performUnifiedVisionProcessing(imageBuffer, filename) {
    console.debug(`[VisionWorker] 🔄 Starting unified vision pipeline for ${filename || 'unknown'}`);
    
    if (!this.isInitialized || !this.faceDetector || !this.interestDetector || !this.colorAnalyzer) {
      throw new Error('Vision processors not initialized');
    }
    
    let preprocessedImage = null;
    
    try {
      // Step 0: Shared preprocessing - buffer handling, EXIF rotation, OpenCV Mat creation
      preprocessedImage = await this.preprocessImageBuffer(imageBuffer, filename);
      
      // Configuration for detection
      const faceDetectionEnabled = this.config?.faceDetection?.enabled !== false;
      const interestDetectionEnabled = true; // Always enabled for fallback
      const colorAnalysisEnabled = false; // Always enabled for theming
      
      console.debug(`[VisionWorker] Pipeline config: face=${faceDetectionEnabled}, interest=${interestDetectionEnabled}, color=${colorAnalysisEnabled}`);
      
      let faces = [];
      let interestRegions = [];
      let colorAnalysis = null;
      
      // Step 1: Face Detection (if enabled)
      if (faceDetectionEnabled) {
        try {
          console.debug(`[VisionWorker] Step 1: Face detection...`);
          // Use the preprocessed Mat directly - no buffer handling needed
          faces = await this.faceDetector.detectFacesFromMat(preprocessedImage);
          console.debug(`[VisionWorker] Face detection found ${faces.length} faces`);
        } catch (faceError) {
          console.warn(`[VisionWorker] Face detection failed:`, faceError.message);
          // Continue with faces = [] (empty array)
        }
      } else {
        console.debug(`[VisionWorker] Step 1: Face detection disabled by config`);
      }
      
      // Step 2: Interest Detection (if enabled)
      if (interestDetectionEnabled) {
        console.debug(`[VisionWorker] Step 2: Interest detection...`);
        const matStatsBeforeInterest = getMatStats();
        
        try {
          // Use the preprocessed Mat directly - no buffer handling needed
          const interestResult = await this.interestDetector.detectInterestRegionsFromMat(preprocessedImage);
          
          if (interestResult && interestResult.candidates && Array.isArray(interestResult.candidates)) {
            const MAX_INTEREST_CANDIDATES = 3;
            const INTEREST_CONFIDENCE_THRESHOLD = 0.65;
            
            // Filter and sort candidates by confidence
            interestRegions = interestResult.candidates
              .filter(candidate => candidate.confidence >= INTEREST_CONFIDENCE_THRESHOLD)
              .sort((a, b) => b.confidence - a.confidence)
              .slice(0, MAX_INTEREST_CANDIDATES);
            
            console.debug(`[VisionWorker] Interest detection found ${interestRegions.length} candidates above ${INTEREST_CONFIDENCE_THRESHOLD} threshold`);
          }
          
          // Check for Mat leaks in interest detection
          const matStatsAfterInterest = getMatStats();
          if (matStatsAfterInterest.active > matStatsBeforeInterest.active) {
            console.warn(`[VisionWorker] ⚠️ Interest detection Mat leak: ${matStatsBeforeInterest.active} -> ${matStatsAfterInterest.active} active objects`);
          }
          
        } catch (interestError) {
          console.error(`[VisionWorker] Interest detection failed:`, interestError.message);
          console.error(`[VisionWorker] Interest detection error stack:`, interestError.stack);
          // Continue with interestRegions = [] (empty array)
        }
      } else {
        console.debug(`[VisionWorker] Step 2: Interest detection disabled by config`);
      }
      
      // Step 3: Color Analysis (if enabled)
      if (colorAnalysisEnabled) {
        try {
          console.debug(`[VisionWorker] Step 3: Color analysis...`);
          // Use the preprocessed Mat directly - no buffer handling needed
          colorAnalysis = await this.colorAnalyzer.analyzeColorsFromMat(preprocessedImage);
          
          if (colorAnalysis && colorAnalysis.dominantColors) {
            console.debug(`[VisionWorker] Color analysis found ${colorAnalysis.dominantColors.length} dominant colors`);
            colorAnalysis.dominantColors.forEach((color, i) => {
              console.debug(`[VisionWorker]   #${i + 1}: ${color.hexColor} (${(color.percentage * 100).toFixed(1)}%)`);
            });
          } else {
            console.debug(`[VisionWorker] Color analysis found no dominant colors`);
          }
          
        } catch (colorError) {
          console.error(`[VisionWorker] Color analysis failed:`, colorError.message);
          // Continue without color analysis
        }
      } else {
        console.debug(`[VisionWorker] Step 3: Color analysis disabled by config`);
      }
      
      console.log(`[VisionWorker] ✅ Unified pipeline completed: ${faces.length} faces, ${interestRegions.length} interest regions, colors: ${colorAnalysis?.dominantColors?.length || 0}`);
      
      // Step 4: Create debug image if requested
      let debugImageBase64 = null;
      if (this.config?.debugMode) {
        try {
          console.debug(`[VisionWorker] Creating debug image for ${filename || 'unknown'}`);
          // Use the preprocessed Mat directly for debug image
          debugImageBase64 = await this.createDebugImageFromMat(preprocessedImage, faces, interestRegions, colorAnalysis);
          console.debug(`[VisionWorker] Debug image created successfully`);
        } catch (debugError) {
          console.warn(`[VisionWorker] Debug image creation failed:`, debugError.message);
        }
      }
      
      return {
        faces,
        interestRegions,
        colorAnalysis,
        debugImageBase64
      };
      
    } finally {
      // CRITICAL: Release the shared preprocessed image
      if (preprocessedImage && !preprocessedImage.empty) {
        safeRelease(preprocessedImage, `preprocessed image for ${filename}`);
      }
    }
  }

  // =================================================================================================
  // 5. DEBUG IMAGE CREATION - Visual debugging with face boxes and interest region overlays  
  // =================================================================================================

  /**
   * Create debug image with face boxes, interest region overlays, and color swatches from Mat
   * @param {cv.Mat} preprocessedImage - Preprocessed OpenCV Mat
   * @param {Array} faces - Array of face detection results
   * @param {Array} interestRegions - Array of interest region candidates (ordered by confidence)
   * @param {Object} colorAnalysis - Color analysis results with dominant colors
   * @returns {Promise<string>} Base64 encoded debug image
   */
  async createDebugImageFromMat(preprocessedImage, faces, interestRegions, colorAnalysis) {
    let debugImage = null;
    
    try {
      // Use the preprocessed image directly - no need to decode buffer again
      debugImage = preprocessedImage.copy();
      trackMat(debugImage, 'debug image copy');
      
      // Draw face rectangles in green
      faces.forEach((face, index) => {
        const topLeft = new cv.Point2(face.x, face.y);
        const bottomRight = new cv.Point2(face.x + face.width, face.y + face.height);
        
        // Green rectangle for faces
        debugImage.drawRectangle(topLeft, bottomRight, new cv.Vec3(0, 255, 0), 3);
        
        // Add face index label
        const labelPos = new cv.Point2(face.x, face.y - 10);
        const confidence = face.confidence ? face.confidence.toFixed(2) : 'N/A';
        debugImage.putText(
          `Face ${index + 1} (${confidence})`,
          labelPos,
          cv.FONT_HERSHEY_SIMPLEX,
          0.7,
          new cv.Vec3(0, 255, 0),
          2
        );
      });
      
      // Draw all interest region rectangles
      if (interestRegions && Array.isArray(interestRegions) && interestRegions.length > 0) {
        interestRegions.forEach((region, index) => {
          if (region && typeof region.x === 'number') {
            let regionX, regionY, regionWidth, regionHeight;
            
            if (region.x <= 1 && region.y <= 1) {
              // Normalized coordinates (0-1)
              regionX = Math.round(region.x * debugImage.cols);
              regionY = Math.round(region.y * debugImage.rows);
              regionWidth = Math.round(region.width * debugImage.cols);
              regionHeight = Math.round(region.height * debugImage.rows);
            } else {
              // Absolute pixel coordinates
              regionX = region.x;
              regionY = region.y;
              regionWidth = region.width;
              regionHeight = region.height;
            }
            
            const topLeft = new cv.Point2(regionX, regionY);
            const bottomRight = new cv.Point2(regionX + regionWidth, regionY + regionHeight);
            
            // First candidate in red (primary choice), others in blue
            const isFirstCandidate = index === 0;
            const color = isFirstCandidate ? new cv.Vec3(0, 0, 255) : new cv.Vec3(255, 128, 0); // Red for first, orange for others
            const thickness = isFirstCandidate ? 3 : 2;
            
            debugImage.drawRectangle(topLeft, bottomRight, color, thickness);
            
            // Add interest region label with confidence
            const confidence = region.confidence ? region.confidence.toFixed(2) : 'N/A';
            const label = isFirstCandidate ? 
              `Interest #1 (${confidence})` : 
              `Interest #${index + 1} (${confidence})`;
            
            const labelPos = new cv.Point2(regionX, regionY - 10);
            debugImage.putText(
              label,
              labelPos,
              cv.FONT_HERSHEY_SIMPLEX,
              0.6,
              color,
              2
            );
            
            // Add crosshair for first candidate only
            if (isFirstCandidate) {
              const centerX = regionX + regionWidth / 2;
              const centerY = regionY + regionHeight / 2;
              const crossSize = Math.min(regionWidth, regionHeight) * 0.1; // 10% of smaller dimension
              
              // Horizontal line
              debugImage.drawLine(
                new cv.Point2(centerX - crossSize, centerY),
                new cv.Point2(centerX + crossSize, centerY),
                new cv.Vec3(255, 255, 0), // Yellow crosshair
                2
              );
              
              // Vertical line  
              debugImage.drawLine(
                new cv.Point2(centerX, centerY - crossSize),
                new cv.Point2(centerX, centerY + crossSize),
                new cv.Vec3(255, 255, 0), // Yellow crosshair
                2
              );
            }
          }
        });
      }
      
      // Draw color swatches in center of image if color analysis available
      if (colorAnalysis && colorAnalysis.dominantColors && colorAnalysis.dominantColors.length > 0) {
        const swatchSize = 100;
        const swatchMargin = 5;
        
        // Calculate center position
        const totalSwatchWidth = (colorAnalysis.dominantColors.length * swatchSize) + ((colorAnalysis.dominantColors.length - 1) * swatchMargin);
        const startX = Math.round((debugImage.cols - totalSwatchWidth) / 2);
        const startY = Math.round((debugImage.rows - swatchSize) / 2);
        
        colorAnalysis.dominantColors.forEach((color, index) => {
          const swatchX = startX + (index * (swatchSize + swatchMargin));
          const swatchY = startY;
          
          // Draw filled rectangle with the dominant color
          const topLeft = new cv.Point2(swatchX, swatchY);
          const bottomRight = new cv.Point2(swatchX + swatchSize, swatchY + swatchSize);
          
          // Fill the swatch with the color (OpenCV uses BGR)
          debugImage.drawRectangle(topLeft, bottomRight, new cv.Vec3(color.bgr[0], color.bgr[1], color.bgr[2]), -1); // -1 means filled
          
          // Add border around swatch
          debugImage.drawRectangle(topLeft, bottomRight, new cv.Vec3(0, 0, 0), 2); // Black border for contrast
          
          // Add percentage label below swatch
          const labelPos = new cv.Point2(swatchX, swatchY + swatchSize + 15);
          const percentage = (color.percentage * 100).toFixed(0);
          debugImage.putText(
            `${percentage}%`,
            labelPos,
            cv.FONT_HERSHEY_SIMPLEX,
            0.4,
            new cv.Vec3(0, 0, 0), // Black text with white outline for visibility
            2
          );
          
          // Add white outline for text visibility
          debugImage.putText(
            `${percentage}%`,
            labelPos,
            cv.FONT_HERSHEY_SIMPLEX,
            0.4,
            new cv.Vec3(255, 255, 255), // White outline
            1
          );
          
          // Add hex color label below percentage
          const hexLabelPos = new cv.Point2(swatchX - 5, swatchY + swatchSize + 30);
          debugImage.putText(
            color.hexColor,
            hexLabelPos,
            cv.FONT_HERSHEY_SIMPLEX,
            0.3,
            new cv.Vec3(0, 0, 0), // Black text
            2
          );
          
          // Add white outline for hex text
          debugImage.putText(
            color.hexColor,
            hexLabelPos,
            cv.FONT_HERSHEY_SIMPLEX,
            0.3,
            new cv.Vec3(255, 255, 255), // White outline
            1
          );
        });
        
        // Add title label above swatches
        const titleX = startX + Math.round(totalSwatchWidth / 2) - 40; // Center the title
        const titleY = startY - 10;
        const titlePos = new cv.Point2(titleX, titleY);
        
        debugImage.putText(
          'Dominant Colors',
          titlePos,
          cv.FONT_HERSHEY_SIMPLEX,
          0.5,
          new cv.Vec3(0, 0, 0), // Black text
          2
        );
        
        // White outline for title
        debugImage.putText(
          'Dominant Colors',
          titlePos,
          cv.FONT_HERSHEY_SIMPLEX,
          0.5,
          new cv.Vec3(255, 255, 255), // White outline
          1
        );
      }
      
      // Encode to JPEG buffer
      const encodedBuffer = cv.imencode('.jpg', debugImage);
      
      // Convert to base64
      const base64String = encodedBuffer.toString('base64');
      
      // Cleanup
      safeRelease(debugImage, 'debug image');
      
      return base64String;
      
    } catch (error) {
      console.error(`[VisionWorker] Debug image creation error:`, error.message);
      
      // Cleanup on error
      safeRelease(debugImage, 'debug image (error cleanup)');
      
      throw error;
    }
  }

  // =================================================================================================
  // 6. UTILITY & LIFECYCLE METHODS - Configuration, health checks, stats, and shutdown
  // =================================================================================================

  handleConfigUpdate(message) {
    const { requestId, config } = message;
    
    console.log(`[VisionWorker] Updating configuration:`, config);
    this.config = { ...this.config, ...config };
    
    this.safeSend({
      type: 'CONFIG_UPDATE_RESULT',
      requestId,
      success: true,
      timestamp: Date.now()
    });
  }

  handleHealthCheck(message) {
    const { requestId } = message;
    
    const stats = {
      isInitialized: this.isInitialized,
      hasVisionProcessors: !!(this.faceDetector && this.interestDetector && this.colorAnalyzer),
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      pid: process.pid,
      configLoaded: Object.keys(this.config).length > 0
    };
    
    console.log(`[VisionWorker] Health check - initialized: ${stats.isInitialized}, processors: ${stats.hasVisionProcessors}`);
    
    this.safeSend({
      type: 'HEALTH_CHECK_RESULT',
      requestId,
      stats,
      timestamp: Date.now()
    });
  }

  handleGetStats(message) {
    const { requestId } = message;
    
    const memUsage = process.memoryUsage();
    const stats = {
      memoryUsage: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024) // MB
      },
      uptime: Math.round(process.uptime()),
      pid: process.pid,
      isInitialized: this.isInitialized,
      hasVisionProcessors: !!(this.faceDetector && this.interestDetector && this.colorAnalyzer),
      matStats: getMatStats() // OpenCV Mat object tracking
    };
    
    this.safeSend({
      type: 'STATS_RESULT',
      requestId,
      stats,
      timestamp: Date.now()
    });
  }

  /**
   * Shutdown method for testing
   */
  async shutdown() {
    console.log('[VisionWorker] Shutting down...');
    this.isInitialized = false;
    // In a real scenario this would terminate the process, 
    // but for testing we just mark as shutdown
  }
}

// Support standalone mode for testing
const isStandalone = process.argv.includes('--standalone') || process.argv.includes('--test');

if (isStandalone) {
  // Standalone mode for testing
  console.log('[VisionWorker] Running in standalone mode for testing...');
  
  const worker = new VisionWorker();
  
  // Keep the process alive and wait for test input
  process.stdin.resume();
  
  console.log('[VisionWorker] Standalone mode ready. Use --help for testing commands.');
  console.log('[VisionWorker] Process will exit after 30 seconds of inactivity...');
  
  // Auto-exit after 30 seconds in standalone mode
  setTimeout(() => {
    console.log('[VisionWorker] Standalone mode timeout - exiting...');
    process.exit(0);
  }, 30000);
  
} else {
  // Normal IPC mode
  const worker = new VisionWorker();
}

// Keep the process alive
process.on('exit', (code) => {
  console.log(`[VisionWorker] Process exiting with code: ${code}`);
});

console.log(`[VisionWorker] Vision worker process started with PID: ${process.pid}`);

// Export the class for testing purposes
module.exports = VisionWorker;