"""Save-as plate projects with independent source parts and recoverable original files."""
import io
import json
import math
import re
import shutil
import tempfile
import uuid
import zipfile
import xml.etree.ElementTree as ET
from xml.parsers import expat
from xml.sax.saxutils import escape, quoteattr

import file_library
import mesh_tools
import safe_zip
import slicer_profiles
import tool_setup

CORE=mesh_tools.CORE_NS
PROD=mesh_tools.PROD_NS
MAX_SOURCE_BYTES=128*1024*1024
IDENTITY=[1,0,0,0,1,0,0,0,1,0,0,0]


def _xml(data):
    if re.search(br'<!DOCTYPE|<!ENTITY',data,re.I):
        raise ValueError("Model XML with document declarations is not supported")
    # Only the build list is needed. Do not construct millions of vertex nodes.
    root=ET.Element('{'+CORE+'}model');build=ET.SubElement(root,'{'+CORE+'}build')
    parser=expat.ParserCreate(namespace_separator='}');in_build=[False]
    def start(tag,attrs):
        if tag==CORE+'}model':root.attrib.update(attrs)
        elif tag==CORE+'}build':in_build[0]=True
        elif tag==CORE+'}item' and in_build[0]:ET.SubElement(build,'{'+CORE+'}item',attrs)
    def end(tag):
        if tag==CORE+'}build':in_build[0]=False
    parser.StartElementHandler=start;parser.EndElementHandler=end
    try:parser.Parse(data,True)
    except expat.ExpatError:raise ValueError("The model XML is damaged")
    return root


def _name(path):
    if '\\' in path or '..' in path.split('/') or path.startswith('/'):
        raise ValueError("The project contains an unsafe part name")
    return path


def _write_mesh(target,path,data,name):
    colour_ids=[];colours=['#808080'];lookup={'#808080':0};current=[]
    def vertex(fields):
        values=[]
        if len(fields)==7:
            try:values=[float(x) for x in fields[4:7]]
            except ValueError:pass
        if len(values)==3 and all(math.isfinite(v) and 0<=v<=1 for v in values):
            colour='#'+''.join(f'{round(v*255):02x}' for v in values)
            if colour not in lookup:
                if len(colours)>=4096:raise ValueError('This OBJ has more than 4,096 vertex colours. Save it as a 3MF in its source program to retain them')
                lookup[colour]=len(colours);colours.append(colour)
            colour_ids.append(lookup[colour])
        else:colour_ids.append(None)
    def face(indices):current[:]=[colour_ids[i] for i in indices]
    with target.open(path,'w') as stream:
        def write(text):stream.write(text.encode())
        write(f'<model unit="millimeter" xmlns="{CORE}" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"><resources><object id="1" type="model"><mesh><vertices>')
        triangles=mesh_tools.iter_obj(data,vertex,face) if name.lower().endswith('.obj') else mesh_tools.iter_model(data,name)[0]
        with tempfile.SpooledTemporaryFile(max_size=2*1024*1024) as faces:
            count=0
            for tri in triangles:
                for v in tri:write('<vertex x="%.9g" y="%.9g" z="%.9g"/>'%v)
                attrs=(' pid="2" '+ ' '.join(f'p{i+1}="{c or 0}"' for i,c in enumerate(current))) if any(c is not None for c in current) else ''
                faces.write(f'<triangle v1="{count*3}" v2="{count*3+1}" v3="{count*3+2}"{attrs}/>'.encode());count+=1
            if not count:raise ValueError("The model has no triangles")
            write('</vertices><triangles>');faces.seek(0);shutil.copyfileobj(faces,stream,1024*1024)
        write('</triangles></mesh></object>')
        if any(c is not None for c in colour_ids):write('<m:colorgroup id="2">'+''.join(f'<m:color color="{c}"/>' for c in colours)+'</m:colorgroup>')
        write('</resources><build><item objectid="1"/></build></model>')
    return f'<model unit="millimeter" xmlns="{CORE}"><build><item objectid="1"/></build></model>'.encode()


def _relocate_xml(data, prefix):
    """Relocate package-absolute model/texture links; original property data stays in place."""
    _xml(data)
    # Preserve namespace declarations and vendor extension payloads verbatim.
    # Re-serialising XML can rename prefixes referenced by requiredextensions.
    def replace(match):
        path=_name(match.group(3).decode().lstrip('/')).encode()
        return match.group(1)+match.group(2)+b'/'+prefix.encode()+path+match.group(2)
    return re.sub(br'''(\b(?:[\w.-]+:)?(?:path|Target)\s*=\s*)(["'])(/[^"']*)\2''',replace,data)


def build(body):
    rows=body.get('objects')
    if not isinstance(rows,list) or not 1<=len(rows)<=32:
        raise ValueError("A plate needs between 1 and 32 model objects")
    output=io.BytesIO();objects=[];settings=[];source_bytes=0;model_parts=[];unpacked_total=0
    setup=tool_setup.get()['heads']
    palette=[next((h['color_hex'] for h in setup if h['toolhead']=='T'+str(i)),'#808080') for i in range(4)]
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as target:
        for index,row in enumerate(rows):
            if not isinstance(row,dict):raise ValueError("Each plate object needs its own settings")
            name=file_library.clean_name(row.get('name'))
            if file_library.kind_of(name) not in ('stl','obj','3mf'):raise ValueError("Add STL, OBJ or 3MF models to a plate")
            data=file_library.read_bytes(name);source_bytes+=len(data)
            if source_bytes>MAX_SOURCE_BYTES:raise ValueError("This plate's source files are too large; use fewer objects")
            transform=row.get('transform',IDENTITY)
            if not isinstance(transform,list) or len(transform)!=12 or any(not isinstance(x,(int,float)) or not math.isfinite(x) or abs(x)>100000 for x in transform):
                raise ValueError("The object has an invalid position, rotation or scale")
            tool=row.get('tool',0)
            if not isinstance(tool,int) or tool not in range(4):raise ValueError("Assign objects to physical tools T0 to T3")
            options=slicer_profiles.validate_options(row.get('settings') or {})
            prefix=f'3D/sources/{index}/';main=prefix+'3D/3dmodel.model'
            if name.lower().endswith('.3mf'):
                archive=safe_zip.open_archive(data)
                try:
                    if len(archive.infolist())>2000:raise ValueError("This project has too many parts to combine")
                    total=0
                    for info in archive.infolist():
                        if info.is_dir():continue
                        part=_name(info.filename);total+=info.file_size;unpacked_total+=info.file_size
                        if unpacked_total>MAX_SOURCE_BYTES:raise ValueError("This project expands beyond the plate editor's memory limit")
                        content=safe_zip.read(archive,part,limit=MAX_SOURCE_BYTES)
                        if part.lower().endswith(('.model','.rels')):content=_relocate_xml(content,prefix)
                        target.writestr(prefix+part,content)
                        if part.lower().endswith('.model'):model_parts.append(prefix+part)
                    original=safe_zip.read(archive,'3D/3dmodel.model',limit=MAX_SOURCE_BYTES)
                finally:archive.close()
            else:
                original=_write_mesh(target,main,data,name);model_parts.append(main)
            root=_xml(original)
            if root.get('unit','millimeter')!='millimeter':raise ValueError("Convert this model to millimetres before combining it")
            items=root.findall('{'+CORE+'}build/{'+CORE+'}item')
            if not items:raise ValueError("The source project has no printable build items")
            oid=index+1
            comps=[]
            for item in items:
                if item.get('printable','1')=='0':continue
                attrs=' objectid='+quoteattr(item.get('objectid',''))+' p:path='+quoteattr('/'+main)
                if item.get('transform'):attrs+=' transform='+quoteattr(item.get('transform'))
                comps.append('<component'+attrs+'/>')
            objects.append(f'<object id="{oid}" type="model" name={quoteattr(name)}><components>'+''.join(comps)+'</components></object>')
            settings.append(f'<object id="{oid}"><metadata key="name" value={quoteattr(name)}/><metadata key="extruder" value="{tool+1}"/>'+''.join(f'<metadata key={quoteattr(k)} value={quoteattr(v)}/>' for k,v in options.items())+'</object>')
            # Recovery copies are never modified or interpreted as executable code.
            target.writestr(f'DejaVu/Sources/{index}/{name}',data)
        model=f'<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="{CORE}" xmlns:p="{PROD}" requiredextensions="p"><metadata name="Application">Deja Vu1</metadata><resources>'+''.join(objects)+'</resources><build>'+''.join(f'<item objectid="{i+1}" transform="'+ ' '.join(format(v,'.9g') for v in row.get('transform',IDENTITY))+'"/>' for i,row in enumerate(rows))+'</build></model>'
        target.writestr('3D/3dmodel.model',model)
        target.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
        target.writestr('3D/_rels/3dmodel.model.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Target="/{escape(path)}" Id="source{i}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' for i,path in enumerate(model_parts))+'</Relationships>')
        target.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/></Types>')
        instances=''.join(f'<model_instance><metadata key="object_id" value="{i+1}"/><metadata key="instance_id" value="0"/><metadata key="identify_id" value="{i+1}"/></model_instance>' for i in range(len(rows)))
        target.writestr('Metadata/model_settings.config','<config>'+''.join(settings)+'<plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="Deja Vu1 plate"/>'+instances+'</plate></config>')
        target.writestr('Metadata/project_settings.config',json.dumps({'filament_colour':palette,'filament_type':[next((h['material'] for h in setup if h['toolhead']=='T'+str(i)),'') for i in range(4)],'printer_model':'Snapmaker U1','printer_settings_id':'Snapmaker U1 (0.4 nozzle)'}))
        target.writestr('DejaVu/plate.json',json.dumps({'version':1,'objects':rows}))
    result=output.getvalue()
    if len(result)>file_library.MAX_BYTES:raise ValueError("The saved plate would exceed the library's 64 MB file limit")
    return result


def save(body):
    data=build(body)
    name='plate-'+uuid.uuid4().hex[:10]+'.3mf'
    return file_library.save(name,data,origin='prepared',note='Plate project; original source files included for recovery')


def native(parts,palette,note='Generated model'):
    """Independent mesh objects and physical-tool assignments in one native project."""
    output=io.BytesIO();settings=[];objects=[]
    for i,part in enumerate(parts):
        if not part['triangles']:continue
        tool=part['tool'];oid=len(objects)+1
        vertices=''.join('<vertex x="%.7g" y="%.7g" z="%.7g"/>'%tuple(v) for v in part['vertices'])
        triangles=''.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a,b,c in part['triangles'])
        objects.append(f'<object id="{oid}" type="model" pid="100" pindex="{tool}"><mesh><vertices>{vertices}</vertices><triangles>{triangles}</triangles></mesh></object>')
        settings.append(f'<object id="{oid}"><metadata key="name" value="T{tool} geometry"/><metadata key="extruder" value="{tool+1}"/></object>')
    if not objects:raise ValueError('The generated model has no geometry')
    materials='<basematerials id="100">'+''.join(f'<base name="T{i}" displaycolor="{h["color_hex"]}"/>' for i,h in enumerate(palette))+'</basematerials>'
    model=f'<model unit="millimeter" xmlns="{CORE}"><metadata name="Application">Deja Vu1</metadata><metadata name="Description">{escape(note)}</metadata><resources>'+materials+''.join(objects)+'</resources><build>'+''.join(f'<item objectid="{i+1}"/>' for i in range(len(objects)))+'</build></model>'
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('3D/3dmodel.model',model)
        z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
        z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>')
        z.writestr('Metadata/model_settings.config','<config>'+''.join(settings)+'</config>')
        z.writestr('Metadata/project_settings.config',json.dumps({'filament_colour':[h['color_hex'] for h in palette],'filament_type':[h['material'] for h in palette],'printer_model':'Snapmaker U1'}))
    return output.getvalue()
