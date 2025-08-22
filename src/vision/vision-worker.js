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
    
    console.log(`[VisionWorker] Received message: ${type} (${requestId})`);
    
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
      console.log(`[VisionWorker] 🎯 Starting complete image processing for: ${filename || 'unknown'}`);
      logMatMemory("BEFORE vision processing (worker)");
      
      // Update config if provided
      if (config) {
        this.config = { ...this.config, ...config };
      }
      
      const faceDetectionEnabled = this.config?.faceDetection?.enabled !== false;
      console.log(`[VisionWorker] Face detection enabled: ${faceDetectionEnabled}`);
      
      let result;
      
      if (!faceDetectionEnabled) {
        // Face detection disabled - return center focal point immediately
        console.log(`[VisionWorker] 🎬 Face detection disabled in config - using center focal point`);
        result = {
          focalPoint: {
            x: 0.25,
            y: 0.25,
            width: 0.5,
            height: 0.5,
            type: 'center_fallback',
            method: 'face_detection_disabled'
          },
          method: 'face_detection_disabled',
          faces: []
        };
      } else {
        // Run complete processing pipeline
        result = await this.performCompleteVisionProcessing(imageBuffer, filename);
      }
      
      const processingTime = Date.now() - startTime;
      logMatMemory("AFTER vision processing (worker)");
      
      console.log(`[VisionWorker] ✅ Complete processing completed in ${processingTime}ms: method=${result.method}`);
      
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
      
      // Return default center fallback on any error
      const fallbackResult = {
        focalPoint: {
          x: 0.25,
          y: 0.25,
          width: 0.5,
          height: 0.5,
          type: 'center_fallback',
          method: 'error_fallback'
        },
        method: 'error_fallback',
        faces: [],
        error: error.message
      };
      
      // Send fallback result back to parent
      this.safeSend({
        type: 'PROCESSING_RESULT',
        requestId,
        result: fallbackResult,
        processingTime,
        error: error.message,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Complete Vision Processing Pipeline
   * Implements the full logic from findInterestingRectangleFallback
   */
  async performCompleteVisionProcessing(imageBuffer, filename) {
    console.log(`[VisionWorker] 🔄 Starting complete vision pipeline for ${filename || 'unknown'}`);
    
    if (!this.isInitialized || !this.faceDetector || !this.interestDetector) {
      throw new Error('Vision processors not initialized');
    }
    
    let focalPoint = null;
    let method = 'none';
    let faces = [];
    
    // Step 1: Try face detection first
    try {
      console.log(`[VisionWorker] Step 1: Attempting face detection...`);
      faces = await this.faceDetector.detectFacesOnly(imageBuffer);
      console.log(`[VisionWorker] Face detection found ${faces.length} faces`);
    } catch (faceError) {
      console.warn(`[VisionWorker] Face detection failed:`, faceError.message);
      // Continue with faces = [] (empty array)
    }
    
    // Step 2: If faces found, create focal point from faces
    if (faces.length > 0) {
      console.log(`[VisionWorker] Step 2: Creating focal point from ${faces.length} face(s)`);
      
      // Find bounding box that contains all faces  
      const minX = Math.min(...faces.map(f => f.x));
      const minY = Math.min(...faces.map(f => f.y));
      const maxX = Math.max(...faces.map(f => f.x + f.width));
      const maxY = Math.max(...faces.map(f => f.y + f.height));
      
      // No padding for now (as per original logic)
      const padding = 0.0;
      const width = maxX - minX;
      const height = maxY - minY;
      const paddingX = width * padding;
      const paddingY = height * padding;
      
      focalPoint = {
        x: Math.max(0, minX - paddingX),
        y: Math.max(0, minY - paddingY),
        width: width + (paddingX * 2),
        height: height + (paddingY * 2),
        type: 'face',
        method: 'all_faces_bounding_box'
      };
      method = 'faces';
      console.log(`[VisionWorker] Face-based focal point created for ${faces.length} faces`);
    }
    
    // Step 3: If no faces, try interest detection  
    if (!focalPoint) {
      console.log(`[VisionWorker] Step 3: No faces found, trying interest detection...`);
      const matStatsBeforeInterest = getMatStats();
      
      try {
        const interestResult = await this.interestDetector.detectInterestRegions(imageBuffer);
        
        if (interestResult && interestResult.focalPoint) {
          focalPoint = interestResult.focalPoint;
          method = 'interest';
          console.log(`[VisionWorker] Interest-based focal point found`);
        }
        
        // Check for Mat leaks in interest detection
        const matStatsAfterInterest = getMatStats();
        if (matStatsAfterInterest.active > matStatsBeforeInterest.active) {
          console.warn(`[VisionWorker] ⚠️ Interest detection Mat leak: ${matStatsBeforeInterest.active} -> ${matStatsAfterInterest.active} active objects`);
        }
        
      } catch (interestError) {
        console.error(`[VisionWorker] Interest detection failed:`, interestError.message);
        console.error(`[VisionWorker] Interest detection error stack:`, interestError.stack);
      }
    }
    
    // Step 4: Default fallback - center crop
    if (!focalPoint) {
      console.log(`[VisionWorker] Step 4: No focal point found, using default center`);
      focalPoint = {
        x: 0.25,
        y: 0.25,
        width: 0.5,
        height: 0.5,
        type: 'default',
        method: 'center_fallback'
      };
      method = 'default';
    }
    
    console.log(`[VisionWorker] ✅ Complete vision processing completed: method=${method}`);
    
    return {
      focalPoint,
      method,
      faces
    };
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
