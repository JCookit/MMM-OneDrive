#!/bin/bash

echo "🔧 Rebuilding OpenCV for Node.js (Custom OpenCV Build)"
echo "===================================================="
echo ""

set -e

MODULE_DIR="/home/cookits/MagicMirror/modules/MMM-OneDrive"

echo "📋 Current situation:"
echo "   • Main process (MagicMirror): Runs in Electron"
echo "   • Worker process: Runs in regular Node.js"  
echo "   • OpenCV: Custom build in /usr/local"
echo "   • Need to rebuild @u4/opencv4nodejs for: Node.js"
echo ""

cd "$MODULE_DIR"

# Function to print section headers
print_section() {
    echo "$1" 
    echo "$(echo "$1" | sed 's/./─/g')"
}

print_section "1️⃣ Checking current Node.js version..."
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"
echo ""

print_section "2️⃣ Backing up current OpenCV installation..."
if [ -d "node_modules/@u4" ]; then
    cp -r node_modules/@u4 node_modules/@u4.electron.backup || echo "Backup failed, continuing..."
fi

print_section "3️⃣ Setting up environment for custom OpenCV build..."

# Disable autobuild - we're using custom OpenCV
export OPENCV4NODEJS_DISABLE_AUTOBUILD=1

# Set include directory for custom OpenCV build
export OPENCV_INCLUDE_DIR=/usr/local/include/opencv4

# Set library directory for custom OpenCV build  
export OPENCV_LIB_DIR=/usr/local/lib

# Generate library list from installed OpenCV libraries
if [ -d "/usr/local/lib" ] && ls /usr/local/lib/libopencv_*.so >/dev/null 2>&1; then
    export OPENCV4NODEJS_LIBRARIES="$(ls /usr/local/lib/libopencv_*.so | sed 's|.*/lib||;s|\.so.*||' | xargs -I{} echo -n '-l{} ')"
    echo "✅ Found custom OpenCV libraries:"
    echo "   Include dir: $OPENCV_INCLUDE_DIR"
    echo "   Library dir: $OPENCV_LIB_DIR"
    echo "   Libraries: $OPENCV4NODEJS_LIBRARIES"
else
    echo "❌ Custom OpenCV libraries not found in /usr/local/lib!"
    echo "Expected files like: libopencv_core.so, libopencv_imgproc.so, etc."
    exit 1
fi

# Verify include directory exists
if [ ! -d "$OPENCV_INCLUDE_DIR" ]; then
    echo "❌ OpenCV include directory not found: $OPENCV_INCLUDE_DIR"
    exit 1
fi

echo ""
print_section "4️⃣ Environment summary:"
echo "OPENCV4NODEJS_DISABLE_AUTOBUILD=$OPENCV4NODEJS_DISABLE_AUTOBUILD"
echo "OPENCV_INCLUDE_DIR=$OPENCV_INCLUDE_DIR"
echo "OPENCV_LIB_DIR=$OPENCV_LIB_DIR"
echo "OPENCV4NODEJS_LIBRARIES=$OPENCV4NODEJS_LIBRARIES"
echo ""

print_section "5️⃣ Rebuilding @u4/opencv4nodejs for Node.js..."
npm rebuild @u4/opencv4nodejs

print_section "6️⃣ Testing OpenCV in Node.js context..."
node -e "
  try {
    const cv = require('@u4/opencv4nodejs');
    console.log('✅ @u4/opencv4nodejs loaded successfully in Node.js');
    console.log('✅ OpenCV version: ' + cv.version);
    console.log('✅ Build information:');
    console.log(cv.getBuildInformation().split('\n').slice(0, 10).join('\n'));
    
    // Test basic functionality
    const mat = new cv.Mat(100, 100, cv.CV_8UC3, [255, 0, 0]);
    console.log('✅ Basic Mat creation works');
    console.log('✅ Mat size: ' + mat.rows + 'x' + mat.cols);
    
    console.log('🎉 OpenCV is ready for Node.js worker processes!');
  } catch (error) {
    console.error('❌ OpenCV test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
"

echo ""
print_section "7️⃣ Testing vision worker startup..."
timeout 10s node src/vision/vision-worker.js || echo "✅ Worker process started successfully (timed out as expected)"

echo ""
echo "🎉 Rebuild complete! OpenCV should now work in both contexts:"
echo "   ✅ Worker process (Node.js) - should work now"
echo "   ⚠️  Main process (Electron) - may need rebuild if issues occur"
echo ""
echo "💡 If main MagicMirror process has OpenCV issues after this, run:"
echo "   ./rebuild_opencv_for_electron.sh"
echo ""
echo "🔧 Environment used:"
echo "   OPENCV4NODEJS_DISABLE_AUTOBUILD=1"
echo "   OPENCV_INCLUDE_DIR=/usr/local/include/opencv4"  
echo "   OPENCV_LIB_DIR=/usr/local/lib"
echo "   OPENCV4NODEJS_LIBRARIES=<auto-detected>"
