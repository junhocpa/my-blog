import olefile, zlib, struct, shutil
from cfb import write_cfb

def parse(d):
    i=0; recs=[]
    while i < len(d)-3:
        h=struct.unpack('<I', d[i:i+4])[0]
        tag=h&0x3ff; lvl=(h>>10)&0x3ff; sz=(h>>20)&0xfff; i+=4
        if sz==0xfff: sz=struct.unpack('<I', d[i:i+4])[0]; i+=4
        recs.append([tag,lvl,d[i:i+sz]]); i+=sz
    return recs

def build(recs):
    out=bytearray()
    for tag,lvl,data in recs:
        sz=len(data)
        if sz>=0xfff:
            out+=struct.pack('<I',(tag&0x3ff)|((lvl&0x3ff)<<10)|(0xfff<<20))+struct.pack('<I',sz)
        else:
            out+=struct.pack('<I',(tag&0x3ff)|((lvl&0x3ff)<<10)|(sz<<20))
        out+=data
    return bytes(out)

YELLOW=0x0000FFFF   # COLORREF 0x00BBGGRR -> R=FF,G=FF,B=00

class Hwp:
    """현행 서식 HWP 편집기 — 텍스트 치환 + 노란 음영(형광) 지정"""
    def __init__(self, src):
        self.src=src
        ole=olefile.OleFileIO(src)
        self.body_raw=ole.openstream('BodyText/Section0').read()
        self.info_raw=ole.openstream('DocInfo').read()
        self.body=parse(zlib.decompress(self.body_raw,-15))
        self.info=parse(zlib.decompress(self.info_raw,-15))
        self._yellow={}                      # base charshape id -> yellow clone id

    # ---------- DocInfo : 노란 음영 글자모양 ----------
    def _charshape_indices(self):
        return [i for i,r in enumerate(self.info) if r[0]==21]
    def yellow_id(self, base):
        if base in self._yellow: return self._yellow[base]
        idxs=self._charshape_indices()
        data=bytearray(self.info[idxs[base]][2])
        struct.pack_into('<I',data,60,YELLOW)          # shadeColor
        new_id=len(idxs)
        self.info.insert(idxs[-1]+1,[21,self.info[idxs[-1]][1],bytes(data)])
        for i,r in enumerate(self.info):               # ID_MAPPINGS[9] = 글자모양 개수
            if r[0]==17:
                m=bytearray(r[2]); struct.pack_into('<I',m,9*4,new_id+1); self.info[i][2]=bytes(m); break
        self._yellow[base]=new_id
        return new_id

    # ---------- BodyText ----------
    def paras(self): return [i for i,r in enumerate(self.body) if r[0]==66]
    def text(self,h):
        b=self.body
        return b[h+1][2].decode('utf-16-le') if h+1<len(b) and b[h+1][0]==67 else ''
    def _charshape_rec(self,h):
        for j in range(h+1,min(h+4,len(self.body))):
            if self.body[j][0]==68: return j
        raise KeyError('charshape rec')
    def base_id(self,h):
        d=self.body[self._charshape_rec(h)][2]
        return struct.unpack('<II',d[0:8])[1]
    def set(self,h,new,marks=()):
        """marks: 노란 음영을 넣을 부분문자열 목록"""
        b=self.body; full=new+'\r'; data=full.encode('utf-16-le')
        hd=bytearray(b[h][2]); old=struct.unpack('<I',bytes(hd[0:4]))[0]
        struct.pack_into('<I',hd,0,(old & 0x80000000)|len(full)); b[h][2]=bytes(hd)
        if b[h+1][0]==67: b[h+1][2]=data
        else: b.insert(h+1,[67,b[h+1][1],data])
        if marks: self.highlight(h,marks)
    def highlight(self,h,marks):
        t=self.text(h); base=self.base_id(h); yid=self.yellow_id(base)
        spans=[]
        for m in marks:
            p=t.find(m)
            if p<0: raise KeyError(f'mark not found: {m!r} in {t!r}')
            spans.append((p,p+len(m)))
        spans.sort()
        pairs=[]; 
        for s,e in spans:
            if not pairs and s>0: pairs.append((0,base))
            elif not pairs: pass
            pairs.append((s,yid)); pairs.append((e,base))
        if not pairs or pairs[0][0]!=0: pairs.insert(0,(0,base))
        j=self._charshape_rec(h)
        self.body[j][2]=b''.join(struct.pack('<II',p,c) for p,c in pairs)
    def append(self,h,suffix,marks=()): self.set(h,self.text(h)[:-1]+suffix,marks)
    def sub(self,h,old,new,marks=()): self.set(h,self.text(h)[:-1].replace(old,new,1),marks)
    def idx_of(self,obj):
        for i,r in enumerate(self.body):
            if r is obj: return i
        raise KeyError
    def find(self,needle,start=0):
        for h in self.paras():
            if h>=start and needle in self.text(h): return h
        raise KeyError(needle)

    # ---------- 저장 ----------
    def save(self,dst):
        ole=olefile.OleFileIO(self.src)
        raw={"/".join(p):ole.openstream("/".join(p)).read() for p in ole.listdir()}
        def pack(recs):
            co=zlib.compressobj(9,zlib.DEFLATED,-15)
            return co.compress(build(recs))+co.flush()
        raw['BodyText/Section0']=pack(self.body)
        raw['DocInfo']=pack(self.info)
        tree={}
        for path,data in raw.items():
            if '/' in path:
                st,nm=path.split('/',1); tree.setdefault(st,{})[nm]=data
            else:
                tree[path]=data
        write_cfb(dst,tree)
        v=olefile.OleFileIO(dst)
        got={"/".join(p):v.openstream("/".join(p)).read() for p in v.listdir()}
        assert sorted(got)==sorted(raw), "stream set mismatch"
        for k in raw: assert got[k]==raw[k], f"stream differs: {k}"
        assert [tuple(r) for r in parse(zlib.decompress(got['BodyText/Section0'],-15))]==[tuple(r) for r in self.body]
        assert [tuple(r) for r in parse(zlib.decompress(got['DocInfo'],-15))]==[tuple(r) for r in self.info]
        return dst
