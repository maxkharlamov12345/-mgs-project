// OBJ + MTL + текстуры из PRO100 → лёгкий GLB для сайта.
// Детали остаются отдельными узлами (имена «N_Деталь», «Кромка…» нужны просмотру для дверей, ящиков и кромок),
// поэтому сжимаем, а не склеиваем: одинаковые материалы/текстуры — один раз, координаты — квантование,
// геометрия — meshopt, текстуры — не больше 1024 px в WebP.
import obj2gltf from 'obj2gltf';
import {NodeIO, Logger} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {dedup, prune, quantize, meshopt, textureCompress} from '@gltf-transform/functions';
import {MeshoptEncoder, MeshoptDecoder} from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = p => String(p).replace(/\\/g, '/').split('/').filter(Boolean).pop();

// в MTL пути к текстурам бывают «папка_textures\файл.png» — файлы у нас лежат рядом, без папки
async function flattenMtl(dir) {
  for (const f of await fs.readdir(dir)) {
    if (!/\.mtl$/i.test(f)) continue;
    const p = path.join(dir, f);
    const t = await fs.readFile(p, 'utf8');
    const out = t.replace(/^(\s*(?:map_\w+|bump|disp|decal|refl)\s+)(?:-\S+\s+\S+\s+)*(.+?)\s*$/gim,
      (m, k, file) => k + base(file.trim()));
    if (out !== t) await fs.writeFile(p, out);
  }
}

export async function convert(dir, objFile, log = () => {}) {
  await flattenMtl(dir);
  const t0 = Date.now();
  const glb = await obj2gltf(path.join(dir, objFile), {binary: true, separate: false, checkTransparency: false, secure: true});
  log(`obj2gltf: ${(glb.length / 1048576).toFixed(1)} МБ за ${Date.now() - t0} мс`);

  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder});
  io.setLogger(new Logger(Logger.Verbosity.ERROR));
  const doc = await io.readBinary(glb);
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  await doc.transform(
    dedup(),
    prune({keepLeaves: true}),
    textureCompress({encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82}),
    quantize({quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14}),
    meshopt({encoder: MeshoptEncoder, level: 'medium'})
  );
  const out = await io.writeBinary(doc);
  const nodes = doc.getRoot().listNodes().length, meshes = doc.getRoot().listMeshes().length;
  log(`GLB: ${(out.length / 1048576).toFixed(2)} МБ, узлов ${nodes}, сеток ${meshes}, всего ${Date.now() - t0} мс`);
  return Buffer.from(out);
}
