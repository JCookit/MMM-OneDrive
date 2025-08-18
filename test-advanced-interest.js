/**
 * Advanced Interest Detection - Uses Sliding Windows and Feature-Based Regions
 * More sophisticated than simple grid tiling
 */

const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

class AdvancedInterestDetector {
  
  constructor(options = {}) {
    this.options = {
      // Size control options
      sizeMode: options.sizeMode || 'adaptive', // 'tight', 'adaptive', 'loose'
      maxRegionPercent: options.maxRegionPercent || 0.25, // Max 25% of image
      minRegionPercent: options.minRegionPercent || 0.08, // Min 8% of image
      preferSquare: options.preferSquare || true,
      
      // Detection options
      featurePadding: options.featurePadding || 40,
      clusterDistance: options.clusterDistance || 120,
      ...options
    };
  }
  
  async findMostInterestingRegion(image) {
    console.log(`[AdvancedInterest] Processing ${image.cols}x${image.rows} image`);
    
    // Resize large images for processing
    let workingImage = image;
    let scale = 1.0;
    
    const maxDimension = 1200;
    if (Math.max(image.cols, image.rows) > maxDimension) {
      scale = maxDimension / Math.max(image.cols, image.rows);
      const newWidth = Math.round(image.cols * scale);
      const newHeight = Math.round(image.rows * scale);
      workingImage = image.resize(newHeight, newWidth);
      console.log(`[AdvancedInterest] Resized to ${workingImage.cols}x${workingImage.rows} (scale: ${scale.toFixed(3)})`);
    }
    
      // Define safe zone (5% margin)
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
      const largeSize = Math.round(baseSize * 1.3);  // ~20%    console.log(`[AdvancedInterest] Safe zone: x=${safeZone.minX}-${safeZone.maxX}, y=${safeZone.minY}-${safeZone.maxY}`);
    
    const candidates = [];
    
    // Method 1: Feature cluster regions (groups nearby feature points)
    console.log('[AdvancedInterest] 1. Detecting feature cluster regions...');
    const featureClusters = await this.detectFeatureClusterRegions(workingImage, safeZone, workingImage);
    candidates.push(...featureClusters);
    
    // Method 2: Sliding window analysis (overlapping regions)
    console.log('[AdvancedInterest] 2. Sliding window analysis...');
    const slidingRegions = await this.slidingWindowAnalysis(workingImage, safeZone, baseSize, smallSize, largeSize);
    candidates.push(...slidingRegions);
    
    // Method 3: Adaptive regions based on brightness gradients
    console.log('[AdvancedInterest] 3. Gradient-based adaptive regions...');
    const gradientRegions = await this.detectGradientRegions(workingImage, safeZone, baseSize);
    candidates.push(...gradientRegions);
    
    let bestRegion;
    let allCandidatesWithConfidence = [];
    
    if (candidates.length === 0) {
      console.log('[AdvancedInterest] No candidates found, using safe center');
      bestRegion = this.getSafeCenterRegion(workingImage, safeZone);
    } else {
      // Remove overlapping candidates
      const filteredCandidates = this.removeOverlappingCandidates(candidates);
      console.log(`[AdvancedInterest] Filtered to ${filteredCandidates.length} unique candidates`);
      
      // Calculate confidence for all
      allCandidatesWithConfidence = filteredCandidates.map(candidate => ({
        ...candidate,
        confidence: this.calculateAdvancedConfidence(candidate, workingImage, safeZone)
      }));
      
      bestRegion = this.selectBestCandidate(allCandidatesWithConfidence);
      
      console.log(`[AdvancedInterest] Selected: ${bestRegion.type} (score: ${bestRegion.score.toFixed(1)}, confidence: ${bestRegion.confidence.toFixed(2)})`);
      
      // Show top candidates
      console.log('[AdvancedInterest] Top candidates:');
      allCandidatesWithConfidence
        .sort((a, b) => (b.score * b.confidence) - (a.score * a.confidence))
        .slice(0, 8) // Show top 8
        .forEach((candidate, i) => {
          const finalScore = candidate.score * candidate.confidence;
          const isWinner = finalScore === (bestRegion.score * bestRegion.confidence);
          const marker = isWinner ? '🏆' : '  ';
          console.log(`   ${marker}${i+1}. ${candidate.type}: raw=${candidate.score.toFixed(1)}, conf=${candidate.confidence.toFixed(2)}, final=${finalScore.toFixed(1)}`);
        });
    }
    
    // Scale back to original coordinates
    if (scale !== 1.0) {
      bestRegion.x = Math.round(bestRegion.x / scale);
      bestRegion.y = Math.round(bestRegion.y / scale);
      bestRegion.width = Math.round(bestRegion.width / scale);
      bestRegion.height = Math.round(bestRegion.height / scale);
      
      allCandidatesWithConfidence = allCandidatesWithConfidence.map(candidate => ({
        ...candidate,
        x: Math.round(candidate.x / scale),
        y: Math.round(candidate.y / scale),
        width: Math.round(candidate.width / scale),
        height: Math.round(candidate.height / scale)
      }));
    }
    
    bestRegion.allCandidates = allCandidatesWithConfidence.slice(0, 8); // Top 8 for display
    return bestRegion;
  }
  
  /**
   * Detect regions by clustering feature points (not grid-based)
   */
  async detectFeatureClusterRegions(image, safeZone, workingImage) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      const features = cv.goodFeaturesToTrack(gray, 50, 0.01, 15); // More features, closer together
      
      if (features.length === 0) return [];
      
      // Filter to safe zone
      const safeFeatures = features.filter(f => 
        f.x >= safeZone.minX && f.x <= safeZone.maxX &&
        f.y >= safeZone.minY && f.y <= safeZone.maxY
      );
      
      // Cluster features using distance-based clustering
      const clusters = this.clusterFeaturesByDistance(safeFeatures, this.options.clusterDistance); // Use options
      
      const regions = [];
      clusters.forEach((cluster, index) => {
        if (cluster.points.length >= 3) { // At least 3 features
          const bounds = this.getClusterBounds(cluster.points, this.options.featurePadding, workingImage); // Pass workingImage
          
          // Ensure bounds are within safe zone
          const clampedBounds = this.clampToSafeZone(bounds, safeZone);
          
          if (clampedBounds.width > 80 && clampedBounds.height > 80) { // Reduced minimum from 100
            const region = {
              ...clampedBounds,
              type: 'feature_cluster',
              score: cluster.points.length * 12, // Higher scoring
              featureCount: cluster.points.length,
              method: 'clustering',
              naturalSpread: bounds.featureSpread,
              padding: bounds.adaptedPadding
            };
            regions.push(region);
            
            console.log(`   Cluster ${index + 1}: ${cluster.points.length} features → ${region.width}x${region.height} (natural: ${bounds.featureSpread.width.toFixed(0)}x${bounds.featureSpread.height.toFixed(0)})`);
          }
        }
      });
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} feature cluster regions (${processingTime}ms)`);
      return regions;
      
    } catch (error) {
      console.log(`   Feature clustering failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Sliding window analysis with overlapping regions
   */
  async slidingWindowAnalysis(image, safeZone, baseSize, smallSize, largeSize) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      const regions = [];
      
      // Multiple adaptive window sizes
      const windowSizes = [smallSize, baseSize, largeSize]; // Dynamic sizes based on image
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
                  contrast: std,
                  brightness: mean,
                  edgeDensity: edgeDensity,
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
      console.log(`   Found ${regions.length} sliding window regions (${processingTime}ms)`);
      return regions;
      
    } catch (error) {
      console.log(`   Sliding window analysis failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Detect regions based on brightness/darkness gradients
   */
  async detectGradientRegions(image, safeZone, baseSize) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      
      // Find local maxima and minima regions  
      const regions = [];
      const regionSize = baseSize; // Use adaptive base size
      const stepSize = Math.round(regionSize * 0.6); // 60% step for more overlap
      
      for (let y = safeZone.minY; y + regionSize <= safeZone.maxY; y += stepSize) {
        for (let x = safeZone.minX; x + regionSize <= safeZone.maxX; x += stepSize) {
          
          try {
            const roi = gray.getRegion(new cv.Rect(x, y, regionSize, regionSize));
            
            // Analyze gradient characteristics
            const mean = roi.mean()[0];
            const std = roi.meanStdDev().stddev[0];
            
            // Look for regions with interesting brightness characteristics
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
                brightness: mean,
                contrast: std,
                method: 'gradient'
              });
            }
          } catch (error) {
            continue;
          }
        }
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} gradient regions (${processingTime}ms)`);
      return regions;
      
    } catch (error) {
      console.log(`   Gradient analysis failed: ${error.message}`);
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
   * Get adaptive bounds around a cluster of points - much tighter and size-aware
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
    
    // Adaptive padding based on:
    // 1. Number of features (more features = tighter)
    // 2. Natural spread (wider spread = less padding needed)
    // 3. Reasonable minimum/maximum sizes
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
    
    // Apply size constraints (in scaled coordinates) if workingImage provided
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
      
      // Ensure minimum size
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
      
      // Cap maximum size (keep it reasonable)
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
      
      // Prefer square-ish regions for better focal points (if enabled)
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
      height: Math.round(height),
      featureSpread: { width: naturalWidth, height: naturalHeight },
      adaptedPadding: { x: paddingX, y: paddingY }
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
      
      if (filtered.length >= 12) break; // Limit to top 12
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
    if (candidate.method === 'sliding_window' && candidate.contrast > 35) confidence += 0.05;
    if (candidate.method === 'gradient' && candidate.contrast > 40) confidence += 0.1;
    
    return Math.max(0.2, Math.min(1.0, confidence));
  }
  
  selectBestCandidate(candidates) {
    return candidates
      .sort((a, b) => (b.score * b.confidence) - (a.score * a.confidence))[0];
  }
  
  getSafeCenterRegion(image, safeZone) {
    const safeWidth = safeZone.maxX - safeZone.minX;
    const safeHeight = safeZone.maxY - safeZone.minY;
    const size = Math.min(safeWidth, safeHeight) * 0.4;
    
    return {
      x: Math.round(safeZone.minX + (safeWidth - size) / 2),
      y: Math.round(safeZone.minY + (safeHeight - size) / 2),
      width: Math.round(size),
      height: Math.round(size),
      type: 'safe_center',
      score: 5.0,
      confidence: 0.4,
      method: 'fallback'
    };
  }
  
  /**
   * Draw all candidates with color coding by method
   */
  drawResultWithCandidates(image, bestRegion, allCandidates) {
    const result = image.copy();
    
    console.log('\n[Drawing] Visualizing advanced candidates...');
    
    // Color code by method
    const methodColors = {
      'clustering': [100, 255, 100],    // Green - feature clusters
      'sliding_window': [255, 100, 100], // Red - sliding windows  
      'gradient': [100, 100, 255],      // Blue - gradient regions
      'fallback': [200, 200, 200]       // Gray - fallback
    };
    
    allCandidates.forEach((candidate, index) => {
      const methodKey = candidate.method || 'clustering';
      const color = new cv.Vec3(...(methodColors[methodKey] || [150, 150, 150]));
      
      // Draw candidate
      result.drawRectangle(
        new cv.Point2(candidate.x, candidate.y),
        new cv.Point2(candidate.x + candidate.width, candidate.y + candidate.height),
        color,
        3
      );
      
      // Label with method and scores
      const finalScore = (candidate.score * candidate.confidence);
      const labelText = `${index + 1}:${candidate.method} F=${finalScore.toFixed(0)}`;
      
      result.putText(
        labelText,
        new cv.Point2(candidate.x, candidate.y - 10),
        cv.FONT_HERSHEY_SIMPLEX,
        0.6,
        color,
        2
      );
      
      // Number in corner
      result.putText(
        `${index + 1}`,
        new cv.Point2(candidate.x + 5, candidate.y + 25),
        cv.FONT_HERSHEY_SIMPLEX,
        1.0,
        color,
        2
      );
    });
    
    // Highlight winner
    result.drawRectangle(
      new cv.Point2(bestRegion.x, bestRegion.y),
      new cv.Point2(bestRegion.x + bestRegion.width, bestRegion.y + bestRegion.height),
      new cv.Vec3(255, 255, 0), // Cyan
      8
    );
    
    // Winner corners
    [[bestRegion.x, bestRegion.y], 
     [bestRegion.x + bestRegion.width, bestRegion.y],
     [bestRegion.x, bestRegion.y + bestRegion.height],
     [bestRegion.x + bestRegion.width, bestRegion.y + bestRegion.height]]
    .forEach(([x, y]) => {
      result.drawCircle(new cv.Point2(x, y), 12, new cv.Vec3(0, 255, 255), -1);
    });
    
    // Legend
    result.putText('GREEN=Features, RED=Sliding, BLUE=Gradient', new cv.Point2(20, 30), 
      cv.FONT_HERSHEY_SIMPLEX, 0.7, new cv.Vec3(255, 255, 255), 2);
    
    return result;
  }
}

// Test function
async function testAdvancedInterest(imagePath, sizeMode = 'adaptive') {
  console.log('=== Advanced Interest Detection Test ===');
  console.log(`Size Mode: ${sizeMode}`);
  
  const detectorOptions = {
    sizeMode: sizeMode,
    maxRegionPercent: sizeMode === 'tight' ? 0.15 : sizeMode === 'loose' ? 0.35 : 0.25,
    minRegionPercent: sizeMode === 'tight' ? 0.05 : sizeMode === 'loose' ? 0.12 : 0.08
  };
  
  const detector = new AdvancedInterestDetector(detectorOptions);
  const image = cv.imread(imagePath);
  
  console.log(`Processing: ${image.cols}x${image.rows}`);
  
  const startTime = Date.now();
  const region = await detector.findMostInterestingRegion(image);
  const totalTime = Date.now() - startTime;
  
  console.log(`\n=== ADVANCED RESULT ===`);
  console.log(`Winner: ${region.type} (${region.method})`);
  console.log(`Region: ${region.width}x${region.height} at (${region.x}, ${region.y})`);
  console.log(`% of image: ${((region.width * region.height) / (image.cols * image.rows) * 100).toFixed(1)}%`);
  console.log(`Score: ${region.score.toFixed(1)}, Confidence: ${region.confidence.toFixed(2)}`);
  console.log(`Final: ${(region.score * region.confidence).toFixed(1)}`);
  console.log(`Processing: ${totalTime}ms`);
  
  // Draw result
  const marked = region.allCandidates && region.allCandidates.length > 0 
    ? detector.drawResultWithCandidates(image, region, region.allCandidates)
    : image.copy();
    
  const outputPath = path.join(__dirname, 'cache', `advanced_interest_${sizeMode}_result.jpg`);
  cv.imwrite(outputPath, marked);
  
  console.log(`\n💾 Advanced result: ${outputPath}`);
  console.log('🚀 Much more sophisticated region detection!');
  console.log('📍 GREEN=Feature clusters, RED=Sliding windows, BLUE=Gradient regions');
  
  return region;
}

// Run test
const imagePath = process.argv[2] || 'cache/20250609_091819362_iOS.jpg';
const sizeMode = process.argv[3] || 'adaptive'; // tight, adaptive, loose
testAdvancedInterest(imagePath, sizeMode).catch(console.error);
