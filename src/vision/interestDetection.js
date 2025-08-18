/**
 * Interest Detection System for MMM-OneDrive
 * 
 * Fallback system when no faces are detected - finds visually interesting regions
 * using feature clustering, sliding windows, and gradient analysis.
 * 
 * Production-ready implementation with adaptive sizing and confidence thresholds.
 */

const cv = require('@u4/opencv4nodejs');

class InterestDetector {
  
  constructor(options = {}) {
    this.options = {
      // Size control options
      sizeMode: options.sizeMode || 'adaptive', // 'tight', 'adaptive', 'loose'
      maxRegionPercent: options.maxRegionPercent || 0.25, // Max 25% of image
      minRegionPercent: options.minRegionPercent || 0.08, // Min 8% of image
      preferSquare: options.preferSquare !== false, // Default true
      
      // Detection options
      featurePadding: options.featurePadding || 40,
      clusterDistance: options.clusterDistance || 120,
      
      // Production thresholds
      minConfidenceThreshold: options.minConfidenceThreshold || 0.65,
      minScoreThreshold: options.minScoreThreshold || 30,
      
      // Logging
      enableDebugLogs: options.enableDebugLogs || false,
      
      ...options
    };
    
    this.log = this.options.enableDebugLogs 
      ? (msg) => console.log(`[InterestDetection] ${msg}`)
      : () => {};
  }
  
  /**
   * Main entry point - find most interesting region in image
   * Returns null if nothing meets confidence thresholds
   */
  async findInterestingRegion(image) {
    const startTime = Date.now();
    this.log(`Processing ${image.cols}x${image.rows} image`);
    
    try {
      // Resize large images for processing efficiency
      let workingImage = image;
      let scale = 1.0;
      
      const maxDimension = 1200;
      if (Math.max(image.cols, image.rows) > maxDimension) {
        scale = maxDimension / Math.max(image.cols, image.rows);
        const newWidth = Math.round(image.cols * scale);
        const newHeight = Math.round(image.rows * scale);
        workingImage = image.resize(newHeight, newWidth);
        this.log(`Resized to ${workingImage.cols}x${workingImage.rows} (scale: ${scale.toFixed(3)})`);
      }
      
      // Define safe zone (5% margin from edges)
      const edgeMargin = 0.05;
      const safeZone = {
        minX: Math.round(workingImage.cols * edgeMargin),
        maxX: Math.round(workingImage.cols * (1 - edgeMargin)),
        minY: Math.round(workingImage.rows * edgeMargin),
        maxY: Math.round(workingImage.rows * (1 - edgeMargin))
      };
      
      // Calculate adaptive region sizes based on image dimensions
      const imageSize = Math.max(workingImage.cols, workingImage.rows);
      const baseSize = Math.round(imageSize * 0.15); // 15% of image dimension
      const smallSize = Math.round(baseSize * 0.7);  // ~10% 
      const largeSize = Math.round(baseSize * 1.3);  // ~20%
      
      this.log(`Safe zone: x=${safeZone.minX}-${safeZone.maxX}, y=${safeZone.minY}-${safeZone.maxY}`);
      
      const candidates = [];
      
      // Method 1: Feature cluster regions (primary method)
      try {
        const featureClusters = await this.detectFeatureClusterRegions(workingImage, safeZone);
        candidates.push(...featureClusters);
        this.log(`Found ${featureClusters.length} feature cluster candidates`);
      } catch (error) {
        this.log(`Feature clustering failed: ${error.message}`);
      }
      
      // Method 2: Sliding window analysis (secondary)
      try {
        const slidingRegions = await this.slidingWindowAnalysis(workingImage, safeZone, baseSize, smallSize, largeSize);
        candidates.push(...slidingRegions);
        this.log(`Found ${slidingRegions.length} sliding window candidates`);
      } catch (error) {
        this.log(`Sliding window analysis failed: ${error.message}`);
      }
      
      // Method 3: Gradient-based adaptive regions (tertiary)
      try {
        const gradientRegions = await this.detectGradientRegions(workingImage, safeZone, baseSize);
        candidates.push(...gradientRegions);
        this.log(`Found ${gradientRegions.length} gradient candidates`);
      } catch (error) {
        this.log(`Gradient analysis failed: ${error.message}`);
      }
      
      let bestRegion = null;
      
      if (candidates.length === 0) {
        this.log('No candidates found');
      } else {
        // Remove overlapping candidates
        const filteredCandidates = this.removeOverlappingCandidates(candidates);
        this.log(`Filtered to ${filteredCandidates.length} unique candidates`);
        
        // Calculate confidence for all candidates
        const candidatesWithConfidence = filteredCandidates.map(candidate => ({
          ...candidate,
          confidence: this.calculateAdvancedConfidence(candidate, workingImage, safeZone)
        }));
        
        // Select best candidate that meets thresholds
        const viableCandidates = candidatesWithConfidence.filter(c => 
          c.confidence >= this.options.minConfidenceThreshold && 
          c.score >= this.options.minScoreThreshold
        );
        
        if (viableCandidates.length > 0) {
          bestRegion = viableCandidates
            .sort((a, b) => (b.score * b.confidence) - (a.score * a.confidence))[0];
          
          this.log(`Selected: ${bestRegion.type} (score: ${bestRegion.score.toFixed(1)}, confidence: ${bestRegion.confidence.toFixed(2)})`);
          
          // Scale back to original coordinates
          if (scale !== 1.0) {
            bestRegion.x = Math.round(bestRegion.x / scale);
            bestRegion.y = Math.round(bestRegion.y / scale);
            bestRegion.width = Math.round(bestRegion.width / scale);
            bestRegion.height = Math.round(bestRegion.height / scale);
          }
          
          bestRegion.processingTime = Date.now() - startTime;
          bestRegion.method = 'interest_detection';
          
        } else {
          this.log(`No candidates met thresholds (min confidence: ${this.options.minConfidenceThreshold}, min score: ${this.options.minScoreThreshold})`);
        }
      }
      
      return bestRegion;
      
    } catch (error) {
      console.error(`[InterestDetection] Error processing image: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Detect regions by clustering feature points
   */
  async detectFeatureClusterRegions(workingImage, safeZone) {
    const startTime = Date.now();
    
    try {
      const gray = workingImage.bgrToGray();
      const features = cv.goodFeaturesToTrack(gray, 50, 0.01, 15);
      
      if (features.length === 0) return [];
      
      // Filter to safe zone
      const safeFeatures = features.filter(f => 
        f.x >= safeZone.minX && f.x <= safeZone.maxX &&
        f.y >= safeZone.minY && f.y <= safeZone.maxY
      );
      
      // Cluster features using distance-based clustering
      const clusters = this.clusterFeaturesByDistance(safeFeatures, this.options.clusterDistance);
      
      const regions = [];
      clusters.forEach((cluster, index) => {
        if (cluster.points.length >= 3) { // At least 3 features
          const bounds = this.getClusterBounds(cluster.points, this.options.featurePadding, workingImage);
          
          // Ensure bounds are within safe zone
          const clampedBounds = this.clampToSafeZone(bounds, safeZone);
          
          if (clampedBounds.width > 80 && clampedBounds.height > 80) {
            regions.push({
              ...clampedBounds,
              type: 'feature_cluster',
              score: cluster.points.length * 12, // Higher scoring
              featureCount: cluster.points.length,
              method: 'clustering'
            });
          }
        }
      });
      
      const processingTime = Date.now() - startTime;
      this.log(`Feature clustering: ${regions.length} regions in ${processingTime}ms`);
      return regions;
      
    } catch (error) {
      this.log(`Feature clustering failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Sliding window analysis with overlapping regions
   */
  async slidingWindowAnalysis(workingImage, safeZone, baseSize, smallSize, largeSize) {
    const startTime = Date.now();
    
    try {
      const gray = workingImage.bgrToGray();
      const regions = [];
      
      // Multiple adaptive window sizes
      const windowSizes = [smallSize, baseSize, largeSize];
      const stepSize = Math.round(baseSize * 0.4); // ~40% overlap
      
      for (const windowSize of windowSizes) {
        for (let y = safeZone.minY; y + windowSize <= safeZone.maxY; y += stepSize) {
          for (let x = safeZone.minX; x + windowSize <= safeZone.maxX; x += stepSize) {
            
            try {
              const roi = gray.getRegion(new cv.Rect(x, y, windowSize, windowSize));
              
              // Multi-metric evaluation
              const mean = roi.mean()[0];
              const std = roi.meanStdDev().stddev[0];
              const edges = roi.canny(50, 120);
              const edgeDensity = edges.mean()[0] / 255;
              
              // Combined score
              let score = 0;
              if (std > 25) score += (std - 25) / 3; // Contrast bonus
              if (mean > 100 && mean < 200) score += (200 - Math.abs(mean - 150)) / 10; // Good brightness
              if (edgeDensity > 0.1) score += edgeDensity * 20; // Edge content
              
              if (score > 15) { // Threshold for interesting regions
                regions.push({
                  x: x,
                  y: y,
                  width: windowSize,
                  height: windowSize,
                  type: `sliding_${windowSize}`,
                  score: score,
                  method: 'sliding_window'
                });
              }
            } catch (error) {
              continue;
            }
          }
        }
      }
      
      const processingTime = Date.now() - startTime;
      this.log(`Sliding window: ${regions.length} regions in ${processingTime}ms`);
      return regions;
      
    } catch (error) {
      this.log(`Sliding window failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Detect regions based on brightness/darkness gradients
   */
  async detectGradientRegions(workingImage, safeZone, baseSize) {
    const startTime = Date.now();
    
    try {
      const gray = workingImage.bgrToGray();
      const regions = [];
      const regionSize = baseSize;
      const stepSize = Math.round(regionSize * 0.6);
      
      for (let y = safeZone.minY; y + regionSize <= safeZone.maxY; y += stepSize) {
        for (let x = safeZone.minX; x + regionSize <= safeZone.maxX; x += stepSize) {
          
          try {
            const roi = gray.getRegion(new cv.Rect(x, y, regionSize, regionSize));
            
            const mean = roi.mean()[0];
            const std = roi.meanStdDev().stddev[0];
            
            let score = 0;
            let regionType = 'gradient';
            
            if (mean > 160 && std > 30) {
              score = (mean - 160) / 5 + std / 2;
              regionType = 'bright_gradient';
            } else if (mean < 80 && std > 25) {
              score = (80 - mean) / 5 + std / 2;
              regionType = 'dark_gradient'; 
            } else if (std > 40) {
              score = std / 3;
              regionType = 'high_contrast';
            }
            
            if (score > 12) {
              regions.push({
                x: x,
                y: y,
                width: regionSize,
                height: regionSize,
                type: regionType,
                score: score,
                method: 'gradient'
              });
            }
          } catch (error) {
            continue;
          }
        }
      }
      
      const processingTime = Date.now() - startTime;
      this.log(`Gradient analysis: ${regions.length} regions in ${processingTime}ms`);
      return regions;
      
    } catch (error) {
      this.log(`Gradient analysis failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Cluster features by distance (not grid-based)
   */
  clusterFeaturesByDistance(features, maxDistance) {
    const clusters = [];
    const used = new Set();
    
    for (let i = 0; i < features.length; i++) {
      if (used.has(i)) continue;
      
      const cluster = { points: [features[i]] };
      used.add(i);
      
      // Find all features within distance of this cluster
      let changed = true;
      while (changed) {
        changed = false;
        
        for (let j = 0; j < features.length; j++) {
          if (used.has(j)) continue;
          
          // Check if this feature is close to any point in the cluster
          for (const clusterPoint of cluster.points) {
            const dist = Math.sqrt(
              Math.pow(features[j].x - clusterPoint.x, 2) + 
              Math.pow(features[j].y - clusterPoint.y, 2)
            );
            
            if (dist <= maxDistance) {
              cluster.points.push(features[j]);
              used.add(j);
              changed = true;
              break;
            }
          }
        }
      }
      
      clusters.push(cluster);
    }
    
    return clusters;
  }
  
  /**
   * Get adaptive bounds around a cluster of points
   */
  getClusterBounds(points, basePadding = 50, workingImage = null) {
    if (points.length === 0) return { x: 0, y: 0, width: 100, height: 100 };
    
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);  
    const maxY = Math.max(...ys);
    
    // Calculate natural spread of features
    const naturalWidth = maxX - minX;
    const naturalHeight = maxY - minY;
    
    // Adaptive padding based on feature density and spread
    let paddingX = basePadding;
    let paddingY = basePadding;
    
    // Reduce padding for dense clusters
    if (points.length >= 8) {
      paddingX = basePadding * 0.6;
      paddingY = basePadding * 0.6;
    } else if (points.length >= 5) {
      paddingX = basePadding * 0.8;
      paddingY = basePadding * 0.8;
    }
    
    // Reduce padding if features are already spread out
    if (naturalWidth > 150) paddingX *= 0.7;
    if (naturalHeight > 150) paddingY *= 0.7;
    
    // Calculate bounds with adaptive padding
    let x = Math.max(0, minX - paddingX);
    let y = Math.max(0, minY - paddingY);
    let width = (maxX - minX) + (2 * paddingX);
    let height = (maxY - minY) + (2 * paddingY);
    
    // Apply size constraints if workingImage provided
    if (workingImage) {
      const imageArea = workingImage.cols * workingImage.rows;
      const minArea = imageArea * this.options.minRegionPercent;
      const maxArea = imageArea * this.options.maxRegionPercent;
      
      const MIN_SIZE = Math.sqrt(minArea);
      const MAX_SIZE = Math.sqrt(maxArea);
      
      // Size mode adjustments
      let sizeMultiplier = 1.0;
      if (this.options.sizeMode === 'tight') {
        sizeMultiplier = 0.7;
      } else if (this.options.sizeMode === 'loose') {
        sizeMultiplier = 1.4;
      }
      
      // Apply size constraints
      const minSize = MIN_SIZE * sizeMultiplier;
      const maxSize = MAX_SIZE * sizeMultiplier;
      
      if (width < minSize) {
        const expand = (minSize - width) / 2;
        x = Math.max(0, x - expand);
        width = minSize;
      }
      if (height < minSize) {
        const expand = (minSize - height) / 2;
        y = Math.max(0, y - expand);
        height = minSize;
      }
      
      if (width > maxSize) {
        const shrink = (width - maxSize) / 2;
        x = x + shrink;
        width = maxSize;
      }
      if (height > maxSize) {
        const shrink = (height - maxSize) / 2;
        y = y + shrink;
        height = maxSize;
      }
      
      // Prefer square-ish regions for better focal points
      if (this.options.preferSquare) {
        const avgSize = (width + height) / 2;
        const aspectRatio = width / height;
        
        if (aspectRatio > 1.8) { // Too wide
          height = Math.min(height * 1.3, avgSize);
        } else if (aspectRatio < 0.55) { // Too tall
          width = Math.min(width * 1.3, avgSize);
        }
      }
    }
    
    return {
      x: Math.round(x),
      y: Math.round(y), 
      width: Math.round(width),
      height: Math.round(height)
    };
  }
  
  /**
   * Clamp bounds to safe zone
   */
  clampToSafeZone(bounds, safeZone) {
    const x = Math.max(safeZone.minX, Math.min(bounds.x, safeZone.maxX));
    const y = Math.max(safeZone.minY, Math.min(bounds.y, safeZone.maxY));
    const maxX = Math.min(safeZone.maxX, bounds.x + bounds.width);
    const maxY = Math.min(safeZone.maxY, bounds.y + bounds.height);
    
    return {
      x: x,
      y: y,
      width: maxX - x,
      height: maxY - y
    };
  }
  
  /**
   * Remove overlapping candidates to avoid redundancy
   */
  removeOverlappingCandidates(candidates) {
    if (candidates.length <= 1) return candidates;
    
    // Sort by score descending
    const sorted = candidates.sort((a, b) => b.score - a.score);
    const filtered = [];
    
    for (const candidate of sorted) {
      let overlaps = false;
      
      for (const kept of filtered) {
        if (this.calculateOverlap(candidate, kept) > 0.4) { // 40% overlap threshold
          overlaps = true;
          break;
        }
      }
      
      if (!overlaps) {
        filtered.push(candidate);
      }
      
      if (filtered.length >= 8) break; // Limit to top 8
    }
    
    return filtered;
  }
  
  /**
   * Calculate overlap between regions
   */
  calculateOverlap(rect1, rect2) {
    const x1 = Math.max(rect1.x, rect2.x);
    const y1 = Math.max(rect1.y, rect2.y);
    const x2 = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
    const y2 = Math.min(rect1.y + rect1.height, rect2.y + rect2.height);
    
    if (x2 <= x1 || y2 <= y1) return 0;
    
    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = rect1.width * rect1.height;
    const area2 = rect2.width * rect2.height;
    const union = area1 + area2 - intersection;
    
    return intersection / union;
  }
  
  /**
   * Advanced confidence calculation
   */
  calculateAdvancedConfidence(candidate, image, safeZone) {
    let confidence = 0.6; // Base confidence
    
    // Position scoring (rule of thirds)
    const centerX = (candidate.x + candidate.width / 2) / image.cols;
    const centerY = (candidate.y + candidate.height / 2) / image.rows;
    
    const thirdDistX = Math.min(Math.abs(centerX - 0.33), Math.abs(centerX - 0.67));
    const thirdDistY = Math.min(Math.abs(centerY - 0.33), Math.abs(centerY - 0.67));
    
    if (thirdDistX < 0.1 && thirdDistY < 0.1) confidence += 0.25;
    else if (thirdDistX < 0.2 || thirdDistY < 0.2) confidence += 0.15;
    
    // Size preferences
    const area = candidate.width * candidate.height;
    const imageArea = image.cols * image.rows;
    const areaRatio = area / imageArea;
    
    if (areaRatio > 0.08 && areaRatio < 0.35) confidence += 0.15;
    else if (areaRatio < 0.04) confidence -= 0.1;
    
    // Method-specific bonuses
    if (candidate.method === 'clustering' && candidate.featureCount >= 5) confidence += 0.1;
    if (candidate.method === 'sliding_window') confidence += 0.05;
    if (candidate.method === 'gradient') confidence += 0.1;
    
    return Math.max(0.2, Math.min(1.0, confidence));
  }
}

module.exports = InterestDetector;
