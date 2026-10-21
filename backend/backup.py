"""Versioned app-data snapshots and isolated restore; the running installation is never overwritten."""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import uuid
import zipfile
from datetime import datetime
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

import safe_zip
import storage

_DATA_DIR = storage.DATA_DIR
MAX_ARCHIVE_BYTES = 256*1024*1024
MAX_TOTAL_BYTES = 512*1024*1024
MAX_FILES = 10000
_EXCLUDED = {'restore-staging','restored','updates','update-staging'}
_SECRET = re.compile(r'(?:api[_-]?key|token|password|secret|webhook|authorization|private[_-]?key)',re.I)


def _safe_name(name):
    if not isinstance(name,str) or not name or '\\' in name or ':' in name or name.startswith('/') or any(p in ('','.','..') for p in name.split('/')):
        raise ValueError('The backup contains an unsafe file name')
    if name.split('/')[0] in _EXCLUDED or name=='manifest.json':raise ValueError('The backup contains a reserved file name')
    return name


def _clean(value, name, omitted, prefix=''):
    if isinstance(value,dict):
        result={}
        for key,item in value.items():
            field=prefix+str(key)
            if _SECRET.search(str(key)) and isinstance(item,str) and item:
                result[key]='';omitted.append(name+': '+field)
            else:result[key]=_clean(item,name,omitted,field+'.')
        return result
    if isinstance(value,list):return [_clean(item,name,omitted,prefix+str(i)+'.') for i,item in enumerate(value)]
    if isinstance(value,str):
        root=str(Path(_DATA_DIR).resolve())+os.sep
        if value.startswith(root):return '@DATA@/'+value[len(root):].replace(os.sep,'/')
        if value.startswith(('http://','https://','rtsp://')):
            try:
                url=urlsplit(value);host=url.netloc.rsplit('@',1)[-1]
                query=[(k,v) for k,v in parse_qsl(url.query,keep_blank_values=True) if not _SECRET.search(k)]
                if host!=url.netloc or len(query)!=len(parse_qsl(url.query,keep_blank_values=True)):
                    omitted.append(name+': '+prefix.rstrip('.')+' URL credentials')
                    return urlunsplit((url.scheme,host,url.path,urlencode(query),url.fragment))
            except ValueError:pass
    return value


def _files():
    root=Path(_DATA_DIR);paths=[]
    if not root.exists():return paths
    for folder,dirs,names in os.walk(root,followlinks=False):
        dirs[:]=[d for d in dirs if d not in _EXCLUDED and not d.startswith('.') and not (Path(folder)/d).is_symlink()]
        for name in sorted(names):
            p=Path(folder)/name
            if name.startswith('.tmp-') or p.is_symlink():continue
            relative=p.relative_to(root).as_posix();_safe_name(relative)
            paths.append((relative,p))
    if len(paths)>MAX_FILES:raise ValueError('More than 10,000 app data files need an offline filesystem backup')
    return sorted(paths)


def create_backup():
    paths=_files();total=0;entries=[];omitted=[];buffer=io.BytesIO();observed={}
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
        for name,path in paths:
            before=path.stat();total+=before.st_size
            if before.st_size>64*1024*1024 or total>MAX_TOTAL_BYTES:raise ValueError('This app data exceeds the 512 MB snapshot limit or contains a file over 64 MB. Use an offline filesystem copy')
            data=path.read_bytes();after=path.stat()
            if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('App data changed during backup. Finish file operations or camera capture, then try again')
            observed[name]=(after.st_size,after.st_mtime_ns)
            if name.endswith('.json'):
                try:decoded=json.loads(data)
                except (ValueError,UnicodeError):raise ValueError(f'{name} is damaged. Recover that record before making a full backup')
                data=json.dumps(_clean(decoded,name,omitted),indent=2).encode()
            archive.writestr(name,data)
            entries.append({'name':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        current=_files()
        if [n for n,_ in current]!=[n for n,_ in paths] or any((p.stat().st_size,p.stat().st_mtime_ns)!=observed[n] for n,p in current):
            raise ValueError('App data changed during backup. Finish file operations or camera capture, then try again')
        manifest={'format':'dejavu1-app-data','version':2,'created_at':datetime.now().isoformat(timespec='seconds'),
                  'files':[e['name'] for e in entries],'entries':entries,'secrets_left_out':omitted,
                  'scope':'All regular app data files, including library, queues, fleet, per-printer logs, presets and time-lapse. Restore/update staging and symlinks excluded. Printer firmware/configuration and external engine installations are not app data.',
                  'privacy':'Connection credentials in JSON settings are omitted. Library and camera payloads remain private content and are retained verbatim.'}
        archive.writestr('manifest.json',json.dumps(manifest,indent=2))
    data=buffer.getvalue()
    if len(data)>MAX_ARCHIVE_BYTES:raise ValueError('This compressed snapshot exceeds the 256 MB restore limit. Use an offline filesystem copy')
    return 'dejavu1-backup-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'.zip',data


def _validate(data):
    if len(data)>MAX_ARCHIVE_BYTES:raise ValueError('The backup exceeds the 256 MB limit')
    with safe_zip.open_archive(data,'backup') as archive:
        names=archive.namelist()
        if len(names)!=len(set(names)) or len(names)>MAX_FILES+1:raise ValueError('The backup repeats files or contains too many files')
        try:manifest=json.loads(safe_zip.read(archive,'manifest.json',limit=4*1024*1024,what='backup'))
        except (ValueError,UnicodeError):raise ValueError('The backup manifest is damaged')
        if not isinstance(manifest,dict) or manifest.get('format')!='dejavu1-app-data' or manifest.get('version')!=2:
            raise ValueError('Only version 2 full app-data backups can be restored. Older selected-settings exports are incomplete')
        entries=manifest.get('entries')
        if not isinstance(entries,list):raise ValueError('The backup has no file inventory')
        expected=['manifest.json'];total=0;payload={}
        for entry in entries:
            if not isinstance(entry,dict):raise ValueError('The backup file inventory is damaged')
            name=_safe_name(entry.get('name'));expected.append(name)
            try:info=archive.getinfo(name)
            except KeyError:raise ValueError('The backup is missing an inventoried file: '+name)
            if stat.S_ISLNK(info.external_attr>>16):raise ValueError('Backup symlinks cannot be restored')
            total+=info.file_size
            if total>MAX_TOTAL_BYTES:raise ValueError('The backup unpacks beyond 512 MB')
            content=safe_zip.read(archive,name,limit=64*1024*1024,what='backup')
            if len(content)!=entry.get('bytes') or hashlib.sha256(content).hexdigest()!=entry.get('sha256'):
                raise ValueError('The backup checksum does not match for '+name)
            if name.endswith('.json'):
                try:json.loads(content)
                except (ValueError,UnicodeError):raise ValueError('The backup contains damaged JSON: '+name)
            payload[name]=content
        if sorted(expected)!=sorted(names) or len(expected)!=len(set(expected)):raise ValueError('The backup contains files outside its inventory')
        return manifest,payload


def preview_restore(data):
    manifest,payload=_validate(data)
    token=uuid.uuid4().hex;folder=Path(_DATA_DIR)/'restore-staging';folder.mkdir(parents=True,exist_ok=True)
    # At most three reviewable uploads. Do not silently delete a previous preview.
    if len(list(folder.glob('*.zip')))>=3:raise ValueError('Three backup previews are already staged. Restore one or remove an unwanted staged preview on this computer')
    (folder/(token+'.zip')).write_bytes(data)
    changes=[{'name':name,'current':('different' if (Path(_DATA_DIR)/name).is_file() and (Path(_DATA_DIR)/name).read_bytes()!=content else 'same') if (Path(_DATA_DIR)/name).exists() else 'new'} for name,content in payload.items()]
    return {'id':token,'files':len(payload),'bytes':sum(len(v) for v in payload.values()),'changes':changes,
            'secrets_left_out':manifest.get('secrets_left_out',[]),'created_at':manifest.get('created_at'),
            'note':'Restore creates a separate recovery folder and launchers. The running installation and existing files are kept. Stop the app before starting the restored copy. Automatic actions and queue advancement are disabled; reconnect credentials must be entered again.'}


def _paths(value,root):
    if isinstance(value,dict):return {k:_paths(v,root) for k,v in value.items()}
    if isinstance(value,list):return [_paths(v,root) for v in value]
    if isinstance(value,str) and value.startswith('@DATA@/'):
        relative=_safe_name(value[7:]);return str(root/relative)
    return value


def restore(body):
    token=body.get('id')
    if not isinstance(token,str) or not re.fullmatch(r'[a-f0-9]{32}',token) or body.get('confirmed') is not True:raise ValueError('Preview the backup and confirm creating its separate restored copy')
    source=Path(_DATA_DIR)/'restore-staging'/(token+'.zip')
    if not source.is_file():raise ValueError('The staged backup is missing. Preview it again')
    manifest,payload=_validate(source.read_bytes())
    parent=Path(_DATA_DIR)/'restored';parent.mkdir(parents=True,exist_ok=True)
    staging=Path(tempfile.mkdtemp(prefix='.preparing-',dir=parent));destination=parent/('recovery-'+uuid.uuid4().hex[:12]);data_root=destination/'data'
    try:
        for name,content in payload.items():
            path=staging/'data'/name;path.parent.mkdir(parents=True,exist_ok=True)
            if name.endswith('.json'):
                value=_paths(json.loads(content),data_root)
                if name=='slicer.json' and isinstance(value,dict):value['last_check']=None
                if name=='print_queue.json' and isinstance(value,dict):
                    for queue in value.values():
                        if isinstance(queue,dict):queue['auto_advance']=False
                content=json.dumps(value,indent=2).encode()
            path.write_bytes(content)
        modules_path=staging/'data/modules.json';modules_path.parent.mkdir(parents=True,exist_ok=True)
        settings=json.loads(modules_path.read_text()) if modules_path.exists() else {}
        if not isinstance(settings,dict):raise ValueError('The module settings cannot be restored safely')
        for module in ('automations','print_queue','auto_print','notifications','home_assistant_bridge','wled_bridge'):settings[module]=False
        modules_path.write_text(json.dumps(settings,indent=2))
        start=Path(__file__).resolve().parent.parent/'start.py'
        launcher="import os, subprocess, sys\nos.environ['DEJAVU_DATA_DIR']="+repr(str(data_root))+"\nraise SystemExit(subprocess.call([sys.executable,"+repr(str(start))+"]))\n"
        (staging/'launch-restored.py').write_text(launcher)
        (staging/'Start restored app.command').write_text('#!/bin/sh\ncd "$(dirname "$0")" || exit 1\nexec python3 launch-restored.py\n')
        (staging/'Start restored app.command').chmod(0o700)
        (staging/'Start restored app.bat').write_text('@echo off\r\ncd /d "%~dp0"\r\npython launch-restored.py\r\npause\r\n')
        (staging/'RECOVERY.txt').write_text('Stop the running Deja Vu1 app first. Open the launcher for your operating system. Your original data is unchanged. Review printer addresses, re-enter connection credentials, check the engine and re-enable automatic modules only after review. Return to the original launcher to recover the previous installation.\n')
        os.replace(staging,destination)
    except BaseException:
        shutil.rmtree(staging,ignore_errors=True);raise
    try:source.unlink()
    except OSError:pass
    return {'folder':str(destination),'files':len(payload),'note':'Restored as a separate copy. Stop this app, open the recovery folder, then double-click Start restored app.command (Linux/macOS) or Start restored app.bat (Windows). The original launcher still opens your original data. Re-enter credentials and review disabled automatic modules before using printers.'}


def discard_preview(body):
    token=body.get('id')
    if not isinstance(token,str) or not re.fullmatch(r'[a-f0-9]{32}',token):raise ValueError('Choose a staged backup preview')
    path=Path(_DATA_DIR)/'restore-staging'/(token+'.zip')
    if path.is_file():path.unlink()
    return {'discarded':True}
