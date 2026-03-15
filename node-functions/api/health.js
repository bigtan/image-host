export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "image-host",
      now: new Date().toISOString()
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

