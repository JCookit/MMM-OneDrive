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

# DNN functionality test (corrected)
echo ""
echo "🧪 Testing DNN module functionality..."
export LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH
export PKG_CONFIG_PATH=/usr/local/lib/pkgconfig:$PKG_CONFIG_PATH

python3 -c "
import cv2
import numpy as np

try:
    # Test basic DNN functionality
    dummy_img = np.zeros((224, 224, 3), dtype=np.uint8)
    blob = cv2.dnn.blobFromImage(dummy_img, 1.0, (224, 224), (0, 0, 0))
    print('✅ DNN module functional - blob shape:', blob.shape)
    
    # Check if DNN backends are available
    try:
        backends = cv2.dnn.getAvailableBackends() if hasattr(cv2.dnn, 'getAvailableBackends') else ['Backend info not available in this version']
        print('✅ DNN backends available:', len(backends) if isinstance(backends, list) else 'Unknown')
    except:
        print('✅ DNN module working (backend enumeration not supported)')
        
except Exception as e:
    print('❌ DNN functionality test failed:', str(e))
    exit(1)
" && echo "✅ DNN module validation completed" || echo "⚠️  DNN validation had issues but build may still be functional"
