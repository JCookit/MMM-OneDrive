/**
 * Simple Interest Detection - Uses Only Available OpenCV Methods
 * Works around OpenCV build limitations
 */

const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

class SimpleInterestDetector {
  
  /**
   * Find interesting regions using only available OpenCV methods
   */
  async findMostInterestingRegion(image) {
    console.log(`[SimpleInterest] Analyzing ${image.cols}x${image.rows} image`);
    
    const candidates = [];
    
    // Method 1: Bright object detection using top-hat (no contours needed)
    console.log('[SimpleInterest] 1. Detecting bright objects...');
    const brightRegions = await this.detectBrightRegionsSimple(image);
    candidates.push(...brightRegions);
    
    // Method 2: Edge density regions (no contours needed)
    console.log('[SimpleInterest] 2. Detecting high-edge regions...');
    const edgeRegions = await this.detectEdgeDensityRegions(image);
    candidates.push(...edgeRegions);
    
    // Method 3: Feature clusters (we know this works)
    console.log('[SimpleInterest] 3. Detecting feature clusters...');
    const featureRegions = await this.detectFeatureClustersSimple(image);
    candidates.push(...featureRegions);
    
    if (candidates.length === 0) {
      console.log('[SimpleInterest] No regions found, using center');
      return this.getCenterRegion(image);
    }
    
    // Pick the highest scoring candidate
    const best = this.selectBestCandidate(candidates, image);
    console.log(`[SimpleInterest] Selected: ${best.type}, score=${best.score.toFixed(2)}`);
    
    return best;
  }
  
  /**
   * Detect bright regions without using contours
   */
  async detectBrightRegionsSimple(image) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      
      // Create morphological kernel
      const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(25, 25));
      
      // Top-hat to find bright objects
      const tophat = gray.morphologyEx(kernel, cv.MORPH_TOPHAT);
      
      // Find bright regions by analyzing grid sections
      const regions = this.analyzeImageGrid(tophat, image, 'bright', (roi) => {
        const mean = roi.mean()[0];
        return mean; // brightness score
      });
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} bright regions in ${processingTime}ms`);
      return regions;
      
    } catch (error) {
      console.log(`   Bright detection failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Detect edge-dense regions without using contours
   */
  async detectEdgeDensityRegions(image) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      const edges = gray.canny(50, 150);
      
      // Analyze edge density in grid sections
      const regions = this.analyzeImageGrid(edges, image, 'edges', (roi) => {
        const mean = roi.mean()[0];
        return mean / 255; // edge density score (0-1)
      });
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} edge regions in ${processingTime}ms`);
      return regions;
      
    } catch (error) {
      console.log(`   Edge detection failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Feature clustering without contours
   */
  async detectFeatureClustersSimple(image) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      const corners = cv.goodFeaturesToTrack(gray, 50, 0.01, 10);
      
      if (corners.length === 0) return [];
      
      // Simple grid-based clustering
      const gridSize = 200; // pixels
      const clusters = this.clusterFeaturesInGrid(corners, image, gridSize);
      
      const regions = clusters.filter(cluster => cluster.count >= 3).map(cluster => ({
        x: cluster.x,
        y: cluster.y,
        width: cluster.width,
        height: cluster.height,
        type: 'features',
        score: cluster.count * 10, // More features = higher score
        featureCount: cluster.count
      }));
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} feature clusters in ${processingTime}ms`);
      return regions;
      
    } catch (error) {
      console.log(`   Feature detection failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Analyze image in grid sections to find interesting regions
   */
  analyzeImageGrid(processedImage, originalImage, type, scoreFunction) {
    const regions = [];
    const gridSize = 400; // Size of each grid cell
    const minScore = type === 'bright' ? 40 : 0.15; // Minimum score thresholds
    
    // Scan image in overlapping grid
    for (let y = 0; y < originalImage.rows - gridSize; y += gridSize / 2) {
      for (let x = 0; x < originalImage.cols - gridSize; x += gridSize / 2) {
        
        // Extract region
        const rect = new cv.Rect(x, y, 
          Math.min(gridSize, originalImage.cols - x),
          Math.min(gridSize, originalImage.rows - y)
        );
        
        try {
          const roi = processedImage.getRegion(rect);
          const score = scoreFunction(roi);
          
          if (score >= minScore) {
            regions.push({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              type: type,
              score: score,
              area: rect.width * rect.height
            });
          }
        } catch (error) {
          // Skip problematic regions
          continue;
        }
      }
    }
    
    // Remove overlapping regions, keep highest scoring
    return this.removeOverlappingRegions(regions);
  }
  
  /**
   * Cluster features in a grid pattern
   */
  clusterFeaturesInGrid(features, image, gridSize) {
    const clusters = [];
    
    for (let y = 0; y < image.rows; y += gridSize) {
      for (let x = 0; x < image.cols; x += gridSize) {
        
        // Count features in this grid cell
        const featuresInCell = features.filter(f => 
          f.x >= x && f.x < x + gridSize && 
          f.y >= y && f.y < y + gridSize
        );
        
        if (featuresInCell.length > 0) {
          clusters.push({
            x: x,
            y: y,
            width: Math.min(gridSize, image.cols - x),
            height: Math.min(gridSize, image.rows - y),
            count: featuresInCell.length,
            features: featuresInCell
          });
        }
      }
    }
    
    return clusters;
  }
  
  /**
   * Remove overlapping regions
   */
  removeOverlappingRegions(regions) {
    if (regions.length <= 1) return regions;
    
    // Sort by score descending
    const sorted = regions.sort((a, b) => b.score - a.score);
    const filtered = [];
    
    for (const region of sorted) {
      let overlaps = false;
      
      for (const kept of filtered) {
        if (this.calculateOverlap(region, kept) > 0.3) {
          overlaps = true;
          break;
        }
      }
      
      if (!overlaps) {
        filtered.push(region);
      }
    }
    
    return filtered;
  }
  
  /**
   * Calculate overlap between two rectangles
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
   * Select the best candidate from all detected regions
   */
  selectBestCandidate(candidates, image) {
    const imageArea = image.cols * image.rows;
    
    // Score candidates based on multiple factors
    const scored = candidates.map(candidate => {
      let finalScore = candidate.score || 0;
      
      // Size preference (not too small, not too large)
      const areaRatio = candidate.area / imageArea;
      if (areaRatio > 0.05 && areaRatio < 0.25) {
        finalScore += 20; // Good size bonus
      }
      
      // Position preference (rule of thirds)
      const centerX = (candidate.x + candidate.width / 2) / image.cols;
      const centerY = (candidate.y + candidate.height / 2) / image.rows;
      
      const thirdX = Math.min(Math.abs(centerX - 0.33), Math.abs(centerX - 0.67));
      const thirdY = Math.min(Math.abs(centerY - 0.33), Math.abs(centerY - 0.67));
      
      if (thirdX < 0.1 && thirdY < 0.1) finalScore += 15;
      
      return { ...candidate, score: finalScore };
    });
    
    // Return highest scoring candidate
    return scored.sort((a, b) => b.score - a.score)[0];
  }
  
  getCenterRegion(image) {
    const size = Math.min(image.cols, image.rows) * 0.25;
    return {
      x: Math.round((image.cols - size) / 2),
      y: Math.round((image.rows - size) / 2),
      width: Math.round(size),
      height: Math.round(size),
      type: 'center',
      score: 0.1
    };
  }
  
  /**
   * Draw the detected region on image
   */
  drawResult(image, region) {
    const result = image.copy();
    
    // Draw main region in bright cyan
    result.drawRectangle(
      new cv.Point2(region.x, region.y),
      new cv.Point2(region.x + region.width, region.y + region.height),
      new cv.Vec3(255, 255, 0), // Cyan
      8
    );
    
    // Add label
    result.putText(
      `MOST INTERESTING: ${region.type} (${region.score.toFixed(1)})`,
      new cv.Point2(region.x, region.y - 15),
      cv.FONT_HERSHEY_SIMPLEX,
      1.0,
      new cv.Vec3(255, 255, 0),
      3
    );
    
    return result;
  }
}

// Test function
async function testSimpleInterestDetection(imagePath) {
  console.log('=== Simple Interest Detection Test ===');
  
  const detector = new SimpleInterestDetector();
  const image = cv.imread(imagePath);
  
  console.log(`Loaded: ${image.cols}x${image.rows}`);
  
  const startTime = Date.now();
  const region = await detector.findMostInterestingRegion(image);
  const totalTime = Date.now() - startTime;
  
  console.log(`\n=== RESULT ===`);
  console.log(`Most interesting: ${region.type}`);
  console.log(`Location: (${region.x}, ${region.y})`);
  console.log(`Size: ${region.width} x ${region.height}`);
  console.log(`Score: ${region.score.toFixed(2)}`);
  console.log(`Total time: ${totalTime}ms`);
  
  // Draw and save
  const marked = detector.drawResult(image, region);
  const outputPath = path.join(__dirname, 'cache', 'simple_interest_result.jpg');
  cv.imwrite(outputPath, marked);
  
  console.log(`\n💾 Result saved: ${outputPath}`);
  console.log('👀 Check the image - does the cyan box highlight something interesting?');
}

// Run test
const imagePath = process.argv[2] || 'cache/20250609_091819362_iOS.jpg';
testSimpleInterestDetection(imagePath).catch(console.error);
