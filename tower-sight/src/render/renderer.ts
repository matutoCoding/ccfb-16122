// WebGPU 主渲染器: 天空散射背景 + 场景网格, 支持透视/全景双模式
import type { AirportScheme, Vec3, WeatherPreset } from '../types';
import { mat4Invert, mat4LookAt, mat4Multiply, mat4Perspective, type Mat4 } from './mat4';
import { buildEarthMesh, buildSceneMeshes, buildTowerMarkerMesh, type SceneMesh } from './scene-builder';
import { SCENE_WGSL, SKY_FULLSCREEN_WGSL } from './scene.wgsl';
import { buildTransmittanceLUT, DEFAULT_ATMOSPHERE } from './transmittance-lut';
import { effectiveExtinction } from '../core/atmosphere';

const SKY_UNIFORM_SIZE = 80; // 20 个 float
const CAM_UNIFORM_SIZE = 80; // mat4(64) + vec3 + pad
const WEATHER_UNIFORM_SIZE = 32; // f32 + pad(16) + vec3(16)
const PAN_UNIFORM_SIZE = 112; // mat4(64) + vec3+pad(16) + mode/yaw/pitch/fov/aspect(20) + vec3 pad(12)

export interface CameraState {
  eye: Vec3;
  yaw: number;   // 方位角(弧度, 北=0 顺时针)
  pitch: number; // 俯仰(弧度, 正=抬头)
  fovY: number;  // 弧度
}

interface GpuMesh {
  vertexBuffer: GPUBuffer;
  indexBuffer: GPUBuffer;
  indexCount: number;
}

export class WebGpuRenderer {
  device!: GPUDevice;
  context!: GPUCanvasContext;
  format!: GPUTextureFormat;
  transLUT!: GPUTexture;
  sampler!: GPUSampler;

  private scenePipeline!: GPURenderPipeline;
  private skyPipeline!: GPURenderPipeline;
  private skyUniformBuffer!: GPUBuffer;
  private camUniformBuffer!: GPUBuffer;
  private weatherUniformBuffer!: GPUBuffer;
  private panUniformBuffer!: GPUBuffer;
  private sceneBindGroup!: GPUBindGroup;
  private skyBindGroup!: GPUBindGroup;
  private meshes: GpuMesh[] = [];
  private depthTexture!: GPUTexture;
  private canvas!: HTMLCanvasElement;

  camera: CameraState = {
    eye: { x: 0, y: -800, z: 60 },
    yaw: 0,
    pitch: -0.15,
    fovY: (60 * Math.PI) / 180,
  };
  panoramaMode = false;
  panFov = (110 * Math.PI) / 180; // 全景水平视场
  sunDir: Vec3 = { x: 0, y: 0, z: 1 };
  exposure = 1;
  turbidity = 2.5;
  sunIntensity = 2.2;

  static async create(canvas: HTMLCanvasElement): Promise<WebGpuRenderer> {
    if (!navigator.gpu) throw new Error('当前浏览器不支持 WebGPU, 请使用 Chrome/Edge 113+');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('未找到可用 GPU 适配器');
    const r = new WebGpuRenderer();
    r.canvas = canvas;
    r.device = await adapter.requestDevice();
    // 诊断: 捕获 WebGPU 运行期错误(着色器校验/绑定问题)
    r.device.addEventListener('uncapturederror', ((e: Event) => {
      const err = (e as GPUUncapturedErrorEvent).error;
      // eslint-disable-next-line no-console
      console.error('[WebGPU error]', err.message);
      (window as unknown as { __gpuErrors?: string[] }).__gpuErrors ??= [];
      (window as unknown as { __gpuErrors?: string[] }).__gpuErrors!.push(err.message);
    }) as EventListener);
    r.context = canvas.getContext('webgpu')!;
    r.format = navigator.gpu.getPreferredCanvasFormat();
    r.context.configure({
      device: r.device,
      format: r.format,
      alphaMode: 'opaque',
      // 交换链纹理需要 CopySrc 才能在截图时 copyTextureToBuffer
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    r.sampler = r.device.createSampler({
      magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    r.transLUT = await buildTransmittanceLUT(r.device, DEFAULT_ATMOSPHERE);
    r.initPipelines();
    r.initBuffers();
    r.resize();
    return r;
  }

  private initPipelines() {
    const sceneModule = this.device.createShaderModule({ code: SCENE_WGSL });
    const skyModule = this.device.createShaderModule({ code: SKY_FULLSCREEN_WGSL });
    void this.checkModule(sceneModule, 'scene');
    void this.checkModule(skyModule, 'sky');

    const sceneLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });
    this.scenePipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [sceneLayout] }),
      vertex: {
        module: sceneModule,
        entryPoint: 'vsMain',
        buffers: [
          {
            arrayStride: 36,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: { module: sceneModule, entryPoint: 'fsMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    const skyLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, texture: {} },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, sampler: {} },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });
    this.skyPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [skyLayout] }),
      vertex: { module: skyModule, entryPoint: 'vsMain' },
      fragment: { module: skyModule, entryPoint: 'fsMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'always',
        format: 'depth24plus',
      },
    });
  }

  private async checkModule(mod: GPUShaderModule, name: string) {
    const info = await mod.getCompilationInfo();
    const errs = info.messages.filter((m) => m.type === 'error');
    if (errs.length > 0) {
      const text = errs.map((m) => `[${name}] ${m.message}`).join('\n');
      // eslint-disable-next-line no-console
      console.error(text);
      (window as unknown as { __gpuErrors?: string[] }).__gpuErrors ??= [];
      (window as unknown as { __gpuErrors?: string[] }).__gpuErrors!.push(text);
    }
  }

  private initBuffers() {
    this.skyUniformBuffer = this.device.createBuffer({ size: SKY_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.camUniformBuffer = this.device.createBuffer({ size: CAM_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.weatherUniformBuffer = this.device.createBuffer({ size: WEATHER_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.panUniformBuffer = this.device.createBuffer({ size: PAN_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.sceneBindGroup = this.device.createBindGroup({
      layout: this.scenePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.camUniformBuffer } },
        { binding: 1, resource: { buffer: this.skyUniformBuffer } },
        { binding: 2, resource: { buffer: this.weatherUniformBuffer } },
        { binding: 3, resource: this.transLUT.createView() },
        { binding: 4, resource: this.sampler },
      ],
    });
    this.skyBindGroup = this.device.createBindGroup({
      layout: this.skyPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.skyUniformBuffer } },
        { binding: 1, resource: this.transLUT.createView() },
        { binding: 2, resource: this.sampler },
        { binding: 3, resource: { buffer: this.panUniformBuffer } },
      ],
    });
  }

  loadScene(scheme: AirportScheme, selectedTowerId?: string) {
    this.meshes.forEach((m) => {
      m.vertexBuffer.destroy();
      m.indexBuffer.destroy();
    });
    this.meshes = [];
    const { ground, buildings, aircraft } = buildSceneMeshes(scheme);
    this.uploadMesh(buildEarthMesh());
    this.uploadMesh(ground);
    this.uploadMesh(buildings);
    this.uploadMesh(aircraft);
    const tower = scheme.towers.find((t) => t.id === selectedTowerId) ?? scheme.towers[0];
    if (tower) {
      this.uploadMesh(buildTowerMarkerMesh(tower.pos, tower.floorElev));
    }
  }

  private uploadMesh(mesh: SceneMesh) {
    const vertexData = new Float32Array(mesh.positions.length + mesh.normals.length + mesh.colors.length);
    const vCount = mesh.positions.length / 3;
    for (let i = 0; i < vCount; i++) {
      vertexData.set(mesh.positions.slice(i * 3, i * 3 + 3), i * 9);
      vertexData.set(mesh.normals.slice(i * 3, i * 3 + 3), i * 9 + 3);
      vertexData.set(mesh.colors.slice(i * 3, i * 3 + 3), i * 9 + 6);
    }
    const vertexBuffer = this.device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(vertexBuffer, 0, vertexData);
    const indexBuffer = this.device.createBuffer({
      size: mesh.indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(indexBuffer, 0, new Uint32Array(mesh.indices));
    this.meshes.push({ vertexBuffer, indexBuffer, indexCount: mesh.indices.length });
  }

  setWeather(w: WeatherPreset) {
    const extinction = effectiveExtinction(w);
    // 雾色: 随霾浓度偏向暖灰, 晴好时冷蓝灰
    const haze = w.haze;
    const fog: [number, number, number] = [
      0.32 + haze * 0.12,
      0.36 + haze * 0.08,
      0.42 - haze * 0.05,
    ];
    const data = new Float32Array([extinction, fog[0], fog[1], fog[2]]);
    this.device.queue.writeBuffer(this.weatherUniformBuffer, 0, data);
  }

  setSun(dir: Vec3, exposure: number, turbidity: number) {
    this.sunDir = dir;
    this.exposure = exposure;
    this.turbidity = turbidity;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 容器未布局时给兜底尺寸, 避免 1x1 纹理
    const cw = Math.max(this.canvas.clientWidth, 640);
    const ch = Math.max(this.canvas.clientHeight, 360);
    const w = Math.max(1, Math.floor(cw * dpr));
    const h = Math.max(1, Math.floor(ch * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (this.depthTexture) this.depthTexture.destroy();
    this.depthTexture = this.device.createTexture({
      size: { width: w, height: h },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  /** 相机看向机场目标点(透视模式) */
  lookAt(target: Vec3, distance = 900) {
    const yaw = this.camera.yaw;
    const pitch = this.camera.pitch;
    const cp = Math.cos(pitch);
    this.camera.eye = {
      x: target.x - Math.sin(yaw) * cp * distance,
      y: target.y - Math.cos(yaw) * cp * distance,
      z: target.z - Math.sin(pitch) * distance,
    };
  }

  /** 把眼位放到塔台管制员位置(全景/透视共用) */
  setEyeAtTower(eye: Vec3) {
    this.camera.eye = { ...eye };
  }

  private writeSkyUniforms() {
    const a = DEFAULT_ATMOSPHERE;
    const data = new Float32Array(20);
    data.set([this.sunDir.x, this.sunDir.y, this.sunDir.z, 0], 0);
    data.set([this.camera.eye.x, this.camera.eye.y, this.camera.eye.z, this.turbidity], 4);
    data.set([a.rayleighBeta[0], a.rayleighBeta[1], a.rayleighBeta[2], a.mieBeta], 8);
    data.set([a.earthRadius, a.atmosphereRadius, this.exposure, this.sunIntensity], 12);
    data.set([0, 0], 16);
    this.device.queue.writeBuffer(this.skyUniformBuffer, 0, data);
  }

  private buildViewProj(): { vp: Mat4; inv: Mat4 } {
    const { eye, yaw, pitch, fovY } = this.camera;
    // 前向: yaw 北0顺时针, pitch 正抬头
    const cp = Math.cos(pitch);
    const fwd: Vec3 = { x: Math.sin(yaw) * cp, y: Math.cos(yaw) * cp, z: Math.sin(pitch) };
    const target = { x: eye.x + fwd.x, y: eye.y + fwd.y, z: eye.z + fwd.z };
    const view = mat4LookAt(eye, target);
    const aspect = this.canvas.width / this.canvas.height;
    const proj = mat4Perspective(fovY, aspect, 0.5, 40000);
    const vp = mat4Multiply(proj, view);
    return { vp, inv: mat4Invert(vp) };
  }

  private writeCameraAndPan(vp: Mat4, inv: Mat4) {
    const cam = new Float32Array(20);
    cam.set(vp, 0);
    cam.set([this.camera.eye.x, this.camera.eye.y, this.camera.eye.z, 0], 16);
    this.device.queue.writeBuffer(this.camUniformBuffer, 0, cam);

    const pan = new Float32Array(24);
    pan.set(inv, 0);
    pan.set([this.camera.eye.x, this.camera.eye.y, this.camera.eye.z], 16);
    pan[19] = this.panoramaMode ? 1 : 0;
    pan[20] = this.camera.yaw;
    pan[21] = this.camera.pitch;
    pan[22] = this.panFov;
    pan[23] = this.canvas.width / this.canvas.height;
    this.device.queue.writeBuffer(this.panUniformBuffer, 0, pan);
  }

  private captureResolve: ((url: string) => void) | null = null;

  /** 请求下一帧渲染完成后截图(由持续 RAF 循环保证纹理在同一帧有效) */
  requestCapture(): Promise<string> {
    return new Promise((resolve) => {
      this.captureResolve = resolve;
    });
  }

  render() {
    this.resize();
    this.writeSkyUniforms();
    const { vp, inv } = this.buildViewProj();
    this.writeCameraAndPan(vp, inv);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.5, g: 0.6, b: 0.8, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // 1. 天空背景(深度 always, 最先画)
    pass.setPipeline(this.skyPipeline);
    pass.setBindGroup(0, this.skyBindGroup);
    pass.draw(3);

    // 2. 场景网格(深度测试)
    pass.setPipeline(this.scenePipeline);
    pass.setBindGroup(0, this.sceneBindGroup);
    for (const m of this.meshes) {
      pass.setVertexBuffer(0, m.vertexBuffer);
      pass.setIndexBuffer(m.indexBuffer, 'uint32');
      pass.drawIndexed(m.indexCount);
    }
    pass.end();

    // 截图请求: 在同一 encoder、同一帧纹理上复制, 避免跨帧失效
    if (this.captureResolve) {
      const canvas = this.canvas;
      const bytesPerRow = Math.ceil((canvas.width * 4) / 256) * 256;
      const captureBuffer = this.device.createBuffer({
        size: bytesPerRow * canvas.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      encoder.copyTextureToBuffer(
        { texture: this.context.getCurrentTexture() },
        { buffer: captureBuffer, bytesPerRow, rowsPerImage: canvas.height },
        { width: canvas.width, height: canvas.height },
      );
      this.device.queue.submit([encoder.finish()]);
      const resolve = this.captureResolve;
      this.captureResolve = null;
      void this.readCaptureBuffer(captureBuffer, canvas.width, canvas.height, bytesPerRow).then(resolve);
      return;
    }
    this.device.queue.submit([encoder.finish()]);
  }

  private async readCaptureBuffer(
    buffer: GPUBuffer, width: number, height: number, bytesPerRow: number,
  ): Promise<string> {
    await buffer.mapAsync(GPUMapMode.READ);
    const copy = new Uint8ClampedArray(buffer.getMappedRange());
    const imageData = new ImageData(width, height);
    for (let y = 0; y < height; y++) {
      const src = copy.subarray(y * bytesPerRow, y * bytesPerRow + width * 4);
      imageData.data.set(src, y * width * 4);
    }
    const full = document.createElement('canvas');
    full.width = width;
    full.height = height;
    full.getContext('2d')!.putImageData(imageData, 0, 0);
    const thumb = document.createElement('canvas');
    thumb.width = 480;
    thumb.height = Math.round((height / width) * 480);
    thumb.getContext('2d')!.drawImage(full, 0, 0, thumb.width, thumb.height);
    buffer.unmap();
    buffer.destroy();
    return thumb.toDataURL('image/jpeg', 0.82);
  }

  /** 诊断: 读回透射率 LUT 的几个代表点 */
  async debugReadLUT(): Promise<Record<string, number[]>> {
    const W = 256, H = 64;
    const bytesPerRow = Math.ceil((W * 4 * 2) / 256) * 256;
    const buffer = this.device.createBuffer({
      size: bytesPerRow * H,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer(
      { texture: this.transLUT },
      { buffer, bytesPerRow, rowsPerImage: H },
      { width: W, height: H },
    );
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = buffer.getMappedRange();
    const u16 = new Uint16Array(mapped);
    const halfToFloat = (h: number): number => {
      const s = (h & 0x8000) ? -1 : 1;
      const e = (h >> 10) & 0x1f;
      const f = h & 0x3ff;
      if (e === 0) return s * (f / 1024) * Math.pow(2, -14);
      if (e === 31) return f ? NaN : s * Infinity;
      return s * (1 + f / 1024) * Math.pow(2, e - 15);
    };
    const probe = (u: number, v: number) => {
      const x = Math.min(W - 1, Math.floor(u * W));
      const y = Math.min(H - 1, Math.floor(v * H));
      const halfIdx = y * (bytesPerRow / 2) + x * 4;
      return [0, 1, 2].map((k) => halfToFloat(u16[halfIdx + k]));
    };
    const out = {
      zenith_sealevel: probe(0, 0),
      sun45_sealevel: probe(0.5, 0),
      horizon_sealevel: probe(0.99, 0),
      zenith_top: probe(0, 0.99),
    };
    buffer.unmap();
    buffer.destroy();
    return out;
  }

  async captureDataUrl(): Promise<string> {
    return this.requestCapture();
  }
}
