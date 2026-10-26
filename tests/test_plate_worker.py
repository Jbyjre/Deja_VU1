import json
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT=Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which('node'),'Node is optional for browser geometry checks')
class GeometryWorker(unittest.TestCase):
    def run_worker(self,data):
        script="const fs=require('fs'),vm=require('vm');const context={self:{postMessage:r=>process.stdout.write(JSON.stringify(r))}};vm.createContext(context);vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),context);const data=JSON.parse(fs.readFileSync(0,'utf8'));if(data.mesh)data.mesh=new Float32Array(data.mesh);if(data.meshes)data.meshes=data.meshes.map(x=>new Float32Array(x));context.self.onmessage({data});"
        result=subprocess.run(['node','-e',script,str(ROOT/'frontend/plate-worker.js')],input=json.dumps(dict(id=1,**data)),capture_output=True,text=True,timeout=15,check=True)
        return json.loads(result.stdout)

    def cube(self,size=1,offset=0):
        v=[(x*size+offset,y*size+offset,z*size+offset) for x,y,z in [(0,0,0),(1,0,0),(1,1,0),(0,1,0),(0,0,1),(1,0,1),(1,1,1),(0,1,1)]]
        faces=[(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
        return [c for tri in faces for i in tri for c in v[i]]

    def test_intersecting_closed_meshes(self):
        result=self.run_worker({'type':'contact','meshes':[self.cube(),self.cube(offset=.5)]})
        self.assertEqual(result['pairs'],[[0,1]])

    def test_enclosed_meshes_without_surface_crossing(self):
        result=self.run_worker({'type':'contact','meshes':[self.cube(4),self.cube(offset=1)]})
        self.assertEqual(result['pairs'],[[0,1]])

    def test_coplanar_triangles_with_overlapping_boxes_are_separate(self):
        a = [0, 0, 0, 4, 0, 0, 0, 4, 0]
        b = [3, 3, 0, 5, 3, 0, 3, 5, 0]
        self.assertEqual(self.run_worker({'type':'contact','meshes':[a,b]})['pairs'],[])

    def test_ray_picks_actual_surface(self):
        result=self.run_worker({'type':'pick','mesh':self.cube(),'ray':{'origin':[.5,.5,3],'direction':[0,0,-1]}})
        self.assertEqual(result['point'],[.5,.5,1])

    def test_missed_ray_returns_no_point(self):
        result=self.run_worker({'type':'pick','mesh':self.cube(),'ray':{'origin':[5,5,3],'direction':[0,0,-1]}})
        self.assertIsNone(result['point'])
