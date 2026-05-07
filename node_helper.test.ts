import { describe, expect, it, beforeEach, jest, afterEach } from "@jest/globals";
import logger from "./tests/logger.mock";
import type { OneDriveMediaItem } from "./types/type";

jest.mock("canvas", () => ({
  createCanvas: jest.fn(() => ({
    getContext: jest.fn(() => ({ drawImage: jest.fn() })),
    toBuffer: jest.fn(() => Buffer.from("resized")),
  })),
  loadImage: jest.fn(() => Promise.resolve({ width: 1920, height: 1080 })),
}), { virtual: true });

import nodeHelperObj from "./node_helper.js";

const createMockOneDrivePhotos = (num: number) => Array(num).fill({})
  .map((_, i) => ({
    id: "photo" + i,
    mediaMetadata: {
      dateTimeOriginal: new Date().toISOString(),
    },
    mimeType: "image/jpeg",
  } as OneDriveMediaItem));

const mockGetImageFromAlbum = jest.fn();

jest.mock("./OneDrivePhotos.js", () =>
  jest.fn(() => ({
    batchRequestRefresh: jest.fn((arr) => Promise.resolve(arr)),
    on: jest.fn(),
    getAlbums: async () => [],
    getAlbumThumbnail: async () => "mock-thumbnail-url",
    getImageFromAlbum: mockGetImageFromAlbum,
  }))
);

describe("nodeHelperObj", () => {
  let helper: InstanceType<typeof nodeHelperObj>;
  beforeEach(async () => {
    mockGetImageFromAlbum.mockImplementation((id: string) =>
      Promise.resolve(createMockOneDrivePhotos(10).map((photo) => ({ ...photo, albumId: "album" + id })))
    );

    helper = new nodeHelperObj();
    // Provide a minimal config for initializeAfterLoading
    const config = { albums: [], updateInterval: 60000, sort: "new", condition: {}, showWidth: 1080, showHeight: 1920, timeFormat: "YYYY/MM/DD HH:mm", forceAuthInteractive: false };
    helper.readFileSafe = jest.fn(() => Promise.resolve(""));
    helper.writeFileSafe = jest.fn(() => Promise.resolve());
    helper.saveCacheConfig = jest.fn(() => Promise.resolve());
    helper.sendSocketNotification = jest.fn(() => Promise.resolve());
    const mockTryToIntitialize = jest.fn(() => Promise.resolve()) as any;
    mockTryToIntitialize.initializeTimer = null;
    helper.tryToIntitialize = mockTryToIntitialize;
    await helper.initializeAfterLoading(config);
    helper.localPhotoList = createMockOneDrivePhotos(10);
    helper.photoRefreshPointer = 0;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    if (helper) {
      helper.visionWorker = null;
      helper.visionRequests?.clear();
      if (helper.visionWorkerHealthCheckInterval) {
        clearInterval(helper.visionWorkerHealthCheckInterval);
        helper.visionWorkerHealthCheckInterval = null;
      }
    }
    helper?.stop();
    helper = null;
  });


  describe("getImageList", () => {
    it("should increase photoRefreshPointer after getImageList call", async () => {
      helper.localPhotoList = createMockOneDrivePhotos(20);
      helper.selectedAlbums = Array(10).fill({})
        .map((_, i) => ({ id: "album" + i, title: "album" + i }));
      await helper.prepAndSendChunk(7);
      expect(helper.photoRefreshPointer).toBeLessThanOrEqual(helper.localPhotoList.length);
      expect(helper.photoRefreshPointer).toBe(7);
      await helper.prepAndSendChunk(7);
      expect(helper.photoRefreshPointer).toBe(14);
      await helper.getImageList();
      expect(helper.localPhotoList.length).toBe(100);
      expect(helper.photoRefreshPointer).toBe(34);
    });

    it("should filter out non image mimetype items", async () => {
      const mimeMap = [
        "image/jpeg",
        "image/heic",
        "image/png",
        "image/gif",
        "video/quicktime",
        "text/plain",
        "unknown",
      ];
      mockGetImageFromAlbum.mockImplementation((id: string, validator: (photo: OneDriveMediaItem) => boolean) =>
        Promise.resolve(createMockOneDrivePhotos(mimeMap.length * 3)
          .map((photo, i) => ({
            ...photo,
            albumId: "album" + id,
            mimeType: mimeMap[i % mimeMap.length],
          }))
          .filter(validator))
      );
      helper.selectedAlbums = Array(3).fill({})
        .map((_, i) => ({ id: "album" + i, title: "album" + i }));
      await helper.getImageList();
      expect(helper.localPhotoList.length).toBe(36); // 3 albums * 3 items * 4 valid mime types
    });
  });

  describe("prepAndSendChunk", () => {
    it("should reset photoRefreshPointer from 0 with remaining", async () => {
      helper.localPhotoList = createMockOneDrivePhotos(19);
      helper.photoRefreshPointer = 100; // Out of bounds
      await helper.prepAndSendChunk(7);
      expect(helper.photoRefreshPointer).toBeLessThanOrEqual(helper.localPhotoList.length);
      expect(helper.photoRefreshPointer).toBe(7);
      await helper.prepAndSendChunk(7);
      expect(helper.photoRefreshPointer).toBeLessThanOrEqual(helper.localPhotoList.length);
      expect(helper.photoRefreshPointer).toBe(14);
      await helper.prepAndSendChunk(7);
      expect(helper.photoRefreshPointer).toBeLessThanOrEqual(helper.localPhotoList.length);
      expect(helper.photoRefreshPointer).toBe(19);
      await helper.prepAndSendChunk(7);
      expect(helper.photoRefreshPointer).toBeLessThanOrEqual(helper.localPhotoList.length);
      expect(helper.photoRefreshPointer).toBe(7);
    });

    it("should handle photoRefreshPointer < 0", async () => {
      helper.photoRefreshPointer = -10;
      await helper.prepAndSendChunk(5);
      expect(helper.photoRefreshPointer).toBeLessThanOrEqual(helper.localPhotoList.length);
    });

    it("should not call batchRequestRefresh if no items to refresh", async () => {
      helper.localPhotoList = [];
      helper.photoRefreshPointer = 0;
      await helper.prepAndSendChunk(5);
      expect(logger.error).toHaveBeenCalledWith("[ONEDRIVE] [node_helper]", "couldn't send ", 0, " pics");
    });
  });

  describe("vision worker resilience", () => {
    it("uses a bounded default vision timeout based on updateInterval", () => {
      helper.config = { updateInterval: 60000 };
      expect(helper.getVisionTimeoutMs()).toBe(5000);

      helper.config = { updateInterval: 9000 };
      expect(helper.getVisionTimeoutMs()).toBe(3000);

      helper.config = { updateInterval: 60000, faceDetection: { timeoutMs: 1200 } };
      expect(helper.getVisionTimeoutMs()).toBe(1200);
    });

    it("rejects non-health requests while the worker is busy", async () => {
      helper.visionWorkerReady = true;
      helper.visionWorkerBusy = true;
      helper.visionWorker = {
        pid: 123,
        send: jest.fn(),
      } as any;
      helper.isVisionWorkerAlive = jest.fn(() => true);

      await expect(helper.sendVisionWorkerMessage({ type: "PROCESS_IMAGE" })).rejects.toThrow("Vision worker busy");
    });

    it("restarts the worker when a vision request times out", async () => {
      jest.useFakeTimers();
      helper.visionWorkerReady = true;
      helper.visionWorkerBusy = false;
      helper.visionWorker = {
        pid: 123,
        send: jest.fn(),
      } as any;
      helper.isVisionWorkerAlive = jest.fn(() => true);
      helper.restartVisionWorker = jest.fn();

      const promise = helper.sendVisionWorkerMessage({ type: "PROCESS_IMAGE" }, 1000);
      jest.advanceTimersByTime(1000);

      await expect(promise).rejects.toThrow("Vision worker timeout after 1000ms");
      expect(helper.visionWorkerBusy).toBe(false);
      expect(helper.restartVisionWorker).toHaveBeenCalledWith("request_timeout:PROCESS_IMAGE:1");
      jest.useRealTimers();
    });
  });
});
