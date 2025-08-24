/**
 * Vision Worker Process - Complete Isolated Vision Processing
 * 
 * This worker process handles ALL computer vision operations in isolation
 * to prevent OpenCV crashes from taking down the main MagicMirror process.
 * 
 * Complete processing pipeline:
 * 1. Face Detection (YOLO or Haar)  
 * 2. Interest Region Detection (fallback)
 * 3. Center Focal Point (final fallback)
 * 
 * Communication via IPC messages:
 * - Input: { type: 'PROCESS_IMAGE', imageBuffer: Buffer, filename: string, config: Object }
 * - Output: { type: 'PROCESSING_RESULT', result: { focalPoint, method, faces } }
 */

const path = require('path');

// Import OpenCV and utilities
const cv = require('@u4/opencv4nodejs');

// Import vision processing modules  
const { FaceDetector } = require('./faceDetection');
const InterestDetector = require('./interestDetection');
const { trackMat, safeRelease, logMatMemory, getMatStats } = require('./matManager');

class VisionWorker {
  constructor() {
    this.faceDetector = null;
    this.interestDetector = null;
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
      
      const faceDetectionEnabled = this.config?.faceDetection?.enabled !== false;
      console.debug(`[VisionWorker] Face detection enabled: ${faceDetectionEnabled}`);
      
      let result;
      
      if (!faceDetectionEnabled) {
        // Face detection disabled - return empty results for main process to handle
        console.log(`[VisionWorker] 🎬 Face detection disabled in config - returning empty results`);
        result = {
          faces: [],
          interestRegions: [],
          debugImageBase64: null
        };
      } else {
        // Run complete processing pipeline
        result = await this.performCompleteVisionProcessing(imageBuffer, filename);
      }
      
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

  /**
   * Complete Vision Processing Pipeline
   * Implements detection-only logic - returns all candidates for main process to decide
   */
  async performCompleteVisionProcessing(imageBuffer, filename) {
    console.debug(`[VisionWorker] 🔄 Starting complete vision pipeline for ${filename || 'unknown'}`);
    
    if (!this.isInitialized || !this.faceDetector || !this.interestDetector) {
      throw new Error('Vision processors not initialized');
    }
    
    // Configuration for detection
    const MAX_INTEREST_CANDIDATES = 3;
    const INTEREST_CONFIDENCE_THRESHOLD = 0.65; // Should match face confidence scale
    
    let faces = [];
    let interestRegions = [];
    
    // Step 1: Always try face detection
    try {
      console.debug(`[VisionWorker] Step 1: Attempting face detection...`);
      faces = await this.faceDetector.detectFacesOnly(imageBuffer);
      console.debug(`[VisionWorker] Face detection found ${faces.length} faces`);
    } catch (faceError) {
      console.warn(`[VisionWorker] Face detection failed:`, faceError.message);
      // Continue with faces = [] (empty array)
    }
    
    // Step 2: Always try interest detection (regardless of faces found)
    console.debug(`[VisionWorker] Step 2: Running interest detection...`);
    const matStatsBeforeInterest = getMatStats();
    
    try {
      const interestResult = await this.interestDetector.detectInterestRegions(imageBuffer);
      
      if (interestResult && interestResult.candidates && Array.isArray(interestResult.candidates)) {
        // Filter and sort candidates by confidence
        interestRegions = interestResult.candidates
          .filter(candidate => candidate.confidence >= INTEREST_CONFIDENCE_THRESHOLD)
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, MAX_INTEREST_CANDIDATES);
        
        console.debug(`[VisionWorker] Interest detection found ${interestRegions.length} candidates above ${INTEREST_CONFIDENCE_THRESHOLD} threshold`);
      } else if (interestResult && interestResult.focalPoint) {
        // Handle legacy single result format
        interestRegions = [{
          ...interestResult.focalPoint,
          confidence: interestResult.confidence || 0.7 // Default confidence for legacy results
        }];
        console.debug(`[VisionWorker] Interest detection found 1 legacy result`);
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
    
    console.log(`[VisionWorker] ✅ Detection completed: ${faces.length} faces, ${interestRegions.length} interest regions`);
    
    // Step 3: Create debug image if requested
    let debugImageBase64 = null;
    if (this.config?.debugMode) {
      try {
        console.debug(`[VisionWorker] Creating debug image for ${filename || 'unknown'} (${faces.length} faces, ${interestRegions.length} interests)`);
        debugImageBase64 = await this.createDebugImage(imageBuffer, faces, interestRegions);
        console.debug(`[VisionWorker] Debug image created successfully`);
      } catch (debugError) {
        console.warn(`[VisionWorker] Debug image creation failed:`, debugError.message);
      }
    }
    
    return {
      faces,
      interestRegions,
      debugImageBase64
    };
  }

  /**
   * Create debug image with face boxes and focal point overlay
   * @param {Buffer} imageBuffer - Original image buffer
   * @param {Array} faces - Array of face detection results
   * @param {Object} focalPoint - Focal point object
   * @returns {Promise<string>} Base64 encoded debug image
   */
  async createDebugImage(imageBuffer, faces, focalPoint) {
    let debugImage = null;
    
    try {
      // Handle IPC serialized buffers
      if (imageBuffer && typeof imageBuffer === 'object' && imageBuffer.type === 'Buffer' && Array.isArray(imageBuffer.data)) {
        imageBuffer = Buffer.from(imageBuffer.data);
      }
      
      // Load image using Sharp first for EXIF handling
      const sharp = require('sharp');
      const processedBuffer = await sharp(imageBuffer)
        .rotate() // Handle EXIF orientation
        .jpeg({ quality: 95 })
        .toBuffer();
      
      // Convert to OpenCV Mat
      debugImage = cv.imdecode(processedBuffer);
      trackMat(debugImage, 'debug image');
      
      // Draw face rectangles in green
      faces.forEach((face, index) => {
        const topLeft = new cv.Point2(face.x, face.y);
        const bottomRight = new cv.Point2(face.x + face.width, face.y + face.height);
        
        // Green rectangle for faces
        debugImage.drawRectangle(topLeft, bottomRight, new cv.Vec3(0, 255, 0), 3);
        
        // Add face index label
        const labelPos = new cv.Point2(face.x, face.y - 10);
        debugImage.putText(
          `Face ${index + 1}`,
          labelPos,
          cv.FONT_HERSHEY_SIMPLEX,
          0.7,
          new cv.Vec3(0, 255, 0),
          2
        );
      });
      
      // Draw focal point rectangle in blue
      if (focalPoint && typeof focalPoint.x === 'number') {
        let fpX, fpY, fpWidth, fpHeight;
        
        if (focalPoint.x <= 1 && focalPoint.y <= 1) {
          // Normalized coordinates (0-1)
          fpX = Math.round(focalPoint.x * debugImage.cols);
          fpY = Math.round(focalPoint.y * debugImage.rows);
          fpWidth = Math.round(focalPoint.width * debugImage.cols);
          fpHeight = Math.round(focalPoint.height * debugImage.rows);
        } else {
          // Absolute pixel coordinates
          fpX = focalPoint.x;
          fpY = focalPoint.y;
          fpWidth = focalPoint.width;
          fpHeight = focalPoint.height;
        }
        
        const fpTopLeft = new cv.Point2(fpX, fpY);
        const fpBottomRight = new cv.Point2(fpX + fpWidth, fpY + fpHeight);
        
        // Blue rectangle for focal point
        debugImage.drawRectangle(fpTopLeft, fpBottomRight, new cv.Vec3(255, 0, 0), 2);
        
        // Add focal point label
        const fpLabelPos = new cv.Point2(fpX, fpY - 10);
        debugImage.putText(
          `Focal (${focalPoint.method || 'unknown'})`,
          fpLabelPos,
          cv.FONT_HERSHEY_SIMPLEX,
          0.6,
          new cv.Vec3(255, 0, 0),
          2
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
      hasVisionProcessors: !!(this.faceDetector && this.interestDetector),
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
      hasVisionProcessors: !!(this.faceDetector && this.interestDetector),
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