import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("inventory_world_assets", ROOT / "tools" / "inventory_world_assets.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WorldAssetInventoryTest(unittest.TestCase):
    def test_inventory_is_current_and_records_both_file_and_geometry_sizes(self):
        actual = module.inventory()
        saved = json.loads(module.OUTPUT.read_text(encoding="utf-8"))
        self.assertEqual(actual, saved)
        boat = next(item for item in actual["resources"] if item["url"].endswith("/boats/laser47.glb"))
        self.assertGreater(boat["referenced_accessor_bytes"], 0)
        self.assertGreater(boat["file_bytes"], 0)
        crate = next(item for item in actual["resources"] if item["url"].endswith("/props/crate.glb"))
        self.assertIn("Textures/colormap.png", crate["external_uris"])

    def test_rejects_bad_glb(self):
        with self.assertRaises(ValueError):
            module.inspect_glb(b"invalid")


if __name__ == "__main__":
    unittest.main()
