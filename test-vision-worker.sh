#!/bin/bash

# Test script to verify vision worker can start properly
echo "Testing vision worker startup..."

cd /home/cookits/MagicMirror/modules/MMM-OneDrive

# Test 1: Check if vision worker file exists and has correct dependencies
echo "1. Checking vision worker file..."
if [ -f "src/vision/vision-worker.js" ]; then
    echo "   ✅ Vision worker file exists"
else
    echo "   ❌ Vision worker file missing"
    exit 1
fi

# Test 2: Check syntax
echo "2. Checking syntax..."
node -c src/vision/vision-worker.js
if [ $? -eq 0 ]; then
    echo "   ✅ Syntax check passed"
else
    echo "   ❌ Syntax check failed"
    exit 1
fi

# Test 3: Check if dependencies exist
echo "3. Checking dependencies..."
if [ -f "src/vision/faceDetection.js" ]; then
    echo "   ✅ faceDetection.js exists"
else
    echo "   ❌ faceDetection.js missing"
fi

if [ -f "src/vision/matManager.js" ]; then
    echo "   ✅ matManager.js exists"
else
    echo "   ❌ matManager.js missing"
fi

# Test 4: Try to start worker for 3 seconds (it should initialize and send WORKER_READY)
echo "4. Testing worker initialization..."
timeout 10s node --max-old-space-size=512 src/vision/vision-worker.js &
WORKER_PID=$!
sleep 3
if kill -0 $WORKER_PID 2>/dev/null; then
    echo "   ✅ Worker process started successfully"
    kill $WORKER_PID 2>/dev/null
else
    echo "   ❌ Worker process failed to start or crashed"
    exit 1
fi

echo "✅ Vision worker test completed successfully!"
