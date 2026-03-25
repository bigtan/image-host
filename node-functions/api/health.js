import { getDefaultProvider, getProviderList } from "./_lib/upload-providers.js";

export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "image-host",
      now: new Date().toISOString(),
      defaultProvider: getDefaultProvider(),
      providers: getProviderList()
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

