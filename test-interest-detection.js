/**
 * Interest Detection Test - Find Most Interesting Region When No Faces Present
 * Uses available OpenCV methods to find the single most interesting focal point
 */

const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

// Configuration for interest detection
const INTEREST_CONFIG = {
  // Minimum region size (percentage of image) to avoid tiny details
  MIN_REGION_SIZE_PERCENT: 0.08, // 8% of image area
  
  // Maximum candidates to analyze (performance)
  MAX_CANDIDATES: 5,
  
  // Top-hat detection (bright objects like signs, lit buildings)
  TOPHAT_KERNEL_SIZE: 25,
  TOPHAT_MIN_INTENSITY: 60,
  
  // Edge cluster detection (architectural features)
  CANNY_LOW: 50,
  CANNY_HIGH: 150,
  EDGE_MIN_CLUSTER_SIZE: 2000,
  
  // Feature point clustering
  FEATURE_CLUSTER_RADIUS: 200, // pixels
  FEATURE_MIN_CLUSTER_SIZE: 5,
};

class InterestDetector {
  
  /**
   * Find the single most interesting region in an image
   */
  async findMostInterestingRegion(image) {
    console.log(`[Interest] Analyzing ${image.cols}x${image.rows} image for interesting regions`);
    
    const candidates = [];
    const minArea = (image.cols * image.rows) * INTEREST_CONFIG.MIN_REGION_SIZE_PERCENT;
    
    // Method 1: Bright object detection using top-hat transform (65ms)
    console.log('[Interest] 1. Detecting bright objects...');
    const brightRegions = await this.detectBrightObjects(image, minArea);
    candidates.push(...brightRegions);
    
    // Method 2: Edge cluster detection (22ms) 
    console.log('[Interest] 2. Detecting edge clusters...');
    const edgeRegions = await this.detectEdgeClusters(image, minArea);
    candidates.push(...edgeRegions);
    
    // Method 3: Feature point clusters (810ms - only if needed)
    if (candidates.length < 2) {
      console.log('[Interest] 3. Detecting feature clusters...');
      const featureRegions = await this.detectFeatureClusters(image, minArea);
      candidates.push(...featureRegions);
    }
    
    if (candidates.length === 0) {
      console.log('[Interest] No interesting regions found, using center');
      return this.getCenterRegion(image);
    }
    
    // Score and rank candidates
    const scoredCandidates = this.scoreInterestCandidates(candidates, image);
    
    // Return the highest scoring region
    const bestCandidate = scoredCandidates[0];
    console.log(`[Interest] Selected region: score=${bestCandidate.score.toFixed(2)}, type=${bestCandidate.type}`);
    
    return {
      x: bestCandidate.x,
      y: bestCandidate.y,
      width: bestCandidate.width,
      height: bestCandidate.height,
      confidence: bestCandidate.score,
      type: bestCandidate.type
    };
  }
  
  /**
   * Detect bright objects using top-hat morphological transform
   */
  async detectBrightObjects(image, minArea) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      const kernel = cv.getStructuringElement(
        cv.MORPH_ELLIPSE, 
        new cv.Size(INTEREST_CONFIG.TOPHAT_KERNEL_SIZE, INTEREST_CONFIG.TOPHAT_KERNEL_SIZE)
      );
      
      // Top-hat finds bright objects on darker backgrounds
      const tophat = gray.morphologyEx(kernel, cv.MORPH_TOPHAT);
      
      // Threshold to find bright regions
      const thresh = tophat.threshold(INTEREST_CONFIG.TOPHAT_MIN_INTENSITY, 255, cv.THRESH_BINARY);
      
      // Find contours of bright regions
      const contours = thresh.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      
      const regions = [];
      for (const contour of contours) {
        const area = cv.contourArea(contour);
        if (area >= minArea) {
          const boundingRect = cv.boundingRect(contour);
          regions.push({
            x: boundingRect.x,
            y: boundingRect.y,
            width: boundingRect.width,
            height: boundingRect.height,
            area: area,
            type: 'bright_object',
            intensity: this.calculateMeanIntensity(tophat, boundingRect)
          });
        }
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} bright objects in ${processingTime}ms`);
      return regions;
      
    } catch (error) {
      console.log(`   Top-hat detection failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Detect clusters of edges (architectural features)
   */
  async detectEdgeClusters(image, minArea) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      const edges = gray.canny(INTEREST_CONFIG.CANNY_LOW, INTEREST_CONFIG.CANNY_HIGH);
      
      // Dilate edges to connect nearby edge pixels
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
      const dilated = edges.dilate(kernel);
      
      // Find contours of edge clusters
      const contours = dilated.findContours(cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      
      const regions = [];
      for (const contour of contours) {
        const area = cv.contourArea(contour);
        if (area >= INTEREST_CONFIG.EDGE_MIN_CLUSTER_SIZE && area >= minArea) {
          const boundingRect = cv.boundingRect(contour);
          regions.push({
            x: boundingRect.x,
            y: boundingRect.y,
            width: boundingRect.width,
            height: boundingRect.height,
            area: area,
            type: 'edge_cluster',
            edgeDensity: area / (boundingRect.width * boundingRect.height)
          });
        }
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} edge clusters in ${processingTime}ms`);
      return regions;
      
    } catch (error) {
      console.log(`   Edge detection failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Detect clusters of feature points
   */
  async detectFeatureClusters(image, minArea) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      const corners = cv.goodFeaturesToTrack(gray, 100, 0.01, 10);
      
      if (corners.length === 0) return [];
      
      // Cluster nearby feature points
      const clusters = this.clusterPoints(corners, INTEREST_CONFIG.FEATURE_CLUSTER_RADIUS);
      
      const regions = [];
      for (const cluster of clusters) {
        if (cluster.points.length >= INTEREST_CONFIG.FEATURE_MIN_CLUSTER_SIZE) {
          const bounds = this.getClusterBounds(cluster.points);
          const area = bounds.width * bounds.height;
          
          if (area >= minArea) {
            regions.push({
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              area: area,
              type: 'feature_cluster',
              featureCount: cluster.points.length
            });
          }
        }
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} feature clusters in ${processingTime}ms`);
      return regions;
      
    } catch (error) {
      console.log(`   Feature detection failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Score interest candidates to pick the most interesting one
   */
  scoreInterestCandidates(candidates, image) {
    const imageArea = image.cols * image.rows;
    
    const scored = candidates.map(candidate => {
      let score = 0;
      
      // Base score from area (prefer medium-sized regions)
      const areaRatio = candidate.area / imageArea;
      if (areaRatio > 0.1 && areaRatio < 0.4) {
        score += 50; // Good size range
      } else if (areaRatio >= 0.05) {
        score += 20; // Acceptable size
      }
      
      // Position scoring (prefer rule of thirds)
      const centerX = candidate.x + candidate.width / 2;
      const centerY = candidate.y + candidate.height / 2;
      const relX = centerX / image.cols;
      const relY = centerY / image.rows;
      
      // Rule of thirds bonus
      const thirdDistX = Math.min(Math.abs(relX - 0.33), Math.abs(relX - 0.67));
      const thirdDistY = Math.min(Math.abs(relY - 0.33), Math.abs(relY - 0.67));
      if (thirdDistX < 0.15 && thirdDistY < 0.15) score += 30;
      
      // Type-specific scoring
      switch (candidate.type) {
        case 'bright_object':
          score += candidate.intensity || 0;
          break;
        case 'edge_cluster':
          score += (candidate.edgeDensity || 0) * 50;
          break;
        case 'feature_cluster':
          score += (candidate.featureCount || 0) * 2;
          break;
      }
      
      return { ...candidate, score };
    });
    
    // Sort by score descending
    return scored.sort((a, b) => b.score - a.score);
  }
  
  /**
   * Helper methods
   */
  calculateMeanIntensity(grayImage, rect) {
    try {
      const roi = grayImage.getRegion(rect);
      return roi.mean()[0];
    } catch (error) {
      return 0;
    }
  }
  
  clusterPoints(points, maxDistance) {
    const clusters = [];
    const used = new Set();
    
    for (let i = 0; i < points.length; i++) {
      if (used.has(i)) continue;
      
      const cluster = { points: [points[i]] };
      used.add(i);
      
      for (let j = i + 1; j < points.length; j++) {
        if (used.has(j)) continue;
        
        const dist = Math.sqrt(
          Math.pow(points[i].x - points[j].x, 2) + 
          Math.pow(points[i].y - points[j].y, 2)
        );
        
        if (dist <= maxDistance) {
          cluster.points.push(points[j]);
          used.add(j);
        }
      }
      
      clusters.push(cluster);
    }
    
    return clusters;
  }
  
  getClusterBounds(points) {
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX + 50, // Add padding
      height: maxY - minY + 50
    };
  }
  
  getCenterRegion(image) {
    const size = Math.min(image.cols, image.rows) * 0.3;
    return {
      x: Math.round((image.cols - size) / 2),
      y: Math.round((image.rows - size) / 2),
      width: Math.round(size),
      height: Math.round(size),
      confidence: 0.1,
      type: 'center_fallback'
    };
  }
  
  /**
   * Draw the detected region on the image
   */
  drawInterestRegion(image, region) {
    const result = image.copy();
    
    // Draw the interest region in bright blue
    result.drawRectangle(
      new cv.Point2(region.x, region.y),
      new cv.Point2(region.x + region.width, region.y + region.height),
      new cv.Vec3(255, 100, 0), // Bright blue
      6
    );
    
    // Add label
    result.putText(
      `${region.type} (${(region.confidence || 0).toFixed(2)})`,
      new cv.Point2(region.x, region.y - 10),
      cv.FONT_HERSHEY_SIMPLEX,
      0.8,
      new cv.Vec3(255, 100, 0),
      2
    );
    
    return result;
  }
}

// Test the interest detection
async function testInterestDetection(imagePath) {
  console.log('=== Interest Detection Test ===');
  
  if (!fs.existsSync(imagePath)) {
    console.log('❌ Test image not found');
    return;
  }
  
  const detector = new InterestDetector();
  const image = cv.imread(imagePath);
  
  console.log(`Loaded image: ${image.cols}x${image.rows}`);
  
  const startTime = Date.now();
  const interestRegion = await detector.findMostInterestingRegion(image);
  const totalTime = Date.now() - startTime;
  
  console.log(`\n=== Result ===`);
  console.log(`Most interesting region: ${interestRegion.type}`);
  console.log(`Position: ${interestRegion.x},${interestRegion.y}`);
  console.log(`Size: ${interestRegion.width}x${interestRegion.height}`);
  console.log(`Confidence: ${(interestRegion.confidence || 0).toFixed(2)}`);
  console.log(`Total processing time: ${totalTime}ms`);
  
  // Draw and save result
  const markedImage = detector.drawInterestRegion(image, interestRegion);
  const outputPath = path.join(__dirname, 'cache', 'interest_detection_result.jpg');
  cv.imwrite(outputPath, markedImage);
  
  console.log(`\n💾 Saved result: ${outputPath}`);
  console.log('Check the image to see if the detected region looks interesting!');
}

// Run the test
const testImagePath = process.argv[2] || 'cache/20250609_091819362_iOS.jpg';
testInterestDetection(testImagePath).catch(console.error);
