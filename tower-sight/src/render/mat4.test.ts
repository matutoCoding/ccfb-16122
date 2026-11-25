import { describe, it, expect } from 'vitest';
import { mat4LookAt, mat4Perspective, mat4Multiply, mat4Invert } from './mat4';

const D = Math.PI / 180;

describe('mat4Invert / view-projection', () => {
  it('inverts identity and translation', () => {
    const id = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const inv = mat4Invert(id);
    for (let i = 0; i < 16; i++) expect(inv[i]).toBeCloseTo(id[i], 5);

    const t = id.slice();
    t[12] = 7; t[13] = -3; t[14] = 2;
    const invT = mat4Invert(t);
    expect(invT[12]).toBeCloseTo(-7, 4);
    expect(invT[13]).toBeCloseTo(3, 4);
    expect(invT[14]).toBeCloseTo(-2, 4);
  });

  it('reconstructs the exact forward view ray from inverse VP (regression: out[11] typo)', () => {
    const eye = { x: -120, y: -250, z: 33.2 };
    const yaw = 112.1 * D;
    const pitch = 27 * D;
    const cp = Math.cos(pitch);
    const fwd = { x: Math.sin(yaw) * cp, y: Math.cos(yaw) * cp, z: Math.sin(pitch) };
    const target = { x: eye.x + fwd.x, y: eye.y + fwd.y, z: eye.z + fwd.z };
    const view = mat4LookAt(eye, target);
    const proj = mat4Perspective(60 * D, 894 / 544, 0.5, 40000);
    const vp = mat4Multiply(proj, view);
    const inv = mat4Invert(vp);

    // unproject clip-space center on the far plane
    const x = 0, y = 0, z = 1;
    const wx = inv[0] * x + inv[4] * y + inv[8] * z + inv[12];
    const wy = inv[1] * x + inv[5] * y + inv[9] * z + inv[13];
    const wz = inv[2] * x + inv[6] * y + inv[10] * z + inv[14];
    const w = inv[3] * x + inv[7] * y + inv[11] * z + inv[15];
    const p = { x: wx / w, y: wy / w, z: wz / w };
    const dir = [p.x - eye.x, p.y - eye.y, p.z - eye.z];
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    expect(dir[0] / l).toBeCloseTo(fwd.x, 2);
    expect(dir[1] / l).toBeCloseTo(fwd.y, 2);
    expect(dir[2] / l).toBeCloseTo(fwd.z, 2);
  });
});
