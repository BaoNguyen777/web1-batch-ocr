import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "plate-images";
  return { url, key, bucket };
}

async function checkSupabase() {
  const { url, key, bucket } = getSupabaseConfig();
  if (!url || !key) {
    return { configured: false, databaseStatus: null, storageStatus: null, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing." };
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  let databaseStatus: number | null = null;
  let storageStatus: number | null = null;
  let error: string | null = null;

  try {
    const response = await fetch(`${url}/rest/v1/plate_records?select=id&limit=1`, {
      headers,
      cache: "no-store",
    });
    databaseStatus = response.status;
    if (!response.ok) error = `Supabase database HTTP ${response.status}.`;
  } catch (e) {
    error = e instanceof Error ? e.message : "Cannot connect to Supabase database.";
  }

  try {
    const response = await fetch(`${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
      headers,
      cache: "no-store",
    });
    storageStatus = response.status;
    if (!response.ok && !error) error = `Supabase storage HTTP ${response.status}.`;
  } catch (e) {
    if (!error) error = e instanceof Error ? e.message : "Cannot connect to Supabase Storage.";
  }

  return { configured: true, databaseStatus, storageStatus, bucket, error };
}

async function checkAi() {
  const value = process.env.AI_API_URL?.trim();
  if (!value) return { configured: false, status: null, ok: false, error: "AI_API_URL is missing." };

  const url = (/^https?:\/\//i.test(value) ? value : `https://${value}`).replace(/\/$/, "");
  const apiKey = process.env.AI_API_KEY?.trim();
  const headers: HeadersInit = apiKey ? { "x-api-key": apiKey } : {};

  try {
    const response = await fetch(`${url}/health`, { headers, cache: "no-store" });
    return { configured: true, status: response.status, ok: response.ok, error: response.ok ? null : `AI server HTTP ${response.status}.` };
  } catch (e) {
    return { configured: true, status: null, ok: false, error: e instanceof Error ? e.message : "Cannot connect to AI server." };
  }
}

export async function GET() {
  const [supabase, ai] = await Promise.all([checkSupabase(), checkAi()]);
  const ok = Boolean(supabase.configured && supabase.databaseStatus === 200 && supabase.storageStatus === 200 && ai.ok);

  return NextResponse.json({
    ok,
    service: "web1-batch-ocr",
    ai,
    supabase,
    environment: {
      supabaseUrlConfigured: Boolean(process.env.SUPABASE_URL?.trim()),
      serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
      storageBucket: process.env.SUPABASE_STORAGE_BUCKET?.trim() || "plate-images",
      aiApiUrlConfigured: Boolean(process.env.AI_API_URL?.trim()),
      aiApiKeyConfigured: Boolean(process.env.AI_API_KEY?.trim()),
    },
  }, { status: ok ? 200 : 503 });
}
