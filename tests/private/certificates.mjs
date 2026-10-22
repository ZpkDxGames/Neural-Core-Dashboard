import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { hash } from "../../backend/v2/note.mjs";
import { X509Certificate } from "node:crypto";
export async function syntheticCertificates() {
  const root = await mkdtemp(join(tmpdir(), "neural-synthetic-tls-")),
    run = (args) =>
      execFileSync("openssl", args, { cwd: root, stdio: "ignore" });
  run([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-subj",
    "/CN=Synthetic-only-local-CA",
    "-days",
    "1",
  ]);
  for (const name of ["server", "client", "other"]) {
    run([
      "req",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      name + ".key",
      "-out",
      name + ".csr",
      "-subj",
      "/CN=Synthetic-" + name,
    ]);
    await writeFile(
      join(root, name + ".ext"),
      name === "server"
        ? "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n"
        : "extendedKeyUsage=clientAuth\n",
    );
    run([
      "x509",
      "-req",
      "-in",
      name + ".csr",
      "-CA",
      "ca.crt",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-out",
      name + ".crt",
      "-days",
      "1",
      "-extfile",
      name + ".ext",
    ]);
  }
  const ca = await readFile(join(root, "ca.crt"), "utf8"),
    out = { ca };
  for (const name of ["server", "client", "other"]) {
    const cert = await readFile(join(root, name + ".crt"), "utf8");
    out[name] = {
      ca,
      cert,
      key: await readFile(join(root, name + ".key"), "utf8"),
      thumbprint: hash(new X509Certificate(cert).raw),
    };
  }
  return { ...out, close: () => rm(root, { recursive: true, force: true }) };
}
