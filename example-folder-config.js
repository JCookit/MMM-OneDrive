/**
 * Example configuration for MMM-OneDrive with folder support
 * 
 * This example shows how to use the new folder support feature
 * alongside the existing album support.
 */

// Example 1: Albums only (existing functionality)
const albumsOnlyConfig = {
  module: "MMM-OneDrive",
  position: "top_right",
  config: {
    albums: ["My wedding", "Vacation 2024", "Family photos"],
    updateInterval: 1000 * 60,
    sort: "new",
    condition: {
      fromDate: "2024-01-01",
      toDate: null,
    },
    showWidth: 1080,
    showHeight: 1920,
  }
};

// Example 2: Folders only (new functionality)
const foldersOnlyConfig = {
  module: "MMM-OneDrive",
  position: "top_right", 
  config: {
    folders: [
      "Photos/2024",           // Path-based access to nested folder
      "Camera Roll",           // Root-level folder by name
      "Screenshots",           // Another root-level folder
      "Pictures/Family",       // Another nested folder
    ],
    updateInterval: 1000 * 60,
    sort: "random",
    timeFormat: "YYYY/MM/DD",  // Show just the date, no time
    condition: {
      minWidth: 800,  // Only show high-resolution images
      minHeight: 600,
    },
    showWidth: 1080,
    showHeight: 1920,
  }
};

// Example 3: Both albums and folders (mixed configuration)
const mixedConfig = {
  module: "MMM-OneDrive",
  position: "top_right",
  config: {
    albums: ["My wedding", "Best of 2024"],     // Special photo albums
    folders: ["Camera Roll", "Photos/Recent"],  // Regular folders
    updateInterval: 1000 * 60,
    sort: "new",
    condition: {
      fromDate: "2024-01-01",
    },
    showWidth: 1080,
    showHeight: 1920,
  }
};

// Example 4: Advanced folder configuration with regex patterns
const advancedConfig = {
  module: "MMM-OneDrive",
  position: "top_right",
  config: {
    // You can use regex patterns for folder names (not paths)
    folders: [
      { source: "Photos.*2024", flags: "i" },  // Matches "Photos 2024", "photos_2024", etc.
      { source: "Camera.*", flags: "i" },      // Matches any folder starting with "Camera"
      "Screenshots",                            // Exact folder name match
      "Pictures/Family",                        // Exact path match
    ],
    updateInterval: 1000 * 60,
    sort: "random",
    showWidth: 1080,
    showHeight: 1920,
  }
};

// Export all examples
module.exports = {
  albumsOnlyConfig,
  foldersOnlyConfig, 
  mixedConfig,
  advancedConfig
};

/**
 * Key differences between albums and folders:
 * 
 * ALBUMS:
 * - Special OneDrive photo collections (bundles)
 * - Only available in personal OneDrive (not OneDrive for Business)
 * - Curated collections similar to Google Photos albums
 * - Access by album name only
 * 
 * FOLDERS:
 * - Regular file system folders
 * - Work with both personal OneDrive and OneDrive for Business
 * - Organized like normal computer folders
 * - Access by folder name OR full path (e.g., "Photos/2024")
 * 
 * BENEFITS OF FOLDER SUPPORT:
 * - Works with OneDrive for Business
 * - Natural organization (most people organize photos in folders)
 * - No manual album creation needed
 * - Supports nested folder structures
 * - Can access existing folder hierarchies
 * 
 * TIME FORMAT OPTIONS:
 * - "YYYY/MM/DD HH:mm" - Full date and time (default)
 * - "YYYY/MM/DD" - Date only (recommended to avoid timezone confusion)
 * - "MMMM D, YYYY" - Full month name (e.g., "July 15, 2025")
 * - "MMM DD, YYYY" - Short month name (e.g., "Jul 15, 2025") 
 * - "L" - Locale-specific date format
 * - "relative" - Relative time (e.g., "2 days ago")
 * 
 * NOTE: Timezone conversion is not recommended because most camera EXIF data
 * does not include timezone information. Converting timestamps would likely
 * produce incorrect results more often than correct ones.
 */
