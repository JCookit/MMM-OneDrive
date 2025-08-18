#!/bin/bash

set -e
set -o pipefail

echo "🔧 Pi5 OpenCV Setup - Step 3: Build OpenCV with DNN Support"
echo "=========================================================="
echo ""

# 📁 Paths (updated to match Step 2 script)
OPENCV_BUILD_DIR="$HOME/opencv_build"
OPENCV_DIR="$OPENCV_BUILD_DIR/opencv"
CONTRIB_DIR="$OPENCV_BUILD_DIR/opencv_contrib"
BUILD_DIR="$OPENCV_BUILD_DIR/build"
LOG_FILE="$OPENCV_BUILD_DIR/opencv_build.log"

# 🧠 Detect architecture
ARCH=$(uname -m)
echo "📋 Configuration:"
echo "   Architecture: $ARCH"
echo "   OpenCV source: $OPENCV_DIR"
echo "   Build directory: $BUILD_DIR"
echo "   Log file: $LOG_FILE"
echo ""

# 🔍 Verify source directories exist
if [ ! -d "$OPENCV_DIR" ]; then
    echo "❌ OpenCV source directory not found: $OPENCV_DIR"
    echo "   Please run Step 2 (repository sync) first"
    exit 1
fi

if [ ! -d "$CONTRIB_DIR" ]; then
    echo "❌ OpenCV contrib directory not found: $CONTRIB_DIR"
    echo "   Please run Step 2 (repository sync) first"
    exit 1
fi

echo "✅ Source directories verified"

# 💾 Check available resources
available_memory_gb=$(free -g | awk 'NR==2{print $7}')
available_disk_gb=$(df "$HOME" | awk 'NR==2 {print int($4/1024/1024)}')
cpu_cores=$(nproc)

echo ""
echo "🔋 System Resources:"
echo "   Available memory: ${available_memory_gb}GB"
echo "   Available disk: ${available_disk_gb}GB"
echo "   CPU cores: $cpu_cores"

if [ $available_memory_gb -lt 2 ]; then
    echo "⚠️  Low memory detected. Build may be slow or fail."
    echo "   Consider increasing swap space if build fails"
fi

if [ $available_disk_gb -lt 5 ]; then
    echo "❌ Insufficient disk space. Need at least 5GB for build"
    exit 1
fi

# 🧹 Clean previous build
echo ""
echo "🧹 Cleaning previous build..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"
echo "✅ Build directory ready: $(pwd)"

# 📦 Common CMake flags
CMAKE_FLAGS=(
  -D CMAKE_BUILD_TYPE=Release
  -D CMAKE_INSTALL_PREFIX=/usr/local
  -D INSTALL_C_EXAMPLES=ON
  -D OPENCV_EXTRA_MODULES_PATH="$CONTRIB_DIR/modules"
  -D BUILD_EXAMPLES=OFF
  -D BUILD_TESTS=OFF
  -D BUILD_PERF_TESTS=OFF
  -D BUILD_opencv_python3=ON
  -D WITH_TBB=ON
  -D WITH_QT=OFF
  -D WITH_GTK=ON
  -D OPENCV_GENERATE_PKGCONFIG=ON
  -D BUILD_opencv_tracking=OFF
  -D BUILD_opencv_legacy=ON
  -D OPENCV_ENABLE_NONFREE=ON
  -D BUILD_opencv_xfeatures2d=OFF
  -D BUILD_opencv_sfm=OFF
  -D BUILD_opencv_xphoto=OFF
  -D BUILD_opencv_structured_light=OFF
  -D BUILD_opencv_optflow=OFF
  -D BUILD_opencv_face=ON
  -D BUILD_opencv_text=ON
  -D BUILD_opencv_aruco=ON
  -D BUILD_opencv_dnn_superres=ON
  -D BUILD_opencv_wechat_qrcode=ON
)

# 🧩 Architecture-specific flags
echo ""
if [[ "$ARCH" == "x86_64" ]]; then
  echo "🔧 Configuring for WSL/x86_64..."
  CMAKE_FLAGS+=(
    -D WITH_OPENGL=ON
    -D ENABLE_PRECOMPILED_HEADERS=OFF
  )
elif [[ "$ARCH" == "aarch64" ]]; then
  echo "🔧 Configuring for Raspberry Pi 5 (ARM64)..."
  CMAKE_FLAGS+=(
    -D WITH_OPENGL=OFF
    -D ENABLE_NEON=ON
    -D CMAKE_CXX_FLAGS="-march=armv8-a"
  )
else
  echo "🔧 Configuring for ARM (generic)..."
  CMAKE_FLAGS+=(
    -D WITH_OPENGL=OFF
    -D ENABLE_NEON=ON
  )
fi

# 🛠️ Run CMake
echo ""
echo "⚙️  Running CMake configuration..."
echo "   This will take a few minutes..."
cmake "${CMAKE_FLAGS[@]}" "$OPENCV_DIR" | tee "$LOG_FILE"

if [ ${PIPESTATUS[0]} -ne 0 ]; then
    echo "❌ CMake configuration failed. Check log: $LOG_FILE"
    exit 1
fi

echo "✅ CMake configuration completed successfully"

# 🔨 Build
echo ""
echo "🔨 Building OpenCV..."
echo "   This will take 30-60 minutes on Pi5..."
echo "   Progress will be logged to: $LOG_FILE"

# Use slightly fewer cores to prevent overheating/memory issues
build_cores=$((cpu_cores > 2 ? cpu_cores - 1 : cpu_cores))
echo "   Using $build_cores parallel jobs (of $cpu_cores available)"

start_time=$(date +%s)
make -j$build_cores | tee -a "$LOG_FILE"

if [ ${PIPESTATUS[0]} -ne 0 ]; then
    echo "❌ Build failed. Check log: $LOG_FILE"
    exit 1
fi

build_time=$(($(date +%s) - start_time))
echo "✅ Build completed in $((build_time/60)) minutes"

# 📦 Install
echo ""
echo "📦 Installing OpenCV..."
sudo make install | tee -a "$LOG_FILE"

if [ ${PIPESTATUS[0]} -ne 0 ]; then
    echo "❌ Installation failed. Check log: $LOG_FILE"
    exit 1
fi

sudo ldconfig
echo "✅ Installation completed"

# ✅ Validate installation
echo ""
echo "🔍 Validating installation..."

# Check pkg-config
if pkg-config --modversion opencv4 > /dev/null 2>&1; then
    opencv_version=$(pkg-config --modversion opencv4)
    echo "✅ OpenCV version: $opencv_version"
else
    echo "❌ pkg-config validation failed"
    exit 1
fi

# Check essential headers
missing_modules=()
essential_modules=("dnn" "face" "imgproc" "core")

for module in "${essential_modules[@]}"; do
    if [ ! -d "/usr/local/include/opencv4/opencv2/$module" ]; then
        missing_modules+=("$module")
    fi
done

if [ ${#missing_modules[@]} -eq 0 ]; then
    echo "✅ All essential modules installed"
else
    echo "⚠️  Missing modules: ${missing_modules[*]}"
    echo "   Build may have succeeded but some features unavailable"
fi

# Summary
total_time=$(($(date +%s) - start_time))
echo ""
echo "🎉 OpenCV Build Complete!"
echo "================================"
echo "✅ Version: $opencv_version"
echo "✅ Architecture: $ARCH"  
echo "✅ Total time: $((total_time/60)) minutes"
echo "✅ Log file: $LOG_FILE"
echo ""
echo "🔄 Next Steps:"
echo "   1. Run Step 4 to install opencv4nodejs with custom build"
echo "   2. Test the face detection system"
echo "   3. Deploy your MMM-OneDrive module"
echo ""
echo "💡 Your Pi5 now has the same OpenCV build as your WSL environment!"
