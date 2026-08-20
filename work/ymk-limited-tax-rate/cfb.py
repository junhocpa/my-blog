"""최소 CFB(OLE2) 라이터 — 스트림 크기를 자유롭게 쓰기 위한 용도."""
import struct

FREESECT=0xFFFFFFFF; ENDOFCHAIN=0xFFFFFFFE; FATSECT=0xFFFFFFFD; DIFSECT=0xFFFFFFFC
SECT=512; MINISECT=64; CUTOFF=4096

class Entry:
    def __init__(self,name,typ,data=None):
        self.name=name; self.typ=typ; self.data=data
        self.children=[]; self.left=0xFFFFFFFF; self.right=0xFFFFFFFF; self.child=0xFFFFFFFF
        self.start=ENDOFCHAIN; self.size=0; self.id=None

def _sortkey(e): return (len(e.name), e.name.upper())

def _tree(ids, entries):
    """정렬된 id 목록 -> 균형 이진트리 루트 id"""
    if not ids: return 0xFFFFFFFF
    m=len(ids)//2
    e=entries[ids[m]]
    e.left=_tree(ids[:m],entries)
    e.right=_tree(ids[m+1:],entries)
    return ids[m]

def write_cfb(path, tree):
    """tree: {'name': bytes|dict}  — dict면 storage, bytes면 stream"""
    entries=[Entry('Root Entry',5)]
    def add(node, parent):
        kids=[]
        for name,val in node.items():
            if isinstance(val,dict):
                e=Entry(name,1); entries.append(e); e.id=len(entries)-1
                kids.append(e.id); add(val,e)
            else:
                e=Entry(name,2,val); entries.append(e); e.id=len(entries)-1
                e.size=len(val); kids.append(e.id)
        kids.sort(key=lambda i:_sortkey(entries[i]))
        parent.child=_tree(kids,entries)
    add(tree,entries[0])

    # ---- 스트림 배치 ----
    big=[]; mini=[]
    for e in entries:
        if e.typ!=2: continue
        (big if e.size>=CUTOFF else mini).append(e)

    ministream=bytearray()
    minifat=[]
    for e in mini:
        e.start=len(ministream)//MINISECT
        n=(e.size+MINISECT-1)//MINISECT or 1
        base=len(minifat)
        for k in range(n): minifat.append(base+k+1)
        minifat[-1]=ENDOFCHAIN
        ministream+=e.data+b'\x00'*(n*MINISECT-e.size)

    sectors=[]; fat=[]
    def alloc(data):
        n=(len(data)+SECT-1)//SECT or 1
        first=len(sectors)
        buf=data+b'\x00'*(n*SECT-len(data))
        for k in range(n):
            sectors.append(buf[k*SECT:(k+1)*SECT])
            fat.append(first+k+1)
        fat[-1]=ENDOFCHAIN
        return first,n
    for e in big:
        e.start,_=alloc(e.data)
    mini_start=ENDOFCHAIN
    if ministream:
        mini_start,_=alloc(bytes(ministream))
    entries[0].start=mini_start; entries[0].size=len(ministream)

    minifat_start=ENDOFCHAIN; minifat_n=0
    if minifat:
        mf=b''.join(struct.pack('<I',x) for x in minifat)
        mf+=b'\xff'*(((len(mf)+SECT-1)//SECT)*SECT-len(mf))
        minifat_start,minifat_n=alloc(mf)

    # 디렉터리
    def dirbytes():
        out=bytearray()
        for e in entries:
            nm=e.name.encode('utf-16-le')+b'\x00\x00'
            b=bytearray(128)
            b[0:len(nm)]=nm
            struct.pack_into('<H',b,64,len(nm))
            b[66]=e.typ; b[67]=1                      # black
            struct.pack_into('<III',b,68,e.left,e.right,e.child)
            struct.pack_into('<I',b,116,e.start)
            struct.pack_into('<II',b,120,e.size&0xFFFFFFFF,0)
            out+=b
        pad=(-len(out))%SECT
        if pad: out+=b'\x00'*pad
        return bytes(out)
    dir_start,dir_n=alloc(dirbytes())

    # FAT 자체가 차지할 섹터 수 수렴 계산
    nfat=1
    while True:
        total=len(fat)+nfat
        need=(total*4+SECT-1)//SECT
        if need<=nfat: break
        nfat+=1
    fat_sectors=[len(sectors)+i for i in range(nfat)]
    full=fat+[FATSECT]*nfat
    full+= [FREESECT]*((nfat*SECT//4)-len(full))
    fatdata=b''.join(struct.pack('<I',x) for x in full)
    for i in range(nfat): sectors.append(fatdata[i*SECT:(i+1)*SECT])

    hdr=bytearray(SECT)
    hdr[0:8]=b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'
    struct.pack_into('<HH',hdr,24,0x003E,0x0003)
    struct.pack_into('<H',hdr,28,0xFFFE)
    struct.pack_into('<HH',hdr,30,9,6)
    struct.pack_into('<I',hdr,44,nfat)
    struct.pack_into('<I',hdr,48,dir_start)
    struct.pack_into('<I',hdr,56,CUTOFF)
    struct.pack_into('<I',hdr,60,minifat_start)
    struct.pack_into('<I',hdr,64,minifat_n)
    struct.pack_into('<I',hdr,68,ENDOFCHAIN)
    struct.pack_into('<I',hdr,72,0)
    for i in range(109):
        struct.pack_into('<I',hdr,76+i*4, fat_sectors[i] if i<nfat else FREESECT)
    with open(path,'wb') as f:
        f.write(bytes(hdr))
        for s in sectors: f.write(s)
    return path
