/**
 * Color Analysis System for MMM-OneDrive
 * 
 * Analyzes dominant colors in images using K-means clustering.
 * Provides main colors and contrasting colors for UI theming and animations.
 * 
 * =================================================================================================
 * FILE NAVIGATION:
 * =================================================================================================
 * 1. INITIALIZATION & CONFIG     - Lines 13-51   : Constructor and configuration options
 * 2. UNIFIED PIPELINE METHOD     - Lines 52-92   : Mat-based color analysis for unified processing
 * 3. COLOR CALCULATION METHODS   - Lines 93-159  : HSV conversion, unified scoring
 * 4. K-MEANS COLOR EXTRACTION    - Lines 160-338 : Core color clustering and analysis
 * 5. COLOR UTILITY METHODS       - Lines 339-469 : Contrast, complementary, text-friendly colors
 * =================================================================================================
 */

const cv = require('@u4/opencv4nodejs');
const { trackMat, safeRelease } = require('./matManager');

class ColorAnalyzer {
  
  constructor(options = {}) {
    this.options = {
      // Number of dominant colors to return
      maxColors: options.maxColors || 3,
      
      // K-means clustering parameters
      kClusters: options.kClusters || 4, // More clusters for better color separation
      maxIterations: options.maxIterations || 20,
      epsilon: options.epsilon || 1.0,
      
      // Performance options
      maxImageSize: options.maxImageSize || 800, // Resize large images for speed
      
      // Color filtering
      minColorPercentage: options.minColorPercentage || 0.01, // Ignore colors < 1% (was 5%)
      
      // Unified scoring options for ranking k-means results
      frequencyWeight: options.frequencyWeight || 0.3,    // Reduced frequency dominance
      saturationWeight: options.saturationWeight || 0.6,   // Increased saturation importance
      brightnessWeight: options.brightnessWeight || 0.1,   // Keep brightness low
      saturationBoost: options.saturationBoost || 4.0,     // Stronger boost for vibrant colors
      minFrequencyForBoost: options.minFrequencyForBoost || 0.01, // Lower threshold for boost (1%)
      
      // Logging
      enableDebugLogs: options.enableDebugLogs || false,
      
      ...options
    };
    
    this.log = this.options.enableDebugLogs 
      ? (msg) => console.log(`[ColorAnalysis] ${msg}`)
      : () => {};
  }

  // =================================================================================================
  // 2. UNIFIED PIPELINE METHOD - Mat-based color analysis for unified processing
  // =================================================================================================

  /**
   * Color analysis using pre-processed OpenCV Mat
   * @param {Mat} image - Pre-processed OpenCV Mat
   * @returns {Promise<Object>} Color analysis results
   */
  async analyzeColorsFromMat(image) {
    const startTime = Date.now();
    
    try {
      if (!image || image.empty) {
        throw new Error('Invalid or empty image Mat for color analysis');
      }
      
      this.log(`Starting color analysis from Mat (${image.cols}x${image.rows} pixels)`);
      
      // Analyze dominant colors
      const colorResults = await this.findDominantColors(image);
      
      if (colorResults && colorResults.length > 0) {
        const processingTime = Date.now() - startTime;
        this.log(`Color analysis completed in ${processingTime}ms: ${colorResults.length} colors found`);
        
        return {
          dominantColors: colorResults,
          mainColor: colorResults[0], // Most dominant color
          processingTime: processingTime,
          timestamp: Date.now()
        };
      }
      
      this.log('No dominant colors found');
      return null;
      
    } catch (error) {
      console.error(`[ColorAnalysis] Color analysis from Mat failed:`, error.message);
      return null;
    }
    // Note: No image cleanup needed - Mat is managed by caller
  }

  // =================================================================================================
  // 3. COLOR CALCULATION METHODS - HSV conversion, unified scoring algorithms
  // =================================================================================================

  /**
   * Calculate unified importance score combining frequency and visual interest
   * @param {number} frequency - Color frequency (0-1)
   * @param {object} hsv - HSV color object {h, s, v}
   * @returns {number} Unified importance score
   */
  calculateUnifiedScore(frequency, hsv) {
    const { s: saturation, v: brightness } = hsv;
    
    // Base score from frequency
    let score = frequency * this.options.frequencyWeight;
    
    // Add saturation contribution
    score += saturation * this.options.saturationWeight;
    
    // Add brightness contribution (prefer mid-range brightness)
    const brightnessScore = 1 - Math.abs(brightness - 0.6); // Peak at 60% brightness
    score += brightnessScore * this.options.brightnessWeight;
    
    // Boost highly saturated colors if they have minimum frequency
    if (saturation > 0.6 && frequency >= this.options.minFrequencyForBoost) { // Lowered saturation threshold
      const boost = Math.pow(saturation, this.options.saturationBoost) * frequency;
      score += boost * 0.5; // Increased boost factor from 0.3 to 0.5
    }
    
    // Extra boost for extremely vibrant colors (>80% saturation)
    if (saturation > 0.8) {
      score += saturation * 0.3; // Additional vibrant color bonus
    }
    
    return score;
  }

  /**
   * Convert RGB to HSV color space
   * @param {number} r - Red component (0-255)
   * @param {number} g - Green component (0-255)
   * @param {number} b - Blue component (0-255)
   * @returns {object} HSV color {h, s, v} where h is 0-360, s and v are 0-1
   */
  rgbToHsv(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const diff = max - min;
    
    let h = 0;
    const s = max === 0 ? 0 : diff / max;
    const v = max;
    
    if (diff !== 0) {
      if (max === r) {
        h = ((g - b) / diff) % 6;
      } else if (max === g) {
        h = (b - r) / diff + 2;
      } else {
        h = (r - g) / diff + 4;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    
    return { h, s, v };
  }

  // =================================================================================================
  // 4. K-MEANS COLOR EXTRACTION - Core color clustering and dominant color analysis
  // =================================================================================================

  /**
   * Find dominant colors using K-means clustering + unified interest scoring
   * @param {cv.Mat} image - OpenCV image matrix
   * @returns {Promise<Array>} Array of most important colors
   */
  async findDominantColors(image) {
    let resizedImage = null;
    let data = null;
    
    try {
      // Resize large images for faster processing
      if (Math.max(image.cols, image.rows) > this.options.maxImageSize) {
        const scale = this.options.maxImageSize / Math.max(image.cols, image.rows);
        const newWidth = Math.round(image.cols * scale);
        const newHeight = Math.round(image.rows * scale);
        resizedImage = image.resize(newHeight, newWidth);
        this.log(`Resized to ${newWidth}x${newHeight} for color analysis`);
      } else {
        resizedImage = image.copy(); // Use copy() instead of clone()
      }
      // trackMat(resizedImage, 'resized image for color analysis');  // Temporarily removed
      
      // Convert image to proper format for k-means clustering
      const pixelCount = resizedImage.rows * resizedImage.cols;
      this.log(`Converting ${pixelCount} pixels to k-means format`);
      
      try {
        // Extract pixel data as Point3 array (required format for opencv4nodejs k-means)
        const pixelData = [];
        
        for (let y = 0; y < resizedImage.rows; y++) {
          for (let x = 0; x < resizedImage.cols; x++) {
            const pixel = resizedImage.at(y, x);
            // Create Point3 objects for BGR color values (opencv4nodejs k-means requirement)  
            // Vec3 uses .x, .y, .z properties (not array access)
            const point3 = new cv.Point3(pixel.x, pixel.y, pixel.z);
            pixelData.push(point3);
          }
        }
        
        this.log(`Created Point3 array with ${pixelData.length} color vectors`);
        
        // For large images, sample pixels to avoid memory issues
        let sampledData = pixelData;
        const maxSampleSize = 10000; // Limit to 10k pixels for performance
        if (pixelData.length > maxSampleSize) {
          sampledData = [];
          const step = Math.floor(pixelData.length / maxSampleSize);
          for (let i = 0; i < pixelData.length; i += step) {
            sampledData.push(pixelData[i]);
          }
          this.log(`Sampled ${sampledData.length} pixels from ${pixelData.length} for k-means`);
        }
        
        data = sampledData; // K-means expects Point3 array, not Mat
        
      } catch (matError) {
        this.log(`Failed to create data Mat: ${matError?.message}`);
        this.log(`Mat error stack: ${matError?.stack}`);
        throw new Error(`Failed to create data matrix: ${matError?.message}`);
      }
      
      // Prepare K-means termination criteria
      const criteria = new cv.TermCriteria(3, 10, 1.0); // type (COUNT+EPS), maxCount, epsilon
      
      this.log(`Running K-means clustering with k=${this.options.kClusters}`);
      
      if (!data || data.length === 0) {
        throw new Error(`No color data available for k-means: ${data.length} points`);
      }
      
      // Run k-means clustering with working 5-parameter format
      let kmeansResult;
      try {
        // Ensure proper parameter types
        const k = Number(this.options.kClusters);
        const attempts = 10;
        const flags = 0; // Default initialization (0 works better than cv.KMEANS_RANDOM_CENTERS)
        
        // Working k-means format: 5 parameters, returns object with labels/centers
        kmeansResult = cv.kmeans(
          data,      // Array of Point3 objects
          k,         // Number of clusters
          criteria,  // Termination criteria
          attempts,  // Number of attempts
          flags      // Initialization flags
        );
        
        if (!kmeansResult || !kmeansResult.labels || !kmeansResult.centers) {
          throw new Error('K-means returned invalid result structure');
        }
        
      } catch (kmeansError) {
        throw new Error(`K-means clustering failed: ${kmeansError?.message || 'unknown k-means error'}`);
      }
      
      // Verify results after k-means
      if (!kmeansResult.labels || !kmeansResult.centers || kmeansResult.labels.length === 0 || kmeansResult.centers.length === 0) {
        throw new Error('K-means produced empty results');
      }
      
      // Count pixels in each cluster
      const counts = new Array(this.options.kClusters).fill(0);
      for (let i = 0; i < kmeansResult.labels.length; i++) {
        const label = kmeansResult.labels[i];
        if (label >= 0 && label < this.options.kClusters) {
          counts[label]++;
        }
      }
      
      // Create color results with percentages
      // CRITICAL FIX: Use the actual sample size that k-means processed, not total image pixels
      const actualSampleSize = kmeansResult.labels.length;
      const dominantColors = [];
      
      for (let i = 0; i < this.options.kClusters; i++) {
        const center = kmeansResult.centers[i];
        const bgrColor = [
          Math.round(Math.max(0, Math.min(255, center.x))), // B
          Math.round(Math.max(0, Math.min(255, center.y))), // G  
          Math.round(Math.max(0, Math.min(255, center.z)))  // R
        ];
        
        // Convert BGR to RGB for easier understanding
        const rgbColor = [bgrColor[2], bgrColor[1], bgrColor[0]];
        
        // Fix: Calculate percentage based on actual sample size used by k-means
        const percentage = counts[i] / actualSampleSize;
        const hexColor = `#${rgbColor.map(c => c.toString(16).padStart(2, '0')).join('')}`;
        
        // Convert RGB to HSV for unified scoring
        const hsvColor = this.rgbToHsv(rgbColor[0], rgbColor[1], rgbColor[2]);
        
        // Only include colors that meet minimum percentage threshold
        if (percentage >= this.options.minColorPercentage) {
          // Calculate unified importance score combining frequency and visual interest
          const unifiedScore = this.calculateUnifiedScore(percentage, hsvColor);
          
          dominantColors.push({ 
            rgb: rgbColor,
            hsv: hsvColor,
            bgr: bgrColor,
            percentage: percentage,
            pixelCount: counts[i],
            hexColor: hexColor,
            contrastColor: this.getContrastingColor(rgbColor),
            unifiedScore: unifiedScore
          });
        }
      }
      
      // Sort by unified importance score (most important first) and limit to maxColors
      const sortedColors = dominantColors
        .sort((a, b) => b.unifiedScore - a.unifiedScore)
        .slice(0, this.options.maxColors);
      
      this.log(`Found ${sortedColors.length} dominant colors`);
      
      return sortedColors;
      
    } catch (error) {
      this.log(`K-means clustering failed: ${error.message}`);
      console.error(`[ColorAnalysis] K-means error stack:`, error.stack);
      return [];
    } finally {
      // CRITICAL: Release all Mat objects in reverse order of creation
      // Note: labels and centers are no longer Mat objects with new k-means format
      // Note: data is now a Point3 array, not a Mat, so no release needed
      
      if (resizedImage && !resizedImage.empty) {
        try {
          safeRelease(resizedImage, 'resized image for color analysis');
        } catch (e) {
          console.warn(`[ColorAnalysis] Error releasing resized image:`, e.message);
        }
      }
    }
  }

  // =================================================================================================
  // 5. COLOR UTILITY METHODS - Contrast, complementary, and text-friendly color calculations
  // =================================================================================================

  /**
   * Calculate contrasting color for better readability
   * @param {Array} rgbColor - [R, G, B] color array
   * @returns {Array} [R, G, B] contrasting color
   */
  getContrastingColor(rgbColor) {
    const [r, g, b] = rgbColor;
    
    // Calculate relative luminance (WCAG formula)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Return black or white for maximum contrast
    return luminance > 0.5 ? [0, 0, 0] : [255, 255, 255];
  }

  /**
   * Get complementary color (opposite on color wheel)
   * @param {Array} rgbColor - [R, G, B] color array
   * @returns {Array} [R, G, B] complementary color
   */
  getComplementaryColor(rgbColor) {
    const [r, g, b] = rgbColor;
    
    // Convert RGB to HSV
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const delta = max - min;
    
    let h = 0;
    if (delta !== 0) {
      if (max === r/255) h = ((g/255 - b/255) / delta) % 6;
      else if (max === g/255) h = (b/255 - r/255) / delta + 2;
      else h = (r/255 - g/255) / delta + 4;
    }
    h = h * 60;
    if (h < 0) h += 360;
    
    const s = max === 0 ? 0 : delta / max;
    const v = max;
    
    // Get complementary hue (180° opposite)
    const compH = (h + 180) % 360;
    
    // Convert HSV back to RGB
    return this.hsvToRgb(compH, s, v);
  }

  /**
   * Convert HSV to RGB
   * @param {number} h - Hue (0-360)
   * @param {number} s - Saturation (0-1)
   * @param {number} v - Value (0-1)
   * @returns {Array} [R, G, B] color array
   */
  hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    
    let r, g, b;
    
    if (h >= 0 && h < 60) {
      r = c; g = x; b = 0;
    } else if (h >= 60 && h < 120) {
      r = x; g = c; b = 0;
    } else if (h >= 120 && h < 180) {
      r = 0; g = c; b = x;
    } else if (h >= 180 && h < 240) {
      r = 0; g = x; b = c;
    } else if (h >= 240 && h < 300) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }
    
    return [
      Math.round((r + m) * 255),
      Math.round((g + m) * 255),
      Math.round((b + m) * 255)
    ];
  }

  /**
   * Get text-friendly colors from dominant colors with conservative brightening
   * Only brightens colors if they are too dark for good text readability
   * @param {Array} dominantColors - Array of dominant colors from unified scoring
   * @param {number} count - Number of text colors to return (default: 2)
   * @returns {Array} Array of text-friendly colors for UI elements
   */
  getTextFriendlyColors(dominantColors, count = 2) {
    if (!dominantColors || dominantColors.length === 0) {
      return [];
    }
    
    const BRIGHTNESS_THRESHOLD = 0.45; // Only brighten if below 45% brightness
    const BRIGHTENING_FACTOR = 0.5;   // Conservative 50% brightening
    
    return dominantColors.slice(0, count).map((color, index) => {
      const brightness = color.hsv.v;
      let finalRgb = [...color.rgb];
      let wasBrightened = false;
      
      // Only brighten if the color is too dark for text readability
      if (brightness < BRIGHTNESS_THRESHOLD) {
        const [r, g, b] = color.rgb;
        
        // Conservative brightening - move toward white by the brightening factor
        finalRgb = [
          Math.min(255, Math.round(r + (255 - r) * BRIGHTENING_FACTOR)),
          Math.min(255, Math.round(g + (255 - g) * BRIGHTENING_FACTOR)),
          Math.min(255, Math.round(b + (255 - b) * BRIGHTENING_FACTOR))
        ];
        
        wasBrightened = true;
      }
      
      const finalHex = `#${finalRgb.map(c => c.toString(16).padStart(2, '0')).join('')}`;
      const finalBrightness = (finalRgb[0] + finalRgb[1] + finalRgb[2]) / (3 * 255);
      
      return {
        ...color,
        rgb: finalRgb,
        hexColor: finalHex,
        brightness: finalBrightness,
        wasBrightened,
        originalRgb: color.rgb,
        originalHex: color.hexColor,
        textRole: index === 0 ? 'date' : 'location', // First for date, second for location
        contrastColor: this.getContrastingColor(finalRgb)
      };
    });
  }
}

module.exports = ColorAnalyzer;
