export interface OneDriveMediaItem {
  id: string;
  baseUrl?: string;
  baseUrlExpireDateTime?: string;
  mimeType: string;
  mediaMetadata: {
    dateTimeOriginal: string;
    manualExtractEXIF: boolean | null;
    width: string;
    height: string;
    location?: {
      latitude: number;
      longitude: number;
      altitude?: number;
      city?: string;
      state?: string;
      country?: string;
    };
    photo: {
      cameraMake?: string;
      cameraModel?: string;
      focalLength?: number;
      apertureFNumber?: number;
      isoEquivalent?: number;
      exposureTime?: string;
    };
  };
  parentReference: {
    driveId: string;
    driveType: string;
    id: string;
    name: string;
    path: string;
  };
  filename: string;
  _albumId: string;
  _albumTitle: string;
  _folderId?: string;  // Present when photo comes from a folder
  _indexOfPhotos: number;
}
