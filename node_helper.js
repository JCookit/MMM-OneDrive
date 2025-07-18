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
        this.log_info("Module suspended");
        this.moduleSuspended = true;
        this.uiRunner?.stop();
        break;
      case "MODULE_RESUMED":
        this.log_info("Module resumed");
        this.moduleSuspended = false;
        this.uiRunner?.resume();
        break;
      case "NEXT_PHOTO":
        if (!this.moduleSuspended) {
          this.uiRunner?.skipToNext();
        }
        break;
      default:
        this.log_error("Unknown notification received", notification);
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
      if (!this.moduleSuspended) {
        this.uiRunner?.resume();
      }
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
    this.log_info("Starting UI render clock");

    this.uiPhotoIndex = 0;

    this.uiRunner = createIntervalRunner(async () => {
      if (this.moduleSuspended) {
        this.log_warn("Module suspended and skipping UI render. The uiRunner should not be running, but something went wrong.");
        return;
      }
      if (!this.localPhotoList || this.localPhotoList.length === 0) {
        this.log_warn("Not ready to render UI. No photos in list.");
        return;
      }
      const photo = this.localPhotoList[this.uiPhotoIndex];

      await this.prepareShowPhoto({ photoId: photo.id });

      this.uiPhotoIndex++;
      if (this.uiPhotoIndex >= this.localPhotoList.length) {
        this.uiPhotoIndex = 0;
      }
    }, this.config.updateInterval);
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

      this.log_debug("Image send to UI:", { id: photo.id, filename: photo.filename, index: photo._indexOfPhotos });
      this.sendSocketNotification("RENDER_PHOTO", { photoBase64: base64, photo, album: source, info: null, errorMessage: null });
    } catch (err) {
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
