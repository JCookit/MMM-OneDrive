"use strict";

/**
 * @typedef {import("./types/type").OneDriveMediaItem} OneDriveMediaItem
 */

const fs = require("fs");
const { writeFile, readFile, mkdir } = require("fs/promises");
const path = require("path");
const moment = require("moment");
const { Readable } = require("stream");
const { finished } = require("stream/promises");
const { spawn } = require("child_process");
const { RE2 } = require("re2-wasm");
const NodeHelper = require("node_helper");
const Log = require("logger");
const crypto = require("crypto");

// Main process no longer imports OpenCV - all vision processing isolated in worker
const OneDrivePhotos = require("./OneDrivePhotos.js");
const { shuffle } = require("./shuffle.js");
const { error_to_string } = require("./error_to_string.js");
const { cachePath } = require("./msal/authConfig.js");
const { convertHEIC } = require("./photosConverter-node");
const { fetchToUint8Array, FetchHTTPError } = require("./fetchItem-node");
const sharp = require('sharp');


/**
 * Create a center fallback focal point in pixel coordinates
 * @param {Buffer} imageBuffer - Image buffer to get dimensions from
 * @param {string} method - The fallback method/reason
 * @returns {Promise<Object>} Fallback result with pixel coordinates
 */
async function createCenterFallback(imageBuffer, method) {
  try {
    // Get image dimensions using Sharp
    const metadata = await sharp(imageBuffer).metadata();
    const { width, height } = metadata;
    
    // Create center rectangle (50% of image centered)
    const focalWidth = Math.round(width * 0.5);
    const focalHeight = Math.round(height * 0.5);
    const focalX = Math.round((width - focalWidth) / 2);
    const focalY = Math.round((height - focalHeight) / 2);
    
    return {
      focalPoint: {
        x: focalX,
        y: focalY,
        width: focalWidth,
        height: focalHeight,
        type: 'center_fallback',
        method: method
      },
      method: method
    };
  } catch (error) {
    console.warn(`[NodeHelper] Could not get image dimensions for fallback, using default: ${error.message}`);
    
    // If we can't get dimensions, use reasonable defaults (assuming common photo size)
    const defaultWidth = 1920;
    const defaultHeight = 1080;
    const focalWidth = Math.round(defaultWidth * 0.5);
    const focalHeight = Math.round(defaultHeight * 0.5);
    const focalX = Math.round((defaultWidth - focalWidth) / 2);
    const focalY = Math.round((defaultHeight - focalHeight) / 2);
    
    return {
      focalPoint: {
        x: focalX,
        y: focalY, 
        width: focalWidth,
        height: focalHeight,
        type: 'center_fallback',
        method: method
      },
      method: method
    };
  }
}


/**
 * Simple reverse geocoding using OpenStreetMap Nominatim API
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<{city?: string, state?: string, country?: string}>}
 */
const reverseGeocode = async (latitude, longitude) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=16&addressdetails=1&accept-language=en`;
    const https = require('https');
    
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'MMM-OneDrive/1.0 (https://github.com/hermanho/MMM-OneDrive)',
          'Accept-Language': 'en'
        }
      };
      
      const req = https.get(url, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const address = json.address;
            resolve({
              city: address?.city || address?.town || address?.village || address?.hamlet || address?.county,
              state: address?.state,
              country: address?.country
            });
          } catch (error) {
            resolve({});
          }
        });
      });
      
      req.on('error', (error) => {
        resolve({});
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({});
      });
    });
  } catch (error) {
    console.error('Reverse geocoding failed:', error);
    return {};
  }
};

const ONE_DAY = 24 * 60 * 60 * 1000; // 1 day in milliseconds
const DEFAULT_SCAN_INTERVAL = 1000 * 60 * 55;
const MINIMUM_SCAN_INTERVAL = 1000 * 60 * 10;

/**
 * Very carefully resize image to preserve exact format characteristics that OpenCV expects
 * This matches the format from fetchToUint8Array as closely as possible
 * @param {Buffer} imageBuffer - Original image buffer from fetchToUint8Array
 * @param {Object} photo - Photo metadata for logging and updating
 * @param {Object} config - Configuration with showWidth/showHeight
 * @returns {Promise<Buffer>} Resized image buffer with same format characteristics
 */
async function resizeImageCarefully(imageBuffer, photo, config) {
  let sharpInstance = null;
  let metadataInstance = null;
  let validationInstance = null;
  
  try {
    const startMemory = process.memoryUsage();
    const { showWidth, showHeight } = config;
    
    // Get original metadata to preserve format exactly
    metadataInstance = sharp(imageBuffer);
    const originalMetadata = await metadataInstance.metadata();
    console.log(`[NodeHelper] 📐 Original ${photo.filename}: ${originalMetadata.width}x${originalMetadata.height} (${Math.round(imageBuffer.length / 1024)}KB)`);
    console.log(`[NodeHelper] 🔍 Original format: ${originalMetadata.format}, channels: ${originalMetadata.channels}, density: ${originalMetadata.density}, space: ${originalMetadata.space}`);
    
    // Create Sharp instance with minimal processing to preserve original characteristics
    sharpInstance = sharp(imageBuffer, {
      // Preserve original settings
      density: originalMetadata.density,
      // Don't modify color space unless necessary
    })
      .rotate() // Only do EXIF rotation - this is essential and works fine
      .resize(showWidth, showHeight, {
        fit: 'inside', // Maintain aspect ratio, fit within bounds
        withoutEnlargement: true // Don't upscale small images
      });
    
    // Preserve the EXACT original format and quality settings
    let resized;
    if (originalMetadata.format === 'jpeg') {
      // For JPEG, try to match the original quality and characteristics exactly
      resized = await sharpInstance
        .jpeg({ 
          quality: 95, // High quality to preserve vision processing accuracy
          progressive: false, // Match typical camera output
          chromaSubsampling: '4:2:0', // Standard JPEG subsampling
          trellisQuantisation: false, // Don't over-optimize
          overshootDeringing: false,
          optimiseScans: false,
          // Keep it as close to original as possible
        })
        .toBuffer();
    } else if (originalMetadata.format === 'png') {
      // For PNG, preserve exactly
      resized = await sharpInstance
        .png({ 
          compressionLevel: 6,
          progressive: false,
          // Preserve alpha channel if present
          adaptiveFiltering: false
        })
        .toBuffer();
    } else {
      // For other formats, convert to JPEG with high quality
      console.log(`[NodeHelper] 📄 Converting ${originalMetadata.format} to JPEG for ${photo.filename}`);
      resized = await sharpInstance
        .jpeg({ 
          quality: 95,
          progressive: false,
          chromaSubsampling: '4:2:0'
        })
        .toBuffer();
    }
    
    // Validate resized image with separate instance
    validationInstance = sharp(resized);
    const newMetadata = await validationInstance.metadata();
    console.log(`[NodeHelper] 📏 Resized ${photo.filename}: ${newMetadata.width}x${newMetadata.height} (${Math.round(resized.length / 1024)}KB)`);
    console.log(`[NodeHelper] 🔍 Resized format: ${newMetadata.format}, channels: ${newMetadata.channels}, density: ${newMetadata.density}, space: ${newMetadata.space}`);
    
    // Update photo metadata with the actual resized dimensions
    if (photo.mediaMetadata) {
      photo.mediaMetadata.width = newMetadata.width;
      photo.mediaMetadata.height = newMetadata.height;
      console.log(`[NodeHelper] 📊 Updated metadata: ${photo.filename} dimensions to ${newMetadata.width}x${newMetadata.height}`);
    }

    const endMemory = process.memoryUsage();
    const memoryDelta = endMemory.heapUsed - startMemory.heapUsed;
    if (memoryDelta > 10 * 1024 * 1024) { // Log if > 10MB memory delta
      console.log(`[NodeHelper] 🧠 Memory delta for ${photo.filename}: ${Math.round(memoryDelta / 1024 / 1024)}MB`);
    }
    
    return resized;
  } catch (error) {
    console.error(`[NodeHelper] ❌ Failed to carefully resize ${photo.filename}:`, error.message);
    console.error(`[NodeHelper] ❌ Stack trace:`, error.stack);
    throw error;
  } finally {
    // Explicit cleanup of Sharp instances to prevent memory leaks
    try {
      if (sharpInstance && typeof sharpInstance.destroy === 'function') {
        sharpInstance.destroy();
        sharpInstance = null;
      }
      if (metadataInstance && typeof metadataInstance.destroy === 'function') {
        metadataInstance.destroy();
        metadataInstance = null;
      }
      if (validationInstance && typeof validationInstance.destroy === 'function') {
        validationInstance.destroy();
        validationInstance = null;
      }
    } catch (cleanupError) {
      console.warn(`[NodeHelper] ⚠️ Sharp cleanup warning for ${photo.filename}:`, cleanupError.message);
    }
  }
}

/**
 * Monitor memory usage and log warnings if high
 */
function logMemoryUsage(context = '') {
  const usage = process.memoryUsage();
  const heapMB = Math.round(usage.heapUsed / 1024 / 1024);
  const externalMB = Math.round(usage.external / 1024 / 1024);
  const totalMB = heapMB + externalMB;
  
  if (totalMB > 200) { // Log if total memory > 200MB
    console.warn(`[NodeHelper] 🧠 High memory usage${context ? ' during ' + context : ''}: Heap ${heapMB}MB + External ${externalMB}MB = ${totalMB}MB total`);
    
    // Suggest garbage collection if memory is very high
    if (totalMB > 300 && global.gc) {
      console.log(`[NodeHelper] 🧹 Triggering garbage collection due to high memory usage`);
      global.gc();
    }
  } else if (context && totalMB > 100) { // Log medium usage for specific contexts
    console.log(`[NodeHelper] 📊 Memory usage${context ? ' during ' + context : ''}: ${totalMB}MB total`);
  }
  
  return { heapMB, externalMB, totalMB };
}

/**
 * @type {OneDrivePhotos}
 */
let oneDrivePhotosInstance = null;

const nodeHelperObject = {
  /** @type {OneDriveMediaItem[]} */
  localPhotoList: [],
  /** @type {number} */
  localPhotoPntr: 0,
  uiRunner: null,
  moduleSuspended: false,
  visionWorker: null,
  visionWorkerReady: false,
  visionRequestId: 0,
  visionRequests: new Map(),
  start: function () {
    this.log_info("Starting module helper");
    this.config = {};
    this.scanTimer = null;
    /** @type {microsoftgraph.DriveItem} */
    this.selectedAlbums = [];
    /** @type {microsoftgraph.DriveItem} */
    this.selectedFolders = [];
    this.localPhotoList = [];
    this.photoRefreshPointer = 0;
    this.queue = null;
    this.initializeTimer = null;

    this.CACHE_ALBUMNS_PATH = path.resolve(this.path, "cache", "selectedAlbumsCache.json");
    this.CACHE_FOLDERS_PATH = path.resolve(this.path, "cache", "selectedFoldersCache.json");
    this.CACHE_PHOTOLIST_PATH = path.resolve(this.path, "cache", "photoListCache.json");
    this.CACHE_CONFIG = path.resolve(this.path, "cache", "config.json");
    
    // Initialize vision worker process
    // this.initializeVisionWorker();
    
    this.log_info("Started");
  },

  socketNotificationReceived: async function (notification, payload) {
    this.log_debug("notification received", notification);
    switch (notification) {
      case "INIT":
        this.initializeAfterLoading(payload);
        break;
      case "IMAGE_LOADED":
        {
          this.log_debug("Image loaded:", payload);
        }
        break;
      case "MODULE_SUSPENDED":
        console.log("[NodeHelper] 💤 Module suspended");
        this.moduleSuspended = true;
        // No timer to stop in request-driven mode
        break;
      case "MODULE_RESUMED":
        console.log("[NodeHelper] 🔄 Module resumed");
        this.moduleSuspended = false;
        // No timer to resume in request-driven mode
        break;
      case "NEXT_PHOTO":
        if (!this.moduleSuspended) {
          console.log("[NodeHelper] ➤ Frontend requesting next photo");
          await this.processNextPhotoRequest();
        } else {
          console.log("[NodeHelper] ⏸ Module suspended, ignoring photo request");
        }
        break;
      default:
        this.log_error("Unknown notification received", notification);
    }
  },

  /**
   * Parse and route vision worker log messages to appropriate console methods
   * @param {string} logLine - Raw log line from vision worker
   */
  routeWorkerLogMessage: function(logLine) {
    // Extract log level from worker message patterns
    // Look for console.debug, console.log, console.warn, console.error patterns
    
    // Handle stderr messages - these are usually errors or important warnings
    if (logLine.includes('[STDERR]')) {
      // Still check for debug patterns in stderr (some debugging might go to stderr)
      if (logLine.includes('📊 Mat created') || 
          logLine.includes('🗑️ Mat released') || 
          logLine.includes('💾 Memory stats')) {
        console.debug(`[Vision Worker] ${logLine}`);
        return;
      }
      // Most stderr messages should be errors or warnings
      console.error(`[Vision Worker] ${logLine}`);
      return;
    }
    
    // Check WARNING and ERROR patterns FIRST (higher priority than debug)
    
    // Error level patterns (actual errors and failures)
    if (logLine.includes('❌') || 
        logLine.includes('ERROR') || 
        logLine.includes('Error:') ||
        logLine.includes('Failed to') ||
        logLine.includes('Uncaught exception') ||
        logLine.includes('Unhandled rejection') ||
        logLine.includes('initialization failed') ||
        logLine.includes('processing failed')) {
      console.error(`[Vision Worker] ${logLine}`);
      return;
    }
    
    // Warning level patterns (important issues but not errors)
    if (logLine.includes('⚠️') || 
        logLine.includes('🚨') ||
        logLine.includes('Warning:') ||
        logLine.includes('WARN') ||
        logLine.includes('Mat leak') ||
        logLine.includes('Debug image creation failed')) {
      console.warn(`[Vision Worker] ${logLine}`);
      return;
    }
    
    // Debug level patterns (most verbose processing details) - checked AFTER warnings/errors
    if (logLine.includes('📊 Mat created') || 
        logLine.includes('🗑️ Mat released') || 
        logLine.includes('⏭️ Mat already released') || 
        logLine.includes('💾 Memory stats') ||
        logLine.includes('Creating YOLO blob') ||
        logLine.includes('YOLO blob created successfully') ||
        logLine.includes('Running YOLO inference') ||
        logLine.includes('YOLO inference completed') ||
        logLine.includes('YOLO found') ||
        logLine.includes('Filtered out') ||
        logLine.includes('Loading image from buffer') ||
        logLine.includes('Converted serialized buffer') ||
        logLine.includes('Received message:') ||
        logLine.includes('🎯 Starting complete image processing') ||
        logLine.includes('Face detection enabled:') ||
        logLine.includes('🔄 Starting complete vision pipeline') ||
        logLine.includes('Step 1: Attempting face detection') ||
        logLine.includes('Face detection found') ||
        logLine.includes('Step 2: Creating focal point') ||
        logLine.includes('Face-based focal point created') ||
        logLine.includes('Step 3: No faces found') ||
        logLine.includes('Step 4: No focal point found') ||
        logLine.includes('Interest-based focal point found') ||
        logLine.includes('Creating debug image') ||
        logLine.includes('Debug image created successfully') ||
        logLine.includes('🧹 Emergency cleanup completed') ||
        logLine.includes('[FaceDetector]') && (
          logLine.includes('Creating') ||
          logLine.includes('blob created') ||
          logLine.includes('Running') ||
          logLine.includes('inference completed') ||
          logLine.includes('found') && logLine.includes('faces') ||
          logLine.includes('Filtered') ||
          logLine.includes('Loading image') ||
          logLine.includes('already released')
        ) ||
        // MatManager debug messages (only those without warning/error symbols)
        logLine.includes('[MatManager]') && (
          logLine.includes('📊') ||
          logLine.includes('🗑️') ||
          logLine.includes('⏭️') ||
          logLine.includes('💾') ||
          logLine.includes('🧹')
        ) ||
        logLine.includes('[VisionWorker]') && (
          logLine.includes('Received message') ||
          logLine.includes('Starting complete') ||
          logLine.includes('Face detection enabled') ||
          logLine.includes('Starting complete vision') ||
          logLine.includes('Step ') ||
          logLine.includes('focal point') ||
          logLine.includes('debug image')
        )) {
      console.debug(`[Vision Worker] ${logLine}`);
      return;
    }
    
    // Default to regular log for everything else (startup messages, results, etc.)
    console.log(`[Vision Worker] ${logLine}`);
  },

  // ==================== VISION WORKER PROCESS MANAGEMENT ====================

  initializeVisionWorker: function() {
    console.log("[NodeHelper] Initializing vision worker process with reduced CPU priority...");
    
    const workerPath = path.join(__dirname, 'src/vision/vision-worker.js');
    
    // Use nice command to spawn the worker with lower CPU priority
    // nice +10 = lower priority, giving UI thread higher priority for smooth animations
    this.visionWorker = spawn('nice', [
      '-n', '10',  // Set nice level to +10 (lower CPU priority)
      'node',
      '--max-old-space-size=512',  // 512MB memory limit for worker
      workerPath
    ], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    // Forward worker stdout to main process (for unified logging)
    this.visionWorker.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          this.routeWorkerLogMessage(line);
        }
      });
    });

    // Forward worker stderr to main process
    this.visionWorker.stderr.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          // Route stderr messages through the same smart routing
          // but prefix them to indicate they came from stderr
          this.routeWorkerLogMessage(`[STDERR] ${line}`);
        }
      });
    });

    // Handle IPC messages from worker
    this.visionWorker.on('message', (message) => {
      this.handleVisionWorkerMessage(message);
    });

    // Handle worker process exit
    this.visionWorker.on('exit', (code, signal) => {
      console.error(`[NodeHelper] Vision worker exited: code=${code}, signal=${signal}`);
      this.visionWorkerReady = false;
      
      if (code !== 0 && !this.shuttingDown) {
        console.log("[NodeHelper] Restarting vision worker in 3 seconds...");
        setTimeout(() => {
          this.initializeVisionWorker();
        }, 3000);
      }
    });

    // Handle worker process errors
    this.visionWorker.on('error', (error) => {
      console.error("[NodeHelper] Vision worker process error:", error.message);
      this.visionWorkerReady = false;
    });

    console.log(`[NodeHelper] Vision worker process spawned with PID: ${this.visionWorker.pid} (nice +10 priority)`);
    
    // Set up periodic health check to detect dead workers
    this.startVisionWorkerHealthCheck();
  },

  /**
   * Start periodic health checking of the vision worker
   */
  startVisionWorkerHealthCheck: function() {
    // Clear any existing health check
    if (this.visionWorkerHealthCheckInterval) {
      clearInterval(this.visionWorkerHealthCheckInterval);
    }

    console.log("Starting vision process health check");
    
    // Check worker health every 10 seconds
    this.visionWorkerHealthCheckInterval = setInterval(() => {
      if (!this.visionWorkerReady || !this.isVisionWorkerAlive()) {
        console.warn("[NodeHelper] Vision worker health check failed - process is dead");
        this.visionWorkerReady = false;
        
        // Clean up the dead worker reference
        this.visionWorker = null;
        
        // Trigger restart
        setTimeout(() => {
          this.initializeVisionWorker();
        }, 1000);
      }
    }, 10000); // Check every 10 seconds
  },

  /**
   * Stop the vision worker health check
   */
  stopVisionWorkerHealthCheck: function() {
    if (this.visionWorkerHealthCheckInterval) {
      clearInterval(this.visionWorkerHealthCheckInterval);
      this.visionWorkerHealthCheckInterval = null;
    }
    console.log("Stopping worker process health check");
  },

  handleVisionWorkerMessage: function(message) {
    const { type, requestId } = message;
    
    switch (type) {
      case 'WORKER_READY':
        console.log("[NodeHelper] ✅ Vision worker ready");
        this.visionWorkerReady = true;
        break;
      
      case 'WORKER_ERROR':
        console.error("[NodeHelper] Vision worker initialization failed:", message.error);
        this.visionWorkerReady = false;
        break;
      
      case 'WORKER_CRASH':
        console.error("[NodeHelper] Vision worker crashed:", message.error);
        if (message.stack) {
          console.error("[NodeHelper] Crash stack:", message.stack);
        }
        this.visionWorkerReady = false;
        break;
      
      case 'FACE_DETECTION_RESULT':
      case 'FACE_DETECTION_ERROR':
      case 'PROCESSING_RESULT':
      case 'ERROR':
        this.handleVisionWorkerResponse(message);
        break;
      
      case 'HEALTH_CHECK_RESULT':
      case 'STATS_RESULT':
        this.handleVisionWorkerResponse(message);
        break;
      
      default:
        console.warn(`[NodeHelper] Unknown vision worker message type: ${type}`);
    }
  },

  handleVisionWorkerResponse: function(message) {
    const { requestId } = message;
    
    if (this.visionRequests.has(requestId)) {
      const { resolve, reject, timeout } = this.visionRequests.get(requestId);
      
      // Clear timeout
      if (timeout) {
        clearTimeout(timeout);
      }
      
      // Remove request from map
      this.visionRequests.delete(requestId);
      
      // Handle response
      if (message.type.endsWith('_ERROR')) {
        const error = new Error(message.error);
        error.stack = message.stack;
        reject(error);
      } else {
        resolve(message);
      }
    } else {
      console.warn(`[NodeHelper] Received response for unknown request ID: ${requestId}`);
    }
  },

  /**
   * Check if the vision worker process is actually alive
   * @returns {boolean} True if worker process is running
   */
  isVisionWorkerAlive: function() {
    if (!this.visionWorker || !this.visionWorker.pid) {
      return false;
    }
    
    try {
      // Use kill(0) to test if process exists without actually sending a signal
      process.kill(this.visionWorker.pid, 0);
      return true;
    } catch (error) {
      // ESRCH error means process doesn't exist
      if (error.code === 'ESRCH') {
        console.warn(`[NodeHelper] Vision worker PID ${this.visionWorker.pid} no longer exists`);
        this.visionWorkerReady = false;
        return false;
      }
      // Other errors (like EPERM) mean process exists but we can't signal it
      return true;
    }
  },

  sendVisionWorkerMessage: function(message, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      // Check both the ready flag AND that the process is actually alive
      if (!this.visionWorker || !this.visionWorkerReady || !this.isVisionWorkerAlive()) {
        // // If worker is dead but we didn't know it, trigger restart
        // if (this.visionWorker && !this.isVisionWorkerAlive()) {
        //   console.warn("[NodeHelper] Dead vision worker detected, triggering restart...");
        //   this.visionWorkerReady = false;
        //   setTimeout(() => {
        //     this.initializeVisionWorker();
        //   }, 1000); // Shorter delay since we detected it's already dead
        // }
        
        reject(new Error('Vision worker not available'));
        return;
      }
      
      const requestId = ++this.visionRequestId;
      message.requestId = requestId;
      
      // Set up timeout
      const timeout = setTimeout(() => {
        this.visionRequests.delete(requestId);
        reject(new Error(`Vision worker timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      
      // Store request
      this.visionRequests.set(requestId, { resolve, reject, timeout });
      
      // Send message to worker
      this.visionWorker.send(message);
    });
  },

  shutdownVisionWorker: function() {
    if (this.visionWorker) {
      console.log("[NodeHelper] Shutting down vision worker...");
      this.shuttingDown = true;
      
      // Stop health checking
      this.stopVisionWorkerHealthCheck();
      
      try {
        this.visionWorker.send({ type: 'SHUTDOWN' });
      } catch (error) {
        console.warn("[NodeHelper] Could not send shutdown message to vision worker:", error.message);
      }
      
      setTimeout(() => {
        if (this.visionWorker && !this.visionWorker.killed) {
          console.log("[NodeHelper] Force killing vision worker...");
          this.visionWorker.kill('SIGTERM');
        }
      }, 5000);
    }
  },

  // ==================== END VISION WORKER MANAGEMENT ====================

  /**
   * Choose the best focal point from face detection and interest region results
   * This implements the decision-making logic that was previously in the worker
   */
  chooseFocalPointFromDetections: async function(detectionResults, imageBuffer, filename) {
    const { faces, interestRegions, colorAnalysis, debugImageBuffer } = detectionResults;
    
    console.log(`[NodeHelper] 🎯 Choosing focal point from ${faces.length} faces and ${interestRegions.length} interest regions`);
    
    // Priority 1: Use faces if available - construct all-faces bounding box
    if (faces && faces.length > 0) {
      console.log(`[NodeHelper] 📍 Using face detection (${faces.length} faces found)`);
      
      // Sort faces by confidence for logging
      const sortedFaces = faces.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
      const bestFace = sortedFaces[0];
      
      let focalPoint;
      
      if (faces.length === 1) {
        // Single face - use the face rectangle directly
        focalPoint = {
          x: bestFace.x,
          y: bestFace.y,
          width: bestFace.width,
          height: bestFace.height,
          type: 'face',
          method: 'single_face_detection',
          confidence: bestFace.confidence
        };
        
        console.log(`[NodeHelper] Selected single face: confidence=${bestFace.confidence?.toFixed(3) || 'unknown'}, ` +
                   `rect=[${bestFace.x?.toFixed(3)}, ${bestFace.y?.toFixed(3)}, ${bestFace.width?.toFixed(3)}, ${bestFace.height?.toFixed(3)}]`);
      } else {
        // Multiple faces - create bounding box that contains all faces
        const minX = Math.min(...faces.map(f => f.x));
        const minY = Math.min(...faces.map(f => f.y));
        const maxX = Math.max(...faces.map(f => f.x + f.width));
        const maxY = Math.max(...faces.map(f => f.y + f.height));
        
        focalPoint = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          type: 'face',
          method: 'multi_face_detection',
          confidence: bestFace.confidence // Use best face confidence
        };
        
        console.log(`[NodeHelper] Created all-faces bounding box for ${faces.length} faces: ` +
                   `rect=[${minX.toFixed(3)}, ${minY.toFixed(3)}, ${(maxX - minX).toFixed(3)}, ${(maxY - minY).toFixed(3)}]`);
      }
      
      return {
        focalPoint: focalPoint,
        method: focalPoint.method,
        colorAnalysis: colorAnalysis,
        debugImageBuffer: debugImageBuffer // Binary buffer instead of base64
      };
    }
    
    // Priority 2: Use interest regions if no faces found
    if (interestRegions && interestRegions.length > 0) {
      console.log(`[NodeHelper] 📍 No faces found, using interest detection (${interestRegions.length} regions found)`);
      
      // Use the highest confidence interest region
      const bestInterest = interestRegions[0]; // Already sorted by confidence in worker
      
      console.log(`[NodeHelper] Selected best interest region: confidence=${bestInterest.confidence?.toFixed(3) || 'unknown'}, ` +
                 `rect=[${bestInterest.x?.toFixed(3)}, ${bestInterest.y?.toFixed(3)}, ${bestInterest.width?.toFixed(3)}, ${bestInterest.height?.toFixed(3)}]`);
      
      return {
        focalPoint: {
          x: bestInterest.x,
          y: bestInterest.y,
          width: bestInterest.width,
          height: bestInterest.height,
          type: 'interest',
          method: 'interest_detection',
          confidence: bestInterest.confidence
        },
        method: 'interest_detection',
        colorAnalysis: colorAnalysis,
        debugImageBuffer: debugImageBuffer // Binary buffer instead of base64
      };
    }
    
    // Priority 3: No detections found - use center fallback via createCenterFallback function
    console.log(`[NodeHelper] 📍 No faces or interest regions found, using center fallback`);
    
    const centerFallback = await createCenterFallback(imageBuffer, 'no_detections_found');
    
    return {
      focalPoint: centerFallback.focalPoint,
      method: centerFallback.method,
      colorAnalysis: colorAnalysis,
      debugImageBuffer: debugImageBuffer // Binary buffer instead of base64
    };
  },

  findInterestingRectangle: async function(imageBuffer, filename) {
    console.log(`[NodeHelper] 🎯 Finding focal point for: ${filename || 'unknown'}`);
    
    // First, check if we have cached vision results for this photo
    const photo = this.localPhotoList.find(p => p.filename === filename);
    if (photo && photo._visionResults) {
      console.log(`[NodeHelper] 💾 Found cached vision results for: ${filename}`);
      console.log(`[NodeHelper] 💾 Cache info: faces=${photo._visionResults.faces?.length || 0}, interests=${photo._visionResults.interestRegions?.length || 0}, colors=${photo._visionResults.colorAnalysis?.dominantColors?.length || 0}, error=${photo._visionResults.error}, shouldRetry=${photo._visionResults.shouldRetry}`);
      
      // Check if cached result was an error - if so, retry the analysis
      if (photo._visionResults.error && photo._visionResults.shouldRetry) {
        console.log(`[NodeHelper] 🔄 Cached result was an error with retry flag, attempting analysis again`);
        // Continue to vision processing below
      } else if (photo._visionResults.error && !photo._visionResults.shouldRetry) {
        console.log(`[NodeHelper] ❌ Using cached permanent error result`);
        // Use cached error result (don't retry permanent errors)
        return await createCenterFallback(imageBuffer, photo._visionResults.errorReason || 'cached_error');
      } else {
        console.log(`[NodeHelper] ✅ Using cached vision detection results - recomputing focal point selection`);
        // Use cached raw detection results but recompute focal point selection
        const cachedDetectionResult = {
          faces: photo._visionResults.faces || [],
          interestRegions: photo._visionResults.interestRegions || [],
          colorAnalysis: photo._visionResults.colorAnalysis || null,
          debugImageBuffer: photo._visionResults.debugImageBuffer // Binary buffer instead of base64
        };
        
        // Recompute focal point decision from cached detections
        const focalPointResult = await this.chooseFocalPointFromDetections(cachedDetectionResult, imageBuffer, filename);
        
        return {
          focalPoint: focalPointResult.focalPoint,
          method: focalPointResult.method,
          colorAnalysis: focalPointResult.colorAnalysis,
          debugImageBuffer: focalPointResult.debugImageBuffer, // Binary buffer instead of base64
          cached: true
        };
      }
    } else {
      console.log(`[NodeHelper] 🆕 No cached vision results found, performing fresh analysis`);
    }
    
    let visionResult = null;
    
    try {
      // Check if face detection is disabled in config (defaults to enabled if not specified)
      const faceDetectionEnabled = this.config?.faceDetection?.enabled !== false;
      console.log(`[NodeHelper] Face detection enabled: ${faceDetectionEnabled}`);
      
      // Use vision worker for complete image processing
      if (this.visionWorkerReady) {
        console.log(`[NodeHelper] Using vision worker for complete image processing...`);
        
        const response = await this.sendVisionWorkerMessage({
          type: 'PROCESS_IMAGE',
          imageBuffer: imageBuffer,
          filename: filename,
          config: {
            faceDetection: { enabled: faceDetectionEnabled },
            debugMode: this.config?.faceDetection?.debugMode || false
          }
        });
        
        if (response.type === 'PROCESSING_RESULT') {
          const { result, processingTime } = response;
          
          // Convert debugImageBuffer from Array back to Buffer (IPC serialization workaround)
          if (result.debugImageBuffer && Array.isArray(result.debugImageBuffer)) {
            result.debugImageBuffer = Buffer.from(result.debugImageBuffer);
            console.debug(`[NodeHelper] Converted debug image from Array back to Buffer: ${result.debugImageBuffer.length} bytes`);
          }
          
          // Check if worker returned an error
          if (result.error) {
            console.log(`[NodeHelper] ⚠️ Vision worker returned error: ${result.error}`);
            console.log(`[NodeHelper] Using center fallback instead`);
            
            visionResult = await createCenterFallback(imageBuffer, 'worker_error');
            
            // Cache this error result but mark for retry (transient error)
            if (photo) {
              photo._visionResults = {
                // No detection data for error cases
                faces: [],
                interestRegions: [],
                debugImageBuffer: null, // Binary buffer instead of base64
                
                // Error metadata
                error: true,
                shouldRetry: true, // Worker errors might be transient
                errorReason: 'worker_error',
                errorMessage: result.error,
                timestamp: Date.now()
              };
              console.log(`[NodeHelper] 💾 Caching worker error result (will retry): ${result.error}`);
              // Save updated photo list to persist cache
              this.savePhotoListCache();
            }
            
            return visionResult;
          }
          
          console.log(`[NodeHelper] ✅ Vision worker completed in ${processingTime}ms`);
          console.log(`[NodeHelper] Detection results: ${result.faces.length} faces, ${result.interestRegions.length} interest regions`);
          
          // Make focal point decision from the detection results
          visionResult = await this.chooseFocalPointFromDetections(result, imageBuffer, filename);
          console.log(`[NodeHelper] Final focal point decision: method=${visionResult.method}`);
          
          // Cache raw detection results (not the final focal point decision)
          if (photo) {
            photo._visionResults = {
              // Store raw detection data
              faces: result.faces || [],
              interestRegions: result.interestRegions || [],
              colorAnalysis: result.colorAnalysis || null,
              debugImageBuffer: result.debugImageBuffer, // Binary buffer instead of base64
              
              // Metadata
              error: false,
              shouldRetry: false,
              analysisComplete: true,
              timestamp: Date.now(),
              processingTime: processingTime
            };
            console.log(`[NodeHelper] 💾 Caching raw vision detection results: ${result.faces.length} faces, ${result.interestRegions.length} interests, colors: ${result.colorAnalysis?.dominantColors?.length || 0}`);
            // Save updated photo list to persist cache
            this.savePhotoListCache();
          }
          
          return visionResult;
        } else {
          throw new Error(`Unexpected vision worker response: ${response.type}`);
        }
      } else {
        console.warn("[NodeHelper] Vision worker not ready, using fallback processing...");
        visionResult = await createCenterFallback(imageBuffer, 'worker_not_ready');
        
        // Cache this fallback result but mark for retry (worker might come online later)
        if (photo) {
          photo._visionResults = {
            // No detection data for error cases
            faces: [],
            interestRegions: [],
            debugImageBuffer: null, // Binary buffer instead of base64
            
            // Error metadata
            error: true,
            shouldRetry: true, // Worker not ready is transient
            errorReason: 'worker_not_ready',
            timestamp: Date.now()
          };
          console.log(`[NodeHelper] 💾 Caching worker-not-ready result (will retry)`);
          // Save updated photo list to persist cache
          this.savePhotoListCache();
        }
        
        return visionResult;
      }
      
    } catch (error) {
      console.error(`[NodeHelper] ❌ Vision processing failed for ${filename || 'unknown'}:`, error.message);
      console.log(`[NodeHelper] Using center fallback due to error`);
      
      // Return center fallback on any error
      visionResult = await createCenterFallback(imageBuffer, 'error_fallback');
      
      // Cache this error result but mark for retry (errors might be transient)
      if (photo) {
        photo._visionResults = {
          // No detection data for error cases
          faces: [],
          interestRegions: [],
          debugImageBuffer: null, // Binary buffer instead of base64
          
          // Error metadata
          error: true,
          shouldRetry: true, // Processing errors might be transient
          errorReason: 'processing_error',
          errorMessage: error.message,
          timestamp: Date.now()
        };
        console.log(`[NodeHelper] 💾 Caching processing error result (will retry): ${error.message}`);
        // Save updated photo list to persist cache
        this.savePhotoListCache();
      }
      
      return visionResult;
    }
  },


  log_debug: function (...args) {
    Log.debug(`[${this.name}] [node_helper]`, ...args);
  },

  log_info: function (...args) {
    Log.info(`[${this.name}] [node_helper]`, ...args);
  },

  log_error: function (...args) {
    Log.error(`[${this.name}] [node_helper]`, ...args);
  },

  log_warn: function (...args) {
    Log.warn(`[${this.name}] [node_helper]`, ...args);
  },

  initializeAfterLoading: async function (config) {
    this.config = config;
    this.debug = config.debug ? config.debug : false;
    if (!this.config.scanInterval) {
      this.config.scanInterval = DEFAULT_SCAN_INTERVAL;
    }
    if (this.config.scanInterval < MINIMUM_SCAN_INTERVAL) {
      this.config.scanInterval = MINIMUM_SCAN_INTERVAL;
    }
    if (this.config.kenBurnsEffect) {
      this.initializeVisionWorker();
    }
    oneDrivePhotosInstance = new OneDrivePhotos({
      debug: this.debug,
      config: config,
    });
    oneDrivePhotosInstance.on("errorMessage", (message) => {
      this.uiRunner?.stop();
      this.sendSocketNotification("ERROR", message);
    });
    oneDrivePhotosInstance.on("authSuccess", () => {
      this.sendSocketNotification("CLEAR_ERROR");

      // if (!this.moduleSuspended) {
      //   this.uiRunner?.resume();
      // }
    });

    this.albumsFilters = [];
    for (const album of config.albums) {
      if (album.hasOwnProperty("source") && album.hasOwnProperty("flags")) {
        this.albumsFilters.push(new RE2(album.source, album.flags + "u"));
      } else {
        this.albumsFilters.push(album);
      }
    }

    this.foldersFilters = [];
    if (config.folders && Array.isArray(config.folders)) {
      for (const folder of config.folders) {
        if (folder.hasOwnProperty("source") && folder.hasOwnProperty("flags")) {
          this.foldersFilters.push(new RE2(folder.source, folder.flags + "u"));
        } else {
          this.foldersFilters.push(folder);
        }
      }
    }

    this.startUIRenderClock();
    await this.tryToIntitialize();
  },

  tryToIntitialize: async function () {
    //set timer, in case if fails to retry in 2 min
    clearTimeout(this.initializeTimer);
    this.initializeTimer = setTimeout(
      () => {
        this.tryToIntitialize();
      },
      2 * 60 * 1000,
    );

    this.log_info("Starting Initialization");
    const cacheResult = await this.loadCache();

    if (cacheResult) {
      this.log_info("Show photos from cache for fast startup");
      this.sendSocketNotification("SCAN_COMPLETE"); // Notify frontend that cache is ready
      this.uiRunner?.skipToNext();
    }

    this.log_info("Initialization complete!");
    clearTimeout(this.initializeTimer);
    this.log_info("Start first scanning.");
    this.startScanning();
  },

  calculateConfigHash: async function () {
    const tokenStr = await this.readFileSafe(cachePath, "MSAL Token");
    if (!tokenStr) {
      return undefined;
    }
    const hash = crypto.createHash("sha256").update(JSON.stringify(this.config) + "\n" + tokenStr)
      .digest("hex");
    return hash;
  },

  /**
   * Loads the cache if it exists and is not expired.
   * If the cache is expired or does not exist, it will skip loading and return false.
   * @returns {Promise<boolean>} true if cache was loaded successfully, false otherwise
   */
  loadCache: async function () {
    const cacheHash = await this.readCacheConfig("CACHE_HASH");
    const configHash = await this.calculateConfigHash();
    if (!cacheHash || cacheHash !== configHash) {
      this.log_info("Config or token has changed. Ignore cache");
      this.log_debug("hash: ", { cacheHash, configHash });
      this.sendSocketNotification("UPDATE_STATUS", "Loading from OneDrive...");
      return false;
    }
    this.log_info("Loading cache data");
    this.sendSocketNotification("UPDATE_STATUS", "Loading from cache");

    //load cached album list - if available
    const cacheAlbumDt = new Date(await this.readCacheConfig("CACHE_ALBUMNS_PATH"));
    const notExpiredCacheAlbum = cacheAlbumDt && (Date.now() - cacheAlbumDt.getTime() < ONE_DAY);
    this.log_debug("notExpiredCacheAlbum", { cacheAlbumDt, notExpiredCacheAlbum });
    if (notExpiredCacheAlbum && fs.existsSync(this.CACHE_ALBUMNS_PATH)) {
      this.log_info("Loading cached albumns list");
      try {
        const data = await readFile(this.CACHE_ALBUMNS_PATH, "utf-8");
        this.selectedAlbums = JSON.parse(data.toString());
        this.log_debug("successfully loaded selectedAlbums");
      } catch (err) {
        this.log_error("unable to load selectedAlbums cache", err);
      }
    }

    //load cached folder list - if available
    const cacheFolderDt = new Date(await this.readCacheConfig("CACHE_FOLDERS_PATH"));
    const notExpiredCacheFolder = cacheFolderDt && (Date.now() - cacheFolderDt.getTime() < ONE_DAY);
    this.log_debug("notExpiredCacheFolder", { cacheFolderDt, notExpiredCacheFolder });
    if (notExpiredCacheFolder && fs.existsSync(this.CACHE_FOLDERS_PATH)) {
      this.log_info("Loading cached folders list");
      try {
        const data = await readFile(this.CACHE_FOLDERS_PATH, "utf-8");
        this.selectedFolders = JSON.parse(data.toString());
        this.log_debug("successfully loaded selectedFolders");
      } catch (err) {
        this.log_error("unable to load selectedFolders cache", err);
      }
    }

    if ((!Array.isArray(this.selectedAlbums) || this.selectedAlbums.length === 0) &&
        (!Array.isArray(this.selectedFolders) || this.selectedFolders.length === 0)) {
      this.log_warn("No valid albums or folders found. Skipping photo loading.");
      return false;
    }

    //load cached list - if available
    const cachePhotoListDt = new Date(await this.readCacheConfig("CACHE_PHOTOLIST_PATH"));
    const notExpiredCachePhotoList = cachePhotoListDt && (Date.now() - cachePhotoListDt.getTime() < ONE_DAY);
    this.log_debug("notExpiredCachePhotoList", { cachePhotoListDt, notExpiredCachePhotoList });
    if (notExpiredCachePhotoList && fs.existsSync(this.CACHE_PHOTOLIST_PATH)) {
      this.log_info("Loading cached list");
      try {
        const data = await readFile(this.CACHE_PHOTOLIST_PATH, "utf-8");
        const cachedPhotoList = JSON.parse(data.toString());
        // check if the cached photo list is empty
        if (Array.isArray(cachedPhotoList) && cachedPhotoList.length > 0) {
          if (this.config.sort === "random") {
            shuffle(cachedPhotoList);
          }
          this.localPhotoList = [...cachedPhotoList].map((photo, index) => {
            photo._indexOfPhotos = index;
            
            // Convert base64 debug images back to binary buffers when loading from cache
            if (photo._visionResults && photo._visionResults.debugImageBase64) {
              photo._visionResults.debugImageBuffer = Buffer.from(photo._visionResults.debugImageBase64, 'base64');
              // Remove the base64 version to save memory
              delete photo._visionResults.debugImageBase64;
              console.debug(`[NodeHelper] Converted cached debug image from base64 to buffer for ${photo.filename}`);
            }
            
            return photo;
          });
          this.log_info("successfully loaded photo list cache of ", this.localPhotoList.length, " photos");
          return true;
        }
      } catch (err) {
        this.log_error("unable to load photo list cache", err);
      }
    }
    return false;
  },

  /** @returns {Promise<microsoftgraph.DriveItem[]>} album */
  getAlbums: async function () {
    try {
      const r = await oneDrivePhotosInstance.getAlbums();
      const configHash = await this.calculateConfigHash();
      if (configHash) {
        await this.saveCacheConfig("CACHE_HASH", configHash);
      }
      return r;
    } catch (err) {
      this.log_error(error_to_string(err));
      throw err;
    }
  },

  /** @returns {Promise<microsoftgraph.DriveItem[]>} folders */
  getFolders: async function () {
    try {
      const r = await oneDrivePhotosInstance.getFolders();
      return r;
    } catch (err) {
      this.log_error(error_to_string(err));
      throw err;
    }
  },

  /** @returns {Promise<microsoftgraph.DriveItem | null>} folder */
  getFolderByPath: async function (folderPath) {
    try {
      const r = await oneDrivePhotosInstance.getFolderByPath(folderPath);
      return r;
    } catch (err) {
      this.log_error(error_to_string(err));
      return null;
    }
  },

  startUIRenderClock: function () {
    console.log("[NodeHelper] 🚀 Switching to request-driven photo processing (no timer)");
    this.uiPhotoIndex = 0;
    // NO TIMER - purely request driven now
  },

  processNextPhotoRequest: async function() {
    const startTime = Date.now();
    console.log(`[NodeHelper] 🔄 Processing photo request... `);
    
    if (!this.localPhotoList || this.localPhotoList.length === 0) {
      console.warn("[NodeHelper] ⚠ No photos available in list");
      this.sendSocketNotification("UPDATE_STATUS", "No photos available...");
      this.sendSocketNotification("NO_PHOTO");
      return;
    }

    const photo = this.localPhotoList[this.uiPhotoIndex];
    console.log(`[NodeHelper] 📸 Processing photo ${this.uiPhotoIndex + 1}/${this.localPhotoList.length}: ${photo.filename}`);

    try {
      await this.prepareShowPhoto({ photoId: photo.id });

      console.log("[NodeHelper] ✅ Photo processed successfully");
    
      // Advance to next photo for future requests
      this.uiPhotoIndex++;
      if (this.uiPhotoIndex >= this.localPhotoList.length) {
        this.uiPhotoIndex = 0;
        console.log("[NodeHelper] 🔄 Wrapped around to beginning of photo list");
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`[NodeHelper] ✅ Photo processed successfully in ${processingTime}ms`);
      
    } catch (error) {
      console.error("[NodeHelper] ❌ Error processing photo:", error);
      console.error("[NodeHelper] ❌ Stack trace:", error.stack);
      this.sendSocketNotification("NO_PHOTO");
    }
  },

  startScanning: function () {
    const fn = () => {
      const nextScanDt = new Date(Date.now() + this.config.scanInterval);
      this.scanJob().then(() => {
        this.log_info("Next scan will be at", nextScanDt.toLocaleString());
      });
    };
    // set up interval, then 1 fail won't stop future scans
    this.scanTimer = setInterval(fn, this.config.scanInterval);
    // call for first time
    fn();
  },

  scanJob: async function () {
    this.queue = null;
    await this.getAlbumList();
    await this.getFolderList();
    try {
      if (this.selectedAlbums.length > 0 || this.selectedFolders.length > 0) {
        await this.getImageList();
        this.savePhotoListCache();
        console.log("Sending SCAN_COMPLETE");
        this.sendSocketNotification("SCAN_COMPLETE");   // this will tell the front end to ask for a photo if it hasn't already
        return true;
      } else {
        this.log_warn("There is no album or folder to get photos.");
        return false;
      }
    } catch (err) {
      this.log_error(error_to_string(err));
    }
  },

  getAlbumList: async function () {
    this.log_info("Getting album list");
    /**
     * @type {microsoftgraph.DriveItem[]} 
     */
    const albums = await this.getAlbums();
    /** 
     * @type {microsoftgraph.DriveItem[]} 
     */
    const selectedAlbums = [];
    for (const ta of this.albumsFilters) {
      const matches = albums.filter((a) => {
        if (ta instanceof RE2) {
          this.log_debug(`RE2 match ${ta.source} -> '${a.name}' : ${ta.test(a.name)}`);
          return ta.test(a.name);
        } else {
          return ta === a.name;
        }
      });
      if (matches.length === 0) {
        this.log_warn(`Can't find "${ta instanceof RE2
          ? ta.source
          : ta}" in your album list.`);
      } else {
        for (const match of matches) {
          if (!selectedAlbums.some(a => a.id === match.id)) {
            selectedAlbums.push(match);
          }
        }
      }
    }
    this.log_info("Finish Album scanning. Properly scanned :", selectedAlbums.length);
    this.selectedAlbums = selectedAlbums;
    await this.saveAlbumListCache();

    for (const a of selectedAlbums) {
      const url = await oneDrivePhotosInstance.getAlbumThumbnail(a);
      if (url) {
        const fpath = path.join(this.path, "cache", a.id);
        const file = fs.createWriteStream(fpath);
        const response = await fetch(url);
        await finished(Readable.fromWeb(response.body).pipe(file));
      }
    }
    this.selectedAlbums = selectedAlbums;
  },

  getFolderList: async function () {
    // Skip folder scanning if no folders are configured
    if (!this.foldersFilters || this.foldersFilters.length === 0) {
      this.selectedFolders = [];
      return;
    }

    this.log_info("Getting folder list");
    /**
     * @type {microsoftgraph.DriveItem[]} 
     */
    const folders = await this.getFolders();
    /** 
     * @type {microsoftgraph.DriveItem[]} 
     */
    const selectedFolders = [];
    
    for (const tf of this.foldersFilters) {
      // Check if this is a path-based filter (contains '/')
      if (typeof tf === 'string' && tf.includes('/')) {
        // Handle folder path like "Photos/2024"
        const folderItem = await this.getFolderByPath(tf);
        if (folderItem) {
          selectedFolders.push(folderItem);
        } else {
          this.log_warn(`Can't find folder path "${tf}" in your OneDrive.`);
        }
      } else {
        // Handle folder name matching (like album matching)
        const matches = folders.filter((f) => {
          if (tf instanceof RE2) {
            this.log_debug(`RE2 match ${tf.source} -> '${f.name}' : ${tf.test(f.name)}`);
            return tf.test(f.name);
          } else {
            return tf === f.name;
          }
        });
        if (matches.length === 0) {
          this.log_warn(`Can't find "${tf instanceof RE2
            ? tf.source
            : tf}" in your folder list.`);
        } else {
          for (const match of matches) {
            if (!selectedFolders.some(f => f.id === match.id)) {
              selectedFolders.push(match);
            }
          }
        }
      }
    }
    this.log_info("Finish Folder scanning. Properly scanned :", selectedFolders.length);
    this.selectedFolders = selectedFolders;
    await this.saveFolderListCache();
  },

  /** @returns {Promise<microsoftgraph.DriveItem[]>} image */
  getImageList: async function () {
    this.log_info("Getting image list");
    const condition = this.config.condition;
    /**
     * @param {OneDriveMediaItem} photo
     */
    const photoCondition = (photo) => {
      if (!photo.hasOwnProperty("mediaMetadata")) return false;
      const data = photo.mediaMetadata;
      if (!photo.mimeType.startsWith("image/")) return false;
      const ct = moment(data.dateTimeOriginal);
      if (condition.fromDate && moment(condition.fromDate).isAfter(ct)) return false;
      if (condition.toDate && moment(condition.toDate).isBefore(ct)) return false;
      if (condition.minWidth && Number(condition.minWidth) > Number(data.width)) return false;
      if (condition.minHeight && Number(condition.minHeight) > Number(data.height)) return false;
      if (condition.maxWidth && Number(condition.maxWidth) < Number(data.width)) return false;
      if (condition.maxHeight && Number(condition.maxHeight) < Number(data.height)) return false;
      const whr = Number(data.width) / Number(data.height);
      if (condition.minWHRatio && Number(condition.minWHRatio) > whr) return false;
      if (condition.maxWHRatio && Number(condition.maxWHRatio) < whr) return false;
      return true;
    };
    /** @type {OneDriveMediaItem[]} */
    const photos = [];
    try {
      for (const album of this.selectedAlbums) {
        this.log_info(`Prepare to get photo list from '${album.name}'`);
        const list = await oneDrivePhotosInstance.getImageFromAlbum(album.id, photoCondition);
        list.forEach((i) => {
          i._albumTitle = album.name;
        });
        this.log_info(`Got ${list.length} photo(s) from '${album.name}'`);
        photos.push(...list);
      }

      // Process folders
      for (const folder of this.selectedFolders) {
        this.log_info(`Prepare to get photo list from folder '${folder.name}'`);
        const list = await oneDrivePhotosInstance.getImageFromFolder(folder.id, photoCondition);
        list.forEach((i) => {
          i._folderTitle = folder.name;
          i._folderId = folder.id;
        });
        this.log_info(`Got ${list.length} photo(s) from folder '${folder.name}'`);
        photos.push(...list);
      }

      if (photos.length > 0) {
        if (this.config.sort === "new" || this.config.sort === "old") {
          photos.sort((a, b) => {
            const at = moment(a.mediaMetadata.dateTimeOriginal);
            const bt = moment(b.mediaMetadata.dateTimeOriginal);
            if (at.isBefore(bt) && this.config.sort === "new") return 1;
            if (at.isAfter(bt) && this.config.sort === "old") return 1;
            return -1;
          });
        } else {
          shuffle(photos);
        }
        this.log_info(`Total indexed photos: ${photos.length}`);
        this.localPhotoList = [...photos].map((photo, index) => {
          photo._indexOfPhotos = index;
          return photo;
        });
        if (this.photoRefreshPointer >= this.localPhotoList.length) {
          this.photoRefreshPointer = 0;
        }
      } else {
        this.log_warn("photos.length is 0");
      }
    } catch (err) {
      this.log_error(error_to_string(err));
      throw err;
    }
  },

  prepareShowPhoto: async function ({ photoId }) {
    logMemoryUsage(`prepareShowPhoto start for ${photoId}`);

    const photo = this.localPhotoList.find((p) => p.id === photoId);
    if (!photo) {
      this.log_error(`Photo with id ${photoId} not found in local list`);
      return;
    }
    this.log_info("Loading to UI:", { id: photoId, filename: photo.filename });

    if (photo?.baseUrlExpireDateTime) {
      const expireDt = new Date(photo.baseUrlExpireDateTime);
      if (!isNaN(+expireDt) && expireDt.getTime() < Date.now()) {
        this.log_info(`Image ${photo.filename} url expired ${photo.baseUrlExpireDateTime}, refreshing...`);
        const p = await oneDrivePhotosInstance.refreshItem(photo);
        photo.baseUrl = p.baseUrl;
        photo.baseUrlExpireDateTime = p.baseUrlExpireDateTime;
        this.log_info(`Image ${photo.filename} url refreshed new baseUrlExpireDateTime: ${photo.baseUrlExpireDateTime}`);
      }
    }

    // Do reverse geocoding if location exists but doesn't have city/state/country yet
    if (photo.mediaMetadata?.location && 
        photo.mediaMetadata.location.latitude && 
        photo.mediaMetadata.location.longitude &&
        !photo.mediaMetadata.location.city && 
        !photo.mediaMetadata.location.state && 
        !photo.mediaMetadata.location.country) {
      
      this.log_debug(`Reverse geocoding location for ${photo.filename}`);
      try {
        const locationInfo = await reverseGeocode(
          photo.mediaMetadata.location.latitude, 
          photo.mediaMetadata.location.longitude
        );
        if (locationInfo.city || locationInfo.state || locationInfo.country) {
          photo.mediaMetadata.location.city = locationInfo.city;
          photo.mediaMetadata.location.state = locationInfo.state;
          photo.mediaMetadata.location.country = locationInfo.country;
          this.log_debug(`Geocoded location: ${[locationInfo.city, locationInfo.state, locationInfo.country].filter(Boolean).join(', ')}`);
        }
      } catch (error) {
        this.log_debug('Failed to reverse geocode location:', error);
      }
    }

    let buffer = null;
    try {
      switch (photo.mimeType) {
        case "image/heic": {
          buffer = await convertHEIC({ id: photo.id, filename: photo.filename, url: photo.baseUrl });
          break;
        }
        default: {
          const buf = await fetchToUint8Array(photo.baseUrl);
          buffer = Buffer.from(buf);
          break;
        }
      }

      // Carefully resize image based on showWidth/showHeight config (preserving format exactly)
      if (buffer && (this.config.showWidth || this.config.showHeight)) {
        console.log(`[NodeHelper] 📏 Resizing ${photo.filename} from full resolution to fit ${this.config.showWidth}x${this.config.showHeight}`);
        logMemoryUsage(`before resizing ${photo.filename}`);
        try {
          const resizedBuffer = await resizeImageCarefully(buffer, photo, this.config);
          buffer = resizedBuffer;
          console.log(`[NodeHelper] ✅ Image resized to ${buffer.length} bytes`);
          logMemoryUsage(`after resizing ${photo.filename}`);
        } catch (resizeError) {
          console.warn(`[NodeHelper] ⚠️ Failed to resize image, using original:`, resizeError.message);
          // Continue with original buffer if resize fails
        }
      }

      const album = this.selectedAlbums.find((a) => a.id === photo._albumId);
      const folder = this.selectedFolders.find((f) => f.id === photo._folderId);
      
      // Determine the source (album or folder) for display
      const source = album || folder;

      // Skip base64 encoding - send raw buffer to frontend
      // const base64 = buffer.toString("base64");
      // const dataUrl = `data:${photo.mimeType === "image/heic" ? "image/jpeg" : photo.mimeType};base64,${base64}`;

      // Find interesting rectangle for Ken Burns effect (handles faces, interest detection, fallbacks)
      let interestingRectangleResult = null;
      if (this.config.kenBurnsEffect !== false && photo.filename) {
        logMemoryUsage(`before vision processing ${photo.filename}`);
        interestingRectangleResult = await this.findInterestingRectangle(buffer, photo.filename);
        logMemoryUsage(`after vision processing ${photo.filename}`);
        
        // Debug image is now created by vision worker as binary buffer (if debugMode enabled)
        if (this.config?.faceDetection?.debugMode && interestingRectangleResult?.debugImageBuffer) {
          // Store the binary buffer for frontend to convert to blob URL
          console.log(`[NodeHelper] Debug image received from vision worker for ${photo.filename} (${interestingRectangleResult.debugImageBuffer.length} bytes)`);
          this.log_debug(`Debug image received for ${photo.filename} (binary buffer)`);
        }
      }

      console.log(`[NodeHelper] 📤 Sending photo to frontend: ${photo.filename} (${buffer.length} bytes, ${photo.mimeType})`);
      console.debug(`[NodeHelper] Photo payload debug:`, {
        hasPhotoBuffer: !!buffer,
        photoBufferSize: buffer.length,
        hasInterestingRectangleResult: !!interestingRectangleResult,
        hasDebugImageBuffer: !!interestingRectangleResult?.debugImageBuffer,
        debugImageBufferSize: interestingRectangleResult?.debugImageBuffer?.length || 0,
        interestingRectangleMethod: interestingRectangleResult?.method || 'none'
      });
      
      this.log_debug("Image send to UI:", { id: photo.id, filename: photo.filename, index: photo._indexOfPhotos });
      this.sendSocketNotification("RENDER_PHOTO", { 
        photoBuffer: buffer, // Send raw binary buffer instead of base64
        mimeType: photo.mimeType === "image/heic" ? "image/jpeg" : photo.mimeType, // Store mime type separately
        photo, 
        album: source, 
        info: null, 
        errorMessage: null,
        interestingRectangleResult // Include face detection results
      });

      // EXPLICITLY NULL LARGE OBJECTS
      buffer = null;
      if (interestingRectangleResult?.markedImageBuffer) {
        interestingRectangleResult.markedImageBuffer = null;
      }
      
      logMemoryUsage(`prepareShowPhoto complete for ${photo.filename}`);
      
    } catch (err) {
      this.sendSocketNotification("NO_PHOTO");  // prime the pump for the UX asking again
      if (err instanceof FetchHTTPError) {
        // silently skip the error
        return;
      }
      this.log_error("Image loading fails:", photo.id, photo.filename, photo.baseUrl);
      if (err) {
        this.log_error("error", err?.message, err?.name);
        this.log_error(err?.stack || err);
      }


    }

  },

  stop: function () {
    this.log_info("Stopping module helper");
    clearInterval(this.scanTimer);
    
    // Shutdown vision worker process
    this.shutdownVisionWorker();
  },

  savePhotoListCache: function () {
    (async () => {
      // Create a copy of localPhotoList with debug image buffers converted to base64 for serialization
      const serializablePhotoList = this.localPhotoList.map(photo => {
        if (photo._visionResults && photo._visionResults.debugImageBuffer) {
          // Convert binary debug image buffer to base64 for JSON serialization
          const debugImageBase64 = photo._visionResults.debugImageBuffer.toString('base64');
          const { debugImageBuffer, ...visionResultsWithoutBuffer } = photo._visionResults;
          return {
            ...photo,
            _visionResults: {
              ...visionResultsWithoutBuffer,
              debugImageBase64: debugImageBase64 // Store as base64 in cache
            }
          };
        }
        return photo;
      });
      
      await this.writeFileSafe(this.CACHE_PHOTOLIST_PATH, JSON.stringify(serializablePhotoList, null, 4), "Photo list cache");
      await this.saveCacheConfig("CACHE_PHOTOLIST_PATH", new Date().toISOString());
    })();
  },

  saveAlbumListCache: function () {
    (async () => {
      await this.writeFileSafe(this.CACHE_ALBUMNS_PATH, JSON.stringify(this.selectedAlbums, null, 4), "Album list cache");
      await this.saveCacheConfig("CACHE_ALBUMNS_PATH", new Date().toISOString());
    })();
  },

  saveFolderListCache: function () {
    (async () => {
      await this.writeFileSafe(this.CACHE_FOLDERS_PATH, JSON.stringify(this.selectedFolders, null, 4), "Folder list cache");
      await this.saveCacheConfig("CACHE_FOLDERS_PATH", new Date().toISOString());
    })();
  },

  readFileSafe: async function (filePath, fileDescription) {
    if (!fs.existsSync(filePath)) {
      this.log_warn(`${fileDescription} does not exist: ${filePath}`);
      return null;
    }
    try {
      const data = await readFile(filePath, "utf-8");
      return data.toString();
    } catch (err) {
      this.log_error(`unable to read ${fileDescription}: ${filePath}`);
      this.log_error(error_to_string(err));
    }
    return null;
  },

  writeFileSafe: async function (filePath, data, fileDescription) {
    try {
      const dirname = path.dirname(filePath);
      if (!fs.existsSync(dirname)) {
        await mkdir(dirname, { recursive: true });
      }
      await writeFile(filePath, data);
      this.log_debug(fileDescription + " saved");
    } catch (err) {
      this.log_error(`unable to write ${fileDescription}: ${filePath}`);
      this.log_error(error_to_string(err));
    }
  },

  readCacheConfig: async function (key) {
    try {
      let config = {};
      if (fs.existsSync(this.CACHE_CONFIG)) {
        const configStr = await this.readFileSafe(this.CACHE_CONFIG, "Cache Config");
        config = JSON.parse(configStr || null);
      }
      if (Object(config).hasOwnProperty(key)) {
        return config[key];
      } else {
        return undefined;
      }
    } catch (err) {
      this.log_error("unable to read Cache Config");
      this.log_error(error_to_string(err));
    }
  },

  saveCacheConfig: async function (key, value) {
    try {
      let config = {};
      // What if the config file is crashed?
      try {
        if (fs.existsSync(this.CACHE_CONFIG)) {
          const configStr = await this.readFileSafe(this.CACHE_CONFIG, "Cache config JSON");
          config = JSON.parse(configStr || null) || {};
        }
      } catch (err) {
        this.log_error("unable to read Cache Config");
        this.log_error(error_to_string(err));
      }
      config[key] = value;
      await this.writeFileSafe(this.CACHE_CONFIG, JSON.stringify(config, null, 4), "Cache config JSON");
      this.log_debug(`Cache config ${key} saved`);
    } catch (err) {
      this.log_error("unable to write Cache Config");
      this.log_error(error_to_string(err));
    }
  },
};

module.exports = NodeHelper.create(nodeHelperObject);
