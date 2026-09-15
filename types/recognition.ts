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
  confidence: number;
  status: ItemStatus;
  recordId?: string | null;
  error?: string;
}

export interface RecognizeResponse {
  success: boolean;
  data?: {
    licensePlate?: string | null;
    confidence?: number;
    plateConfidence?: number;
    gates?: string[];
    gateNames?: string[];
    imagePath?: string | null;
    recordId?: string | null;
    storedAt?: string | null;
    storageError?: string | null;
  };
  error?: string;
}
