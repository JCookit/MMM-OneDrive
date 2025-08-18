#!/bin/bash

# Pi5 Step 2: Download OpenCV source code matching WSL build
# This script downloads OpenCV 4.x branch (latest stable) to match your WSL setup

set -e  # Exit on any error

echo "🔧 Pi5 OpenCV Setup - Step 2: Repository Sync"
echo "=============================================="
echo ""

# Configuration
OPENCV_DIR="$HOME/opencv_build"
OPENCV_REPO="https://github.com/opencv/opencv.git"
OPENCV_CONTRIB_REPO="https://github.com/opencv/opencv_contrib.git"
TARGET_BRANCH="4.x"  # Use 4.x branch instead of specific tag

echo "📋 Configuration:"
echo "   Build directory: $OPENCV_DIR"
echo "   Target branch: $TARGET_BRANCH (latest 4.x stable)"
echo ""

# Function to print section headers
print_section() {
    echo "$1" 
    echo "$(echo "$1" | sed 's/./─/g')"
}

# Function to check available disk space
check_disk_space() {
    local required_gb=3
    local available_kb=$(df "$HOME" | awk 'NR==2 {print $4}')
    local available_gb=$((available_kb / 1024 / 1024))
    
    echo "💾 Available disk space: ${available_gb}GB"
    
    if [ $available_gb -lt $required_gb ]; then
        echo "❌ Insufficient disk space. Need at least ${required_gb}GB"
        exit 1
    else
        echo "✅ Sufficient disk space available"
    fi
}

# Function to monitor system resources during download
monitor_download() {
    local repo_name="$1"
    local pid="$2"
    
    while kill -0 "$pid" 2>/dev/null; do
        local mem_usage=$(free -m | awk 'NR==2{printf "%.1f", $3/1024}')
        local load_avg=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | sed 's/,//')
        echo "   📊 Downloading $repo_name... (Memory: ${mem_usage}GB, Load: $load_avg)"
        sleep 10
    done
}

# Step 1: Prerequisites check
print_section "1️⃣ Checking prerequisites..."

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git not found. Please install git first:"
    echo "   sudo apt update && sudo apt install git"
    exit 1
else
    echo "✅ Git found: $(git --version)"
fi

# Check disk space
check_disk_space

# Step 2: Create build directory
print_section "2️⃣ Setting up build directory..."

if [ -d "$OPENCV_DIR" ]; then
    echo "⚠️  Build directory already exists: $OPENCV_DIR"
    read -p "   Remove existing directory and start fresh? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "🗑️  Removing existing directory..."
        rm -rf "$OPENCV_DIR"
        echo "✅ Directory removed"
    else
        echo "ℹ️  Using existing directory"
    fi
fi

mkdir -p "$OPENCV_DIR"
cd "$OPENCV_DIR"
echo "✅ Build directory ready: $(pwd)"

# Step 3: Clone OpenCV repository
print_section "3️⃣ Cloning OpenCV repository..."

if [ ! -d "opencv" ]; then
    echo "🔄 Cloning OpenCV (this may take several minutes)..."
    git clone --depth 1 --branch "$TARGET_BRANCH" "$OPENCV_REPO" opencv &
    clone_pid=$!
    monitor_download "OpenCV" $clone_pid
    wait $clone_pid
    
    if [ $? -eq 0 ]; then
        echo "✅ OpenCV cloned successfully"
    else
        echo "❌ Failed to clone OpenCV repository"
        exit 1
    fi
else
    echo "ℹ️  OpenCV directory already exists, updating..."
    cd opencv
    git fetch origin "$TARGET_BRANCH"
    git checkout "$TARGET_BRANCH"
    git pull origin "$TARGET_BRANCH"
    cd ..
    echo "✅ OpenCV updated to latest $TARGET_BRANCH"
fi

# Step 4: Clone OpenCV contrib repository
print_section "4️⃣ Cloning OpenCV contrib repository..."

if [ ! -d "opencv_contrib" ]; then
    echo "🔄 Cloning OpenCV contrib (this may take several minutes)..."
    git clone --depth 1 --branch "$TARGET_BRANCH" "$OPENCV_CONTRIB_REPO" opencv_contrib &
    contrib_pid=$!
    monitor_download "OpenCV Contrib" $contrib_pid
    wait $contrib_pid
    
    if [ $? -eq 0 ]; then
        echo "✅ OpenCV contrib cloned successfully"
    else
        echo "❌ Failed to clone OpenCV contrib repository"
        exit 1
    fi
else
    echo "ℹ️  OpenCV contrib directory already exists, updating..."
    cd opencv_contrib
    git fetch origin "$TARGET_BRANCH"
    git checkout "$TARGET_BRANCH" 
    git pull origin "$TARGET_BRANCH"
    cd ..
    echo "✅ OpenCV contrib updated to latest $TARGET_BRANCH"
fi

# Step 5: Verify versions and check what we actually got
print_section "5️⃣ Verifying repository versions..."

cd opencv
OPENCV_VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "Latest $TARGET_BRANCH")
OPENCV_COMMIT=$(git rev-parse --short HEAD)
echo "✅ OpenCV version: $OPENCV_VERSION (commit: $OPENCV_COMMIT)"

cd ../opencv_contrib  
CONTRIB_VERSION=$(git describe --tags --abbrev=0 2>/dev/null || echo "Latest $TARGET_BRANCH")
CONTRIB_COMMIT=$(git rev-parse --short HEAD)
echo "✅ OpenCV contrib version: $CONTRIB_VERSION (commit: $CONTRIB_COMMIT)"

cd ..

# Step 6: Repository size and final validation
print_section "6️⃣ Final validation..."

opencv_size=$(du -sh opencv | cut -f1)
contrib_size=$(du -sh opencv_contrib | cut -f1)
total_size=$(du -sh . | cut -f1)

echo "📊 Repository sizes:"
echo "   OpenCV: $opencv_size"
echo "   OpenCV contrib: $contrib_size"
echo "   Total: $total_size"
echo ""

# Verify essential directories exist
essential_dirs=("opencv/modules/core" "opencv/modules/imgproc" "opencv/modules/dnn" "opencv_contrib/modules")
missing_dirs=()

for dir in "${essential_dirs[@]}"; do
    if [ ! -d "$dir" ]; then
        missing_dirs+=("$dir")
    fi
done

if [ ${#missing_dirs[@]} -eq 0 ]; then
    echo "✅ All essential directories present"
else
    echo "❌ Missing directories:"
    for dir in "${missing_dirs[@]}"; do
        echo "   - $dir"
    done
    exit 1
fi

# Final summary
print_section "🎉 Step 2 Complete!"

echo "📋 Summary:"
echo "   ✅ OpenCV $TARGET_BRANCH branch downloaded ($OPENCV_VERSION)"
echo "   ✅ OpenCV contrib $TARGET_BRANCH branch downloaded ($CONTRIB_VERSION)" 
echo "   ✅ Total size: $total_size"
echo "   📁 Location: $OPENCV_DIR"
echo ""

echo "🔄 Next Steps:"
echo "   1. Run Step 3 script to build OpenCV with DNN support"
echo "   2. This will match your WSL build configuration"
echo "   3. The build will take 30-60 minutes on Pi5"
echo ""

echo "✅ Repository sync completed successfully!"
echo "💡 Note: Using $TARGET_BRANCH branch ensures latest stable 4.x version"
