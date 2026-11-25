// 场景 PBR-ish 着色器: 太阳直射 + 天空环境光 + 深度相关大气衰减
import { SKY_UNIFORMS_WGSL, SKY_LIB_WGSL } from './sky.wgsl';

export const SCENE_WGSL = /* wgsl */ `
struct CameraUniforms {
  viewProj: mat4x4<f32>,
  eyePos: vec3<f32>,
  _pad0: f32,
};
${SKY_UNIFORMS_WGSL}
struct WeatherUniforms {
  extinction: f32,
  fogColor: vec3<f32>,
};

@group(0) @binding(0) var<uniform> cam: CameraUniforms;
@group(0) @binding(1) var<uniform> sky: SkyUniforms;
@group(0) @binding(2) var<uniform> weather: WeatherUniforms;
@group(0) @binding(3) var transLUT: texture_2d<f32>;
@group(0) @binding(4) var transSampler: sampler;

struct VSIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
};
struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
};

@vertex
fn vsMain(in: VSIn) -> VSOut {
  var out: VSOut;
  out.worldPos = in.position;
  out.normal = in.normal;
  out.color = in.color;
  out.clip = cam.viewProj * vec4<f32>(in.position, 1.0);
  return out;
}

fn acesToneMap(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}
fn linearToSRGB(c: vec3<f32>) -> vec3<f32> {
  return pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let L = normalize(sky.sunDir);
  let ndl = max(dot(n, L), 0.0);
  // 太阳落到地平线以下后无直射光(避免地下太阳仍照亮竖直墙面)
  let sunUp = smoothstep(-0.06, 0.03, L.z);

  let sunColor = mix(vec3<f32>(1.0, 0.85, 0.65), vec3<f32>(1.0, 0.97, 0.9),
                     clamp(sky.sunDir.z * 3.0, 0.0, 1.0));
  let direct = in.color * sunColor * ndl * sky.sunIntensity * 0.55 * sunUp;

  // 天空环境光(半球): 天顶冷色, 地面反弹暖色
  let skyAmb = vec3<f32>(0.18, 0.24, 0.34) * clamp(L.z + 0.35, 0.1, 1.0);
  let groundAmb = vec3<f32>(0.12, 0.1, 0.08);
  let ambient = in.color * (skyAmb * (n.z * 0.5 + 0.5) + groundAmb * (1.0 - n.z) * 0.5);

  var hdr = direct + ambient;

  // 深度相关大气混合: T = exp(-σ·d), 不是平铺白雾
  let viewDir = in.worldPos - cam.eyePos;
  let dist = length(viewDir);
  let T = exp(-weather.extinction * dist);
  let blended = hdr * T + weather.fogColor * (1.0 - T);

  return vec4<f32>(linearToSRGB(acesToneMap(blended * sky.exposure)), 1.0);
}
`;

// 天空全屏着色器从独立模块再导出, 保持 renderer 单一 import 入口
export { SKY_FULLSCREEN_WGSL } from './scene-sky.wgsl';
