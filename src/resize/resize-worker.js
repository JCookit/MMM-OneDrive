const sharp = require('sharp');

function normalizeIpcBuffer(value) {
  if (!value) {
    return null;
  }

  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (value?.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }

  if (value?.data instanceof Uint8Array) {
    return Buffer.from(value.data);
  }

  return null;
}

function formatMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rssMB: Math.round(usage.rss / 1024 / 1024),
    heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(usage.heapTotal / 1024 / 1024),
    externalMB: Math.round(usage.external / 1024 / 1024),
    arrayBuffersMB: Math.round((usage.arrayBuffers || 0) / 1024 / 1024)
  };
}

function getResizeConfig(config = {}) {
  const resizeConfig = config.imageResize || {};

  return {
    sharpCache: resizeConfig.sharpCache !== undefined ? resizeConfig.sharpCache !== false : false,
    sharpConcurrency: Number.isFinite(Number(resizeConfig.sharpConcurrency))
      ? Math.max(1, Math.floor(Number(resizeConfig.sharpConcurrency)))
      : 1
  };
}

function configureSharp(config) {
  const resizeConfig = getResizeConfig(config);

  if (!resizeConfig.sharpCache) {
    sharp.cache(false);
  }

  sharp.concurrency(resizeConfig.sharpConcurrency);
}

function getOrientedDimensions(metadata) {
  const width = metadata?.width || 0;
  const height = metadata?.height || 0;
  const orientation = metadata?.orientation || 1;

  if (orientation >= 5 && orientation <= 8) {
    return { width: height, height: width };
  }

  return { width, height };
}

function calculateResizeDimensions(originalWidth, originalHeight, showWidth, showHeight) {
  const maxWidth = showWidth || originalWidth;
  const maxHeight = showHeight || originalHeight;
  const widthRatio = maxWidth / originalWidth;
  const heightRatio = maxHeight / originalHeight;
  const ratio = Math.min(widthRatio, heightRatio, 1);

  return {
    width: Math.max(1, Math.round(originalWidth * ratio)),
    height: Math.max(1, Math.round(originalHeight * ratio))
  };
}

async function resizeImageWithSharp(imageBuffer, photo, config) {
  const startedAt = Date.now();
  const beforeMemory = formatMemoryUsage();

  configureSharp(config);

  const image = sharp(imageBuffer, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();
  const { width: originalWidth, height: originalHeight } = getOrientedDimensions(metadata);

  if (!originalWidth || !originalHeight) {
    throw new Error(`Unable to read dimensions for ${photo?.filename || photo?.id || 'image'}`);
  }

  const target = calculateResizeDimensions(
    originalWidth,
    originalHeight,
    config.showWidth,
    config.showHeight
  );

  const resizedBuffer = await image
    .resize({
      width: target.width,
      height: target.height,
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: 95 })
    .toBuffer();

  return {
    buffer: resizedBuffer,
    outputWidth: target.width,
    outputHeight: target.height,
    telemetry: {
      pid: process.pid,
      elapsedMs: Date.now() - startedAt,
      inputBytes: imageBuffer.length,
      outputBytes: resizedBuffer.length,
      originalWidth,
      originalHeight,
      outputWidth: target.width,
      outputHeight: target.height,
      beforeMemory,
      memory: formatMemoryUsage()
    }
  };
}

process.on('message', async (message) => {
  if (!message || typeof message !== 'object') {
    return;
  }

  if (message.type === 'SHUTDOWN') {
    process.exit(0);
    return;
  }

  if (message.type !== 'RESIZE_IMAGE') {
    return;
  }

  const { requestId, photo, config } = message;

  try {
    const imageBuffer = normalizeIpcBuffer(message.imageBuffer);
    if (!imageBuffer) {
      throw new Error('No image buffer supplied to resize worker');
    }

    const result = await resizeImageWithSharp(imageBuffer, photo, config || {});
    process.send?.({
      type: 'RESIZE_RESULT',
      requestId,
      buffer: result.buffer,
      outputWidth: result.outputWidth,
      outputHeight: result.outputHeight,
      telemetry: result.telemetry
    });
  } catch (error) {
    process.send?.({
      type: 'RESIZE_ERROR',
      requestId,
      error: error?.message || String(error),
      stack: error?.stack || null,
      telemetry: {
        pid: process.pid,
        memory: formatMemoryUsage()
      }
    });
  }
});

process.on('uncaughtException', (error) => {
  process.send?.({
    type: 'RESIZE_ERROR',
    error: error?.message || String(error),
    stack: error?.stack || null,
    telemetry: {
      pid: process.pid,
      memory: formatMemoryUsage()
    }
  });
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  process.send?.({
    type: 'RESIZE_ERROR',
    error: error?.message || String(error),
    stack: error?.stack || null,
    telemetry: {
      pid: process.pid,
      memory: formatMemoryUsage()
    }
  });
  process.exit(1);
});

process.send?.({
  type: 'RESIZE_WORKER_READY',
  pid: process.pid,
  telemetry: {
    memory: formatMemoryUsage()
  }
});
