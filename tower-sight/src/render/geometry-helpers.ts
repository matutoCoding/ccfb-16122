// 渲染层几何辅助,复用 core 实现
export {
  extrudePolygon, polygonToFlatMesh, stripToPolygon, triangulate,
  rectPolygon, bboxOf,
} from '../core/geometry';
export type { MeshData } from '../core/geometry';
