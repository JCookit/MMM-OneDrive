#!/usr/bin/env python3

import cv2
import numpy as np
import os

print("=== Testing Same Model with Python OpenCV ===\n")

# Load the test image
test_image_path = "cache/image_with_faces.jpg"
if not os.path.exists(test_image_path):
    print(f"Error: {test_image_path} not found!")
    exit(1)

img = cv2.imread(test_image_path)
print(f"✓ Test image loaded: {img.shape[1]}x{img.shape[0]}")

# Load the same face detection model
model_path = "models/opencv_face_detector_uint8.pb"
config_path = "models/opencv_face_detector.pbtxt"

if not os.path.exists(model_path) or not os.path.exists(config_path):
    print("Error: Model files not found!")
    exit(1)

net = cv2.dnn.readNetFromTensorflow(model_path, config_path)
print("✓ Model loaded successfully")

# Create blob from image (same parameters as Node.js version)
blob = cv2.dnn.blobFromImage(img, 1.0, (300, 300), (104, 177, 123), swapRB=False, crop=False)

# Set input and perform detection
net.setInput(blob)
outputs = net.forward(['mbox_conf', 'mbox_loc'])

mbox_conf = outputs[0]
mbox_loc = outputs[1]

print(f"Confidence tensor shape: {mbox_conf.shape}")
print(f"Location tensor shape: {mbox_loc.shape}")

num_anchors = mbox_conf.shape[1] // 2
print(f"Number of anchors: {num_anchors}")

# Analyze confidence distribution across anchor ranges
ranges = [
    {"name": "First 1000 anchors (top-left region)", "start": 0, "end": 1000},
    {"name": "Middle 1000 anchors (center region)", "start": 3000, "end": 4000},
    {"name": "Anchors 6000-7000 (center-right)", "start": 6000, "end": 7000},
    {"name": f"Last 1000 anchors (bottom-right)", "start": num_anchors - 1000, "end": num_anchors}
]

print("\n=== Python OpenCV Results ===")

for range_info in ranges:
    high_conf_count = 0
    max_conf = 0
    
    for i in range(range_info["start"], range_info["end"]):
        bg_conf = mbox_conf[0, i * 2]
        face_conf = mbox_conf[0, i * 2 + 1]
        
        # Apply softmax
        max_c = max(bg_conf, face_conf)
        exp_bg = np.exp(bg_conf - max_c)
        exp_face = np.exp(face_conf - max_c)
        confidence = exp_face / (exp_bg + exp_face)
        
        if confidence > 0.3:
            high_conf_count += 1
        if confidence > max_conf:
            max_conf = confidence
    
    print(f"{range_info['name']}:")
    print(f"  High confidence (>30%): {high_conf_count} detections")
    print(f"  Max confidence: {max_conf * 100:.1f}%\n")

# Distribution analysis
early_high_conf = 0
late_high_conf = 0

for i in range(num_anchors):
    bg_conf = mbox_conf[0, i * 2]
    face_conf = mbox_conf[0, i * 2 + 1]
    
    max_c = max(bg_conf, face_conf)
    exp_bg = np.exp(bg_conf - max_c)
    exp_face = np.exp(face_conf - max_c)
    confidence = exp_face / (exp_bg + exp_face)
    
    if confidence > 0.5:
        if i < num_anchors // 2:
            early_high_conf += 1
        else:
            late_high_conf += 1

print("=== Distribution Analysis ===")
print(f"High confidence in first half of anchors: {early_high_conf}")
print(f"High confidence in second half of anchors: {late_high_conf}")

# Low threshold test
very_low_threshold_count = 0
for i in range(num_anchors // 2):
    bg_conf = mbox_conf[0, i * 2]
    face_conf = mbox_conf[0, i * 2 + 1]
    
    max_c = max(bg_conf, face_conf)
    exp_bg = np.exp(bg_conf - max_c)
    exp_face = np.exp(face_conf - max_c)
    confidence = exp_face / (exp_bg + exp_face)
    
    if confidence > 0.1:
        very_low_threshold_count += 1

print(f"\nWith 10% threshold in first half: {very_low_threshold_count} detections")

# Comparison conclusion
print("\n=== Comparison with Node.js Results ===")
print("If results match Node.js version:")
print("  → This is a MODEL LIMITATION")
print("  → The pre-trained model doesn't detect the left face well")
print("  → Need to switch to a different model")
print("\nIf results differ from Node.js version:")
print("  → This is an opencv4nodejs ISSUE")  
print("  → The Node.js binding has different behavior")
print("  → Can potentially fix in Node.js implementation")

# Create visualization of all detections
print("\n=== Creating Visual Output ===")

# Copy image for visualization
result_img = img.copy()

# Process all detections and draw them
all_detections = []
scale = 0.08  # Same scale used in Node.js version

for i in range(num_anchors):
    bg_conf = mbox_conf[0, i * 2]
    face_conf = mbox_conf[0, i * 2 + 1]
    
    # Apply softmax
    max_c = max(bg_conf, face_conf)
    exp_bg = np.exp(bg_conf - max_c)
    exp_face = np.exp(face_conf - max_c)
    confidence = exp_face / (exp_bg + exp_face)
    
    if confidence > 0.1:  # Show all detections > 10%
        # Get location data
        dx = mbox_loc[0, i * 4] * scale
        dy = mbox_loc[0, i * 4 + 1] * scale
        dw = mbox_loc[0, i * 4 + 2] * scale
        dh = mbox_loc[0, i * 4 + 3] * scale
        
        # Simple coordinate decoding (same as Node.js failing approach)
        centerX = 0.5 + dx
        centerY = 0.5 + dy
        w = 0.2 * np.exp(dw)
        h = 0.2 * np.exp(dh)
        
        # Convert to image coordinates
        x1 = int((centerX - w/2) * img.shape[1])
        y1 = int((centerY - h/2) * img.shape[0])
        x2 = int((centerX + w/2) * img.shape[1])
        y2 = int((centerY + h/2) * img.shape[0])
        
        # Clamp to image bounds
        x1 = max(0, min(x1, img.shape[1]))
        y1 = max(0, min(y1, img.shape[0]))
        x2 = max(0, min(x2, img.shape[1]))
        y2 = max(0, min(y2, img.shape[0]))
        
        all_detections.append({
            'confidence': confidence,
            'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
            'centerX': (x1 + x2) // 2,
            'centerY': (y1 + y2) // 2,
            'side': 'LEFT' if (x1 + x2) // 2 < img.shape[1] // 2 else 'RIGHT'
        })

# Sort by confidence
all_detections.sort(key=lambda x: x['confidence'], reverse=True)

print(f"Total detections >10%: {len(all_detections)}")

# Draw top 20 detections
for i, det in enumerate(all_detections[:20]):
    # Color based on confidence
    if det['confidence'] > 0.8:
        color = (0, 255, 0)  # Green for high confidence
        thickness = 3
    elif det['confidence'] > 0.5:
        color = (0, 255, 255)  # Yellow for medium confidence
        thickness = 2
    else:
        color = (255, 0, 0)  # Blue for low confidence
        thickness = 1
    
    # Draw rectangle
    cv2.rectangle(result_img, (det['x1'], det['y1']), (det['x2'], det['y2']), color, thickness)
    
    # Draw confidence label
    label = f"{det['confidence']*100:.1f}%"
    label_pos = (det['x1'], max(det['y1'] - 10, 20))
    cv2.putText(result_img, label, label_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 2)
    
    print(f"  {i+1}: {det['confidence']*100:.1f}% conf, {det['side']} side, center({det['centerX']}, {det['centerY']})")

# Draw center line to show left/right division
center_x = img.shape[1] // 2
cv2.line(result_img, (center_x, 0), (center_x, img.shape[0]), (255, 255, 255), 2)

# Count detections by side
left_count = sum(1 for det in all_detections if det['side'] == 'LEFT')
right_count = sum(1 for det in all_detections if det['side'] == 'RIGHT')

print(f"\nSpatial distribution: {left_count} LEFT, {right_count} RIGHT")

# Save result
output_path = "python_opencv_detection_results.jpg"
cv2.imwrite(output_path, result_img)
print(f"✓ Visualization saved: {output_path}")

# Also test with classic detectMultiScale for comparison if available
print("\n=== Testing Classic Haar Cascade for Reference ===")
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

try:
    # Try different paths for Haar cascade
    cascade_paths = [
        '/usr/share/opencv4/haarcascades/haarcascade_frontalface_default.xml',
        '/usr/local/share/opencv4/haarcascades/haarcascade_frontalface_default.xml',
        'haarcascade_frontalface_default.xml'
    ]
    
    face_cascade = None
    for path in cascade_paths:
        if os.path.exists(path):
            face_cascade = cv2.CascadeClassifier(path)
            break
    
    if face_cascade and not face_cascade.empty():
        faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
        print(f"Haar cascade detected {len(faces)} faces")
        for i, (x, y, w, h) in enumerate(faces):
            side = "LEFT" if x + w/2 < img.shape[1]/2 else "RIGHT"
            print(f"  Face {i+1}: {side} side, center({x + w//2}, {y + h//2}), size {w}x{h}")
    else:
        print("Haar cascade not found in common locations")
except Exception as e:
    print(f"Haar cascade error: {e}")
