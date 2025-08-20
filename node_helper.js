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
const { RE2 } = require("re2-wasm");
const NodeHelper = require("node_helper");
const Log = require("logger");
const crypto = require("crypto");
const { getMatStats, logMatMemory } = require("./src/vision/matManager");

// OpenCV Memory Debugging unified through matManager
const OneDrivePhotos = require("./OneDrivePhotos.js");
const { shuffle } = require("./shuffle.js");
const { error_to_string } = require("./error_to_string.js");
const { cachePath } = require("./msal/authConfig.js");
const { convertHEIC } = require("./photosConverter-node");
const { fetchToUint8Array, FetchHTTPError } = require("./fetchItem-node");
const { createIntervalRunner } = require("./src/interval-runner");

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
 * @type {OneDrivePhotos}
 */
let oneDrivePhotosInstance = null;

// CRASH DETECTION AND LOGGING
process.on('SIGABRT', (signal) => {
  console.error(`[NodeHelper] 🚨 SIGABRT detected - likely native memory corruption from OpenCV`);
  const matStats = getMatStats();
  console.error(`[NodeHelper] Active Mat objects: ${matStats.active}, Total created: ${matStats.total}`);
  console.error(`[NodeHelper] Memory usage:`, process.memoryUsage());
  process.exit(1);
});

process.on('SIGSEGV', (signal) => {
  console.error(`[NodeHelper] 🚨 SIGSEGV detected - segmentation fault, likely OpenCV Mat access`);
  const matStats = getMatStats();
  console.error(`[NodeHelper] Active Mat objects: ${matStats.active}, Total created: ${matStats.total}`);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error(`[NodeHelper] 🚨 Uncaught Exception:`, error);
  console.error(`[NodeHelper] Stack:`, error.stack);
  const matStats = getMatStats();
  console.error(`[NodeHelper] Active Mat objects: ${matStats.active}, Total created: ${matStats.total}`);
});

// Check if garbage collection is available
if (global.gc) {
  console.log("[NodeHelper] ✅ Garbage collection available");
} else {
  console.log("[NodeHelper] ❌ Garbage collection NOT available - consider starting with --expose-gc");
}

const nodeHelperObject = {
  /** @type {OneDriveMediaItem[]} */
  localPhotoList: [],
  /** @type {number} */
  localPhotoPntr: 0,
  uiRunner: null,
  moduleSuspended: false,
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

  performFaceDetection: async function(imageBuffer, filename) {
    console.log(`[NodeHelper] � Face detection starting for: ${filename || 'unknown'}`);
    logMatMemory("BEFORE face detection");
    
    try {
      // Import the face detection module (dynamic import since it's optional)
      const { faceDetector } = await import('./src/vision/faceDetection.js');
      
      // Track Mat objects before detection
      const matStatsBefore = getMatStats();
      
      // Only detect faces - no focal point calculation, no debug drawing
      const faces = await faceDetector.detectFacesOnly(imageBuffer);
      
      // Check for Mat object leaks
      const matStatsAfter = getMatStats();
      if (matStatsAfter.active > matStatsBefore.active) {
        console.warn(`[NodeHelper] ⚠️ Potential Mat leak: ${matStatsBefore.active} -> ${matStatsAfter.active} active objects`);
      }
      
      logMatMemory("AFTER face detection");
      console.log(`[NodeHelper] ✅ Face detection completed: found ${faces.length} faces`);
      
      return faces; // Just return array of face objects: [{ x, y, width, height, confidence }]
      
    } catch (error) {
      console.error(`[NodeHelper] ❌ Face detection failed for ${filename || 'unknown'}:`, error.message);
      console.error(`[NodeHelper] ❌ Face detection error stack:`, error.stack);
      logMatMemory("AFTER face detection error");
      this.log_debug("Face detection failed:", error.message);
      return []; // Return empty array on failure
    }
  },

  findInterestingRectangle: async function(imageBuffer, filename) {
    console.log(`[NodeHelper] 🎯 Finding focal point for: ${filename || 'unknown'}`);
    logMatMemory("BEFORE focal point analysis");
    
    try {
      this.log_debug("Starting focal point analysis for:", filename);
      
      // Step 1: Try face detection first
      let faces = [];
      try {
        faces = await this.performFaceDetection(imageBuffer, filename);
        this.log_debug(`Face detection found ${faces.length} faces for ${filename}`);
      } catch (faceError) {
        console.log(`[NodeHelper] Face detection failed:`, faceError.message);
        this.log_debug("Face detection failed:", faceError.message);
        // Continue with faces = [] (empty array)
      }
      
      let focalPoint = null;
      let method = 'none';
      
      // Step 2: If faces found, create all-face bounding box
      if (faces.length > 0) {
        console.log(`[NodeHelper] Creating focal point from ${faces.length} face(s)`);
        
        // Find bounding box that contains all faces
        const minX = Math.min(...faces.map(f => f.x));
        const minY = Math.min(...faces.map(f => f.y));
        const maxX = Math.max(...faces.map(f => f.x + f.width));
        const maxY = Math.max(...faces.map(f => f.y + f.height));
        
        // Add some padding around the faces
        const padding = 0.0; // try no padding
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
        console.log(`[NodeHelper] Face-based focal point created for ${faces.length} faces`);
      }
      
      // Step 3: If no faces, try interest detection
      if (!focalPoint) {
        console.log(`[NodeHelper] No faces found, trying interest detection...`);
        const matStatsBeforeInterest = getMatStats();
        
        try {
          // Import and use InterestDetector directly
          const InterestDetector = require('./src/vision/interestDetection.js');
          const interestDetector = new InterestDetector({
            sizeMode: 'adaptive',
            minConfidenceThreshold: 0.65,
            minScoreThreshold: 30,
            enableDebugLogs: false
          });
          
          const interestResult = await interestDetector.detectInterestRegions(imageBuffer);
          if (interestResult && interestResult.focalPoint) {
            focalPoint = interestResult.focalPoint;
            method = 'interest';
            console.log(`[NodeHelper] Interest-based focal point found`);
          }
          
          // Check for Mat leaks in interest detection
          const matStatsAfterInterest = getMatStats();
          if (matStatsAfterInterest.active > matStatsBeforeInterest.active) {
            console.warn(`[NodeHelper] ⚠️ Interest detection Mat leak: ${matStatsBeforeInterest.active} -> ${matStatsAfterInterest.active} active objects`);
          }
          
        } catch (interestError) {
          console.error(`[NodeHelper] Interest detection failed:`, interestError.message);
          console.error(`[NodeHelper] Interest detection error stack:`, interestError.stack);
          this.log_debug("Interest detection failed:", interestError.message);
        }
      }
      
      // Step 4: Default fallback - center crop
      if (!focalPoint) {
        console.log(`[NodeHelper] No focal point found, using default center`);
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
      
      logMatMemory("AFTER focal point analysis");
      console.log(`[NodeHelper] ✅ findInterestingRectangle completed: method=${method}`);
      this.log_debug(`Focal point analysis completed for ${filename}:`, {
        method: method,
        faceCount: faces.length
      });
      
      return {
        focalPoint,
        method,
        faces
      };
      
    } catch (error) {
      console.error(`[NodeHelper] ❌ findInterestingRectangle failed for ${filename || 'unknown'}:`, error.message);
      console.error(`[NodeHelper] Error stack:`, error.stack);
      logMatMemory("AFTER focal point error");
      this.log_debug("Focal point analysis failed, using fallback:", error.message);
      
      // Return default fallback on any error
      return {
        focalPoint: {
          x: 0.25,
          y: 0.25,
          width: 0.5,
          height: 0.5,
          type: 'default',
          method: 'error_fallback'
        },
        method: 'error_fallback',
        faces: []
      };
    }
  },

  // analyzeFaceDetection: async function(payload) {
  //   const { url, photo, album, filename } = payload;
    
  //   try {
  //     this.log_debug("Starting face detection analysis for:", filename);
      
  //     // Import the face detection module (dynamic import since it's optional)
  //     const { faceDetector } = await import('./src/vision/faceDetection.js');
      
  //     // Use the cache directory (not the token file path)
  //     const cacheDir = path.join(__dirname, 'cache');
  //     const tempDir = path.join(cacheDir, 'temp');
  //     if (!fs.existsSync(tempDir)) {
  //       await mkdir(tempDir, { recursive: true });
  //     }
      
  //     // Extract base64 data from data URL
  //     const base64Data = url.replace(/^data:image\/[a-z]+;base64,/, '');
  //     const tempFilePath = path.join(tempDir, `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`);
      
  //     // Write base64 data to file
  //     await writeFile(tempFilePath, base64Data, 'base64');
      
  //     // Analyze image for faces
  //     const faceDetectionResult = await faceDetector.detectFaces(tempFilePath, false); // Don't need debug mode
      
  //     // Convert marked image buffer to data URL if available
  //     let markedImageUrl = url; // Default to original
  //     if (faceDetectionResult.markedImageBuffer) {
  //       const markedImageBase64 = faceDetectionResult.markedImageBuffer.toString('base64');
  //       markedImageUrl = `data:image/jpeg;base64,${markedImageBase64}`;
  //     }
      
  //     // Clean up temp file
  //     try {
  //       await fs.promises.unlink(tempFilePath);
  //     } catch (cleanupError) {
  //       this.log_debug("Failed to clean up temp file:", cleanupError.message);
  //     }
      
  //     // // Send result back to frontend with marked image
  //     // this.sendSocketNotification("FACE_DETECTION_RESULT", {
  //     //   url: markedImageUrl, // Use marked image instead of original
  //     //   photo,
  //     //   album,
  //     //   faceDetectionResult
  //     // });
      
  //   } catch (error) {
  //     this.log_error("Face detection analysis failed:", error);
      
  //     // Send fallback result to frontend so it can proceed with random Ken Burns
  //     // this.sendSocketNotification("FACE_DETECTION_RESULT", {
  //     //   url,
  //     //   photo,
  //     //   album,
  //     //   faceDetectionResult: {
  //     //     faceCount: 0,
  //     //     faces: [],
  //     //     focalPoint: null,
  //     //     processingTime: 0,
  //     //     error: error.message
  //     //   }
  //     // });
  //   }
  // },

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
    const memBefore = process.memoryUsage();
    console.log(`[NodeHelper] 🔄 Processing photo request... (Memory: ${Math.round(memBefore.heapUsed / 1024 / 1024)}MB heap, ${Math.round(memBefore.rss / 1024 / 1024)}MB RSS)`);
    logMatMemory("BEFORE photo processing");
    
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

      // MEMORY MONITORING
      const memAfter = process.memoryUsage();
      const memDelta = memAfter.heapUsed - memBefore.heapUsed;
      console.log(`[NodeHelper] 💾 Memory after processing: ${Math.round(memAfter.heapUsed / 1024 / 1024)}MB heap (${memDelta > 0 ? '+' : ''}${Math.round(memDelta / 1024 / 1024)}MB), RSS: ${Math.round(memAfter.rss / 1024 / 1024)}MB`);
      
      // CRASH PREVENTION - restart if memory too high
      if (memAfter.heapUsed > 1000 * 1024 * 1024) { // 1GB threshold
        console.error(`[NodeHelper] 🚨 Memory limit exceeded (${Math.round(memAfter.heapUsed / 1024 / 1024)}MB) - requesting restart to prevent crash`);
        this.sendSocketNotification("ERROR", "Memory limit exceeded - please restart MagicMirror");
        process.exit(1); // Force clean restart
      }

      // FORCE GARBAGE COLLECTION after each photo
      if (global.gc) {
        global.gc();
        global.gc(); // Double GC for more thorough cleanup
        console.log("[NodeHelper] 🗑️ Double garbage collection forced");
      } else {
        // Alternative: Force memory pressure to trigger GC
        const dummy = new Array(100000).fill(0); // Create pressure
        dummy.length = 0; // Clear immediately
        console.log("[NodeHelper] 🗑️ Memory pressure applied to trigger GC");
      }
      
      logMatMemory("AFTER photo processing & GC");
    
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
      logMatMemory("AFTER error in photo processing");
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

    // Log memory usage before processing
    const memBefore = process.memoryUsage();
    
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

      const album = this.selectedAlbums.find((a) => a.id === photo._albumId);
      const folder = this.selectedFolders.find((f) => f.id === photo._folderId);
      
      // Determine the source (album or folder) for display
      const source = album || folder;

      const base64 = buffer.toString("base64");
      const dataUrl = `data:${photo.mimeType === "image/heic" ? "image/jpeg" : photo.mimeType};base64,${base64}`;

      // Find interesting rectangle for Ken Burns effect (handles faces, interest detection, fallbacks)
      let interestingRectangleResult = null;
      if (this.config.kenBurnsEffect !== false && photo.filename) {
        interestingRectangleResult = await this.findInterestingRectangle(buffer, photo.filename);
        
        // Generate debug image if requested (using all rectangle information)
        if (this.config?.faceDetection?.debugMode && interestingRectangleResult) {
          try {
            console.log(`[NodeHelper] Creating debug image for ${photo.filename} (${interestingRectangleResult.faces.length} faces)`);
            
            const { debugImageCreator } = await import('./src/vision/debugUtils.js');
            const debugResult = await debugImageCreator.createDebugImage(
              buffer, 
              interestingRectangleResult.faces, 
              interestingRectangleResult.focalPoint
            );
            
            if (debugResult && debugResult.markedImageBuffer) {
              const markedImageBase64 = debugResult.markedImageBuffer.toString('base64');
              interestingRectangleResult.markedImageUrl = `data:image/jpeg;base64,${markedImageBase64}`;
              console.log(`[NodeHelper] Debug image created successfully`);
              this.log_debug(`Debug image created for ${photo.filename}`);
            }
          } catch (debugError) {
            console.log(`[NodeHelper] ⚠️  Debug image creation failed:`, debugError.message);
            this.log_debug("Debug image creation failed:", debugError.message);
            interestingRectangleResult.markedImageUrl = null;
          }
        }
      }

      console.log(`[NodeHelper] 📤 Sending photo to frontend: ${photo.filename}`);
      this.log_debug("Image send to UI:", { id: photo.id, filename: photo.filename, index: photo._indexOfPhotos });
      this.sendSocketNotification("RENDER_PHOTO", { 
        photoBase64: base64, 
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
      
      // Log memory usage after processing
      const memAfter = process.memoryUsage();
      console.log(`[NodeHelper] 💾 Memory after photo processing: ${Math.round(memAfter.heapUsed / 1024 / 1024)}MB heap (+${Math.round((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024)}MB)`);

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
  },

  savePhotoListCache: function () {
    (async () => {
      await this.writeFileSafe(this.CACHE_PHOTOLIST_PATH, JSON.stringify(this.localPhotoList, null, 4), "Photo list cache");
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
