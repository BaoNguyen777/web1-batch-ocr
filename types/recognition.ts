export type ItemStatus =
  | "pending"
  | "processing"
  | "done"
  | "error";

export interface RecognitionItem {
  id: string;
  file: File;
  preview: string;
  licensePlate: string;
  cccd: string;
  confidence: number;
  status: ItemStatus;
  error?: string;
}

export interface RecognizeResponse {
  success: boolean;
  data?: {
    licensePlate?: string;
    cccd?: string;
    confidence?: number;
  };
  error?: string;
}
