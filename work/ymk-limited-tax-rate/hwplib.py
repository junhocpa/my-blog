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
        self._var={}                        # (base,shade,size) -> clone id

    # ---------- DocInfo : 노란 음영 글자모양 ----------
    def _charshape_indices(self):
        return [i for i,r in enumerate(self.info) if r[0]==21]
    def variant(self, base, shade=None, size=None):
        key=(base,shade,size)
        if key in self._var: return self._var[key]
        idxs=self._charshape_indices()
        data=bytearray(self.info[idxs[base]][2])
        if shade is not None: struct.pack_into('<I',data,60,shade)     # shadeColor
        if size  is not None:
            struct.pack_into('<i',data,42,size)                        # baseSize
            for k in range(7): data[14+k]=100                          # 장평 100%
        new_id=len(idxs)
        self.info.insert(idxs[-1]+1,[21,self.info[idxs[-1]][1],bytes(data)])
        for i,r in enumerate(self.info):               # ID_MAPPINGS[9] = 글자모양 개수
            if r[0]==17:
                m=bytearray(r[2]); struct.pack_into('<I',m,9*4,new_id+1); self.info[i][2]=bytes(m); break
        self._var[key]=new_id
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
    def set(self,h,new,marks=(),small=()):
        b=self.body; full=new+'\r'; data=full.encode('utf-16-le')
        hd=bytearray(b[h][2]); old=struct.unpack('<I',bytes(hd[0:4]))[0]
        struct.pack_into('<I',hd,0,(old & 0x80000000)|len(full)); b[h][2]=bytes(hd)
        if b[h+1][0]==67: b[h+1][2]=data
        else: b.insert(h+1,[67,b[h+1][1],data])
        spans=[(m,{'shade':YELLOW}) for m in marks]+[(m,{'size':800}) for m in small]
        if spans: self.style(h,spans)
    def style(self,h,spans):
        """spans: [(부분문자열, {'shade':..,'size':..}), ...]"""
        t=self.text(h); base=self.base_id(h); segs=[]
        for sub,kw in spans:
            p=t.find(sub)
            if p<0: raise KeyError(f'not found: {sub!r} in {t!r}')
            segs.append((p,p+len(sub),self.variant(base,**kw)))
        segs.sort()
        pairs=[]
        for s,e,cid in segs:
            if not pairs and s>0: pairs.append((0,base))
            pairs.append((s,cid)); pairs.append((e,base))
        if not pairs or pairs[0][0]!=0: pairs.insert(0,(0,base))
        # 마지막 구간이 문단 끝이면 잉여 pair 제거
        if len(pairs)>1 and pairs[-1][0]>=len(t): pairs.pop()
        j=self._charshape_rec(h)
        self.body[j][2]=b''.join(struct.pack('<II',p,c) for p,c in pairs)
        hd=bytearray(self.body[h][2])                 # ★ nCharShapes 동기화
        struct.pack_into('<H',hd,12,len(pairs)); self.body[h][2]=bytes(hd)
    def append(self,h,suffix,marks=(),small=()): self.set(h,self.text(h)[:-1]+suffix,marks,small)
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
        self.verify()
        return dst

    def verify(self):
        """PARA_HEADER의 nChars/nCharShapes/nLineSegs 가 실제 레코드와 일치하는지 검사"""
        b=self.body; bad=[]
        for i,r in enumerate(b):
            if r[0]!=66: continue
            nch=struct.unpack('<I',r[2][0:4])[0] & 0x7fffffff
            ncs=struct.unpack('<H',r[2][12:14])[0]
            nls=struct.unpack('<H',r[2][16:18])[0]
            tl=1; cs=ls=None
            for j in range(i+1,len(b)):
                if b[j][0]==66: break
                if b[j][0]==67: tl=len(b[j][2])//2
                if b[j][0]==68: cs=len(b[j][2])//8
                if b[j][0]==69: ls=len(b[j][2])//36
            if tl!=nch: bad.append((i,'nChars',nch,tl))
            if cs is not None and cs!=ncs: bad.append((i,'nCharShapes',ncs,cs))
            if ls is not None and ls!=nls: bad.append((i,'nLineSegs',nls,ls))
        if bad: raise AssertionError(f"문단 무결성 불일치 {len(bad)}건: {bad[:6]}")
        return True
