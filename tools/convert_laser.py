"""Convert the supplied Laser OBJ into a compact GLB with separate named assemblies."""
import argparse
import json
import math
import struct
import zipfile
from pathlib import Path

NAMES = ["hull", "centreboard", "sail", "mast", "mast", "boom", "boom", "rudder", "hull", "hull", "hull", "rudder", "rudder", "rudder", "rudder", "rudder", "rudder", "rudder", "hull", "hull", "hull", "hull", "rudder", "boom"]
SCALE = 4.23 / (32.7 + 35.8)

def convert(source: Path, output: Path):
    vertices, normals, groups = [], [], []
    with zipfile.ZipFile(source) as archive, archive.open("Laser 4.7.obj") as obj:
        for line in obj:
            fields = line.decode("utf-8", "replace").split()
            if not fields:
                continue
            if fields[0] == "v":
                x, y, z = map(float, fields[1:4])
                vertices.append(((x - 5.7134) * SCALE, (y - 12.3) * SCALE, (z + 1.55) * SCALE))
            elif fields[0] == "vn":
                normals.append(tuple(map(float, fields[1:4])))
            elif fields[0] == "usemtl":
                groups.append({"map": {}, "positions": [], "normals": [], "indices": []})
            elif fields[0] == "f":
                group = groups[-1]
                indices = []
                for entry in fields[1:]:
                    segments = entry.split("/")
                    vi, ni = int(segments[0]) - 1, int(segments[2]) - 1
                    pair = (vi, ni)
                    if pair not in group["map"]:
                        group["map"][pair] = len(group["positions"])
                        group["positions"].append(vertices[vi])
                        group["normals"].append(normals[ni])
                    indices.append(group["map"][pair])
                for index in range(1, len(indices) - 1):
                    group["indices"].extend((indices[0], indices[index], indices[index + 1]))
    if len(groups) != len(NAMES):
        raise ValueError(f"Unexpected OBJ structure: {len(groups)} parts")
    binary = bytearray()
    views, accessors, meshes, nodes = [], [], [], []
    def append(values, fmt, target, kind, component, bounds=False):
        while len(binary) % 4: binary.append(0)
        start = len(binary)
        for row in values:
            binary.extend(struct.pack(fmt, *(row if isinstance(row, tuple) else (row,))))
        view = len(views); views.append({"buffer":0,"byteOffset":start,"byteLength":len(binary)-start,"target":target})
        accessor = {"bufferView":view,"componentType":component,"count":len(values),"type":kind}
        if bounds:
            accessor["min"] = [min(row[i] for row in values) for i in range(3)]
            accessor["max"] = [max(row[i] for row in values) for i in range(3)]
        accessors.append(accessor)
        return len(accessors)-1
    for i, group in enumerate(groups):
        pos = append(group["positions"], "<3f", 34962, "VEC3", 5126, True)
        normal = append(group["normals"], "<3f", 34962, "VEC3", 5126)
        indices = append(group["indices"], "<I", 34963, "SCALAR", 5125)
        name = f"{NAMES[i]}_{i:02d}"
        meshes.append({"name":name,"primitives":[{"attributes":{"POSITION":pos,"NORMAL":normal},"indices":indices,"material":0}]})
        nodes.append({"name":name,"mesh":i})
    while len(binary)%4: binary.append(0)
    gltf = {"asset":{"version":"2.0","generator":"Sail Academy OBJ converter"},"scene":0,"scenes":[{"nodes":list(range(len(nodes)))}],"nodes":nodes,"meshes":meshes,"materials":[{"name":"neutral","doubleSided":True,"pbrMetallicRoughness":{"baseColorFactor":[0.9,0.9,0.85,1],"metallicFactor":0,"roughnessFactor":0.8}}],"buffers":[{"byteLength":len(binary)}],"bufferViews":views,"accessors":accessors}
    chunk = json.dumps(gltf,separators=(",",":")).encode()
    chunk += b" " * ((-len(chunk)) % 4)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_bytes(struct.pack("<4sII",b"glTF",2,12+8+len(chunk)+8+len(binary))+struct.pack("<I4s",len(chunk),b"JSON")+chunk+struct.pack("<I4s",len(binary),b"BIN\0")+binary)
    print(f"{len(groups)} assemblies; {len(binary):,} bytes geometry; {output}")

if __name__ == "__main__":
    parser=argparse.ArgumentParser(); parser.add_argument("source",type=Path); parser.add_argument("output",type=Path); args=parser.parse_args(); convert(args.source,args.output)
