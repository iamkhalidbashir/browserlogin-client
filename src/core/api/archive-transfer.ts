export { streamArchiveDownload } from "./archive-download.js";
export { streamArchiveUpload } from "./archive-upload.js";

export type TransferProgress = {
  readonly direction: "download" | "upload";
  readonly transferred: number;
  readonly total: number;
  readonly done: boolean;
};

export type TransferProgressCallback = (progress: TransferProgress) => void;
