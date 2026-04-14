/**
 * Tree LOD — WebGPU compute: frustum + max distance + mesh LOD (dense instance matrices).
 * Uses StorageInstancedBufferAttribute so WebGPU InstancedMesh uses the storage() matrix path
 * (same GPU buffer as compute). Plain InstancedBufferAttribute uses buffer(CPU array) and ignores compute writes.
 *
 * Culled or wrong-LOD slots get a zero matrix. Both LOD meshes use count = treeCount (dense).
 * Pine + impostor path should stay on CPU in the caller.
 *
 * Limit: up to 6 submeshes per LOD tier (WGSL unroll).
 */

import * as THREE from "three";

const MAX_SM = 6;

function getDevice(renderer) {
  return renderer?.backend?.device ?? null;
}

/** Column-major 16 floats for WGSL mat4x4 storage. */
function matToColMajorF32(m, out, offset) {
  const e = m.elements;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[offset + c * 4 + r] = e[c * 4 + r];
    }
  }
}

export function treeLodGpuCanUseForDefs(lod0Defs, lod1Defs) {
  const n0 = lod0Defs?.length ?? 0;
  const n1 = lod1Defs?.length ?? 0;
  return n0 >= 1 && n0 <= MAX_SM && n1 <= MAX_SM;
}

export class TreeLodChunkGpuCull {
  /**
   * @param {THREE.WebGPURenderer} renderer
   * @param {number} cap
   * @param {Array<{ localMatrix: THREE.Matrix4 }>} lod0Defs
   * @param {Array<{ localMatrix: THREE.Matrix4 }>|null|undefined} lod1Defs
   * @param {Array<{ im: THREE.InstancedMesh }>} lod0ims
   * @param {Array<{ im: THREE.InstancedMesh }>|null} lod1ims
   */
  constructor(renderer, cap, lod0Defs, lod1Defs, lod0ims, lod1ims) {
    this.renderer = renderer;
    this.cap = cap;
    this.nSub0 = Math.min(lod0Defs.length, MAX_SM);
    this.nSub1 = Math.min(lod1Defs?.length ?? 0, MAX_SM);
    this.lod0ims = lod0ims;
    this.lod1ims = lod1ims;

    const device = getDevice(renderer);
    if (!device) throw new Error("[TreeLodGpu] No WebGPU device");

    this.device = device;
    this.uniformBuffer = device.createBuffer({
      label: "treeLodGpu_uni",
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.local0Buffer = device.createBuffer({
      label: "treeLodGpu_loc0",
      size: MAX_SM * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.local1Buffer = device.createBuffer({
      label: "treeLodGpu_loc1",
      size: MAX_SM * 64,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.inPosBuffer = device.createBuffer({
      label: "treeLodGpu_inPos",
      size: cap * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.inRotBuffer = device.createBuffer({
      label: "treeLodGpu_inRot",
      size: cap * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const tmp = new Float32Array(16);
    for (let sm = 0; sm < this.nSub0; sm++) {
      matToColMajorF32(lod0Defs[sm].localMatrix, tmp, 0);
      device.queue.writeBuffer(this.local0Buffer, sm * 64, tmp);
    }
    for (let sm = 0; sm < this.nSub1; sm++) {
      matToColMajorF32(lod1Defs[sm].localMatrix, tmp, 0);
      device.queue.writeBuffer(this.local1Buffer, sm * 64, tmp);
    }

    this.lod0GpuBuffers = [];
    this.lod1GpuBuffers = [];

    for (let sm = 0; sm < this.nSub0; sm++) {
      const im = lod0ims[sm].im;
      const attr = new THREE.StorageInstancedBufferAttribute(
        new Float32Array(cap * 16),
        16,
      );
      im.instanceMatrix = attr;
      renderer.backend.createStorageAttribute(attr);
      this.lod0GpuBuffers.push(renderer.backend.get(attr).buffer);
    }
    if (lod1ims && this.nSub1 > 0) {
      for (let sm = 0; sm < this.nSub1; sm++) {
        const im = lod1ims[sm].im;
        const attr = new THREE.StorageInstancedBufferAttribute(
          new Float32Array(cap * 16),
          16,
        );
        im.instanceMatrix = attr;
        renderer.backend.createStorageAttribute(attr);
        this.lod1GpuBuffers.push(renderer.backend.get(attr).buffer);
      }
    }

    const wgsl = buildWgsl(this.nSub0, this.nSub1);
    const module = device.createShaderModule({ label: "treeLodGpu", code: wgsl });
    this.pipeline = device.createComputePipeline({
      label: "treeLodGpu_pipe",
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    this.bindGroup = device.createBindGroup({
      label: "treeLodGpu_bg",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: this._bindEntries(),
    });
  }

  _bindEntries() {
    const e = [
      { binding: 0, resource: { buffer: this.uniformBuffer } },
      { binding: 1, resource: { buffer: this.local0Buffer } },
    ];
    if (this.nSub1 > 0) {
      e.push({ binding: 2, resource: { buffer: this.local1Buffer } });
    }
    e.push(
      { binding: 3, resource: { buffer: this.inPosBuffer } },
      { binding: 4, resource: { buffer: this.inRotBuffer } },
    );
    let b = 5;
    for (let i = 0; i < this.nSub0; i++) {
      e.push({
        binding: b++,
        resource: { buffer: this.lod0GpuBuffers[i] },
      });
    }
    for (let i = 0; i < this.nSub1; i++) {
      e.push({
        binding: b++,
        resource: { buffer: this.lod1GpuBuffers[i] },
      });
    }
    return e;
  }

  dispose() {
    try {
      this.uniformBuffer?.destroy();
      this.local0Buffer?.destroy();
      this.local1Buffer?.destroy();
      this.inPosBuffer?.destroy();
      this.inRotBuffer?.destroy();
    } catch (_) {
      /* ignore */
    }
    this.lod0GpuBuffers.length = 0;
    this.lod1GpuBuffers.length = 0;
  }

  /**
   * @param {THREE.Matrix4} worldToClip — row-major Three.js; transposed for WGSL column vectors.
   */
  encode(worldToClip, camPos, thrSq, maxSq, meshMul, treeCount, chunkPositions, meshMode = 2) {
    const n = Math.min(chunkPositions.length | 0, this.cap | 0);
    const u = new Float32Array(64);
    worldToClip.toArray(u, 0);
    u[16] = camPos.x;
    u[17] = camPos.y;
    u[18] = camPos.z;
    u[19] = thrSq;
    u[20] = maxSq;
    u[21] = meshMul;
    u[22] = 0;
    // WGSL: treeCount = u32(uni.maxMeshTree.w + 0.5) — must be vec4 .w (index 23).
    u[23] = n;
    u[24] = this.nSub0;
    u[25] = this.nSub1;
    // 0: force LOD0, 1: force LOD1, 2: per-tree split by threshold
    u[26] = meshMode;
    u[27] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, u);

    const pos = new Float32Array(this.cap * 4);
    const rot = new Float32Array(this.cap);
    for (let i = 0; i < n; i++) {
      const p = chunkPositions[i];
      pos[i * 4 + 0] = p.x;
      pos[i * 4 + 1] = p.y;
      pos[i * 4 + 2] = p.z;
      pos[i * 4 + 3] = p.scale;
      rot[i] =
        typeof p.rot === "number" && Number.isFinite(p.rot)
          ? p.rot
          : Math.PI *
            2 *
            ((((p.x * 13.7 + p.z * 7.3) % 1) + 1) % 1);
    }
    this.device.queue.writeBuffer(this.inPosBuffer, 0, pos);
    this.device.queue.writeBuffer(this.inRotBuffer, 0, rot);

    const enc = this.device.createCommandEncoder({ label: "treeLodGpu_enc" });
    const pass = enc.beginComputePass({ label: "treeLodGpu_pass" });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    const wg = Math.max(1, Math.ceil(n / 64));
    pass.dispatchWorkgroups(wg);
    pass.end();
    this.device.queue.submit([enc.finish()]);

    const drawLod0 = meshMode !== 1;
    const drawLod1 = meshMode !== 0;
    for (const { im } of this.lod0ims) im.count = drawLod0 ? n : 0;
    if (this.lod1ims) for (const { im } of this.lod1ims) im.count = drawLod1 ? n : 0;
  }
}

function buildWgsl(n0, n1) {
  let lod0Decl = "";
  let lod1Decl = "";
  const locals1Decl =
    n1 > 0
      ? "@group(0) @binding(2) var<storage, read> locals1: array<mat4x4<f32>>;\n"
      : "";
  let b = 5;
  for (let i = 0; i < n0; i++) {
    lod0Decl += `@group(0) @binding(${b++}) var<storage, read_write> lod0_s${i}: array<f32>;\n`;
  }
  for (let i = 0; i < n1; i++) {
    lod1Decl += `@group(0) @binding(${b++}) var<storage, read_write> lod1_s${i}: array<f32>;\n`;
  }

  let writeLod0 = "";
  for (let sm = 0; sm < n0; sm++) {
    writeLod0 += `
  {
    var Mlod = base * locals0[${sm}];
    if (!vis || useLod1) { Mlod = zero_mat(); }
    let o = i * 16u;
    for (var k = 0u; k < 16u; k++) { lod0_s${sm}[o + k] = mat_elem(Mlod, k); }
  }`;
  }

  let writeLod1 = "";
  for (let sm = 0; sm < n1; sm++) {
    writeLod1 += `
  {
    var Mlod = base * locals1[${sm}];
    if (!vis || !useLod1) { Mlod = zero_mat(); }
    let o = i * 16u;
    for (var k = 0u; k < 16u; k++) { lod1_s${sm}[o + k] = mat_elem(Mlod, k); }
  }`;
  }

  return `
struct U {
  worldToClip: mat4x4<f32>,
  camThr: vec4<f32>,
  maxMeshTree: vec4<f32>,
  nSub: vec4<f32>,
}
@group(0) @binding(0) var<uniform> uni: U;
@group(0) @binding(1) var<storage, read> locals0: array<mat4x4<f32>>;
${locals1Decl}@group(0) @binding(3) var<storage, read> in_pos: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> in_rot: array<f32>;
${lod0Decl}
${lod1Decl}

fn mat_elem(M: mat4x4<f32>, k: u32) -> f32 {
  let c = k / 4u;
  let r = k % 4u;
  return M[c][r];
}

fn zero_mat() -> mat4x4<f32> {
  return mat4x4<f32>(
    vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0)
  );
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let treeCount = u32(uni.maxMeshTree.w + 0.5);
  if (i >= treeCount) { return; }

  let p = in_pos[i];
  let rot = in_rot[i];
  let cam = uni.camThr.xyz;
  let dx = p.x - cam.x;
  let dy = p.y - cam.y;
  let dz = p.z - cam.z;
  let distSq = dx*dx + dy*dy + dz*dz;

  // Chunk frustum culling is already done on CPU before encode().
  // Keep GPU per-tree culling focused on max distance + LOD split.
  let vis = distSq <= uni.maxMeshTree.x;

  let thrSq = uni.camThr.w;
  let n1 = u32(uni.nSub.y + 0.5);
  var useLod1 = (distSq >= thrSq) && (n1 > 0u);
  let drawMode = u32(uni.nSub.z + 0.5);
  if (drawMode == 0u) {
    useLod1 = false;
  } else if (drawMode == 1u) {
    useLod1 = n1 > 0u;
  }

  let c = cos(rot);
  let s = sin(rot);
  let sc = p.w * uni.maxMeshTree.y;
  let col0 = vec4<f32>(c * sc, 0.0, -s * sc, 0.0);
  let col1 = vec4<f32>(0.0, sc, 0.0, 0.0);
  let col2 = vec4<f32>(s * sc, 0.0, c * sc, 0.0);
  let col3 = vec4<f32>(p.xyz, 1.0);
  var base = mat4x4<f32>(col0, col1, col2, col3);
  if (!vis) { base = zero_mat(); }

${writeLod0}
${writeLod1}
}
`;
}
