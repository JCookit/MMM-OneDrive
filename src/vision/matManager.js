/**
 * Unified OpenCV Mat Object Memory Management
 * 
 * Provides centralized tracking and cleanup of OpenCV Mat objects
 * to prevent memory leaks and native heap corruption.
 */

// Global Mat object tracking
const activeMatObjects = new Set();
let totalMatObjectsCreated = 0;

/**
 * Track a new Mat object
 */
function trackMat(mat, context) {
  if (mat && mat.rows && mat.cols) {
    activeMatObjects.add(mat);
    totalMatObjectsCreated++;
    //console.debug(`[MatManager] 📊 Mat created (${context}): ${activeMatObjects.size} active, ${totalMatObjectsCreated} total`);
  }
  return mat;
}

/**
 * Safely release a Mat object with error handling
 */
function safeRelease(mat, context) {
  try {
    if (mat && mat.rows && mat.cols && !mat.empty) {
      mat.release();
      activeMatObjects.delete(mat);
      //console.debug(`[MatManager] 🗑️ Mat released (${context}): ${activeMatObjects.size} active remaining`);
      return true;
    } else {
      console.debug(`[MatManager] ⏭️ Mat already released or invalid (${context})`);
      return false;
    }
  } catch (error) {
    console.warn(`[MatManager] ⚠️ Error releasing Mat (${context}):`, error.message);
    // Still try to remove from tracking set
    activeMatObjects.delete(mat);
    return false;
  }
}

/**
 * Get current Mat object statistics
 */
function getMatStats() {
  return {
    active: activeMatObjects.size,
    total: totalMatObjectsCreated
  };
}

/**
 * Force cleanup of all tracked Mat objects (emergency use only)
 */
function forceCleanup() {
  console.warn(`[MatManager] 🚨 Emergency cleanup of ${activeMatObjects.size} Mat objects`);
  let cleanedCount = 0;
  
  for (const mat of activeMatObjects) {
    try {
      if (mat && mat.rows && mat.cols && !mat.empty) {
        mat.release();
        cleanedCount++;
      }
    } catch (error) {
      console.warn(`[MatManager] Error in emergency cleanup:`, error.message);
    }
  }
  
  activeMatObjects.clear();
  console.debug(`[MatManager] 🧹 Emergency cleanup completed: ${cleanedCount} Mat objects released`);
}

/**
 * Log current memory statistics
 */
function logMatMemory(context) {
  const stats = getMatStats();
  const memUsage = process.memoryUsage();
  console.debug(`[MatManager] 💾 Memory stats (${context}): ${stats.active} active Mats, ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB heap`);
}

module.exports = {
  trackMat,
  safeRelease,
  getMatStats,
  forceCleanup,
  logMatMemory,
  // Export the Set for advanced debugging
  activeMatObjects
};
