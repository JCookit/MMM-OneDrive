import type { DriveItem } from "@microsoft/microsoft-graph-types";

export type AutoInfoPositionFunction = boolean | ((album: DriveItem, target: DriveItem) => (number | string)[]) | null;
export type Config = {
  albums: (string | RegExp)[];
  folders?: (string | RegExp)[];
  updateInterval: number;
  sort: "new" | "old" | "random";
  condition: {
    fromDate: string | null;
    toDate: string | null;
    minWidth: number | null;
    maxWidth: number | null;
    minHeight: number | null;
    maxHeight: number | null;
    minWHRatio: number | null;
    maxWHRatio: number | null;
  };
  showWidth: number;
  showHeight: number;
  imageResize?: {
    backend?: "sharp" | "sharpWorker" | "canvas" | "onedriveThumbnail";
    sharpCache?: boolean;
    sharpConcurrency?: number;
    workerTimeoutMs?: number;
    workerMaxJobs?: number;
    workerMaxRssMB?: number;
  };
  resizeBackend?: "sharp" | "sharpWorker" | "canvas" | "onedriveThumbnail";
  timeFormat: string;
  forceAuthInteractive: boolean;
  autoInfoPosition: AutoInfoPositionFunction;
  leftMargin?: string | null; // e.g. "25vw" or "400px" - leaves space for left sidebar modules
  kenBurnsEffect?: boolean; // Enable/disable Ken Burns crop-and-zoom effect
  kenBurnsCenterStart?: boolean; // Start with focal point centered, then pan to natural position
  debugAlwaysStaticImage?: boolean; // Debug-only: keep backend vision enabled but suppress frontend pan/zoom transforms
  debugDomTelemetry?: boolean; // Debug-only: emit verbose DOM mutation telemetry
  faceDetection?: {
    enabled?: boolean; // Enable face detection for Ken Burns focal points
    minFaceSize?: number; // Minimum face size in pixels
    maxFaceSize?: number; // Maximum face size in pixels
    confidenceThreshold?: number; // Detection confidence threshold (0-1)
    debugMode?: boolean; // Show detection bounding rectangles on images
  };
};

export type ConfigTransformed = Omit<Config, "albums" | "folders"> & {
  albums: (string | {
    source: string,
    flags: string,
  })[];
  folders?: (string | {
    source: string,
    flags: string,
  })[];
};
