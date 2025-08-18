#!/bin/bash

# Pi5 Step 1: Clean All Existing OpenCV Installation
# This script ensures a completely clean system before building OpenCV from source

echo "🧹 Pi5 Step 1: Cleaning All Existing OpenCV Components"
echo "=" * 60

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to run command with status check
run_with_check() {
    local cmd="$1"
    local desc="$2"
    
    echo "🔄 $desc..."
    if eval "$cmd" >/dev/null 2>&1; then
        echo "✅ $desc - SUCCESS"
        return 0
    else
        echo "⚠️  $desc - SKIPPED (not found or already clean)"
        return 1
    fi
}

echo ""
echo "1️⃣ Removing APT-installed OpenCV packages..."
echo "────────────────────────────────────────────"

# Remove all opencv-related packages
sudo apt remove -y libopencv* opencv* python3-opencv 2>/dev/null || echo "⚠️  No APT OpenCV packages found"
sudo apt autoremove -y 2>/dev/null

echo ""
echo "2️⃣ Cleaning npm opencv packages from MMM-OneDrive..."
echo "──────────────────────────────────────────────────────"

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
    echo "⚠️  Not in MMM-OneDrive directory. Please run from module root."
    echo "   Expected to be in: /home/cookits/MagicMirror/modules/MMM-OneDrive"
    exit 1
fi

# Remove opencv from npm
npm uninstall @u4/opencv4nodejs opencv4nodejs cv2 opencv 2>/dev/null || echo "⚠️  No npm OpenCV packages found"

echo ""
echo "3️⃣ Removing system OpenCV libraries and headers..."
echo "────────────────────────────────────────────────────"

# Remove system OpenCV files
run_with_check "sudo rm -rf /usr/local/lib/libopencv*" "Remove OpenCV libraries"
run_with_check "sudo rm -rf /usr/local/include/opencv*" "Remove OpenCV headers"  
run_with_check "sudo rm -rf /usr/local/lib/pkgconfig/opencv*" "Remove OpenCV pkg-config"
run_with_check "sudo rm -rf /usr/local/share/opencv*" "Remove OpenCV share files"
run_with_check "sudo rm -rf /usr/local/bin/opencv*" "Remove OpenCV binaries"

# Update library cache
echo "🔄 Updating library cache..."
sudo ldconfig
echo "✅ Library cache updated"

echo ""
echo "4️⃣ Cleaning build directories and caches..."
echo "────────────────────────────────────────────"

# Remove potential build directories
run_with_check "rm -rf ~/opencv" "Remove ~/opencv directory"
run_with_check "rm -rf ~/opencv_contrib" "Remove ~/opencv_contrib directory"
run_with_check "rm -rf ~/opencv_build" "Remove ~/opencv_build directory"
run_with_check "sudo rm -rf /tmp/opencv*" "Remove temp OpenCV files"

echo ""
echo "5️⃣ Validating clean state..."
echo "────────────────────────────"

validation_passed=true

# Check for remaining OpenCV files
echo "🔍 Checking for remaining OpenCV components..."

# Check libraries
if ls /usr/local/lib/libopencv* 1>/dev/null 2>&1; then
    echo "❌ Found remaining OpenCV libraries in /usr/local/lib/"
    ls /usr/local/lib/libopencv* 2>/dev/null || true
    validation_passed=false
else
    echo "✅ No OpenCV libraries found in /usr/local/lib/"
fi

# Check headers  
if ls /usr/local/include/opencv* 1>/dev/null 2>&1; then
    echo "❌ Found remaining OpenCV headers in /usr/local/include/"
    ls /usr/local/include/opencv* 2>/dev/null || true
    validation_passed=false
else
    echo "✅ No OpenCV headers found in /usr/local/include/"
fi

# Check pkg-config
if ls /usr/local/lib/pkgconfig/opencv* 1>/dev/null 2>&1; then
    echo "❌ Found remaining OpenCV pkg-config files"
    ls /usr/local/lib/pkgconfig/opencv* 2>/dev/null || true
    validation_passed=false
else
    echo "✅ No OpenCV pkg-config files found"
fi

# Check APT packages
opencv_apt_count=$(dpkg -l | grep opencv | wc -l)
if [[ $opencv_apt_count -gt 0 ]]; then
    echo "❌ Found $opencv_apt_count APT OpenCV packages still installed:"
    dpkg -l | grep opencv
    validation_passed=false
else
    echo "✅ No APT OpenCV packages found"
fi

# Check npm packages  
if npm list @u4/opencv4nodejs opencv4nodejs --depth=0 2>/dev/null | grep -q opencv; then
    echo "❌ Found remaining npm OpenCV packages:"
    npm list @u4/opencv4nodejs opencv4nodejs --depth=0 2>/dev/null | grep opencv || true
    validation_passed=false
else
    echo "✅ No npm OpenCV packages found"
fi

echo ""
echo "6️⃣ System Information..."
echo "─────────────────────"

echo "📋 Pi5 System Details:"
echo "   OS: $(lsb_release -d | cut -f2)"
echo "   Kernel: $(uname -r)"
echo "   Architecture: $(uname -m)"
echo "   Available RAM: $(free -h | grep 'Mem:' | awk '{print $2}')"
echo "   Available Disk: $(df -h / | tail -1 | awk '{print $4}')"

echo ""
if [[ $validation_passed == true ]]; then
    echo "🎉 STEP 1 COMPLETE - System is clean and ready for OpenCV build!"
    echo ""
    echo "✅ All OpenCV components successfully removed"
    echo "✅ System libraries updated"  
    echo "✅ Ready to proceed to Step 2 (sync OpenCV repo)"
    echo ""
    echo "Next step: Run the repo sync command to download OpenCV source"
    exit 0
else
    echo "❌ STEP 1 VALIDATION FAILED - Manual cleanup required"
    echo ""
    echo "Please review the remaining files above and remove them manually,"
    echo "then re-run this script to validate the clean state."
    exit 1
fi
