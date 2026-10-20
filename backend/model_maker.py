"""Four-tool image tiles, measured layer recipes and closed heightmap reliefs."""
import hashlib
import json
import math
import os
import re
import threading
import uuid

import file_library
import layer_planner
import plate_project
import storage
import tool_setup

_DATA_DIR=storage.DATA_DIR
_PATH=os.path.join(_DATA_DIR,'colour_calibration.json')
_lock=threading.RLock()


def number(value,label,lo,hi):
    try:n=float(value)
    except (ValueError,TypeError):raise ValueError(f'{label} needs a number')
    if not math.isfinite(n) or not lo<=n<=hi:raise ValueError(f'{label} must be between {lo} and {hi}')
    return n


def palette():
    heads=tool_setup.get()['heads']
    if len(heads)!=4:raise ValueError('Save all four heads in Auto-print → Tools & filaments first')
    return sorted(heads,key=lambda h:h['toolhead'])


def recipes():
    result=[[i]*4 for i in range(4)]
    for a in range(4):
        for b in range(a+1,4):result.extend([[a,a,a,b],[a,b,b,b]])
    return result


def signature(heads,height):
    fields=[{k:h.get(k) for k in ('material','color_hex','spool_id','nozzle')} for h in heads]
    return hashlib.sha256(json.dumps([fields,height],sort_keys=True).encode()).hexdigest()


def settings(height=.2):
    h=number(height,'Layer thickness',.04,.56)
    heads=palette();key=signature(heads,h)
    with _lock:calibration=storage.load_json(_PATH,{}).get(key)
    return {'palette':heads,'recipes':[{'id':i,'row':i//4+1,'column':i%4+1,'layers':['T'+str(t) for t in row]} for i,row in enumerate(recipes())],
            'layer_height':h,'calibration':calibration,'note':'Measured recipes apply only to these saved spools, colours, nozzles and layer thickness. A screen preview cannot predict a physical print.'}


def save_calibration(body):
    h=number(body.get('layer_height',.2),'Layer thickness',.04,.56);heads=palette()
    colours=body.get('colours')
    if not isinstance(colours,list) or len(colours)!=16 or any(not isinstance(c,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',c) for c in colours):
        raise ValueError('Enter the sixteen measured swatch colours, in row order')
    if body.get('measured') is not True:raise ValueError('Confirm these colours came from your printed swatches')
    with _lock:
        data=storage.load_json(_PATH,{})
        if len(data)>=100 and signature(heads,h) not in data:raise ValueError('The calibration library is full')
        data[signature(heads,h)]={'colours':[c.lower() for c in colours],'source':'user-measured'}
        storage.save_json(_PATH,data)
    return settings(h)


def linear(rgb):
    return [v/255/12.92 if v/255<=.04045 else ((v/255+.055)/1.055)**2.4 for v in rgb]


def rgb(hex_colour):return [int(hex_colour[k:k+2],16) for k in (1,3,5)]


def quantize(pixels,w,h,colours,dither=False):
    palette_rgb=[linear(rgb(c)) for c in colours]
    values=[linear(pixels[i:i+3]) for i in range(0,len(pixels),3)];out=[0]*(w*h)
    weights=[.2126,.7152,.0722]
    for y in range(h):
        direction=1 if y%2==0 else -1
        for x in (range(w) if direction==1 else range(w-1,-1,-1)):
            index=y*w+x;v=[max(0,min(1,c)) for c in values[index]]
            chosen=min(range(len(colours)),key=lambda j:sum(weights[k]*(v[k]-palette_rgb[j][k])**2 for k in range(3)))
            out[index]=chosen
            if dither:
                error=[v[k]-palette_rgb[chosen][k] for k in range(3)]
                for dx,dy,weight in [(direction,0,7/16),(-direction,1,3/16),(0,1,5/16),(direction,1,1/16)]:
                    nx,ny=x+dx,y+dy
                    if 0<=nx<w and ny<h:
                        for k in range(3):values[ny*w+nx][k]+=error[k]*weight
    return out


def box(part,x,y,z,w,d,h):
    v=part['vertices'];n=len(v)
    v.extend([(x,y,z),(x+w,y,z),(x+w,y+d,z),(x,y+d,z),(x,y,z+h),(x+w,y,z+h),(x+w,y+d,z+h),(x,y+d,z+h)])
    faces=[(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    part['triangles'].extend(tuple(n+i for i in f) for f in faces)


def terrain(pixels,w,h,width,depth,rise,base):
    top=[]
    for y in range(h):
        for x in range(w):
            p=linear(pixels[(y*w+x)*3:(y*w+x)*3+3]);lum=sum(a*b for a,b in zip(p,(.2126,.7152,.0722)))
            top.append((x*width/(w-1),y*depth/(h-1),base+lum*rise))
    n=len(top);v=top+[(x,y,0) for x,y,z in top];faces=[]
    for y in range(h-1):
        for x in range(w-1):
            a=y*w+x;b=a+1;c=a+w;d=c+1
            faces.extend([(a,b,d),(a,d,c),(a+n,d+n,b+n),(a+n,c+n,d+n)])
    perimeter=list(range(w))+[y*w+w-1 for y in range(1,h)]+[h*w-1-x for x in range(1,w)]+[y*w for y in range(h-2,0,-1)]
    for i,a in enumerate(perimeter):
        b=perimeter[(i+1)%len(perimeter)];faces.extend([(a,a+n,b+n),(a,b+n,b)])
    return {'tool':0,'vertices':v,'triangles':faces}


def build(body):
    mode=body.get('mode','mosaic');heads=palette();height=number(body.get('layer_height',.2),'Layer thickness',.04,.56)
    for head in heads:
        lo,hi=layer_planner.U1_LIMITS[head['nozzle']]
        if not lo<=height<=hi:raise ValueError(f"{head['toolhead']}: choose a layer thickness between {lo} and {hi} mm")
    base=number(body.get('base',.8),'Backing thickness',.4,5)
    parts=[{'tool':i,'vertices':[],'triangles':[]} for i in range(4)]
    plan=recipes()
    if mode=='calibration':
        size,gap=10,2;span=4*size+3*gap
        box(parts[0],0,0,0,span,span,base)
        for i,layers in enumerate(plan):
            for z,t in enumerate(layers):box(parts[t],(i%4)*(size+gap),(3-i//4)*(size+gap),base+z*height,size,size,height)
        preview=None
    else:
        w=body.get('pixels_w');h=body.get('pixels_h');pixels=body.get('pixels')
        if not isinstance(w,int) or not isinstance(h,int) or not 2<=w<=96 or not 2<=h<=96:
            raise ValueError('Use an image grid between 2 and 96 pixels in each direction')
        if not isinstance(pixels,list) or len(pixels)!=w*h*3 or any(not isinstance(n,int) or not 0<=n<=255 for n in pixels):
            raise ValueError('The image pixels are incomplete or invalid')
        width=number(body.get('width',80),'Print width',5,240);depth=width*h/w
        if depth>240:raise ValueError('The image is too tall for this width. Reduce its print width')
        if mode=='terrain':
            rise=number(body.get('rise',15),'Relief height',.2,80);parts=[terrain(pixels,w,h,width,depth,rise,base)];preview=None
        elif mode in ('mosaic','layered'):
            cell=width/w
            if cell<max(h['nozzle'] for h in heads)*2:raise ValueError('Image cells are narrower than two nozzle widths. Reduce image detail or increase print width')
            colours=[h['color_hex'] for h in heads]
            if mode=='layered':
                cal=settings(height)['calibration']
                if not cal:raise ValueError('Print and measure the sixteen swatches first. Layered colours need a calibration for these exact tools and layer thickness')
                colours=cal['colours']
            indices=quantize(pixels,w,h,colours,body.get('dither') is True)
            box(parts[0],0,0,0,width,depth,base)
            # Adjacent cells with the same recipe merge into one closed strip.
            for y in range(h):
                x=0
                while x<w:
                    choice=indices[y*w+x];end=x+1
                    while end<w and indices[y*w+end]==choice:end+=1
                    layers=plan[choice] if mode=='layered' else [choice,choice]
                    z=0
                    while z<len(layers):
                        t=layers[z];last=z+1
                        while last<len(layers) and layers[last]==t:last+=1
                        box(parts[t],x*cell,(h-1-y)*cell,base+z*height,(end-x)*cell,cell,(last-z)*height);z=last
                    x=end
            preview={'width':w,'height':h,'colours':colours,'indices':indices,'source':'measured swatches' if mode=='layered' else 'saved filament colours; appearance is not calibrated'}
        else:raise ValueError('Choose mosaic, layered image, calibration swatches or terrain relief')
    data=plate_project.native(parts,heads,'Image/heightmap geometry; slice before printing')
    name=mode+'-'+uuid.uuid4().hex[:10]+'.3mf'
    entry=file_library.save(name,data,origin='generated',note='Generated '+mode+' model; inspect and slice before printing')
    return {'file':entry,'preview':preview,'note':'This is model geometry, not G-code. Slice it to obtain real time and filament figures. Physical colour matching is unverified.'}
