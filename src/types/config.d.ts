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
  timeFormat: string;
  forceAuthInteractive: boolean;
  autoInfoPosition: AutoInfoPositionFunction;
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
