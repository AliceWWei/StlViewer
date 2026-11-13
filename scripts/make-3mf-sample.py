"""生成示例文件：
- public/samples/bracket.3mf：竖着放的 L 形支架（单位声明为厘米），顶部横臂下面是悬垂
- public/samples/gear-inch.stl：把 gear.stl 缩小 25.4 倍，模拟“用英寸导出”的 STL
运行：python3 scripts/make-3mf-sample.py
"""
import struct, zipfile

# L 形截面（x, z），单位 mm，沿 y 方向挤出 20 mm
P = [(0, 0), (5, 0), (5, 35), (30, 35), (30, 40), (0, 40)]
CAP = [(0, 1, 2), (0, 2, 5), (2, 3, 4), (2, 4, 5)]
D = 20
verts = [(x, 0, z) for x, z in P] + [(x, D, z) for x, z in P]
n = len(P)
tris = []
for a, b, c in CAP:
    tris.append((a, c, b))  # y = 0 这一面，法线朝 -y
    tris.append((a + n, b + n, c + n))  # y = D 这一面，法线朝 +y
for i in range(n):
    j = (i + 1) % n
    tris.append((i, j, j + n))
    tris.append((i, j + n, i + n))

def signed_volume():
    s = 0
    for a, b, c in tris:
        (ax, ay, az), (bx, by, bz), (cx, cy, cz) = verts[a], verts[b], verts[c]
        s += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
    return s / 6

if signed_volume() < 0:
    tris = [(a, c, b) for a, b, c in tris]
print("bracket volume mm3:", signed_volume())

# 3MF 里用厘米：坐标除以 10
vxml = "\n".join(f'<vertex x="{x/10:g}" y="{y/10:g}" z="{z/10:g}"/>' for x, y, z in verts)
txml = "\n".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in tris)
model = f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="centimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">L bracket sample</metadata>
<resources>
<object id="1" type="model"><mesh>
<vertices>
{vxml}
</vertices>
<triangles>
{txml}
</triangles>
</mesh></object>
</resources>
<build><item objectid="1"/></build>
</model>
'''
content_types = '''<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
'''
rels = '''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
'''
with zipfile.ZipFile("public/samples/bracket.3mf", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types)
    z.writestr("_rels/.rels", rels)
    z.writestr("3D/3dmodel.model", model)

# gear-inch.stl
data = bytearray(open("public/samples/gear.stl", "rb").read())
count = struct.unpack_from("<I", data, 80)[0]
for t in range(count):
    off = 84 + t * 50 + 12  # 跳过法线
    vals = struct.unpack_from("<9f", data, off)
    struct.pack_into("<9f", data, off, *(v / 25.4 for v in vals))
open("public/samples/gear-inch.stl", "wb").write(data)
print("done")
