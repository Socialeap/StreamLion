// Owner-operated only. Generates locally; configures no service and sends nothing.
import { writeFileSync } from "node:fs";
import { isAbsolute, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
const target = process.argv[2];
const repository = fileURLToPath(new URL("../", import.meta.url));
if (
  !target ||
  !isAbsolute(target) ||
  !relative(repository, resolve(target)).startsWith("..")
) {
  throw new Error(
    "Provide an absolute private-file path outside the repository.",
  );
}
const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const publicKey = Buffer.from(
  await crypto.subtle.exportKey("raw", pair.publicKey),
).toString("base64url");
const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d;
writeFileSync(target, JSON.stringify({ publicKey, privateKey }) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log("Public VAPID key: " + publicKey);
console.log(
  "Private key saved to the requested file. Configure it directly as a Cloudflare secret.",
);
