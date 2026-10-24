import { useEffect, useRef, useState } from "react";

export default function CompletionDelivery({
  job,
  busy,
  command,
  prepareCompletion,
}) {
  const generation = useRef(0);
  const [brief, setBrief] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    generation.current++;
    setLoading(false);
    setBrief(null);
    setReviewed(false);
    setError("");
  }, [job.id, job.revision]);
  async function prepare() {
    const request = ++generation.current;
    setLoading(true);
    setReviewed(false);
    setBrief(null);
    setError("");
    try {
      const result = await prepareCompletion(job.id);
      if (generation.current !== request) return;
      if (
        typeof result.document !== "string" ||
        !/^[a-f0-9]{64}$/.test(result.hash)
      )
        throw new Error(
          "The Completion Brief could not be verified. Prepare it again.",
        );
      setBrief(result);
    } catch (e) {
      if (generation.current === request) setError(e.message);
    } finally {
      if (generation.current === request) setLoading(false);
    }
  }
  return (
    <section
      className="coord-completion"
      aria-label="Completion Brief delivery"
    >
      <h3>Completion Brief</h3>
      <p>
        Prepare the report from saved project records. Check its scope,
        measurements, exceptions and references before making it available to
        your client.
      </p>
      <button disabled={busy || loading} onClick={prepare}>
        {loading ? "Preparing…" : "Prepare Completion Brief"}
      </button>
      {error && <p role="alert">{error}</p>}
      {brief && (
        <>
          <iframe
            title="Completion Brief preview"
            sandbox=""
            srcDoc={brief.document}
            style={{
              width: "100%",
              height: 480,
              border: "1px solid #d3dcd0",
              marginTop: 16,
            }}
          />
          <p>
            Only reviewed field records are included. Original file references
            may need separate client access; check them before delivery.
          </p>
          <label className="coord-check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed this Completion Brief and authorize{" "}
            {job.chargeAuthorizedMicros / 12500} credits when it is delivered to
            the client portal. Retrying or reopening this job adds no second
            project fee.
          </label>
          <button
            disabled={busy || !reviewed}
            onClick={() =>
              command(job, "progress", {
                state: "delivered",
                completionHash: brief.hash,
                completionReviewed: true,
                authorizedMicros: job.chargeAuthorizedMicros,
              })
            }
          >
            Deliver Completion Brief · {job.chargeAuthorizedMicros / 12500}{" "}
            credits
          </button>
        </>
      )}
    </section>
  );
}
