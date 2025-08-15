#!/bin/bash
# filepath: build-opencv-wsl.sh

set -e
echo "🚀 Building OpenCV with DNN support on WSL..."

# Check system info
echo "System: $(uname -a)"
echo "Cores: $(nproc)"
echo "Memory: $(free -h | grep Mem)"

# Install dependencies
echo "📦 Installing dependencies..."
sudo apt update
sudo apt install -y build-essential cmake git libgtk2.0-dev pkg-config \
    libavcodec-dev libavformat-dev libswscale-dev \
    libtbb-dev libjpeg-dev libpng-dev libtiff-dev \
    libdc1394-dev libopenblas-dev liblapack-dev libatlas-base-dev \
    gfortran python3-dev python3-numpy \
    libgtk-3-dev libcanberra-gtk-module libcanberra-gtk3-module \
    libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev

# Create build directory
BUILD_DIR="$HOME/opencv_build"
echo "📁 Creating build directory: $BUILD_DIR"
mkdir -p $BUILD_DIR && cd $BUILD_DIR

# Clone repositories
if [ ! -d "opencv" ]; then
    echo "📥 Cloning OpenCV repositories..."
    git clone https://github.com/opencv/opencv.git
    git clone https://github.com/opencv/opencv_contrib.git
fi

# Checkout latest 4.x
cd opencv && git checkout 4.x && git pull
cd ../opencv_contrib && git checkout 4.x && git pull

# Build configuration
cd ../opencv
rm -rf build && mkdir build && cd build

echo "⚙️ Configuring OpenCV build..."
cmake -D CMAKE_BUILD_TYPE=RELEASE \
      -D CMAKE_INSTALL_PREFIX=/usr/local \
      -D OPENCV_EXTRA_MODULES_PATH=$BUILD_DIR/opencv_contrib/modules \
      -D WITH_TBB=ON \
      -D WITH_OPENGL=OFF \
      -D WITH_GTK=ON \
      -D BUILD_opencv_dnn=ON \
      -D OPENCV_DNN_CUDA=OFF \
      -D BUILD_opencv_python3=ON \
      -D PYTHON3_EXECUTABLE=$(which python3) \
      -D OPENCV_ENABLE_NONFREE=ON \
      -D BUILD_EXAMPLES=OFF \
      -D BUILD_TESTS=OFF \
      -D BUILD_PERF_TESTS=OFF \
      -D INSTALL_C_EXAMPLES=OFF \
      -D INSTALL_PYTHON_EXAMPLES=OFF \
      ..

# Build (WSL can usually handle full CPU)
CORES=$(nproc)
echo "🔨 Building with $CORES cores (this will take 20-40 minutes)..."
make -j$CORES

echo "📦 Installing OpenCV..."
sudo make install
sudo ldconfig

# Verify Python installation
echo "🔍 Verifying OpenCV installation..."
python3 -c "
import cv2
print(f'OpenCV version: {cv2.__version__}')
print(f'DNN available: {hasattr(cv2, \"dnn\")}')
if hasattr(cv2, 'dnn'):
    print('DNN methods:', [m for m in dir(cv2.dnn) if not m.startswith('_')][:5])
"

# Now install opencv4nodejs
echo "🎯 Installing opencv4nodejs..."
cd /home/cookits/MagicMirror/modules/MMM-OneDrive

# Remove old installation
npm uninstall @u4/opencv4nodejs 2>/dev/null || true

# Set environment for opencv4nodejs
export OPENCV4NODEJS_DISABLE_AUTOBUILD=1
export OPENCV_INCLUDE_DIR=/usr/local/include/opencv4
export OPENCV_LIB_DIR=/usr/local/lib

echo "Installing opencv4nodejs with custom OpenCV..."
npm install @u4/opencv4nodejs

# Test Node.js DNN support
echo "🧪 Testing Node.js OpenCV DNN support..."
node -e "
const cv = require('@u4/opencv4nodejs');
console.log('✅ opencv4nodejs loaded');
console.log('OpenCV version:', cv.getVersionString());
console.log('readNetFromTensorflow:', typeof cv.readNetFromTensorflow);
console.log('dnn module:', typeof cv.dnn);

// Test actual DNN loading
try {
  const net = cv.readNetFromTensorflow('./models/opencv_face_detector_uint8.pb', './models/opencv_face_detector.pbtxt');
  console.log('🎉 DNN model loaded successfully!');
} catch(e) {
  console.log('❌ DNN model loading failed:', e.message);
}
"

echo "✅ Build complete!"