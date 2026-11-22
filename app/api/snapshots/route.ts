import type { SupabaseClient } from "@supabase/supabase-js";
import { iterateSnapshots } from "@/lib/supabase/archives";
import { ownerRoute } from "@/lib/supabase/route";

async function* snapshotJson(supabase: SupabaseClient): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const chunkSize = 32_768;
  yield encoder.encode('{"snapshots":[');

  let separator = "";
  for await (const snapshot of iterateSnapshots(supabase)) {
    const bytes = encoder.encode(separator + JSON.stringify(snapshot));
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      yield bytes.subarray(offset, offset + chunkSize);
    }
    separator = ",";
  }

  yield encoder.encode("]}");
}

export function GET() {
  return ownerRoute(async (supabase) => {
    const chunks = snapshotJson(supabase);
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await chunks.next();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch {
          console.error("Arşiv listesi aktarımı tamamlanamadı.");
          controller.error(new Error("Arşiv listesi aktarımı tamamlanamadı."));
        }
      },
      async cancel() {
        await chunks.return(undefined);
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
    });
  });
}
