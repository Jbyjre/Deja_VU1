"""
Tests for model_inbox.py and its route: the Downloads watcher (only new model files, only read, only this computer),
zips unpacked safely, pasted links (public addresses only, size and kind checked) and the credit a model keeps.

    python3 -m unittest tests.test_model_inbox
"""

import io
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from http.server import HTTPServer
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import app as dv_app       # noqa: E402
import file_library        # noqa: E402
import model_inbox         # noqa: E402
from frontend_parts import read_frontend  # noqa: E402

MODEL = ('<?xml version="1.0"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
         '<metadata name="Title">Little boat</metadata><metadata name="Designer">Ann Maker</metadata>'
         '<metadata name="License">CC BY 4.0</metadata><resources/><build/></model>')
STL = b"solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a\n"


def three_mf(model=MODEL):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("3D/3dmodel.model", model)
    return buf.getvalue()


class InboxCase(unittest.TestCase):

    def setUp(self):
        self.folder = tempfile.mkdtemp()
        self.made = []
        if os.path.exists(model_inbox._SETTINGS):
            os.remove(model_inbox._SETTINGS)

    def tearDown(self):
        shutil.rmtree(self.folder, ignore_errors=True)
        for name in self.made:
            try:
                file_library.delete(name)
            except ValueError:
                pass
        if os.path.exists(model_inbox._SETTINGS):
            os.remove(model_inbox._SETTINGS)

    def drop(self, name, data):
        with open(os.path.join(self.folder, name), "wb") as f:
            f.write(data)

    def offers(self):
        return [o["name"] for o in model_inbox.status()["offers"]]


class TestWatcher(InboxCase):

    def test_off_until_switched_on_and_only_new_files_count(self):
        self.drop("old.stl", STL)
        self.assertEqual(model_inbox.status()["offers"], [])
        self.assertFalse(model_inbox.status()["watch"])
        old = os.path.join(self.folder, "old.stl")
        os.utime(old, (time.time() - 60, time.time() - 60))
        model_inbox.set_watch(True, self.folder)
        self.drop("boat.3mf", three_mf())
        self.drop("notes.txt", b"not a model")
        self.drop("half.3mf.crdownload", b"partial")
        self.assertEqual(self.offers(), ["boat.3mf"])

    def test_taking_copies_it_with_its_credit_and_leaves_the_folder_alone(self):
        model_inbox.set_watch(True, self.folder)
        self.drop("boat.3mf", three_mf())
        before = os.listdir(self.folder)
        done = model_inbox.take("boat.3mf")
        self.made += done["added"]
        self.assertEqual(done["added"], ["boat.3mf"])
        self.assertEqual(os.listdir(self.folder), before)
        source = file_library.describe("boat.3mf")["source"]
        self.assertEqual((source["designer"], source["title"], source["licence"]), ("Ann Maker", "Little boat", "CC BY 4.0"))
        self.assertEqual(file_library.describe("boat.3mf")["origin"], "download")
        self.assertEqual(self.offers(), [])

    def test_not_this_one_stops_offering_it(self):
        model_inbox.set_watch(True, self.folder)
        self.drop("a.stl", STL)
        model_inbox.dismiss("a.stl")
        self.assertEqual(self.offers(), [])

    def test_only_names_in_the_folder_can_be_taken(self):
        model_inbox.set_watch(True, self.folder)
        for bad in ("../secret.stl", os.path.join(self.folder, "a.stl"), "nothing.stl"):
            with self.assertRaises(ValueError):
                model_inbox.take(bad)

    def test_a_zip_is_unpacked_safely(self):
        model_inbox.set_watch(True, self.folder)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("pack/part one.stl", STL)
            z.writestr("__MACOSX/pack/._part one.stl", b"junk")
            z.writestr("readme.txt", b"hello")
            z.writestr("../../escape.stl", STL)
        self.drop("pack.zip", buf.getvalue())
        added = model_inbox.take("pack.zip")["added"]
        self.made += added
        self.assertEqual(len(added), 2)
        self.assertTrue(all(name.endswith(".stl") and "/" not in name for name in added))
        for name in added:
            self.assertTrue(os.path.isfile(os.path.join(file_library.FILES_DIR, name)))
            self.assertEqual(file_library.describe(name)["source"]["archive"], "pack.zip")

    def test_a_folder_that_does_not_exist_is_refused(self):
        with self.assertRaises(ValueError):
            model_inbox.set_watch(True, os.path.join(self.folder, "missing"))

    def test_another_device_sees_no_folder_or_file_names(self):
        model_inbox.set_watch(True, self.folder)
        self.drop("boat.3mf", three_mf())
        away = model_inbox.status(here=False)
        self.assertTrue(away["watch"])
        self.assertEqual((away["folder"], away["default_folder"], away["offers"], away["here"]), (None, None, [], False))
        self.assertEqual(self.offers(), ["boat.3mf"])

    def test_a_plain_upload_under_the_same_name_drops_the_old_credit(self):
        model_inbox.set_watch(True, self.folder)
        self.drop("boat.3mf", three_mf())
        self.made += model_inbox.take("boat.3mf")["added"]
        file_library.save("boat.3mf", three_mf(), origin="upload")
        self.assertNotIn("source", file_library.describe("boat.3mf"))


class TestOrigin(InboxCase):

    def test_the_page_linux_recorded_with_a_download_is_read(self):
        path = os.path.join(self.folder, "boat.stl")
        with open(path, "wb") as f:
            f.write(STL)
        try:
            os.setxattr(path, "user.xdg.origin.url", b"https://www.printables.com/model/1234-boat")
        except (AttributeError, OSError):
            self.skipTest("this file system keeps no extended attributes")
        self.assertEqual(model_inbox.download_origin(path),
                         {"site": "printables.com", "page": "https://www.printables.com/model/1234-boat",
                          "how": "Downloads"})

    def test_a_page_that_is_not_a_web_address_is_ignored(self):
        path = os.path.join(self.folder, "boat.stl")
        with open(path, "wb") as f:
            f.write(STL)
        try:
            os.setxattr(path, "user.xdg.origin.url", b"javascript:alert(1)")
        except (AttributeError, OSError):
            self.skipTest("this file system keeps no extended attributes")
        self.assertEqual(model_inbox.download_origin(path), {"how": "Downloads"})


class _Reply:
    def __init__(self, status, body=b"", headers=None):
        self.status, self.reason, self._body, self._headers = status, "OK", body, headers or {}

    def getheader(self, name):
        return self._headers.get(name)

    def read(self, n=-1):
        return self._body if n < 0 else self._body[:n]


class _Conn:
    def close(self):
        pass


class TestLinks(InboxCase):

    def test_private_and_plain_addresses_are_refused(self):
        for url in ("http://example.com/a.stl", "https://localhost/a.stl", "https://127.0.0.1/a.stl",
                    "https://192.168.1.20/a.3mf", "https://[::1]/a.stl", "https://user:pw@example.com/a.stl"):
            with self.assertRaises(ValueError, msg=url):
                model_inbox.fetch_link(url)

    def test_a_redirect_to_a_private_address_is_refused(self):
        real_open = model_inbox._open

        def fake_open(url):
            if url.startswith("https://models.example/"):
                return _Conn(), _Reply(302, headers={"Location": "https://10.0.0.1/a.stl"})
            return real_open(url)          # the real check refuses the private address
        with mock.patch.object(model_inbox, "_open", side_effect=fake_open):
            with self.assertRaises(ValueError) as caught:
                model_inbox.fetch_link("https://models.example/a.stl")
        self.assertIn("your own network", str(caught.exception))

    def test_a_model_link_comes_in_with_its_page(self):
        reply = _Reply(200, three_mf(), {"Content-Disposition": 'attachment; filename="boat.3mf"'})
        with mock.patch.object(model_inbox, "_open", return_value=(_Conn(), reply)):
            added = model_inbox.fetch_link("https://www.models.example/get/123")["added"]
        self.made += added
        source = file_library.describe("boat.3mf")["source"]
        self.assertEqual(source["site"], "models.example")
        self.assertEqual(source["page"], "https://www.models.example/get/123")
        self.assertEqual(source["designer"], "Ann Maker")

    def test_a_web_page_or_a_huge_file_is_refused_in_words(self):
        page = _Reply(200, b"<!DOCTYPE html><html></html>")
        with mock.patch.object(model_inbox, "_open", return_value=(_Conn(), page)):
            with self.assertRaises(ValueError) as caught:
                model_inbox.fetch_link("https://models.example/thing/5")
        self.assertIn("download button", str(caught.exception))
        huge = _Reply(200, b"x", {"Content-Length": str(model_inbox.MAX_BYTES + 1)})
        with mock.patch.object(model_inbox, "_open", return_value=(_Conn(), huge)):
            with self.assertRaises(ValueError):
                model_inbox.fetch_link("https://models.example/a.stl")

    def test_redirect_loops_stop(self):
        loop = _Reply(302, headers={"Location": "/again"})
        with mock.patch.object(model_inbox, "_open", return_value=(_Conn(), loop)):
            with self.assertRaises(ValueError) as caught:
                model_inbox.fetch_link("https://models.example/a.stl")
        self.assertIn("five times", str(caught.exception))


class TestRoute(InboxCase):

    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), dv_app.DejaVuHandler)
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)

    def send(self, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        request = Request(self.base + path, data=data, headers={"Content-Type": "application/json"},
                          method="GET" if payload is None else "POST")
        try:
            with urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except HTTPError as err:
            return err.code, json.loads(err.read())

    def test_watch_and_take_through_the_route(self):
        status, body = self.send("/api/models/inbox", {"action": "watch", "on": True, "folder": self.folder})
        self.assertEqual(status, 200, body)
        self.drop("clip.stl", STL)
        status, body = self.send("/api/models/inbox")
        self.assertEqual([o["name"] for o in body["offers"]], ["clip.stl"])
        status, body = self.send("/api/models/inbox", {"action": "take", "name": "clip.stl"})
        self.assertEqual(status, 200, body)
        self.made += body["added"]

    def test_a_private_link_is_a_400_in_words(self):
        status, body = self.send("/api/models/inbox", {"action": "link", "url": "https://127.0.0.1/a.stl"})
        self.assertEqual(status, 400)
        self.assertIn("public", body["error"])


class TestPage(unittest.TestCase):

    def test_search_links_open_in_a_new_tab_without_an_opener(self):
        js = read_frontend("models.js")
        self.assertIn("noopener", js)
        self.assertIn("esc(href)", js)


if __name__ == "__main__":
    unittest.main()
