/**
 * Lightweight Interest Detection - Memory Safe for Large Images
 * Processes images in small chunks to avoid memory crashes
 */

const cv = require('@u4/opencv4nodejs');
const fs = require('fs');
const path = require('path');

class LightweightInterestDetector {
  
  /**
   * Find interesting region with memory-safe processing
   */
  async findMostInterestingRegion(image) {
    console.log(`[LightInterest] Processing ${image.cols}x${image.rows} image`);
    
    // Resize large images to avoid memory issues
    let workingImage = image;
    let scale = 1.0;
    
    const maxDimension = 1200; // Safe processing size
    if (Math.max(image.cols, image.rows) > maxDimension) {
      scale = maxDimension / Math.max(image.cols, image.rows);
      const newWidth = Math.round(image.cols * scale);
      const newHeight = Math.round(image.rows * scale);
      workingImage = image.resize(newHeight, newWidth);
      console.log(`[LightInterest] Resized to ${workingImage.cols}x${workingImage.rows} (scale: ${scale.toFixed(3)})`);
    }
    
    // Define safe zone (avoid 5% edges)
    const edgeMargin = 0.05;
    const safeZone = {
      minX: Math.round(workingImage.cols * edgeMargin),
      maxX: Math.round(workingImage.cols * (1 - edgeMargin)),
      minY: Math.round(workingImage.rows * edgeMargin),
      maxY: Math.round(workingImage.rows * (1 - edgeMargin))
    };
    
    console.log(`[LightInterest] Safe zone: x=${safeZone.minX}-${safeZone.maxX}, y=${safeZone.minY}-${safeZone.maxY}`);
    
    const candidates = [];
    
    // Method 1: Feature point analysis (fast and reliable)
    console.log('[LightInterest] Analyzing feature density...');
    const featureRegions = await this.analyzeFeatureDensity(workingImage, safeZone);
    candidates.push(...featureRegions);
    
    // Method 2: Simple brightness analysis
    console.log('[LightInterest] Analyzing brightness regions...');
    const brightRegions = await this.analyzeBrightnessRegions(workingImage, safeZone);
    candidates.push(...brightRegions);
    
    // Method 3: Edge density (only if we have few candidates)
    if (candidates.length < 3) {
      console.log('[LightInterest] Analyzing edge density...');
      const edgeRegions = await this.analyzeEdgeDensity(workingImage, safeZone);
      candidates.push(...edgeRegions);
    }
    
    let bestRegion;
    let allCandidatesWithConfidence = [];
    
    if (candidates.length === 0) {
      console.log('[LightInterest] No candidates found in safe zone, using safe center');
      bestRegion = this.getSafeCenterRegion(workingImage, safeZone);
    } else {
      // Calculate confidence for all candidates
      allCandidatesWithConfidence = candidates.map(candidate => ({
        ...candidate,
        confidence: this.calculateConfidence(candidate, workingImage, safeZone)
      }));
      
      bestRegion = this.selectBestCandidateWithConfidence(candidates, workingImage, safeZone);
      console.log(`[LightInterest] Selected: ${bestRegion.type} (score: ${bestRegion.score.toFixed(1)}, confidence: ${bestRegion.confidence.toFixed(2)})`);
      
      // Log all candidates for comparison
      console.log('[LightInterest] All candidates with confidence:');
      allCandidatesWithConfidence
        .sort((a, b) => (b.score * b.confidence) - (a.score * a.confidence))
        .forEach((candidate, i) => {
          const finalScore = candidate.score * candidate.confidence;
          const isWinner = finalScore === (bestRegion.score * bestRegion.confidence);
          const marker = isWinner ? '🏆' : '  ';
          console.log(`   ${marker}${i+1}. ${candidate.type}: raw=${candidate.score.toFixed(1)}, conf=${candidate.confidence.toFixed(2)}, final=${finalScore.toFixed(1)}, pos=(${candidate.x},${candidate.y})`);
        });
    }
    
    // Store candidates for drawing
    bestRegion.allCandidates = allCandidatesWithConfidence;
    
    // Scale back to original image coordinates
    if (scale !== 1.0) {
      bestRegion.x = Math.round(bestRegion.x / scale);
      bestRegion.y = Math.round(bestRegion.y / scale);
      bestRegion.width = Math.round(bestRegion.width / scale);
      bestRegion.height = Math.round(bestRegion.height / scale);
      
      // IMPORTANT: Scale back all candidates too!
      bestRegion.allCandidates = allCandidatesWithConfidence.map(candidate => ({
        ...candidate,
        x: Math.round(candidate.x / scale),
        y: Math.round(candidate.y / scale),
        width: Math.round(candidate.width / scale),
        height: Math.round(candidate.height / scale)
      }));
    }
    
    return bestRegion;
  }
  
  /**
   * Analyze feature point density in grid (avoiding edges)
   */
  async analyzeFeatureDensity(image, safeZone) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      
      // Reduce number of features for performance
      const features = cv.goodFeaturesToTrack(gray, 30, 0.02, 20);
      
      if (features.length === 0) return [];
      
      // Filter features to safe zone only
      const safeFeatures = features.filter(f => 
        f.x >= safeZone.minX && f.x <= safeZone.maxX &&
        f.y >= safeZone.minY && f.y <= safeZone.maxY
      );
      
      console.log(`   Filtered ${safeFeatures.length}/${features.length} features in safe zone`);
      
      // Simple grid-based clustering within safe zone
      const safeWidth = safeZone.maxX - safeZone.minX;
      const safeHeight = safeZone.maxY - safeZone.minY;
      const gridSize = Math.min(250, Math.min(safeWidth, safeHeight) / 3);
      const regions = [];
      
      // Divide safe zone into grid and count features per cell
      for (let y = safeZone.minY; y < safeZone.maxY; y += gridSize) {
        for (let x = safeZone.minX; x < safeZone.maxX; x += gridSize) {
          const cellWidth = Math.min(gridSize, safeZone.maxX - x);
          const cellHeight = Math.min(gridSize, safeZone.maxY - y);
          
          // Count features in this cell
          const featuresInCell = safeFeatures.filter(f => 
            f.x >= x && f.x < x + cellWidth && 
            f.y >= y && f.y < y + cellHeight
          ).length;
          
          if (featuresInCell >= 2) { // At least 2 features
            regions.push({
              x: x,
              y: y,
              width: cellWidth,
              height: cellHeight,
              type: 'features',
              score: featuresInCell * 10, // Increased scoring
              featureCount: featuresInCell,
              rawScore: featuresInCell
            });
          }
        }
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} feature-rich regions in safe zone (${processingTime}ms)`);
      return regions.slice(0, 5); // Top 5 candidates
      
    } catch (error) {
      console.log(`   Feature analysis failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Analyze brightness in simple grid (avoiding edges)
   */
  async analyzeBrightnessRegions(image, safeZone) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      const regions = [];
      
      // Grid analysis within safe zone only
      const gridCols = 4;
      const gridRows = 3;
      const safeWidth = safeZone.maxX - safeZone.minX;
      const safeHeight = safeZone.maxY - safeZone.minY;
      const cellWidth = Math.floor(safeWidth / gridCols);
      const cellHeight = Math.floor(safeHeight / gridRows);
      
      for (let row = 0; row < gridRows; row++) {
        for (let col = 0; col < gridCols; col++) {
          const x = safeZone.minX + col * cellWidth;
          const y = safeZone.minY + row * cellHeight;
          const w = (col === gridCols - 1) ? safeZone.maxX - x : cellWidth;
          const h = (row === gridRows - 1) ? safeZone.maxY - y : cellHeight;
          
          try {
            const roi = gray.getRegion(new cv.Rect(x, y, w, h));
            const mean = roi.mean()[0];
            const std = roi.meanStdDev().stddev[0]; // Get standard deviation for contrast
            
            // Look for bright AND high-contrast regions
            if (mean > 110 && std > 25) { // Bright with good contrast
              regions.push({
                x: x,
                y: y,
                width: w,
                height: h,
                type: 'bright',
                score: (mean - 110) / 5 + std / 3, // Combined brightness + contrast score
                brightness: mean,
                contrast: std,
                rawScore: mean
              });
            }
          } catch (error) {
            continue;
          }
        }
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} bright regions in safe zone (${processingTime}ms)`);
      return regions.slice(0, 3);
      
    } catch (error) {
      console.log(`   Brightness analysis failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Simple edge density analysis (avoiding edges)
   */
  async analyzeEdgeDensity(image, safeZone) {
    const startTime = Date.now();
    
    try {
      const gray = image.bgrToGray();
      const edges = gray.canny(60, 120);
      
      const regions = [];
      
      // 2x2 grid within safe zone
      const safeWidth = safeZone.maxX - safeZone.minX;
      const safeHeight = safeZone.maxY - safeZone.minY;
      const cellWidth = Math.floor(safeWidth / 2);
      const cellHeight = Math.floor(safeHeight / 2);
      
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          const x = safeZone.minX + col * cellWidth;
          const y = safeZone.minY + row * cellHeight;
          const w = (col === 1) ? safeZone.maxX - x : cellWidth;
          const h = (row === 1) ? safeZone.maxY - y : cellHeight;
          
          try {
            const roi = edges.getRegion(new cv.Rect(x, y, w, h));
            const edgeDensity = roi.mean()[0] / 255; // 0 to 1
            
            if (edgeDensity > 0.12) { // Has significant edges
              regions.push({
                x: x,
                y: y,
                width: w,
                height: h,
                type: 'edges',
                score: edgeDensity * 30, // Score based on edge density
                edgeDensity: edgeDensity,
                rawScore: edgeDensity
              });
            }
          } catch (error) {
            continue;
          }
        }
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`   Found ${regions.length} edge regions in safe zone (${processingTime}ms)`);
      return regions;
      
    } catch (error) {
      console.log(`   Edge analysis failed: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Select best candidate with comprehensive confidence scoring
   */
  selectBestCandidateWithConfidence(candidates, image, safeZone) {
    console.log(`[LightInterest] Evaluating ${candidates.length} candidates with confidence scoring...`);
    
    const scored = candidates.map(candidate => {
      const confidence = this.calculateConfidence(candidate, image, safeZone);
      return { ...candidate, confidence };
    });
    
    // Sort by combined score AND confidence
    const final = scored.sort((a, b) => {
      const scoreA = a.score * a.confidence; // Multiply raw score by confidence
      const scoreB = b.score * b.confidence;
      return scoreB - scoreA;
    });
    
    return final[0];
  }
  
  /**
   * Calculate confidence score for a candidate (0-1 scale)
   */
  calculateConfidence(candidate, image, safeZone) {
    let confidence = 0.5; // Base confidence
    
    // 1. Position confidence (rule of thirds is better than edges or center)
    const centerX = (candidate.x + candidate.width / 2) / image.cols;
    const centerY = (candidate.y + candidate.height / 2) / image.rows;
    
    // Rule of thirds positions (0.33, 0.67)
    const thirdDistX = Math.min(Math.abs(centerX - 0.33), Math.abs(centerX - 0.67));
    const thirdDistY = Math.min(Math.abs(centerY - 0.33), Math.abs(centerY - 0.67));
    
    if (thirdDistX < 0.1 && thirdDistY < 0.1) {
      confidence += 0.25; // Strong rule of thirds bonus
    } else if (thirdDistX < 0.2 || thirdDistY < 0.2) {
      confidence += 0.15; // Moderate positioning bonus
    }
    
    // Penalize too close to center
    const centerDist = Math.sqrt(Math.pow(centerX - 0.5, 2) + Math.pow(centerY - 0.5, 2));
    if (centerDist < 0.15) {
      confidence -= 0.1; // Too central penalty
    } else if (centerDist > 0.2) {
      confidence += 0.1; // Good off-center bonus
    }
    
    // 2. Size confidence (prefer medium-sized regions)
    const area = candidate.width * candidate.height;
    const imageArea = image.cols * image.rows;
    const areaRatio = area / imageArea;
    
    if (areaRatio > 0.08 && areaRatio < 0.3) {
      confidence += 0.2; // Good size range
    } else if (areaRatio > 0.05 && areaRatio < 0.5) {
      confidence += 0.1; // Acceptable size
    } else if (areaRatio < 0.03 || areaRatio > 0.6) {
      confidence -= 0.15; // Too small or too large penalty
    }
    
    // 3. Type-specific confidence
    switch (candidate.type) {
      case 'features':
        // Features are generally reliable
        confidence += 0.1;
        if (candidate.featureCount >= 5) confidence += 0.1;
        if (candidate.featureCount >= 8) confidence += 0.1;
        break;
        
      case 'bright':
        // Brightness needs good contrast too
        confidence += 0.05;
        if (candidate.contrast && candidate.contrast > 30) confidence += 0.1;
        if (candidate.brightness > 150) confidence += 0.05;
        break;
        
      case 'edges':
        // Edge density is moderately reliable
        if (candidate.edgeDensity > 0.2) confidence += 0.1;
        if (candidate.edgeDensity > 0.3) confidence += 0.1;
        break;
    }
    
    // 4. Safe zone positioning confidence
    const safeWidth = safeZone.maxX - safeZone.minX;
    const safeHeight = safeZone.maxY - safeZone.minY;
    const safeCenterX = safeZone.minX + safeWidth / 2;
    const safeCenterY = safeZone.minY + safeHeight / 2;
    
    const candidateCenterX = candidate.x + candidate.width / 2;
    const candidateCenterY = candidate.y + candidate.height / 2;
    
    // Distance from safe zone center (normalized)
    const safeDistX = Math.abs(candidateCenterX - safeCenterX) / (safeWidth / 2);
    const safeDistY = Math.abs(candidateCenterY - safeCenterY) / (safeHeight / 2);
    
    // Prefer regions not at safe zone edges
    if (safeDistX < 0.7 && safeDistY < 0.7) {
      confidence += 0.1; // Well within safe zone
    }
    
    // 5. Raw score influence (higher raw scores get confidence boost)
    if (candidate.rawScore) {
      const scoreBonus = Math.min(0.15, candidate.rawScore / 100); // Cap at 0.15
      confidence += scoreBonus;
    }
    
    // Clamp confidence to reasonable range
    return Math.max(0.1, Math.min(1.0, confidence));
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
      score: 1.0,
      confidence: 0.3 // Low confidence fallback
    };
  }
  
  /**
   * Draw result with all candidates shown
   */
  drawResultWithCandidates(image, bestRegion, allCandidates) {
    const result = image.copy();
    
    // First, draw all candidates in different colors
    console.log('\n[Drawing] Visualizing all candidates...');
    
    allCandidates.forEach((candidate, index) => {
      // Calculate confidence for display
      const confidence = candidate.confidence || 0.5;
      const finalScore = (candidate.score * confidence);
      
      // Different colors for different candidates
      const colors = [
        [100, 100, 255], // Light blue
        [100, 255, 100], // Light green  
        [255, 100, 255], // Magenta
        [255, 200, 100], // Orange
        [200, 200, 200]  // Gray
      ];
      
      const color = new cv.Vec3(...colors[index % colors.length]);
      
      // Draw candidate rectangle (thinner line)
      result.drawRectangle(
        new cv.Point2(candidate.x, candidate.y),
        new cv.Point2(candidate.x + candidate.width, candidate.y + candidate.height),
        color,
        4
      );
      
      // Add candidate info label
      const labelText = `${index + 1}: ${candidate.type} S=${candidate.score.toFixed(0)} C=${confidence.toFixed(2)} F=${finalScore.toFixed(0)}`;
      const labelY = candidate.y > 40 ? candidate.y - 10 : candidate.y + candidate.height + 30;
      
      result.putText(
        labelText,
        new cv.Point2(candidate.x, labelY),
        cv.FONT_HERSHEY_SIMPLEX,
        0.7,
        color,
        2
      );
      
      // Add candidate number in corner
      result.putText(
        `${index + 1}`,
        new cv.Point2(candidate.x + 10, candidate.y + 30),
        cv.FONT_HERSHEY_SIMPLEX,
        1.2,
        color,
        3
      );
    });
    
    // Now draw the WINNER in bright cyan with thick border
    result.drawRectangle(
      new cv.Point2(bestRegion.x, bestRegion.y),
      new cv.Point2(bestRegion.x + bestRegion.width, bestRegion.y + bestRegion.height),
      new cv.Vec3(255, 255, 0), // Bright cyan
      12
    );
    
    // Add corner markers for the winner
    const cornerSize = 20;
    const corners = [
      [bestRegion.x, bestRegion.y], // Top-left
      [bestRegion.x + bestRegion.width, bestRegion.y], // Top-right
      [bestRegion.x, bestRegion.y + bestRegion.height], // Bottom-left
      [bestRegion.x + bestRegion.width, bestRegion.y + bestRegion.height] // Bottom-right
    ];
    
    corners.forEach(([x, y]) => {
      result.drawCircle(new cv.Point2(x, y), 15, new cv.Vec3(0, 255, 255), -1); // Yellow filled circle
    });
    
    // Add WINNER label
    const winnerLabelY = bestRegion.y > 80 ? bestRegion.y - 50 : bestRegion.y + bestRegion.height + 80;
    result.putText(
      `WINNER: ${bestRegion.type.toUpperCase()}`,
      new cv.Point2(bestRegion.x, winnerLabelY),
      cv.FONT_HERSHEY_SIMPLEX,
      1.5,
      new cv.Vec3(0, 255, 255), // Yellow
      4
    );
    
    result.putText(
      `Score=${bestRegion.score.toFixed(0)} Conf=${(bestRegion.confidence || 1.0).toFixed(2)} Final=${((bestRegion.score * (bestRegion.confidence || 1.0))).toFixed(0)}`,
      new cv.Point2(bestRegion.x, winnerLabelY + 40),
      cv.FONT_HERSHEY_SIMPLEX,
      1.0,
      new cv.Vec3(0, 255, 255),
      3
    );
    
    // Add legend in top-left corner
    const legendStart = 30;
    result.putText(
      'CANDIDATE ANALYSIS:',
      new cv.Point2(20, legendStart),
      cv.FONT_HERSHEY_SIMPLEX,
      0.8,
      new cv.Vec3(255, 255, 255),
      2
    );
    
    result.putText(
      'S=Score, C=Confidence, F=Final',
      new cv.Point2(20, legendStart + 30),
      cv.FONT_HERSHEY_SIMPLEX,
      0.6,
      new cv.Vec3(255, 255, 255),
      2
    );
    
    return result;
  }
  
  /**
   * Fallback draw method for single region
   */
  drawResult(image, region) {
    const result = image.copy();
    
    // Draw thick cyan rectangle
    result.drawRectangle(
      new cv.Point2(region.x, region.y),
      new cv.Point2(region.x + region.width, region.y + region.height),
      new cv.Vec3(255, 255, 0), // Cyan
      12
    );
    
    // Add corner markers
    const corners = [
      [region.x, region.y],
      [region.x + region.width, region.y],
      [region.x, region.y + region.height],
      [region.x + region.width, region.y + region.height]
    ];
    
    corners.forEach(([x, y]) => {
      result.drawCircle(new cv.Point2(x, y), 15, new cv.Vec3(0, 255, 255), -1);
    });
    
    // Add label
    const labelY = region.y > 50 ? region.y - 20 : region.y + region.height + 40;
    result.putText(
      `${region.type.toUpperCase()} (${region.score.toFixed(1)})`,
      new cv.Point2(region.x, labelY),
      cv.FONT_HERSHEY_SIMPLEX,
      1.2,
      new cv.Vec3(0, 255, 255),
      3
    );
    
    return result;
  }
}

// Test function
async function testLightweightInterest(imagePath) {
  console.log('=== Lightweight Interest Detection Test ===');
  
  if (!fs.existsSync(imagePath)) {
    console.log('❌ Image not found');
    return;
  }
  
  const detector = new LightweightInterestDetector();
  const image = cv.imread(imagePath);
  
  console.log(`Original: ${image.cols}x${image.rows}`);
  
  const startTime = Date.now();
  const region = await detector.findMostInterestingRegion(image);
  const totalTime = Date.now() - startTime;
  
  console.log(`\n=== RESULT ===`);
  console.log(`Type: ${region.type}`);
  console.log(`Location: (${region.x}, ${region.y})`);
  console.log(`Size: ${region.width} x ${region.height}`);
  console.log(`Raw Score: ${region.score.toFixed(2)}`);
  console.log(`Confidence: ${region.confidence ? region.confidence.toFixed(2) : 'N/A'}`);
  console.log(`Final Score: ${region.confidence ? (region.score * region.confidence).toFixed(2) : region.score.toFixed(2)}`);
  console.log(`Processing time: ${totalTime}ms`);
  
  // Calculate percentage position for reference
  const centerX = ((region.x + region.width/2) / image.cols * 100).toFixed(1);
  const centerY = ((region.y + region.height/2) / image.rows * 100).toFixed(1);
  console.log(`Center position: ${centerX}% across, ${centerY}% down`);
  
  // Edge distance check
  const edgeDistLeft = (region.x / image.cols * 100).toFixed(1);
  const edgeDistTop = (region.y / image.rows * 100).toFixed(1);
  const edgeDistRight = ((image.cols - region.x - region.width) / image.cols * 100).toFixed(1);
  const edgeDistBottom = ((image.rows - region.y - region.height) / image.rows * 100).toFixed(1);
  
  console.log(`Edge distances: L=${edgeDistLeft}%, T=${edgeDistTop}%, R=${edgeDistRight}%, B=${edgeDistBottom}%`);
  
  // Quality assessment
  const minEdgeDist = Math.min(edgeDistLeft, edgeDistTop, edgeDistRight, edgeDistBottom);
  if (minEdgeDist >= 5.0) {
    console.log(`✅ Region respects 5% edge margin (closest edge: ${minEdgeDist}%)`);
  } else {
    console.log(`⚠️  Region too close to edge (closest: ${minEdgeDist}%)`);
  }
  
  // Draw and save with all candidates visible
  const marked = region.allCandidates && region.allCandidates.length > 0 
    ? detector.drawResultWithCandidates(image, region, region.allCandidates)
    : detector.drawResult(image, region);
    
  const outputPath = path.join(__dirname, 'cache', 'lightweight_interest_result.jpg');
  cv.imwrite(outputPath, marked);
  
  console.log(`\n💾 Result: ${outputPath}`);
  console.log('🎯 LEGEND: Each candidate shown in different color');
  console.log('   - Numbers 1-5: Individual candidates with scores');
  console.log('   - Thick CYAN box with yellow dots: WINNER');
  console.log('   - S=Raw Score, C=Confidence, F=Final Score');
  console.log('👁️  Examine if the winner is truly the best choice!');
}

// Run test
const imagePath = process.argv[2] || 'cache/20250609_091819362_iOS.jpg';
testLightweightInterest(imagePath).catch(console.error);
