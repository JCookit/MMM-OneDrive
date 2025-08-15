# 🧠 Installing OpenCV with DNN Support for `opencv4nodejs` on Raspberry Pi

This guide walks you through building OpenCV from source with DNN support and compiling `opencv4nodejs` against it. Required for any Node.js module that uses deep learning features via OpenCV.

---

## 📦 Prerequisites

### Install system dependencies:

```bash
sudo apt update
sudo apt install -y build-essential cmake git libgtk2.0-dev pkg-config \
    libavcodec-dev libavformat-dev libswscale-dev \
    libtbbmalloc2 libtbb-dev libjpeg-dev libpng-dev libtiff-dev \
    libdc1394-dev libopenblas-dev liblapack-dev libatlas-base-dev \
    gfortran python3-dev

mkdir ~/opencv_build && cd ~/opencv_build
```

### Clone OpenCV Repositories
```bash
git clone https://github.com/opencv/opencv.git
git clone https://github.com/opencv/opencv_contrib.git

cd opencv && git checkout 4.x
cd ../opencv_contrib && git checkout 4.x
```
### Build OpenCV with DNN Support
```bash
cd ~/opencv_build/opencv
mkdir build && cd build

cmake -D CMAKE_BUILD_TYPE=RELEASE \
      -D CMAKE_INSTALL_PREFIX=/usr/local \
      -D OPENCV_EXTRA_MODULES_PATH=~/opencv_build/opencv_contrib/modules \
      -D BUILD_LIST=core,imgproc,imgcodecs,highgui,dnn,tracking \
      -D ENABLE_NEON=ON \
      -D WITH_OPENGL=OFF \
      -D WITH_TBB=ON \
      -D BUILD_opencv_dnn=ON \
      -D BUILD_opencv_tracking=ON \
      -D BUILD_EXAMPLES=OFF ..

make -j4  # Use -j8 if your Pi has enough cores
sudo make install
```
### Install
```bash
export OPENCV4NODEJS_DISABLE_AUTOBUILD=1
export OPENCV_INCLUDE_DIR=/usr/local/include/opencv4
export OPENCV_LIB_DIR=/usr/local/lib
npm install --save opencv4nodejs
```

### verify:
```bash
const cv = require('opencv4nodejs');
console.log(cv.getBuildInformation());


symlink bonus:   needed for install
sudo ln -s /usr/local/include/opencv4/opencv2 /usr/local/include/opencv2
