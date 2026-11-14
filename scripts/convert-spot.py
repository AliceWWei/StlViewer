"""
把 Keenan Crane 的 Spot（CC0，三角化的 OBJ）转换成打印用的二进制 STL：
- OBJ 是 Y 轴朝上，3D 打印习惯 Z 轴朝上，所以绕 X 轴转 90°：(x, y, z) -> (x, -z, y)
- 原始模型大约 1.7 个单位高，放大 35 倍，大约 60 mm 高
- 把最低点放到 z = 0

用法：python3 scripts/convert-spot.py spot.obj public/samples/spot.stl
"""
import struct
import sys

SCALE = 35.0

src, dst = sys.argv[1], sys.argv[2]
verts, faces = [], []
for line in open(src):
    parts = line.split()
    if not parts:
        continue
    if parts[0] == 'v':
        x, y, z = map(float, parts[1:4])
        verts.append((x * SCALE, -z * SCALE, y * SCALE))
    elif parts[0] == 'f':
        idx = [int(p.split('/')[0]) - 1 for p in parts[1:]]
        for i in range(1, len(idx) - 1):  # 多边形按扇形拆成三角形
            faces.append((idx[0], idx[i], idx[i + 1]))

zmin = min(v[2] for v in verts)
verts = [(x, y, z - zmin) for x, y, z in verts]

with open(dst, 'wb') as f:
    f.write(b'Spot by Keenan Crane, CC0 1.0. Converted to Z-up mm'.ljust(80, b' '))
    f.write(struct.pack('<I', len(faces)))
    for a, b, c in faces:
        pa, pb, pc = verts[a], verts[b], verts[c]
        u = [pb[i] - pa[i] for i in range(3)]
        w = [pc[i] - pa[i] for i in range(3)]
        n = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        length = sum(k * k for k in n) ** 0.5 or 1.0
        f.write(struct.pack('<3f', *(k / length for k in n)))
        for p in (pa, pb, pc):
            f.write(struct.pack('<3f', *p))
        f.write(b'\0\0')
print(f'{len(faces)} triangles -> {dst}')
