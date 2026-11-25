// 全屏天空着色器: 透视/全景双模式重建视线方向, 调用散射库
import { SKY_UNIFORMS_WGSL, SKY_LIB_WGSL } from './sky.wgsl';

export const SKY_FULLSCREEN_WGSL = /* wgsl */ `
${SKY_UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> U: SkyUniforms;
@group(0) @binding(1) var transLUT: texture_2d<f32>;
@group(0) @binding(2) var transSampler: sampler;

struct PanUniforms {
  invViewProj: mat4x4<f32>,
  eyePos: vec3<f32>,
  mode: f32, // 0=透视, 1=全景(等距柱状)
  panYaw: f32,
  panPitch: f32,
  panFov: f32,
  aspect: f32,
  _pad: vec3<f32>,
};
@group(0) @binding(3) var<uniform> pan: PanUniforms;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldDir: vec3<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vid: u32) -> VSOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  let p = pos[vid];
  var out: VSOut;
  out.clip = vec4<f32>(p, 0.999, 1.0);

  if (pan.mode < 0.5) {
    let far = pan.invViewProj * vec4<f32>(p, 1.0, 1.0);
    let world = far.xyz / far.w;
    out.worldDir = normalize(world - pan.eyePos);
  } else {
    let uv = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
    let yaw = pan.panYaw + (uv.x - 0.5) * pan.panFov;
    let pitch = pan.panPitch + (0.5 - uv.y) * pan.panFov / pan.aspect;
    let cp = cos(pitch);
    out.worldDir = vec3<f32>(
      sin(yaw) * cp,
      cos(yaw) * cp,
      sin(pitch));
  }
  return out;
}

${SKY_LIB_WGSL}

@fragment
fn fsMain(in: VSOut) -> @location(0) vec4<f32> {
  let hdr = skyColor(normalize(in.worldDir));
  return vec4<f32>(processColor(hdr), 1.0);
}
`;
