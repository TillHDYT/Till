import json, struct, io
import numpy as np
from PIL import Image
CT={5126:np.float32,5125:np.uint32,5123:np.uint16,5121:np.uint8}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}
class Glb:
    def __init__(s,path):
        d=open(path,'rb').read();cl=struct.unpack('<I',d[12:16])[0]
        s.j=json.loads(d[20:20+cl]);bl=struct.unpack('<I',d[20+cl:24+cl])[0];s.b=d[28+cl:28+cl+bl]
    def acc(s,i):
        a=s.j['accessors'][i];bv=s.j['bufferViews'][a['bufferView']];o=bv.get('byteOffset',0)+a.get('byteOffset',0)
        n=NC[a['type']];dt=np.dtype(CT[a['componentType']]);st=bv.get('byteStride',dt.itemsize*n)
        if st==dt.itemsize*n: return np.frombuffer(s.b,dt,count=a['count']*n,offset=o).reshape(a['count'],n).copy()
        raw=np.frombuffer(s.b,np.uint8,count=st*(a['count']-1)+dt.itemsize*n,offset=o)
        return np.lib.stride_tricks.as_strided(raw,shape=(a['count'],n*dt.itemsize),strides=(st,1)).copy().view(dt).reshape(a['count'],n)
    def prim(s):
        p=s.j['meshes'][0]['primitives'][0];A=p['attributes']
        P=s.acc(A['POSITION']).astype(np.float64);I=s.acc(p['indices']).reshape(-1,3).astype(np.int64)
        UV=s.acc(A['TEXCOORD_0']).astype(np.float64) if 'TEXCOORD_0' in A else None
        return P,UV,I,p
    def image(s,ti):
        img=s.j['images'][s.j['textures'][ti]['source']];bv=s.j['bufferViews'][img['bufferView']]
        return Image.open(io.BytesIO(s.b[bv.get('byteOffset',0):bv.get('byteOffset',0)+bv['byteLength']]))
def write_glb(path,pos,nrm,uv,idx,images,material,extra_meshes=None):
    """images: list of (bytes,mime). material: gltf material dict referencing textures 0..n-1 (one texture per image)."""
    buf=bytearray();views=[];accs=[]
    def add(arr,ctype,typ,target=None,mm=False):
        while len(buf)%4: buf.append(0)
        data=np.ascontiguousarray(arr).tobytes();v={'buffer':0,'byteOffset':len(buf),'byteLength':len(data)}
        if target: v['target']=target
        views.append(v);buf.extend(data)
        a={'bufferView':len(views)-1,'componentType':ctype,'count':int(arr.shape[0]),'type':typ}
        if mm: a['min']=arr.min(0).tolist();a['max']=arr.max(0).tolist()
        accs.append(a);return len(accs)-1
    ip=add(pos.astype(np.float32),5126,'VEC3',34962,True);inn=add(nrm.astype(np.float32),5126,'VEC3',34962);iu=add(uv.astype(np.float32),5126,'VEC2',34962)
    ii=add(idx.reshape(-1).astype(np.uint32),5125,'SCALAR',34963)
    imgs=[]
    for data,mime in images:
        while len(buf)%4: buf.append(0)
        views.append({'buffer':0,'byteOffset':len(buf),'byteLength':len(data)});buf.extend(data);imgs.append({'bufferView':len(views)-1,'mimeType':mime})
    while len(buf)%4: buf.append(0)
    j={'asset':{'version':'2.0','generator':'kluft base bake'},'scene':0,'scenes':[{'nodes':[0]}],
       'nodes':[{'name':'Base','mesh':0}],'meshes':[{'name':'Base','primitives':[{'attributes':{'POSITION':ip,'NORMAL':inn,'TEXCOORD_0':iu},'indices':ii,'material':0}]}],
       'materials':[material],'textures':[{'source':i,'sampler':0} for i in range(len(imgs))],'images':imgs,
       'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}],
       'accessors':accs,'bufferViews':views,'buffers':[{'byteLength':len(buf)}]}
    js=json.dumps(j,separators=(',',':')).encode()
    while len(js)%4: js+=b' '
    with open(path,'wb') as f:
        f.write(struct.pack('<4sII',b'glTF',2,12+8+len(js)+8+len(buf)));f.write(struct.pack('<I4s',len(js),b'JSON'));f.write(js)
        f.write(struct.pack('<I4s',len(buf),b'BIN\x00'));f.write(bytes(buf))
