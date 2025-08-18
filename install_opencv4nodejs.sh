#!/bin/bash

echo "🔧 Pi5 OpenCV Setup - Step 4: Install opencv4nodejs with Custom Build"
echo "==================================================================="
echo ""

set -e

# Configuration
MODULE_DIR="/home/cookits/MagicMirror/modules/MMM-OneDrive"
OPENCV_VERSION="7.1.2"

echo "📋 Configuration:"
echo "   Module directory: $MODULE_DIR"
echo "   Target opencv4nodejs version: $OPENCV_VERSION"
echo "   Custom OpenCV build: /usr/local"
echo ""

# Function to print section headers
print_section() {
    echo "$1" 
    echo "$(echo "$1" | sed 's/./─/g')"
}

# Step 1: Set up environment variables
print_section "1️⃣ Setting up environment variables..."

export OPENCV4NODEJS_DISABLE_AUTOBUILD=1
export OPENCV_INCLUDE_DIR=/usr/local/include/opencv4
export OPENCV_LIB_DIR=/usr/local/lib
export OPENCV_BIN_DIR=/usr/local/bin
export LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:$PKG_CONFIG_PATH

echo "✅ Environment variables set:"
echo "   OPENCV4NODEJS_DISABLE_AUTOBUILD=$OPENCV4NODEJS_DISABLE_AUTOBUILD"
echo "   OPENCV_INCLUDE_DIR=$OPENCV_INCLUDE_DIR"
echo "   OPENCV_LIB_DIR=$OPENCV_LIB_DIR"
echo "   OPENCV_BIN_DIR=$OPENCV_BIN_DIR"

# Step 2: Verify prerequisites
print_section "2️⃣ Verifying prerequisites..."

# Check if custom OpenCV is available
if ! pkg-config --exists opencv4; then
    echo "❌ OpenCV4 not found via pkg-config"
    echo "   Please run Steps 1-3 to build OpenCV first"
    exit 1
fi

opencv_version=$(pkg-config --modversion opencv4)
echo "✅ OpenCV found: $opencv_version"

# Check essential directories
if [ ! -d "$OPENCV_INCLUDE_DIR" ]; then
    echo "❌ OpenCV include directory not found: $OPENCV_INCLUDE_DIR"
    exit 1
fi

if [ ! -d "$OPENCV_LIB_DIR" ]; then
    echo "❌ OpenCV lib directory not found: $OPENCV_LIB_DIR"
    exit 1
fi

echo "✅ OpenCV directories verified"

# Step 3: Navigate to module directory
print_section "3️⃣ Preparing module directory..."

if [ ! -d "$MODULE_DIR" ]; then
    echo "❌ MMM-OneDrive directory not found: $MODULE_DIR"
    echo "   Please ensure the module is installed"
    exit 1
fi

cd "$MODULE_DIR"
echo "✅ Working directory: $(pwd)"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found in $MODULE_DIR"
    exit 1
fi

echo "✅ package.json found"

# Step 4: Remove any existing opencv4nodejs installations
print_section "4️⃣ Cleaning previous opencv4nodejs installations..."

# Remove both old and new package names
npm uninstall opencv4nodejs @u4/opencv4nodejs 2>/dev/null || echo "No previous installations found"
echo "✅ Previous installations cleaned"

# Step 5: Install opencv4nodejs
print_section "5️⃣ Installing @u4/opencv4nodejs..."

echo "🔄 Installing @u4/opencv4nodejs@$OPENCV_VERSION..."
echo "   This may take several minutes..."

# Install with environment variables
npm install "@u4/opencv4nodejs@$OPENCV_VERSION"

if [ $? -eq 0 ]; then
    echo "✅ @u4/opencv4nodejs installed successfully"
else
    echo "❌ Installation failed"
    exit 1
fi


# Step 7: Create environment persistence
print_section "7️⃣ Setting up environment persistence..."

# Create a script to set environment variables
cat > opencv-env.sh << 'EOF'
#!/bin/bash
# OpenCV environment variables for opencv4nodejs
export OPENCV4NODEJS_DISABLE_AUTOBUILD=1
export OPENCV_INCLUDE_DIR=/usr/local/include/opencv4
export OPENCV_LIB_DIR=/usr/local/lib
export OPENCV_BIN_DIR=/usr/local/bin
export LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:$PKG_CONFIG_PATH
EOF

chmod +x opencv-env.sh
echo "✅ Environment script created: opencv-env.sh"

# Final summary
print_section "🎉 Installation Complete!"

echo "📋 Summary:"
echo "   ✅ @u4/opencv4nodejs@$OPENCV_VERSION installed"
echo "   ✅ Using custom OpenCV build ($opencv_version)"
echo ""

echo "🔄 Next Steps:"
echo "   1. Test your face detection system"
echo "   2. Copy YOLO model files to models/ directory"
echo "   3. Run your MMM-OneDrive module"
echo ""

echo "💡 Environment Setup:"
echo "   Run 'source opencv-env.sh' to set environment variables"
echo "   Or add these to your ~/.bashrc for permanent setup"
echo ""

echo "✅ Your Pi5 is now ready for YOLO face detection!"
