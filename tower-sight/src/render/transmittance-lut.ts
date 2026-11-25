// 透射率 LUT 预计算: 横轴太阳天顶角(0..90°), 纵轴海拔高度(0..大气层顶)
// 纯瑞利+米氏指数大气的路径积分, 启动时离线渲染一次

const LUT_W = 256;
const LUT_H = 64;

const LUT_COMPUTE_WGSL = /* wgsl */ `
// 全 scalar 布局, 与 CPU Float32Array 一一对应, 避免 vec3 对齐坑
struct LUTParams {
  earthRadius: f32,
  atmosphereRadius: f32,
  betaR_x: f32,
  betaR_y: f32,
  betaR_z: f32,
  mieBeta: f32,
  _pad0: f32,
  _pad1: f32,
};
@group(0) @binding(0) var<uniform> P: LUTParams;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;

const RAYLEIGH_SCALE_HEIGHT = 7994.0;
const MIE_SCALE_HEIGHT = 1200.0;
const PI = 3.14159265359;

fn raySphere(ro: vec3<f32>, rd: vec3<f32>, radius: f32) -> f32 {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return -1.0; }
  let s = sqrt(disc);
  let t1 = -b - s;
  let t2 = -b + s;
  if (t1 > 0.0) { return t1; }
  if (t2 > 0.0) { return t2; }
  return -1.0;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(outTex);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let u = (f32(gid.x) + 0.5) / f32(dims.x); // 太阳天顶角 0..1(乘 π/2)
  let v = f32(gid.y) / f32(dims.y);          // 高度比例 0..1

  let height = v * (P.atmosphereRadius - P.earthRadius);
  let sunZen = u * PI * 0.5;

  // 采样点位置(放在 z 轴上), 太阳方向由天顶角构造
  let ro = vec3<f32>(0.0, 0.0, P.earthRadius + height);
  let sunDir = vec3<f32>(sin(sunZen), 0.0, cos(sunZen));

  let tExit = raySphere(ro, sunDir, P.atmosphereRadius);
  let steps = 64u;
  let dt = tExit / f32(steps);
  var opticalR = 0.0;
  var opticalM = 0.0;
  for (var i = 0u; i < steps; i = i + 1u) {
    let p = ro + sunDir * (f32(i) + 0.5) * dt;
    let h = length(p) - P.earthRadius;
    opticalR = opticalR + exp(-max(h, 0.0) / RAYLEIGH_SCALE_HEIGHT) * dt;
    opticalM = opticalM + exp(-max(h, 0.0) / MIE_SCALE_HEIGHT) * dt;
  }
  let transR = exp(-vec3<f32>(P.betaR_x, P.betaR_y, P.betaR_z) * opticalR);
  let transM = exp(-vec3<f32>(P.mieBeta * opticalM));
  textureStore(outTex, vec2<i32>(gid.xy), vec4<f32>(transR * transM, 1.0));
}
`;

export interface AtmosphereConstants {
  earthRadius: number;
  atmosphereRadius: number;
  rayleighBeta: [number, number, number];
  mieBeta: number;
}

export const DEFAULT_ATMOSPHERE: AtmosphereConstants = {
  earthRadius: 6360000,
  atmosphereRadius: 6420000, // 60km 大气壳
  // 海平面瑞利散射系数(1/m), 波长相关 -> 蓝天
  rayleighBeta: [5.8e-6, 13.6e-6, 33.1e-6],
  mieBeta: 3.9e-6,
};

export async function buildTransmittanceLUT(
  device: GPUDevice,
  atmo: AtmosphereConstants = DEFAULT_ATMOSPHERE,
): Promise<GPUTexture> {
  const texture = device.createTexture({
    size: { width: LUT_W, height: LUT_H },
    format: 'rgba16float',
    usage:
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_SRC,
  });

  const module = device.createShaderModule({ code: LUT_COMPUTE_WGSL });
  // LUTParams: f32 + f32 + vec3 + f32 = 8 个 float(对齐后 32 字节, 留余量取 48)
  const uniformBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const data = new Float32Array(8);
  data[0] = atmo.earthRadius;
  data[1] = atmo.atmosphereRadius;
  data[2] = atmo.rayleighBeta[0];
  data[3] = atmo.rayleighBeta[1];
  data[4] = atmo.rayleighBeta[2];
  data[5] = atmo.mieBeta;
  device.queue.writeBuffer(uniformBuffer, 0, data);

  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: texture.createView() },
    ],
  });

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(LUT_W / 8), Math.ceil(LUT_H / 8));
  pass.end();
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  return texture;
}
