#!/bin/bash

echo "🔧 Electron OpenCV Rebuild - Fix ABI Compatibility"
echo "================================================="
echo ""

set -e

# Configuration
MODULE_DIR="/home/cookits/MagicMirror/modules/MMM-OneDrive"
MAGICMIRROR_DIR="/home/pi/MagicMirror"

echo "📋 Configuration:"
echo "   Module directory: $MODULE_DIR"
echo "   MagicMirror directory: $MAGICMIRROR_DIR"
echo ""

# Function to print section headers
print_section() {
    echo "$1" 
    echo "$(echo "$1" | sed 's/./─/g')"
}

# Step 1: Detect Electron version
print_section "1️⃣ Detecting Electron version..."

cd "$MAGICMIRROR_DIR"
ELECTRON_VERSION=$(npm list electron --depth=0 2>/dev/null | grep electron@ | sed 's/.*electron@//' | sed 's/ .*//')

if [ -z "$ELECTRON_VERSION" ]; then
    echo "❌ Could not detect Electron version"
    echo "   Please ensure MagicMirror is properly installed"
    exit 1
fi

echo "✅ Detected Electron version: $ELECTRON_VERSION"

# Step 2: Navigate to module directory
print_section "2️⃣ Preparing opencv4nodejs rebuild..."

cd "$MODULE_DIR"

# Step 3: Set environment variables for Electron build
print_section "3️⃣ Setting up environment variables..."

export OPENCV4NODEJS_DISABLE_AUTOBUILD=1
export OPENCV_INCLUDE_DIR=/usr/local/include/opencv4
export OPENCV_LIB_DIR=/usr/local/lib
export OPENCV_BIN_DIR=/usr/local/bin
export LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:$PKG_CONFIG_PATH

echo "✅ Environment variables set for custom OpenCV build"

# Step 4: Rebuild opencv4nodejs for Electron
print_section "4️⃣ Rebuilding opencv4nodejs for Electron..."

echo "🔄 Using @electron/rebuild to rebuild for Electron $ELECTRON_VERSION..."
npx @electron/rebuild -f -w @u4/opencv4nodejs -v $ELECTRON_VERSION

# Step 5: Validate the installation
print_section "5️⃣ Validating Electron build..."

echo "🧪 Testing basic opencv4nodejs functionality..."
node -e "
try {
  const cv = require('@u4/opencv4nodejs');
  console.log('✅ opencv4nodejs loaded successfully');
  console.log('   Version:', cv.version.major + '.' + cv.version.minor + '.' + cv.version.revision);
  
  // Test basic functionality
  const point = new cv.Point2(0, 0);
  const size = new cv.Size(100, 100);
  console.log('✅ Basic constructors work');
  
  // Test cascade classifier (used by face detection)
  const cascade = new cv.CascadeClassifier(cv.HAAR_FRONTALFACE_ALT2);
  console.log('✅ CascadeClassifier works');
  
  console.log('');
  console.log('🎉 opencv4nodejs is ready for Electron " + process.versions.electron + "!');
} catch (error) {
  console.log('❌ Validation failed:', error.message);
  process.exit(1);
}
"

echo ""
echo "✅ REBUILD COMPLETE!"
echo ""
echo "🔄 Next steps:"
echo "   1. Restart MagicMirror"
echo "   2. Test face detection functionality"
echo "   3. If MagicMirror updates Electron, re-run this script"
echo ""
echo "💡 Pro tip: Bookmark this script - you'll need it after Electron updates!"
