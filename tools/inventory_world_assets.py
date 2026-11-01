"""Inventory world asset files and GLB payloads; not a runtime memory budget."""
from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "client" / "public" / "assets" / "glb"
OUTPUT = ROOT / "shared" / "world" / "asset-inventory.json"


def inspect_glb(data: bytes) -> dict:
    if len(data) < 20:
        raise ValueError("Truncated GLB")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("Invalid GLB header")
    json_size, chunk_type = struct.unpack_from("<I4s", data, 12)
    if chunk_type != b"JSON" or 20 + json_size > len(data):
        raise ValueError("Invalid GLB JSON chunk")
    document = json.loads(data[20:20 + json_size])
    component_bytes = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
    components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}
    referenced = set()
    for mesh in document.get("meshes", []):
        for primitive in mesh.get("primitives", []):
            referenced.update(primitive.get("attributes", {}).values())
            if "indices" in primitive:
                referenced.add(primitive["indices"])
            for target in primitive.get("targets", []):
                referenced.update(target.values())
    accessors = document.get("accessors", [])
    decoded = sum(accessors[i]["count"] * component_bytes[accessors[i]["componentType"]] * components[accessors[i]["type"]] for i in referenced)
    return {
        "mesh_count": len(document.get("meshes", [])),
        "referenced_accessor_bytes": decoded,
        "external_uris": sorted({image["uri"] for image in document.get("images", []) if "uri" in image and not image["uri"].startswith("data:")}),
    }


def inventory() -> dict:
    resources = []
    for path in sorted(ASSETS.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".glb", ".png", ".jpg", ".jpeg", ".webp", ".ktx2"}:
            continue
        data = path.read_bytes()
        item = {"url": "/assets/glb/" + path.relative_to(ASSETS).as_posix(), "file_bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        if path.suffix.lower() == ".glb":
            item.update(inspect_glb(data))
            for uri in item["external_uris"]:
                dependency = (path.parent / uri).resolve()
                if not dependency.is_relative_to(ASSETS.resolve()) or not dependency.is_file():
                    raise ValueError(f"Missing or unsafe external resource {uri!r} in {path}")
        resources.append(item)
    return {
        "version": 1,
        "kind": "asset_inventory_not_runtime_budget",
        "file_bytes_total": sum(item["file_bytes"] for item in resources),
        "limitations": ["Includes all GLB-directory resources, including assets not instantiated in the hub.", "Excludes procedural meshes and dynamic textures.", "Accessor byte counts exclude alignment, GPU allocation, texture decoding and runtime copies.", "Not a chunk manifest or proof of the 10-percent requirement."],
        "resources": resources,
    }


if __name__ == "__main__":
    result = inventory()
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Inventoried {len(result['resources'])} files ({result['file_bytes_total']} bytes): {OUTPUT}")
