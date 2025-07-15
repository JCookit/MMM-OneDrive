#!/usr/bin/env node
"use strict";

// Mock MagicMirror's Log system by intercepting require calls
const Module = require('module');
const originalRequire = Module.prototype.require;

const mockLog = {
  info: (...args) => console.log('[INFO]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => console.log('[DEBUG]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
};

// Override require to return our mock Log when 'logger' is requested
Module.prototype.require = function(id) {
  if (id === 'logger') {
    return mockLog;
  }
  return originalRequire.apply(this, arguments);
};

// Also set global.Log for any other usage
global.Log = mockLog;

const OneDrivePhotos = require('./OneDrivePhotos');

// Test configuration - modify as needed
const testConfig = {
  albums: [], // Leave empty to test all albums
  forceAuthInteractive: false, // Set to true if you need interactive auth
  debug: true
};

const testOptions = {
  config: testConfig,
  debug: true
};

async function testOneDrive() {
  console.log('🚀 Starting OneDrive Location Test...\n');
  
  const oneDrivePhotos = new OneDrivePhotos(testOptions);
  
  // Set up event listeners
  oneDrivePhotos.on('errorMessage', (message) => {
    console.log('📱 Auth Message:');
    console.log(message);
    console.log('');
  });
  
  oneDrivePhotos.on('authSuccess', () => {
    console.log('✅ Authentication successful!\n');
  });

  try {
    console.log('📁 Getting albums...');
    const albums = await oneDrivePhotos.getAlbums();
    console.log(`Found ${albums.length} albums:\n`);
    
    albums.forEach((album, index) => {
      console.log(`${index + 1}. ${album.name} (ID: ${album.id})`);
    });
    
    if (albums.length === 0) {
      console.log('❌ No albums found. Make sure you have OneDrive albums with photos.');
      return;
    }
    
    // Test the first album
    const testAlbum = albums[0];
    console.log(`\n🔍 Testing photos in album: "${testAlbum.name}"`);
    
    const photos = await oneDrivePhotos.getImageFromAlbum(testAlbum.id, null, 5); // Limit to 5 photos for testing
    console.log(`\nFound ${photos.length} photos in the album:\n`);
    
    photos.forEach((photo, index) => {
      console.log(`--- Photo ${index + 1}: ${photo.filename} ---`);
      console.log(`  📅 Date: ${photo.mediaMetadata.dateTimeOriginal}`);
      console.log(`  📐 Size: ${photo.mediaMetadata.width}x${photo.mediaMetadata.height}`);
      
      if (photo.mediaMetadata.location) {
        console.log(`  📍 Location:`);
        console.log(`     Coordinates: ${photo.mediaMetadata.location.latitude}, ${photo.mediaMetadata.location.longitude}`);
        if (photo.mediaMetadata.location.altitude) {
          console.log(`     Altitude: ${photo.mediaMetadata.location.altitude}m`);
        }
        if (photo.mediaMetadata.location.city || photo.mediaMetadata.location.state || photo.mediaMetadata.location.country) {
          const locationParts = [
            photo.mediaMetadata.location.city,
            photo.mediaMetadata.location.state,
            photo.mediaMetadata.location.country
          ].filter(Boolean);
          console.log(`     Address: ${locationParts.join(', ')}`);
        }
      } else {
        console.log(`  📍 Location: No GPS data`);
      }
      
      if (photo.mediaMetadata.photo) {
        console.log(`  📷 Camera: ${photo.mediaMetadata.photo.cameraMake} ${photo.mediaMetadata.photo.cameraModel}`);
      }
      console.log('');
    });
    
    // Test location feature specifically
    const photosWithLocation = photos.filter(p => p.mediaMetadata.location);
    if (photosWithLocation.length > 0) {
      console.log(`✅ SUCCESS! Found ${photosWithLocation.length} photos with location data.`);
      console.log('🗺️  Location feature is working correctly!\n');
    } else {
      console.log('⚠️  No photos with location data found in this album.');
      console.log('   This could mean:');
      console.log('   • Photos were taken without GPS enabled');
      console.log('   • Photos are from older devices without GPS');
      console.log('   • Try testing with a different album\n');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (testConfig.debug) {
      console.error('Full error:', error);
    }
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Test interrupted by user. Goodbye!');
  process.exit(0);
});

// Run the test
testOneDrive().then(() => {
  console.log('🏁 Test completed!');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Unexpected error:', error);
  process.exit(1);
});
