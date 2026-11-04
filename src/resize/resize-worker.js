const MAX_METADATA_BYTES = 64 * 1024;
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;

async function writeFrame(stream, metadata, buffer) {
  const json = Buffer.from(JSON.stringify(metadata));
  validateFrameLengths(json.length, buffer.length);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(json.length);
  header.writeUInt32BE(buffer.length, 4);
  for (const part of [header, json, buffer]) {
    await new Promise((resolve, reject) => {
      stream.write(part, error => error ? reject(error) : resolve());
    });
  }
}

function validateFrameLengths(metadataLength, imageLength) {
  if (!metadataLength || metadataLength > MAX_METADATA_BYTES ||
      !imageLength || imageLength > MAX_IMAGE_BYTES) {
    throw new Error(`Invalid resize frame lengths: ${metadataLength}, ${imageLength}`);
  }
}

async function* readFrames(stream) {
  let header = Buffer.alloc(8);
  let metadata;
  let image;
  let offset = 0;
  for await (const chunk of stream) {
    let cursor = 0;
    while (cursor < chunk.length) {
      const target = image || metadata || header;
      const count = chunk.copy(target, offset, cursor);
      cursor += count;
      offset += count;
      if (offset < target.length) continue;
      offset = 0;
      if (image) {
        yield { metadata: JSON.parse(metadata.toString('utf8')), buffer: image };
        metadata = image = undefined;
        header = Buffer.alloc(8);
      } else if (metadata) {
        image = Buffer.allocUnsafe(header.readUInt32BE(4));
      } else {
        const metadataLength = header.readUInt32BE();
        validateFrameLengths(metadataLength, header.readUInt32BE(4));
        metadata = Buffer.allocUnsafe(metadataLength);
      }
    }
  }
  if (offset || metadata) throw new Error('Incomplete resize frame');
}

module.exports = { readFrames, writeFrame };
if (require.main !== module) return;

const sharp = require('sharp');
const { Socket } = require('node:net');
const output = new Socket({ fd: 4, readable: false, writable: true });

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

process.on('message', message => {
  if (message?.type === 'SHUTDOWN') process.exit(0);
});

async function run() {
  for await (const { metadata: { requestId, photo, config }, buffer } of readFrames(process.stdin)) {
    try {
      const { buffer: resized, ...result } = await resizeImageWithSharp(buffer, photo, config || {});
      await writeFrame(output, { type: 'RESIZE_RESULT', requestId, ...result }, resized);
    } catch (error) {
      process.send?.({
        type: 'RESIZE_ERROR',
        requestId,
        error: error?.message || String(error),
        stack: error?.stack || null
      });
    }
  }
}

process.on('uncaughtException', (error) => {
  process.send?.({
    type: 'RESIZE_ERROR',
    origin: 'uncaughtException',
    error: error?.message || String(error),
    stack: error?.stack || null,
    telemetry: {
      pid: process.pid,
      nodeVersion: process.version,
      sharpVersions: sharp.versions,
      memory: formatMemoryUsage()
    }
  });
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  process.send?.({
    type: 'RESIZE_ERROR',
    origin: 'unhandledRejection',
    error: error?.message || String(error),
    stack: error?.stack || null,
    telemetry: {
      pid: process.pid,
      nodeVersion: process.version,
      sharpVersions: sharp.versions,
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

run();
