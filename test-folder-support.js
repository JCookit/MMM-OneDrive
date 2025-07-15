// Mock the MagicMirror logger module before requiring OneDrivePhotos
require.cache[require.resolve('logger')] = {
  exports: {
    info: (...args) => console.log('[INFO]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    debug: (...args) => console.log('[DEBUG]', ...args)
  }
};

const OneDrivePhotos = require('./OneDrivePhotos.js');
const { msalConfig } = require('./msal/authConfig.js');

/**
 * Simple test for folder support functionality
 */
async function testFolderSupport() {
  console.log('🧪 Testing Folder Support in MMM-OneDrive\n');
  
  try {
    const oneDrivePhotos = new OneDrivePhotos({
      debug: false, // Reduced logging for cleaner output
      config: {}
    });

    // Wait for auth ready
    console.log('🔐 Waiting for authentication...');
    await oneDrivePhotos.onAuthReady();
    console.log('✅ Authentication successful!\n');

    // Test 1: Get folder list
    console.log('📁 Testing getFolders()...');
    const folders = await oneDrivePhotos.getFolders();
    console.log(`Found ${folders.length} folders:\n`);
    
    folders.slice(0, 10).forEach((folder, index) => {
      console.log(`  ${index + 1}. ${folder.name} (ID: ${folder.id})`);
    });

    if (folders.length > 10) {
      console.log(`  ... and ${folders.length - 10} more folders`);
    }

    // Test 2: Test folder by path (if user has common folders)
    console.log('\n📂 Testing getFolderByPath()...');
    const commonPaths = ['Pictures', 'Photos', 'Camera Roll', 'Screenshots'];
    
    for (const path of commonPaths) {
      try {
        const folder = await oneDrivePhotos.getFolderByPath(path);
        if (folder) {
          console.log(`  ✅ Found folder: ${path} (ID: ${folder.id})`);
          
          // Test 3: Get photos from this folder
          console.log(`  📸 Getting photos from ${path}...`);
          const photos = await oneDrivePhotos.getFolderPhotos(folder.id);
          console.log(`  📊 Found ${photos.length} photos in ${path}`);
          break; // Test with the first folder we find
        }
      } catch (err) {
        console.log(`  ❌ Folder not found: ${path}`);
      }
    }

    // Test 4: Test with the first folder if we found any
    if (folders.length > 0) {
      const testFolder = folders[0];
      console.log(`\n🔍 Testing getImageFromFolder() with: "${testFolder.name}"`);
      
      try {
        const images = await oneDrivePhotos.getImageFromFolder(testFolder.id, null, 3); // Limit to 3 for testing
        console.log(`Found ${images.length} images in folder "${testFolder.name}":\n`);
        
        images.forEach((image, index) => {
          console.log(`--- Image ${index + 1}: ${image.filename} ---`);
          console.log(`  📅 Date: ${image.mediaMetadata.dateTimeOriginal}`);
          console.log(`  📐 Size: ${image.mediaMetadata.width}x${image.mediaMetadata.height}`);
          console.log(`  🏷️  Type: ${image.mimeType}`);
          
          if (image.mediaMetadata.location) {
            console.log(`  📍 Location: ${image.mediaMetadata.location.latitude}, ${image.mediaMetadata.location.longitude}`);
          }
          console.log('');
        });
      } catch (err) {
        console.log(`  ❌ Error getting images from folder: ${err.message}`);
      }
    }

    console.log('✅ Folder support test completed successfully!');
    console.log('\n📝 To use folder support in your MagicMirror config:');
    console.log('```javascript');
    console.log('{');
    console.log('  module: "MMM-OneDrive",');
    console.log('  config: {');
    console.log('    albums: ["My Album"],  // Optional: existing album support');
    console.log('    folders: [             // NEW: folder support');
    if (folders.length > 0) {
      console.log(`      "${folders[0].name}",    // Folder name matching`);
    }
    console.log('      "Photos/2024",      // Path-based access');
    console.log('      "Camera Roll"       // Another folder');
    console.log('    ]');
    console.log('  }');
    console.log('}');
    console.log('```');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
if (require.main === module) {
  testFolderSupport().catch(console.error);
}

module.exports = { testFolderSupport };
