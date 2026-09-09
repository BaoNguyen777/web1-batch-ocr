const DEFAULT_BUCKET = "plate-images";

export type SupabaseConfig = {
  url: string;
  key: string;
  bucket: string;
};

export function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_BUCKET;

  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  return { url, key, bucket };
}

export function supabaseHeaders(contentType?: string): HeadersInit {
  const { key } = getSupabaseConfig();
  const headers: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
  };
  if (contentType) headers["Content-Type"] = contentType;
  return headers;
}

export function storageObjectUrl(bucket: string, path: string): string {
  return `${getSupabaseConfig().url}/storage/v1/object/${encodeURIComponent(bucket)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}
