// Meshopt-compress GLBs in place, keeping float positions and node transforms exactly as generated.
// The viewer and kit read raw geometry in the file's frame (cm), so no quantization: only the
// lossless meshopt byte codec is applied. Usage: node tools/compress_glb.mjs public/models/*.glb
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'
import { statSync } from 'node:fs'

await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })

for (const path of process.argv.slice(2)) {
  const before = statSync(path).size
  const doc = await io.read(path)
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) { console.log(`${path}: already compressed`); continue }
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE })
  await io.write(path, doc)
  console.log(`${path}: ${(before / 1e6).toFixed(2)} MB -> ${(statSync(path).size / 1e6).toFixed(2)} MB`)
}
