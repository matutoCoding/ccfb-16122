// 大气散射 WGSL 着色器
// 预计算透射率 LUT + 视线 Rayleigh/Mie 单次散射(Bruneton 思路的轻量实现)
// 所有颜色为线性 RGB, 绝无渐变贴图

/** 共享 uniform 声明(场景与天空两个着色器共用, 只在此处定义一次) */
export const SKY_UNIFORMS_WGSL = /* wgsl */ `
struct SkyUniforms {
  sunDir: vec3<f32>,
  _pad0: f32,
  cameraPos: vec3<f32>,
  turbidity: f32,
  rayleighBeta: vec3<f32>,
  mieBeta: f32,
  earthRadius: f32,
  atmosphereRadius: f32,
  exposure: f32,
  sunIntensity: f32,
  _pad1: vec2<f32>,
};
`;

/** 散射函数库(不含 binding 声明, 由各着色器自行绑定) */
export const SKY_LIB_WGSL = /* wgsl */ `
const PI = 3.14159265359;
const RAYLEIGH_SCALE_HEIGHT = 7994.0;
const MIE_SCALE_HEIGHT = 1200.0;
const MIE_G = 0.76;

// 瑞利相位函数
fn rayleighPhase(cosTheta: f32) -> f32 {
  return 0.0596831 * (1.0 + cosTheta * cosTheta); // 3/(16π)*(1+cos²)
}

// Henyey-Greenstein 米氏相位函数
fn miePhase(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  let base = 1.0 + g2 - 2.0 * g * cosTheta;
  return 0.1193662 * (1.0 - g2) / (pow(max(base, 1e-7), 1.5)); // 3/(8π)
}

// 射线与球相交(上方), 返回距离 t; 不相交返回 -1
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

// 沿视线数值积分单次散射(Bruneton 标准形式)
fn integrateScattering(ro: vec3<f32>, rd: vec3<f32>, viewT: f32,
                       rayleighBeta: vec3<f32>, mieBeta: f32) -> vec3<f32> {
  let sampleCount = 32u;
  let dt = viewT / f32(sampleCount);
  let sunCos = dot(rd, U.sunDir);

  var rayleighCol = vec3<f32>(0.0);
  var mieCol = vec3<f32>(0.0);
  var opticalR = 0.0; // 视线瑞利光学厚度(标量, 颜色在 beta 处体现)
  var opticalM = 0.0;

  for (var i = 0u; i < sampleCount; i = i + 1u) {
    let t = (f32(i) + 0.5) * dt;
    let p = ro + rd * t;
    let height = max(length(p) - U.earthRadius, 0.0);

    // 密度随高度指数衰减(柱长元 dt)
    let densityR = exp(-height / RAYLEIGH_SCALE_HEIGHT) * dt;
    let densityM = exp(-height / MIE_SCALE_HEIGHT) * dt;

    // 采样点到太阳的透射率(LUT: 太阳天顶角 u / 高度 v)
    let v = clamp(height / (U.atmosphereRadius - U.earthRadius), 0.0, 1.0);
    let pNorm = normalize(p);
    let sunZen = acos(clamp(dot(pNorm, U.sunDir), -1.0, 1.0));
    // 太阳射线是否被地球遮挡: 采样点朝太阳方向与地球球相交即处于阴影
    let toSun = U.sunDir;
    let b = dot(p, toSun);
    let cEarth = dot(p, p) - U.earthRadius * U.earthRadius;
    let earthDisc = b * b - cEarth;
    var sunVisible = 1.0;
    if (earthDisc > 0.0 && -b - sqrt(earthDisc) > 0.0) {
      sunVisible = 0.0; // 地球阴影, 无直射
    }
    let u = clamp(sunZen / (PI * 0.5), 0.0, 1.0);
    let sunTrans = textureSample(transLUT, transSampler, vec2<f32>(u, v)).rgb * sunVisible;

    // 眼点到采样点的视线透射率(瑞利与米氏各自指数衰减, 相乘不是相加)
    opticalR = opticalR + densityR;
    opticalM = opticalM + densityM;
    let viewTrans = exp(-(rayleighBeta * opticalR + vec3<f32>(mieBeta * opticalM)));

    let atten = sunTrans * viewTrans;
    rayleighCol = rayleighCol + densityR * atten;
    mieCol = mieCol + densityM * atten;
  }

  let pR = rayleighPhase(sunCos);
  let pM = miePhase(sunCos, MIE_G);
  return U.sunIntensity * (rayleighBeta * pR * rayleighCol + vec3<f32>(mieBeta * pM) * mieCol);
}

// 天空主函数: 世界空间视线方向 -> 线性 HDR 颜色
fn skyColor(worldDir: vec3<f32>) -> vec3<f32> {
  // 眼点放在行星地表(局部坐标 z 仅 30m, 相对行星半径可忽略但保留)
  let ro = vec3<f32>(0.0, 0.0, U.earthRadius + U.cameraPos.z);
  let rd = normalize(worldDir);

  let tAtmo = raySphere(ro, rd, U.atmosphereRadius);
  // 机场场景自带局部地面网格, 天空着色器不画行星地面, 只算大气路径
  var viewT = tAtmo;
  if (viewT < 0.0) { viewT = 0.0; }

  var col = integrateScattering(ro, rd, viewT, U.rayleighBeta, U.mieBeta);

  // 太阳盘(视角 0.27°)+ 近太阳辉光增强
  let sunCos = dot(rd, U.sunDir);
  let sunDisc = smoothstep(0.999886, 0.999924, sunCos); // cos(0.27°/2) 附近
  let sunGlow = pow(max(sunCos, 0.0), 800.0) * 0.35 + pow(max(sunCos, 0.0), 64.0) * 0.08;
  let sunZenAtEye = acos(clamp(U.sunDir.z, -1.0, 1.0));
  let eyeTrans = textureSample(transLUT, transSampler,
    vec2<f32>(sunZenAtEye / (PI * 0.5), clamp(U.cameraPos.z / 8000.0, 0.0, 1.0))).rgb;
  col = col + vec3<f32>(1.0, 0.96, 0.88) * U.sunIntensity * eyeTrans * (sunDisc * 6.0 + sunGlow);

  return col;
}

// ACES 胶片色调映射
fn acesToneMap(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn linearToSRGB(c: vec3<f32>) -> vec3<f32> {
  return pow(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
}

fn processColor(hdr: vec3<f32>) -> vec3<f32> {
  return linearToSRGB(acesToneMap(hdr * U.exposure));
}
`;
