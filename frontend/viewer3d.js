/* Deja Vu1 - 3D engine shared by the file viewer and the G-code inspector.
 *
 * Plain JavaScript and raw WebGL: no library, no build step.
 *   - parseSTL: binary or ASCII STL
 *   - parse3MF: unzips the 3MF with the browser's own DecompressionStream
 *     ("deflate-raw"), reads 3D/3dmodel.model and follows <component>s into
 *     3D/Objects/*.model parts (how Bambu Studio / Orca-family slicers store
 *     objects), applying every transform - the same rules as the server's
 *     backend/mesh_tools.py
 *   - Viewer: one small renderer for both triangle meshes and G-code
 *     toolpaths (coloured line segments), with the U1's 270 x 270 mm bed,
 *     orbit / zoom by mouse or touch, and a layer limit for scrubbing.
 */
'use strict';

const DV3D = (() => {
  const BED = 270;

  /* ---------------- parsing ---------------- */

  /* The same rules as the server's mesh_tools.py: a binary STL may carry a
   * little padding after its triangles, a cut-short one says so, and a
   * coordinate that isn't a number is refused rather than drawn as NaN. */
  const MAX_TRIANGLES = 2000000;
  const MAX_PART_BYTES = 512 * 1024 * 1024;

  function parseSTL(buffer) {
    const view = new DataView(buffer);
    const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(2048, buffer.byteLength))).toLowerCase();
    const looksAscii = head.startsWith('solid') && head.includes('facet');
    if (buffer.byteLength >= 84 && !looksAscii) {
      const count = view.getUint32(80, true);
      const expected = 84 + count * 50;
      if (expected <= buffer.byteLength && buffer.byteLength <= expected + 1024) {
        if (count > MAX_TRIANGLES) throw new Error(`The model has ${count.toLocaleString()} triangles - too many to show`);
        const pos = new Float32Array(count * 9);
        for (let i = 0; i < count; i++) {
          const base = 84 + i * 50 + 12;
          for (let k = 0; k < 9; k++) pos[i * 9 + k] = view.getFloat32(base + k * 4, true);
        }
        return finishMesh(pos, { objects: 1 });
      }
      if (buffer.byteLength < expected && count < 50000000) {
        throw new Error(`The STL is cut short: it says ${count.toLocaleString()} triangles but holds ${Math.floor((buffer.byteLength - 84) / 50).toLocaleString()}`);
      }
    }
    const text = new TextDecoder().decode(buffer);
    if (!text.includes('facet')) throw new Error('Not a readable STL file');
    const nums = [];
    const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
    let m;
    while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
    if (!nums.length || nums.length % 9) throw new Error('STL has an incomplete triangle');
    if (nums.length / 9 > MAX_TRIANGLES) throw new Error('The model has too many triangles to show');
    return finishMesh(new Float32Array(nums), { objects: 1 });
  }

  function parseOBJ(buffer) {
    const text = new TextDecoder('utf-8', {fatal:true}).decode(buffer), vertices = [], vertexColours=[], pos = [], colours=[];
    for (const line of text.split(/\r?\n/)) {
      const fields = line.split('#')[0].trim().split(/\s+/);
      if (fields[0] === 'v') {
        const v = fields.slice(1,4).map(Number);
        if(v.length!==3 || !v.every(Number.isFinite) || vertices.length>=MAX_TRIANGLES*3) throw new Error('OBJ has invalid or too many vertices');
        vertices.push(v);
        const rgb=fields.slice(4,7).map(Number);
        vertexColours.push(fields.length===7&&rgb.length===3&&rgb.every(n=>Number.isFinite(n)&&n>=0&&n<=1)?rgb:null);
      } else if(fields[0]==='f') {
        if(fields.length!==4)throw new Error('Export OBJ with triangulated faces; polygons are not supported yet');
        for(const f of fields.slice(1)) {
          const raw=f.split('/')[0]; if(!/^-?\d+$/.test(raw))throw new Error('OBJ has an invalid face index');
          const n=Number(raw), i=n>0?n-1:vertices.length+n;
          if(n===0 || !vertices[i])throw new Error('OBJ face refers to a missing vertex');
          pos.push(...vertices[i]);
          colours.push(...(vertexColours[i]||[.5,.5,.5]));
        }
        if(pos.length/9>MAX_TRIANGLES)throw new Error('OBJ has too many triangles');
      }
    }
    if(!pos.length)throw new Error('OBJ has no triangular faces');
    return finishMesh(new Float32Array(pos),{objects:1,colours:vertexColours.some(Boolean)?new Float32Array(colours):null,application:'OBJ',warnings:/^mtllib\s/m.test(text)?['External OBJ material/texture files are not loaded. Vertex colours are preserved; check any missing materials in the source program.']:[]});
  }

  function transformMesh(mesh, scale=1, axis=null) {
    if(!Number.isFinite(scale)||scale<=0||scale>100)throw new Error('Choose a scale greater than zero and at most 10,000%');
    const pos=new Float32Array(mesh.positions.length);
    for(let i=0;i<pos.length;i+=3){
      let [x,y,z]=[mesh.positions[i],mesh.positions[i+1],mesh.positions[i+2]];
      if(axis==='x')[y,z]=[-z,y];
      if(axis==='y')[x,z]=[z,-x];
      if(axis==='z')[x,y]=[-y,x];
      pos.set([x*scale,y*scale,z*scale],i);
    }
    const transformed=finishMesh(pos,{objects:mesh.objects,application:mesh.application,colours:mesh.colours,warnings:mesh.warnings});
    const b=transformed.bounds, delta=[BED/2-(b.min[0]+b.max[0])/2,BED/2-(b.min[1]+b.max[1])/2,-b.min[2]];
    for(let i=0;i<pos.length;i++)pos[i]+=delta[i%3];
    return finishMesh(pos,{objects:mesh.objects,application:mesh.application,colours:mesh.colours,warnings:mesh.warnings});
  }

  function exportSTL(mesh) {
    const buffer=new ArrayBuffer(84+mesh.triangles*50), view=new DataView(buffer);
    view.setUint32(80,mesh.triangles,true);
    for(let t=0;t<mesh.triangles;t++)for(let k=0;k<9;k++)view.setFloat32(84+t*50+12+k*4,mesh.positions[t*9+k],true);
    return buffer;
  }

  async function unzip(buffer, wanted) {
    const view = new DataView(buffer);
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a 3MF file (no zip directory)');
    const entries = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < entries; n++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('Damaged zip directory');
      const method = view.getUint16(ptr + 10, true);
      const csize = view.getUint32(ptr + 20, true);
      const usize = view.getUint32(ptr + 24, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const local = view.getUint32(ptr + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(buffer, ptr + 46, nameLen));
      if (csize === 0xffffffff || local === 0xffffffff) throw new Error('Very large (ZIP64) 3MF files are not supported yet');
      files[name.toLowerCase()] = { name, method, csize, usize, local };
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    const read = async (key,limit=MAX_PART_BYTES) => {
      const f = files[key.replace(/^\//, '').toLowerCase()];
      if (!f) return null;
      if (view.getUint32(f.local, true) !== 0x04034b50) throw new Error(`The 3MF is damaged (${f.name} has no header)`);
      // Checked before unpacking: a small file that unpacks to gigabytes
      // (a "zip bomb") must not fill the tab's memory.
      if (f.usize > limit) throw new Error(`The 3MF's ${f.name} would unpack to ${Math.round(f.usize / 1048576)} MB - refused`);
      const nl = view.getUint16(f.local + 26, true);
      const el = view.getUint16(f.local + 28, true);
      const data = new Uint8Array(buffer, f.local + 30 + nl + el, f.csize);
      if (f.method === 0) return data;
      if (f.method !== 8) throw new Error('Unsupported zip compression');
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip 3MF files');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      let out;
      try {const reader=stream.getReader(),chunks=[];let length=0;while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>f.usize||length>limit){await reader.cancel();throw new Error('Expanded data exceeds its declared size');}chunks.push(value);}out=new Uint8Array(length);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}}
      catch (e) { throw new Error(`The 3MF is damaged - ${f.name} can't be unpacked`); }
      if (out.length > f.usize) throw new Error(`The 3MF's ${f.name} is larger than it says - refused`);
      return out;
    };
    return { read, names: Object.values(files).map(f => f.name) };
  }

  const NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
  const PNS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';

  function matrix(text) {
    if (!text) return null;
    const v = text.trim().split(/\s+/).map(Number);
    return v.length === 12 ? v : null;
  }
  function compose(a, b) {           // apply a, then b (row-vector 4x3)
    if (!a) return b;
    if (!b) return a;
    const out = [];
    for (let r = 0; r < 4; r++) {
      const w = r === 3 ? 1 : 0;
      for (let c = 0; c < 3; c++) {
        out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c] + w * b[9 + c]);
      }
    }
    return out;
  }

  async function parse3MF(buffer) {
    const zip = await unzip(buffer);
    const parts = {};
    const load = async (path) => {
      const key = path.replace(/^\//, '').toLowerCase();
      if (!parts[key]) {
        const bytes = await zip.read(key);
        if (!bytes) throw new Error(`3MF refers to a missing part: ${path}`);
        const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
        // DOMParser doesn't throw on bad XML - it returns a <parsererror> document.
        if (doc.getElementsByTagName('parsererror').length) throw new Error(`The 3MF's ${path} isn't valid XML`);
        parts[key] = doc;
      }
      return parts[key];
    };
    const main = '3D/3dmodel.model';
    const root = await load(main);
    const meta = {};
    for (const m of root.getElementsByTagNameNS(NS, 'metadata')) meta[m.getAttribute('name')] = m.textContent;
    const chunks = [], colourChunks=[], warnings=new Set();
    let palette=[],assigned={};
    try {const config=await zip.read('Metadata/project_settings.config');if(config){const d=JSON.parse(new TextDecoder().decode(config));palette=Array.isArray(d.filament_colour)?d.filament_colour:[];}}catch(_){warnings.add('Project colour settings could not be read.');}
    const settings=await zip.read('Metadata/model_settings.config');
    if(settings){const doc=new DOMParser().parseFromString(new TextDecoder().decode(settings),'application/xml');for(const o of doc.querySelectorAll('config > object')){const m=[...o.children].find(x=>x.localName==='metadata'&&x.getAttribute('key')==='extruder');if(m)assigned[o.getAttribute('id')]=Number(m.getAttribute('value'))-1;}}
    let total = 0;
    const objectsIn = (doc) => {
      const map = {};
      for (const o of doc.getElementsByTagNameNS(NS, 'object')) map[o.getAttribute('id')] = o;
      return map;
    };
    const emit = async (path, id, t, depth, assignedTool=0) => {
      if (depth > 8) throw new Error('3MF components nest too deeply');
      const obj = objectsIn(await load(path))[id];
      if (!obj) throw new Error(`3MF object ${id} is missing`);
      const mesh = obj.getElementsByTagNameNS(NS, 'mesh')[0];
      if (mesh && mesh.parentNode === obj) {
        const vs = mesh.getElementsByTagNameNS(NS, 'vertex');
        const verts = new Float32Array(vs.length * 3);
        for (let i = 0; i < vs.length; i++) {
          let x = +vs[i].getAttribute('x'), y = +vs[i].getAttribute('y'), z = +vs[i].getAttribute('z');
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error('The 3MF has a vertex coordinate that isn\'t a number');
          if (t) {
            const nx = x * t[0] + y * t[3] + z * t[6] + t[9];
            const ny = x * t[1] + y * t[4] + z * t[7] + t[10];
            z = x * t[2] + y * t[5] + z * t[8] + t[11]; x = nx; y = ny;
          }
          verts[i * 3] = x; verts[i * 3 + 1] = y; verts[i * 3 + 2] = z;
        }
        const ts = mesh.getElementsByTagNameNS(NS, 'triangle');
        if (total / 9 + ts.length > MAX_TRIANGLES) throw new Error('The model has too many triangles to show');
        const pos = new Float32Array(ts.length * 9);
        const colors=new Float32Array(pos.length), doc=await load(path), resources={};
        for(const r of [...doc.documentElement.children].find(n=>n.localName==='resources')?.children||[]){
          if(r.localName==='basematerials'||r.localName==='colorgroup')resources[r.getAttribute('id')]=[...r.children].map(n=>n.getAttribute('displaycolor')||n.getAttribute('color'));
          if(r.localName==='texture2d'||r.localName==='texture2dgroup')warnings.add('Texture images are kept in saved 3MF projects; this preview shows material colours only.');
        }
        for (let i = 0; i < ts.length; i++) {
          const a = +ts[i].getAttribute('v1') * 3, b = +ts[i].getAttribute('v2') * 3, c = +ts[i].getAttribute('v3') * 3;
          for (const k of [a, b, c]) {
            if (!Number.isInteger(k) || k < 0 || k + 3 > verts.length) throw new Error(`A 3MF triangle refers to vertex ${k / 3}, which doesn't exist`);
          }
          pos.set(verts.subarray(a, a + 3), i * 9);
          pos.set(verts.subarray(b, b + 3), i * 9 + 3);
          pos.set(verts.subarray(c, c + 3), i * 9 + 6);
          const tri=ts[i],pid=tri.getAttribute('pid')||obj.getAttribute('pid'),props=resources[pid];
          let tool=assignedTool;
          const paint=tri.getAttribute('paint_color')||tri.getAttribute('slic3rpe:mmu_segmentation');
          if(paint){const slot=['4','8','0C','1C'].indexOf(paint);if(slot>=0)tool=slot;else warnings.add('Subdivided painted faces are preserved in the saved source, but this preview approximates their colour.');}
          for(let v=0;v<3;v++){const raw=tri.getAttribute('p'+(v+1))||tri.getAttribute('p1')||obj.getAttribute('pindex')||'0';const hex=props?.[Number(raw)]||palette[tool]||'#808080';colors.set(hexToRGB(hex),i*9+v*3);}
        }
        chunks.push(pos);
        colourChunks.push(colors);
        total += pos.length;
      }
      const comps = obj.getElementsByTagNameNS(NS, 'component');
      for (const comp of comps) {
        const p = comp.getAttributeNS(PNS, 'path') || path;
        await emit(p, comp.getAttribute('objectid'), compose(matrix(comp.getAttribute('transform')), t), depth + 1,assignedTool);
      }
    };
    const build = root.getElementsByTagNameNS(NS, 'item');
    const items = build.length ? [...build] : Object.keys(objectsIn(root)).map(id => ({ getAttribute: k => (k === 'objectid' ? id : null) }));
    for (const item of items) {if(item.getAttribute('printable')==='0')continue;await emit(main, item.getAttribute('objectid'), matrix(item.getAttribute('transform')), 0,assigned[item.getAttribute('objectid')]||0);}
    if(!total)throw new Error('The project has no printable triangles');
    const all = new Float32Array(total), colors=new Float32Array(total);
    let off = 0;
    for (let i=0;i<chunks.length;i++) { all.set(chunks[i], off);colors.set(colourChunks[i],off); off += chunks[i].length; }
    let plateSource=null;
    try{const stateBytes=await zip.read('DejaVu/plate.json',1024*1024);if(stateBytes){const state=JSON.parse(new TextDecoder().decode(stateBytes));if(state.version!==1||!Array.isArray(state.objects)||!state.objects.length||state.objects.length>32)throw new Error('Invalid plate state');plateSource={state,read:(index,name)=>zip.read('DejaVu/Sources/'+index+'/'+name,64*1024*1024)};}}catch(_){warnings.add('Saved plate-editing state could not be restored. The geometry remains available.');}
    return finishMesh(all, { colours:colors,objects: items.length, application: meta.Application || '', title: meta.Title || '',warnings:[...warnings],plateSource });
  }

  function finishMesh(pos, info) {
    for (let i = 0; i < pos.length; i++) {
      if (!Number.isFinite(pos[i])) throw new Error('The model has a coordinate that isn\'t a number');
    }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (pos[i + k] < min[k]) min[k] = pos[i + k];
        if (pos[i + k] > max[k]) max[k] = pos[i + k];
      }
    }
    const normals = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 9) {
      const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
      const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) { normals[i + k * 3] = nx; normals[i + k * 3 + 1] = ny; normals[i + k * 3 + 2] = nz; }
    }
    return { positions: pos, normals, triangles: pos.length / 9, bounds: { min, max },
             size: max.map((v, i) => +(v - min[i]).toFixed(2)), ...info };
  }

  async function parseModel(buffer, name) {
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith('.obj')) return parseOBJ(buffer);
      if (lower.endsWith('.stl')) return parseSTL(buffer);
      if (lower.endsWith('.3mf')) return await parse3MF(buffer);
    } catch (e) {
      // A header pointing past the end of the file: say it's damaged, not "Offset is outside the bounds".
      if (e instanceof RangeError) throw new Error('The file is damaged or cut short - it can\'t be read');
      throw e;
    }
    throw new Error('Only STL, 3MF and triangulated OBJ models can be shown');
  }

  /* ---------------- tiny matrix helpers ---------------- */

  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(eye, target, up) {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
            -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
            -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
            -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
  }
  function multiply(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  /* ---------------- the renderer ---------------- */

  const MESH_VS = `attribute vec3 p; attribute vec3 n; attribute vec3 k; uniform mat4 m; varying vec3 vn; varying vec3 vk; varying float vz;
    void main(){ vn = n; vk=k; vz = p.z; gl_Position = m * vec4(p, 1.0); }`;
  /* Optional height bands (the Photo-to-Print Studio): up to four colours,
     each from its start height upward - which filament prints where. */
  const MESH_FS = `precision mediump float; varying vec3 vn; varying vec3 vk; varying float vz; uniform vec3 c; uniform vec3 l; uniform bool colored;
    uniform vec3 bc[4]; uniform float bz[4]; uniform int nb;
    void main(){
      vec3 col = colored ? vk : c;
      for (int i = 0; i < 4; i++) { if (i < nb && vz >= bz[i] - 0.0005) col = bc[i]; }
      float d = abs(dot(normalize(vn), l)); gl_FragColor = vec4(col * (0.38 + 0.62 * d), 1.0); }`;
  const LINE_VS = `attribute vec3 p; attribute vec4 k; uniform mat4 m; varying vec4 vk; varying float vz;
    void main(){ vk = k; vz=p.z; gl_PointSize=6.0; gl_Position = m * vec4(p, 1.0); }`;
  const LINE_FS = `precision mediump float; varying vec4 vk; varying float vz; uniform bool hideTravel; uniform float minZ; uniform float maxZ;
    void main(){ if(vk.a<0.001 || (hideTravel && vk.a<0.5) || vz<minZ || vz>maxZ)discard; gl_FragColor = vk; }`;

  function hexToRGB(hex, fallback = [1, 0.48, 0.18]) {
    const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(hex || '');
    if (!m) return fallback;
    const v = parseInt(m[1], 16);
    return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255];
  }

  class Viewer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { antialias: true, alpha: true, preserveDrawingBuffer: false });
      if (!gl) throw new Error('WebGL is not available in this browser');
      this.gl = gl;
      this.mesh = null;
      this.lines = null;
      this.limit = Infinity;
      this.showTravel = false;
      this.color = [1, 0.48, 0.18];
      this.yaw = -0.9; this.pitch = 0.62; this.dist = 380;
      this.target = [BED / 2, BED / 2, 0];
      this.panMode = false;
      this.meshProg = this.program(MESH_VS, MESH_FS);
      this.lineProg = this.program(LINE_VS, LINE_FS);
      this.bed = this.buildBed();
      this.bindInput();
      this.resizeObserver = new ResizeObserver(() => this.draw());
      this.resizeObserver.observe(canvas);
      this.draw();
    }

    program(vs, fs) {
      const gl = this.gl;
      const make = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      return p;
    }

    buffer(data) {
      const gl = this.gl, b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return b;
    }

    buildBed() {
      const pos = [], col = [];
      const push = (x1, y1, x2, y2, a) => { pos.push(x1, y1, 0, x2, y2, 0); col.push(.3, .34, .42, a, .3, .34, .42, a); };
      for (let i = 0; i <= BED; i += 27) { push(i, 0, i, BED, i % 135 ? .16 : .34); push(0, i, BED, i, i % 135 ? .16 : .34); }
      return { pos: this.buffer(new Float32Array(pos)), col: this.buffer(new Float32Array(col)), count: pos.length / 3 };
    }

    /* bands (optional): [{z, hex}] lowest first, heights in the model's own mm. */
    setMesh(mesh, colorHex, bands, options={}) {
      const gl = this.gl;
      this.clear();
      // Sit the model on the bed, centred, as a slicer would place it.
      const b = mesh.bounds;
      const dx = options.absolute?0:BED / 2 - (b.min[0] + b.max[0]) / 2, dy = options.absolute?0:BED / 2 - (b.min[1] + b.max[1]) / 2, dz = options.absolute?0:-b.min[2];
      const pos = new Float32Array(mesh.positions.length);
      for (let i = 0; i < pos.length; i += 3) {
        pos[i] = mesh.positions[i] + dx; pos[i + 1] = mesh.positions[i + 1] + dy; pos[i + 2] = mesh.positions[i + 2] + dz;
      }
      this.mesh = { pos: this.buffer(pos), nrm: this.buffer(mesh.normals), count: pos.length / 3 };
      if(mesh.colours)this.mesh.col=this.buffer(mesh.colours);
      this.color = hexToRGB(colorHex);
      // Like the toolpath view, lift near-black on screen only so it doesn't vanish.
      const lift = (c) => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return l < 0.22 ? c.map(v => v + (0.42 - l)) : c; };
      this.bands = (bands || []).slice(0, 4).map(b => ({ z: b.z + dz, color: lift(hexToRGB(b.hex)) }));
      if(!options.keepCamera)this.frame([BED / 2, BED / 2, mesh.size[2] / 2], Math.max(...mesh.size));
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      this.draw();
    }

    /* segments: [x1,y1,z1,x2,y2,z2,tool,extruding] from the server's analysis */
    setToolpath(segments, colours, details={}) {
      this.clear();
      const n = segments.length;
      const pos = new Float32Array(n * 6), col = new Float32Array(n * 8);
      // Very dark filament (black) would vanish against the dark viewer, so
      // on screen only it is lifted toward grey; the file is untouched.
      const visible = (c) => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return l < 0.22 ? c.map(v => v + (0.42 - l)) : c; };
      const palette = [0, 1, 2, 3].map(i => visible(hexToRGB(colours && colours[i], [[1, .48, .18], [.2, .5, .95], [.2, .7, .35], [.85, .2, .3]][i])));
      this.zAt = new Float32Array(n);
      let zmax = 0, min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) {
        const s = segments[i];
        pos.set([s[0], s[1], s[2], s[3], s[4], s[5]], i * 6);
        const ext = s[7] === 1;
        const c = ext ? palette[s[6]] || palette[0] : [.45, .5, .6];
        const a = ext ? 1 : .22;
        col.set([c[0], c[1], c[2], a, c[0], c[1], c[2], a], i * 8);
        if (ext) {
          zmax = Math.max(zmax, s[5]);
          for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], s[k], s[k + 3]); max[k] = Math.max(max[k], s[k], s[k + 3]); }
        }
        this.zAt[i] = zmax;               // highest printed Z so far: file order is print order
      }
      this.travelMask = segments.map(s => s[7] === 1);
      this.lines = { pos: this.buffer(pos), col: this.buffer(col), count: n * 2, zmax };
      this.toolSegments=segments;this.toolPalette=palette;this.pathMode='tool';this.toolFilter=-1;
      this.pathDetails=details;this.lowerLimit=-Infinity;
      const markers=details.markers||[];
      if(markers.length){const mp=new Float32Array(markers.length*3),mc=new Float32Array(markers.length*4);markers.forEach((m,i)=>{mp.set(m.position,i*3);mc.set(m.kind==='toolchange'?[1,.85,.15,1]:[1,.2,.7,1],i*4);});this.markers={pos:this.buffer(mp),col:this.buffer(mc),count:markers.length};}
      if (isFinite(min[0])) this.frame([(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (max[2]) / 2],
        Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
      this.limit = Infinity;
      this.draw();
      return { zmax };
    }

    setLayerLimit(z) { this.limit = z; this.draw(); }

    setPathStyle(mode='tool',tool=-1) {
      if(!this.lines)return;this.pathMode=mode;this.toolFilter=tool;
      const segs=this.toolSegments,col=new Float32Array(segs.length*8),max=segs.reduce((n,s)=>Math.max(n,s[8]||0),1),features=[[.15,.7,1],[1,.5,.12],[.35,.85,.4],[.85,.35,.9],[.95,.85,.2],[.6,.7,.85]];
      for(let i=0;i<segs.length;i++){const s=segs[i],ext=s[7]===1;let c=ext?this.toolPalette[s[6]]||this.toolPalette[0]:[.45,.5,.6];if(ext&&mode==='speed'){const t=(s[8]||0)/max;c=[t,.35+.4*(1-Math.abs(2*t-1)),1-t];}if(ext&&mode==='feature')c=features[(s[9]||0)%features.length];const a=tool>=0&&s[6]!==tool?0:ext?1:.22;col.set([...c,a,...c,a],i*8);}
      const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.lines.col);gl.bufferData(gl.ARRAY_BUFFER,col,gl.STATIC_DRAW);this.draw();
    }

    frame(center, size) {
      this.target = center;
      this.dist = Math.max(60, size * 2.6);
    }

    clear() {
      const gl = this.gl;
      for (const obj of [this.mesh, this.lines,this.markers]) {
        if (!obj) continue;
        for (const key of ['pos', 'nrm', 'col']) if (obj[key]) gl.deleteBuffer(obj[key]);
      }
      this.mesh = null; this.lines = null;this.markers=null;this.toolSegments=null;
    }

    matrix() {
      const { canvas } = this;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const e = [
        this.target[0] + this.dist * Math.cos(this.pitch) * Math.cos(this.yaw),
        this.target[1] + this.dist * Math.cos(this.pitch) * Math.sin(this.yaw),
        this.target[2] + this.dist * Math.sin(this.pitch),
      ];
      return multiply(perspective(0.8, w / Math.max(1, h), 1, 4000), lookAt(e, this.target, [0, 0, 1]));
    }

    attrib(prog, name, buf, size) {
      const gl = this.gl, loc = gl.getAttribLocation(prog, name);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return loc;
    }

    draw() {
      if (this.pending) return;
      this.pending = requestAnimationFrame(() => { this.pending = 0; this.render(); });
    }

    render() {
      const gl = this.gl, canvas = this.canvas;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (!w || !h) return;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const m = this.matrix();

      gl.useProgram(this.lineProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'm'), false, m);
      gl.uniform1i(gl.getUniformLocation(this.lineProg,'hideTravel'),false);
      gl.uniform1f(gl.getUniformLocation(this.lineProg,'minZ'),-1e8);gl.uniform1f(gl.getUniformLocation(this.lineProg,'maxZ'),1e8);
      const lp = this.attrib(this.lineProg, 'p', this.bed.pos, 3);
      const lk = this.attrib(this.lineProg, 'k', this.bed.col, 4);
      gl.drawArrays(gl.LINES, 0, this.bed.count);

      if (this.lines) {
        gl.uniform1i(gl.getUniformLocation(this.lineProg,'hideTravel'),!this.showTravel);
        gl.uniform1f(gl.getUniformLocation(this.lineProg,'minZ'),Number.isFinite(this.lowerLimit)?this.lowerLimit:-1e8);
        gl.uniform1f(gl.getUniformLocation(this.lineProg,'maxZ'),Number.isFinite(this.limit)?this.limit+1e-5:1e8);
        this.attrib(this.lineProg, 'p', this.lines.pos, 3);
        this.attrib(this.lineProg, 'k', this.lines.col, 4);
        let count = this.lines.count / 2;
        if (isFinite(this.limit)) {
          let lo = 0, hi = count;                       // zAt only ever rises: binary search
          while (lo < hi) { const mid = (lo + hi) >> 1; if (this.zAt[mid] <= this.limit + 1e-6) lo = mid + 1; else hi = mid; }
          count = lo;
        }
        gl.lineWidth(1);
        gl.drawArrays(gl.LINES, 0, count * 2);
        if(this.showMarkers&&this.markers){this.attrib(this.lineProg,'p',this.markers.pos,3);this.attrib(this.lineProg,'k',this.markers.col,4);gl.uniform1i(gl.getUniformLocation(this.lineProg,'hideTravel'),false);gl.drawArrays(gl.POINTS,0,this.markers.count);}
      }
      gl.disableVertexAttribArray(lk);

      if (this.mesh) {
        gl.useProgram(this.meshProg);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.meshProg, 'm'), false, m);
        gl.uniform3fv(gl.getUniformLocation(this.meshProg, 'c'), this.color);
        const bands = this.bands || [];
        gl.uniform1i(gl.getUniformLocation(this.meshProg, 'nb'), bands.length);
        if (bands.length) {
          const bc = new Float32Array(12), bz = new Float32Array(4);
          bands.forEach((b, i) => { bc.set(b.color, i * 3); bz[i] = b.z; });
          gl.uniform3fv(gl.getUniformLocation(this.meshProg, 'bc'), bc);
          gl.uniform1fv(gl.getUniformLocation(this.meshProg, 'bz'), bz);
        }
        const l = [Math.cos(this.yaw + 0.6), Math.sin(this.yaw + 0.6), 0.8];
        const ll = Math.hypot(...l);
        gl.uniform3fv(gl.getUniformLocation(this.meshProg, 'l'), l.map(v => v / ll));
        const mp = this.attrib(this.meshProg, 'p', this.mesh.pos, 3);
        const mn = this.attrib(this.meshProg, 'n', this.mesh.nrm, 3);
        const mk=gl.getAttribLocation(this.meshProg,'k');
        gl.uniform1i(gl.getUniformLocation(this.meshProg,'colored'),!!this.mesh.col);
        if(this.mesh.col)this.attrib(this.meshProg,'k',this.mesh.col,3);else{gl.disableVertexAttribArray(mk);gl.vertexAttrib3f(mk,1,1,1);}
        gl.drawArrays(gl.TRIANGLES, 0, this.mesh.count);
        gl.disableVertexAttribArray(mn);
        gl.disableVertexAttribArray(mp);
        gl.disableVertexAttribArray(mk);
      }
      gl.disableVertexAttribArray(lp);
    }

    /* Orbit and zoom. The canvas has touch-action:none (see workshop.css) and
       the release listeners are on the document, so a finger sliding off the
       canvas mid-drag can never leave it stuck in "dragging". */
    bindInput() {
      const c = this.canvas;
      const pointers = new Map();
      let pinch = 0;
      const down = (e) => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        c.setPointerCapture?.(e.pointerId);
      };
      const move = (e) => {
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        if (pointers.size === 1 && (this.panMode || e.shiftKey)) {
          const dx=(e.clientX-prev.x)*this.dist/600, dy=(e.clientY-prev.y)*this.dist/600;
          this.target[0]-=Math.cos(this.yaw)*dx;
          this.target[1]-=Math.sin(this.yaw)*dx;
          this.target[2]+=dy;
        } else if (pointers.size === 1) {
          this.yaw -= (e.clientX - prev.x) * 0.008;
          this.pitch = Math.max(-0.2, Math.min(1.5, this.pitch + (e.clientY - prev.y) * 0.008));
        }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch) this.dist = Math.max(30, Math.min(1500, this.dist * pinch / d));
          pinch = d;
        }
        this.draw();
      };
      const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = 0; };
      c.addEventListener('pointerdown', down);
      c.addEventListener('pointermove', move);
      this.docUp = up;
      document.addEventListener('pointerup', up);
      document.addEventListener('pointercancel', up);
      c.addEventListener('wheel', (e) => {
        e.preventDefault();
        this.dist = Math.max(30, Math.min(1500, this.dist * (1 + Math.sign(e.deltaY) * 0.1)));
        this.draw();
      }, { passive: false });
      c.addEventListener('keydown', (e) => {
        const step = { ArrowLeft: [-.12, 0], ArrowRight: [.12, 0], ArrowUp: [0, .08], ArrowDown: [0, -.08] }[e.key];
        if (step) { e.preventDefault(); this.yaw += step[0]; this.pitch = Math.max(-0.2, Math.min(1.5, this.pitch + step[1])); this.draw(); }
        if (e.key === '+' || e.key === '=') { this.dist *= 0.9; this.draw(); }
        if (e.key === '-') { this.dist *= 1.1; this.draw(); }
      });
    }

    dispose() {
      this.clear();
      this.resizeObserver.disconnect();
      document.removeEventListener('pointerup', this.docUp);
      document.removeEventListener('pointercancel', this.docUp);
      const lose = this.gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  }

  /* A G-code toolpath read in the browser, for viewing a file from this
   * device when the dashboard server isn't there to analyse it. Only what the
   * viewer needs: moves (G0/G1, and G2/G3 arcs by I/J as Klipper runs them),
   * absolute/relative positioning and extrusion, G92, and T0-T3. It is not
   * the pre-flight check (backend/gcode_tools.py) and doesn't claim to be:
   * no time, weight or safety verdict comes from here. Segments are
   * [x0, y0, z0, x1, y1, z1, tool, extruding] like the server's, and at
   * most MAX_SEGMENTS are kept, spread evenly through the file. */
  const MAX_SEGMENTS = 60000;

  function parseGcode(text) {
    const pos = { X: 0, Y: 0, Z: 0, E: 0 };
    let absolute = true, absE = true, tool = 0;
    const segments = [], tools = new Set(), zs = new Set();
    const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
    let colours = [];
    const lines = text.split('\n');
    for (const raw of lines) {
      const semi = raw.indexOf(';');
      if (semi >= 0 && !colours.length) {
        const m = raw.slice(semi).match(/^;\s*(?:filament_colou?r|extruder_colou?r)\s*=\s*(.+)$/i);
        if (m) colours = m[1].split(/[;,]/).map(c => c.trim().replace(/^"|"$/g, '')).filter(c => /^#[0-9a-f]{6}$/i.test(c));
      }
      const code = (semi >= 0 ? raw.slice(0, semi) : raw).trim().toUpperCase();
      if (!code) continue;
      const words = code.split(/\s+/);
      const head = words[0];
      if (/^T\d+$/.test(head)) { tool = +head.slice(1); continue; }
      if (head === 'G90') { absolute = true; continue; }
      if (head === 'G91') { absolute = false; continue; }
      if (head === 'M82') { absE = true; continue; }
      if (head === 'M83') { absE = false; continue; }
      const p = {};
      for (const w of words.slice(1)) {
        const v = parseFloat(w.slice(1));
        if (/^[XYZEIJ]$/.test(w[0]) && Number.isFinite(v)) p[w[0]] = v;
      }
      if (head === 'G92') { for (const k of ['X', 'Y', 'Z', 'E']) if (k in p) pos[k] = p[k]; continue; }
      if (!/^G[0-3]$/.test(head)) continue;
      const to = { ...pos };
      for (const k of ['X', 'Y', 'Z']) if (k in p) to[k] = absolute ? p[k] : pos[k] + p[k];
      let extruding = false;
      if ('E' in p) {
        const e = absE ? p.E : pos.E + p.E;
        extruding = e > pos.E + 1e-9;
        to.E = e;
      }
      const moved = to.X !== pos.X || to.Y !== pos.Y || to.Z !== pos.Z;
      if (moved) {
        const points = [];
        if ((head === 'G2' || head === 'G3') && ('I' in p || 'J' in p)) {
          const cx = pos.X + (p.I || 0), cy = pos.Y + (p.J || 0), r = Math.hypot(pos.X - cx, pos.Y - cy);
          let a0 = Math.atan2(pos.Y - cy, pos.X - cx), a1 = Math.atan2(to.Y - cy, to.X - cx);
          let sweep = a1 - a0;
          if (head === 'G2' && sweep >= 0) sweep -= 2 * Math.PI;      // clockwise
          if (head === 'G3' && sweep <= 0) sweep += 2 * Math.PI;      // counter-clockwise
          const n = Math.max(1, Math.min(64, Math.ceil(Math.abs(sweep) * r / 1.5)));
          for (let i = 1; i <= n; i++) {
            const a = a0 + sweep * i / n;
            points.push(i === n ? [to.X, to.Y, to.Z] : [cx + r * Math.cos(a), cy + r * Math.sin(a), pos.Z + (to.Z - pos.Z) * i / n]);
          }
        } else points.push([to.X, to.Y, to.Z]);
        let prev = [pos.X, pos.Y, pos.Z];
        for (const q of points) {
          segments.push([prev[0], prev[1], prev[2], q[0], q[1], q[2], tool, extruding ? 1 : 0]);
          if (extruding) {
            for (let k = 0; k < 2; k++) { min[k] = Math.min(min[k], prev[k], q[k]); max[k] = Math.max(max[k], prev[k], q[k]); }
            zs.add(Math.round(q[2] * 1000));
            tools.add(tool);
          }
          prev = q;
        }
      }
      Object.assign(pos, to);
    }
    const total = segments.length;
    const kept = total <= MAX_SEGMENTS ? segments
      : Array.from({ length: MAX_SEGMENTS }, (_, i) => segments[Math.floor(i * total / MAX_SEGMENTS)]);
    return {
      toolpath: { segments: kept, total_segments: total, downsampled: total > MAX_SEGMENTS },
      lines: lines.length,
      layers: zs.size,
      tools_used: [...tools].sort().map(t => `T${t}`),
      footprint_mm: isFinite(min[0]) ? [+(max[0] - min[0]).toFixed(1), +(max[1] - min[1]).toFixed(1)] : null,
      colours,
    };
  }

  return { parseSTL, parse3MF, parseOBJ, transformMesh, exportSTL, parseModel, parseGcode, finishMesh, hexToRGB, Viewer, BED };
})();
