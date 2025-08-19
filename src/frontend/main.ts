import { AutoInfoPositionFunction, Config, ConfigTransformed } from "../types/config";
import type MomentLib from "moment";
import type { OneDriveMediaItem } from "../../types/type";
import type { DriveItem } from "@microsoft/microsoft-graph-types";

/**
 * Global or injected variable declarations
 * moment.js is lazy loaded so not available when script is loaded.
 */
declare const moment: typeof MomentLib;

Module.register<Config>("MMM-OneDrive", {
  defaults: {
    albums: [],
    updateInterval: 1000 * 30, // minimum 10 seconds.
    sort: "new", // "old", "random"
    condition: {
      fromDate: null, // Or "2018-03", RFC ... format available
      toDate: null, // Or "2019-12-25",
      minWidth: null, // Or 400
      maxWidth: null, // Or 8000
      minHeight: null, // Or 400
      maxHeight: null, // Or 8000
      minWHRatio: null,
      maxWHRatio: null,
      // WHRatio = Width/Height ratio ( ==1 : Squared Photo,   < 1 : Portraited Photo, > 1 : Landscaped Photo)
    },
    showWidth: 1080, // These values will be used for quality of downloaded photos to show. real size to show in your MagicMirror region is recommended.
    showHeight: 1920,
    timeFormat: "YYYY/MM/DD HH:mm",
    autoInfoPosition: false,
    forceAuthInteractive: false,
    leftMargin: null, // e.g. "25vw" or "400px" - leaves space for left sidebar modules
    kenBurnsEffect: true, // Enable Ken Burns crop-and-zoom effect by default
    kenBurnsCenterStart: true, // NEW: Start with focal point centered, then pan to natural position
    faceDetection: {
      enabled: true, // Enable face detection for Ken Burns focal points
      minFaceSize: 50, // Minimum face size in pixels
      maxFaceSize: 300, // Maximum face size in pixels  
      confidenceThreshold: 0.5, // Detection confidence threshold (0-1)
      debugMode: false, // Show detection bounding rectangles on images
    },
  },
  requiresVersion: "2.24.0",

  suspended: false,

  getScripts() {
    return ["moment.js"];
  },
  getStyles: function () {
    return ["MMM-OneDrive.css"];
  },

  start: function () {
    this.firstScan = true;
    if (this.config.updateInterval < 1000 * 10) this.config.updateInterval = 1000 * 10;
    this.config.condition = Object.assign({}, this.defaults.condition, this.config.condition);

    const config: ConfigTransformed = { ...this.config };
    for (let i = 0; i < this.config.albums.length; i++) {
      const album = this.config.albums[i];
      if (album instanceof RegExp) {
        config.albums[i] = {
          source: album.source,
          flags: album.flags,
        };
      }
    }

    this.sendSocketNotification("INIT", config);
    this.dynamicPosition = 0;
  },

  socketNotificationReceived: function (noti, payload) {
    if (noti === "ERROR") {
      const current = document.getElementById("ONEDRIVE_PHOTO_CURRENT");
      current.textContent = "";
      const errMsgContainer = document.createElement("div");
      Object.assign(errMsgContainer.style, {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
      });
      const errMsgDiv = document.createElement("div");
      Object.assign(errMsgDiv.style, {
        maxWidth: "70vw",
        fontSize: "1.5em",
      });
      errMsgDiv.textContent = payload;
      errMsgContainer.appendChild(errMsgDiv);
      current.appendChild(errMsgContainer);
    }
    if (noti === "CLEAR_ERROR") {
      const current = document.getElementById("ONEDRIVE_PHOTO_CURRENT");
      current.textContent = "";
    }
    if (noti === "UPDATE_STATUS") {
      const info = document.getElementById("ONEDRIVE_PHOTO_INFO");
      info.innerHTML = String(payload);
    }
    if (noti === "RENDER_PHOTO") {
      this.state = { type: "newPhoto", payload };
      const { photo, photoBase64, album, interestingRectangleResult } = payload;
      const url = `data:${photo.mimeType === "image/heic" ? "image/jpeg" : photo.mimeType};base64,${photoBase64}`;
      
      // Use marked image if face detection was performed and rectangles were burned in
      const displayUrl = interestingRectangleResult?.markedImageUrl || url;
      
      // Pass face detection focal point if available
      const focalPoint = interestingRectangleResult?.focalPoint || null;
      
      this.render(displayUrl, photo, album, focalPoint);
    }
  },

  notificationReceived: function (noti, _payload, _sender) {
    if (noti === "ONEDRIVE_PHOTO_NEXT") {
      this.sendSocketNotification("NEXT_PHOTO", []);
    }
  },

  // ==================== KEN BURNS DYNAMIC ANIMATION ==================== 
  createKenBurnsKeyframes: function(animationName: string, cropX: number, cropY: number, focalPoint: any, imageWidth: number, imageHeight: number, totalDuration: number): void {
    const fadeInDuration = 1; // 1 second fade in
    const fadeOutDuration = 1; // 1 second fade out
    
    const fadeInPercent = (fadeInDuration / totalDuration) * 100;
    const fadeOutPercent = ((totalDuration - fadeOutDuration) / totalDuration) * 100;

    // Calculate optimal starting scale based on focal point rectangle
    let startScale = 1.0; // Default fallback
    
    if (focalPoint && imageWidth && imageHeight) {
      // Calculate focal point dimensions as percentages of image
      const focalWidthPercent = (focalPoint.width / imageWidth) * 100;
      const focalHeightPercent = (focalPoint.height / imageHeight) * 100;
      
      // Calculate required scale to make focal point fit the screen
      // We want the focal rectangle to be as large as possible while staying on screen
      const scaleForWidth = 100 / focalWidthPercent;
      const scaleForHeight = 100 / focalHeightPercent;
      
      // Use the smaller scale to ensure both dimensions fit
      const optimalScale = Math.min(scaleForWidth, scaleForHeight);
      
      // Clamp the scale to reasonable bounds (1.1x to 2.5x)
      startScale = Math.max(1.1, Math.min(10.0 /*2.5*/, optimalScale));
      
      console.debug("[MMM-OneDrive] Focal point scale calculation:", {
        focalWidthPercent: focalWidthPercent.toFixed(1),
        focalHeightPercent: focalHeightPercent.toFixed(1),
        scaleForWidth: scaleForWidth.toFixed(2),
        scaleForHeight: scaleForHeight.toFixed(2),
        optimalScale: optimalScale.toFixed(2),
        finalStartScale: startScale.toFixed(2)
      });
    }

    // NEW: Calculate pan offsets to center the focal point at start
    let startTranslateX = 0;
    let startTranslateY = 0;
    
    if (focalPoint && this.config.kenBurnsCenterStart !== false) { // New config option
      // Calculate how far the focal point is from center (in percentages)
      const focalCenterX = cropX; // This is already the focal point center as %
      const focalCenterY = cropY;
      
      // Calculate translation needed to move focal point to screen center (50%, 50%)
      // Note: Transform translate uses opposite direction, so subtract from 50
      startTranslateX = 50 - focalCenterX; 
      startTranslateY = 50 - focalCenterY;
      
      console.debug("[MMM-OneDrive] Pan calculation:", {
        focalCenter: `${focalCenterX.toFixed(1)}%, ${focalCenterY.toFixed(1)}%`,
        translation: `${startTranslateX.toFixed(1)}%, ${startTranslateY.toFixed(1)}%`,
        finalPosition: "50%, 50% (screen center)"
      });
    }

    const keyframes = `
      @keyframes ${animationName} {
        0% {
          opacity: 0;
          transform: scale(${startScale}) translate(${startTranslateX}%, ${startTranslateY}%) ;
          overflow: hidden;
        }
        ${fadeInPercent.toFixed(3)}% {
          opacity: 1;
          overflow: hidden;
        }
        ${fadeOutPercent.toFixed(3)}% {
          opacity: 1;
          overflow: hidden;
        }
        100% {
          opacity: 0;
          transform: translate(0%, 0%) scale(1.0);
          overflow: hidden;
        }
      }
    `

    // experiment 1
    // const keyframes = `
    //   @keyframes ${animationName} {
    //     0% {
    //       opacity: 0;
    //       transform: translate(${startTranslateX}%, ${startTranslateY}%) scale(${startScale});
    //     }
    //     ${fadeInPercent.toFixed(3)}% {
    //       opacity: 1;
    //     }
    //     ${fadeOutPercent.toFixed(3)}% {
    //       opacity: 1;
    //     }
    //     100% {
    //       opacity: 0;
    //       transform: translate(0%, 0%) scale(1.0);
    //     }
    //   }
    // `
    
    // known good below -- do not touch
    // const keyframes = `
    //   @keyframes ${animationName} {
    //     0% {
    //       opacity: 0;
    //       transform: scale(${startScale});
    //       transform-origin: ${cropX}% ${cropY}%;
    //     }
    //     ${fadeInPercent.toFixed(3)}% {
    //       opacity: 1;
    //       transform: scale(${startScale});
    //       transform-origin: ${cropX}% ${cropY}%;
    //     }
    //     ${fadeOutPercent.toFixed(3)}% {
    //       opacity: 1;
    //       transform: scale(1.0);
    //       transform-origin: ${cropX}% ${cropY}%;
    //     }
    //     100% {
    //       opacity: 0;
    //       transform: scale(1.0);
    //       transform-origin: ${cropX}% ${cropY}%;
    //     }
    //   }
    // `;
    
    // Remove any existing style element for this animation
    const existingStyle = document.getElementById(animationName);
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Create and inject the new keyframes
    const styleElement = document.createElement('style');
    styleElement.id = animationName;
    styleElement.textContent = keyframes;
    document.head.appendChild(styleElement);
  },

  render: function (url: string, target: OneDriveMediaItem, album: DriveItem, focalPoint?: any) {
    if (this.suspended) {
      console.debug("[MMM-OneDrive] Module is suspended, skipping render");
      return;
    }
    const startDt = new Date();
    const back = document.getElementById("ONEDRIVE_PHOTO_BACKDROP");
    const current = document.getElementById("ONEDRIVE_PHOTO_CURRENT");
    current.textContent = "";
    back.style.backgroundImage = `url(${url})`;
    current.style.backgroundImage = `url(${url})`;
    
    // ==================== LEFT MARGIN SUPPORT WITH CLIPPING WRAPPER ==================== 
    if (this.config.leftMargin) {
      // Create or get the clipping wrapper
      let clipWrapper = document.getElementById("ONEDRIVE_PHOTO_CLIP_WRAPPER");
      if (!clipWrapper) {
        clipWrapper = document.createElement("div");
        clipWrapper.id = "ONEDRIVE_PHOTO_CLIP_WRAPPER";
        clipWrapper.style.position = "absolute";
        clipWrapper.style.overflow = "hidden";
        clipWrapper.style.top = "10px";
        clipWrapper.style.bottom = "10px";
        
        // Insert wrapper and move current inside it
        const parent = current.parentNode;
        parent.insertBefore(clipWrapper, current);
        clipWrapper.appendChild(current);
      }
      
      // Set wrapper boundaries to respect left margin
      clipWrapper.style.left = this.config.leftMargin;
      clipWrapper.style.right = "10px";
      
      // Reset current element positioning since it's now inside wrapper
      current.style.left = "0";
      current.style.right = "0";
      current.style.top = "0";
      current.style.bottom = "0";
      current.style.width = "100%";
      current.style.height = "100%";
      current.style.overflow = "";
      
      // Ensure the background image is centered within the container
      current.style.backgroundPosition = "center center";
      current.style.backgroundSize = "contain";
      
    } else {
      // Remove wrapper if no left margin needed
      const clipWrapper = document.getElementById("ONEDRIVE_PHOTO_CLIP_WRAPPER");
      if (clipWrapper) {
        const parent = clipWrapper.parentNode;
        parent.insertBefore(current, clipWrapper);
        parent.removeChild(clipWrapper);
        
        // Reset current element to original positioning
        current.style.left = "10px";
        current.style.right = "10px";
        current.style.top = "10px";
        current.style.bottom = "10px";
      }
    }
    
    // ==================== KEN BURNS EFFECT ==================== 
    if (this.config.kenBurnsEffect !== false) { // Default to enabled unless explicitly disabled
      if (focalPoint) {
        // Get image dimensions from photo metadata for pixel-to-percentage conversion
        const imageWidth = Number(target.mediaMetadata?.width);
        const imageHeight = Number(target.mediaMetadata?.height);
        
        if (imageWidth && imageHeight) {
          // Convert pixel coordinates to percentages (backend sends pixels, we need percentages)
          const focalCenterX = (focalPoint.x + focalPoint.width / 2) / imageWidth;
          const focalCenterY = (focalPoint.y + focalPoint.height / 2) / imageHeight;
          
          let cropX = focalCenterX * 100;
          let cropY = focalCenterY * 100;
          
          // Ensure crop center is within reasonable bounds
          cropX = Math.max(20, Math.min(80, cropX));
          cropY = Math.max(20, Math.min(80, cropY));
          
          console.log(`[MMM-OneDrive] Using face-detected focal point: ${cropX.toFixed(1)}%, ${cropY.toFixed(1)}%`);
          this.applyKenBurnsAnimation(current, cropX, cropY, target, focalPoint);
        } else {
          console.warn(`[MMM-OneDrive] Missing image dimensions for focal point conversion, using random`);
          // Fallback to random if no image dimensions
          const cropX = Math.random() * 60 + 20;
          const cropY = Math.random() * 60 + 20;
          this.applyKenBurnsAnimation(current, cropX, cropY, target);
        }
      } else {
        // Generate random crop position for Ken Burns effect (fallback)
        const cropX = Math.random() * 60 + 20; // 20% to 80% (avoid edges)
        const cropY = Math.random() * 60 + 20; // 20% to 80% (avoid edges)
        
        console.log(`[MMM-OneDrive] Using random focal point: ${cropX.toFixed(1)}%, ${cropY.toFixed(1)}%`);
        this.applyKenBurnsAnimation(current, cropX, cropY, target);
      }
    } else {
      // Remove any Ken Burns animation
      current.style.removeProperty('animation');
      current.style.removeProperty('overflow');
    }
    
    this.applyCommonStyling(current, target, album, startDt);
  },

  applyKenBurnsAnimation: function(current: HTMLElement, cropX: number, cropY: number, target: OneDriveMediaItem, focalPoint?: any): void {
    const totalDuration = (this.config.updateInterval/1000) + 2; // Add 2 seconds for fade in + out
    
    // Create unique animation name for this photo
    const animationName = `ken-burns-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    // Get image dimensions for scale calculation
    const imageWidth = Number(target.mediaMetadata?.width) || 0;
    const imageHeight = Number(target.mediaMetadata?.height) || 0;
    
    // Generate and inject dynamic keyframes (scale calculation happens inside)
    this.createKenBurnsKeyframes(animationName, cropX, cropY, focalPoint, imageWidth, imageHeight, totalDuration);
    
    // Apply the animation to the element
    current.style.animation = `${animationName} ${totalDuration}s linear forwards`;
    current.style.overflow = 'hidden';
    
    console.debug("[MMM-OneDrive] Ken Burns animation:", { 
      animationName,
      origin: `${cropX}% ${cropY}%`, 
      totalDuration: `${totalDuration}s`,
      filename: target.filename,
      hasFocalPoint: !!focalPoint
    });
  },

  applyCommonStyling: function(current: HTMLElement, target: OneDriveMediaItem, album: DriveItem, startDt: Date): void {
    // ==================== END KEN BURNS EFFECT ==================== 
    
    current.classList.add("animated");
    const info = document.getElementById("ONEDRIVE_PHOTO_INFO");
    if (this.config.autoInfoPosition) {
      let op: AutoInfoPositionFunction = (_album, _target) => {
        const now = new Date();
        const q = Math.floor(now.getMinutes() / 15);
        const r = [
          [0, "none", "none", 0],
          ["none", "none", 0, 0],
          ["none", 0, 0, "none"],
          [0, 0, "none", "none"],
        ];
        return r[q];
      };
      if (typeof this.config.autoInfoPosition === "function") {
        op = this.config.autoInfoPosition;
      }
      const [top, left, bottom, right] = op(album, target);
      info.style.setProperty("--top", String(top));
      info.style.setProperty("--left", String(left));
      info.style.setProperty("--bottom", String(bottom));
      info.style.setProperty("--right", String(right));
    }
    info.innerHTML = "";
    
    // Detect if this photo is from a folder vs an album
    const isFromFolder = target._folderId && !album.bundle;
    
    let sourceIcon, sourceTitle;
    
    if (isFromFolder) {
      // Create folder icon instead of album cover
      sourceIcon = document.createElement("div");
      sourceIcon.classList.add("folderIcon");
      sourceIcon.innerHTML = ""; // Empty - icon created with CSS
      
      sourceTitle = document.createElement("div");
      sourceTitle.classList.add("folderTitle");
      sourceTitle.innerHTML = album.name; // Folder name
    } else {
      // Create album cover (existing behavior)
      sourceIcon = document.createElement("div");
      sourceIcon.classList.add("albumCover");
      sourceIcon.style.backgroundImage = `url(modules/MMM-OneDrive/cache/${album.id})`;
      
      sourceTitle = document.createElement("div");
      sourceTitle.classList.add("albumTitle");
      sourceTitle.innerHTML = album.name; // Album name
    }
    
    const photoTime = document.createElement("div");
    photoTime.classList.add("photoTime");
    photoTime.innerHTML = this.config.timeFormat === "relative" ? moment(target.mediaMetadata.dateTimeOriginal).fromNow() : moment(target.mediaMetadata.dateTimeOriginal).format(this.config.timeFormat);
    
    // Add location info if available
    const photoLocation = document.createElement("div");
    photoLocation.classList.add("photoLocation");
    if (target.mediaMetadata.location) {
      const location = target.mediaMetadata.location;
      if (location.city || location.state || location.country) {
        const locationParts = [location.city];
        
        // Include state if: (US or Canada) OR (no city available)
        if (location.state && ((location.country?.toLowerCase() === "united states" || location.country?.toLowerCase() === "canada") || !location.city)) {
          locationParts.push(location.state);
        }
        
        if (location.country) {
          locationParts.push(location.country);
        }
        
        photoLocation.innerHTML = locationParts.filter(Boolean).join(", ");
      } else if (location.latitude && location.longitude) {
        photoLocation.innerHTML = `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`;
      }
    }
    
    const infoText = document.createElement("div");
    infoText.classList.add("infoText");

    info.appendChild(sourceIcon);
    infoText.appendChild(sourceTitle);
    infoText.appendChild(photoTime);
    if (photoLocation.innerHTML) {
      infoText.appendChild(photoLocation);
    }
    info.appendChild(infoText);
    console.debug("[MMM-OneDrive] render image done",
      JSON.stringify({
        id: target.id,
        filename: target.filename,
        duration: new Date().getTime() - startDt.getTime(),
      }));
    this.sendSocketNotification("IMAGE_LOADED", {
      id: target.id,
      filename: target.filename,
      indexOfPhotos: target._indexOfPhotos,
    });
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.id = "ONEDRIVE_PHOTO";
    const back = document.createElement("div");
    back.id = "ONEDRIVE_PHOTO_BACKDROP";
    const current = document.createElement("div");
    current.id = "ONEDRIVE_PHOTO_CURRENT";
    if (this.data.position.search("fullscreen") === -1) {
      if (this.config.showWidth) wrapper.style.width = this.config.showWidth + "px";
      if (this.config.showHeight) wrapper.style.height = this.config.showHeight + "px";
    }
    current.addEventListener("animationend", () => {
      current.classList.remove("animated");
    });
    const info = document.createElement("div");
    info.id = "ONEDRIVE_PHOTO_INFO";
    info.innerHTML = "Loading...";
    wrapper.appendChild(back);
    wrapper.appendChild(current);
    wrapper.appendChild(info);
    console.info("[MMM-OneDrive] Dom updated!");
    return wrapper;
  },

  suspend() {
    this.sendSocketNotification("MODULE_SUSPENDED", undefined);
    this.suspended = true;
    const info = document.getElementById("ONEDRIVE_PHOTO_INFO");
    info.innerHTML = "";
  },

  resume() {
    this.sendSocketNotification("MODULE_RESUMED", undefined);
    this.suspended = false;
  },
});
