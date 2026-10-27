import struct, math
# ---------- geometry (mm), Z up ----------
L, W, H, T = 3200, 4100, 2700, 100   # room interior, height, wall thickness
objects = {}  # name -> (material, [boxes])
def add(name, mat, box): objects.setdefault(name,(mat,[]))[1].append(box)

def wall(name, axis, fixed, u0, u1, openings, inside_sign):
    # wall slab along axis 'x' or 'y'; thickness outward from fixed
    cuts = sorted({u0,u1,*[o[0] for o in openings],*[o[1] for o in openings]})
    for a,b in zip(cuts,cuts[1:]):
        zs=[(0,H)]
        for o in openings:
            if o[0]<=a and b<=o[1]:
                nz=[]
                for z0,z1 in zs:
                    if o[2]>z0: nz.append((z0,min(z1,o[2])))
                    if o[3]<z1: nz.append((max(z0,o[3]),z1))
                zs=nz
        t0,t1 = (fixed, fixed-T*inside_sign) 
        t0,t1 = min(t0,t1),max(t0,t1)
        for z0,z1 in zs:
            if axis=='x': add(name,'wall',(a,t0,z0,b,t1,z1))
            else: add(name,'wall',(t0,a,z0,t1,b,z1))

# Стена 1 (y=0) — окно 1400 шир, подоконник 900, верх 2400
wall('Stena1','x',0,-T,L+T,[(900,2300,900,2400)],-1)
# Стена 2 (x=L) — дверь 800 шир, 2100 выс
wall('Stena2','y',L,0,W,[(300,1100,0,2100)],-1)
wall('Stena3','x',W,-T,L+T,[],-1)
wall('Stena4','y',0,0,W,[],1)
add('Pol','floor',(-T,-T,-20,L+T,W+T,0))
# Розетки (красные, 80x80, выступ 20) и вывод воды (синий)
for i,(x,z) in enumerate([(400,300),(2600,1100)]):
    add(f'Rozetka{i+1}','socket',(x-40,W-20,z-40,x+40,W,z+40))   # на стене 3
add('Rozetka3','socket',(0,1800-40,300-40,20,1800+40,300+40))  # на стене 4
add('Voda','water',(0,3000-30,500-30,60,3000+30,500+30))       # на стене 4

mats={'wall':(220,220,215),'floor':(170,140,100),'socket':(220,30,30),'water':(30,90,220)}

def box_mesh(b):
    x0,y0,z0,x1,y1,z1=b
    v=[(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0),(x0,y0,z1),(x1,y0,z1),(x1,y1,z1),(x0,y1,z1)]
    f=[(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    return v,f
def obj_mesh(boxes):
    V=[];F=[]
    for b in boxes:
        v,f=box_mesh(b);o=len(V);V+=v;F+=[(a+o,c+o,d+o) for a,c,d in f]
    return V,F

# ---------- OBJ (Y up) ----------
def write_obj(fn, s):
    with open(fn+'.mtl','w') as m:
        for k,(r,g,b) in mats.items(): m.write(f'newmtl {k}\nKd {r/255:.3f} {g/255:.3f} {b/255:.3f}\n\n')
    with open(fn+'.obj','w') as o:
        o.write(f'mtllib {fn}.mtl\n'); n=1
        for name,(mat,boxes) in objects.items():
            V,F=obj_mesh(boxes); o.write(f'o {name}\nusemtl {mat}\n')
            for x,y,z in V: o.write(f'v {x*s:.4f} {z*s:.4f} {-y*s:.4f}\n')
            for a,b,c in F: o.write(f'f {a+n} {b+n} {c+n}\n')
            n+=len(V)

# ---------- 3DS (Z up) ----------
def chunk(cid,data): return struct.pack('<HI',cid,6+len(data))+data
def write_3ds(fn,s):
    mat=b''.join(chunk(0xAFFF, chunk(0xA000,k.encode()+b'\0')+chunk(0xA020,chunk(0x0011,bytes(c))))
                 for k,c in mats.items())
    objs=b''
    for name,(m,boxes) in objects.items():
        V,F=obj_mesh(boxes)
        vl=struct.pack('<H',len(V))+b''.join(struct.pack('<3f',x*s,y*s,z*s) for x,y,z in V)
        fm=chunk(0x4130,m.encode()+b'\0'+struct.pack('<H',len(F))+b''.join(struct.pack('<H',i) for i in range(len(F))))
        fl=chunk(0x4120,struct.pack('<H',len(F))+b''.join(struct.pack('<4H',a,b,c,7) for a,b,c in F)+fm)
        objs+=chunk(0x4000,name.encode()+b'\0'+chunk(0x4100,chunk(0x4110,vl)+fl))
    edit=chunk(0x3D3E,struct.pack('<I',3))+mat+objs
    open(fn,'wb').write(chunk(0x4D4D,chunk(0x0002,struct.pack('<I',3))+chunk(0x3D3D,edit)))

write_3ds('komnata_mm.3ds',1); write_3ds('komnata_cm.3ds',0.1)
write_obj('komnata_mm',1)

# preview
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
fig=plt.figure(figsize=(8,7));ax=fig.add_subplot(projection='3d')
for name,(m,boxes) in objects.items():
    V,F=obj_mesh(boxes)
    ax.add_collection3d(Poly3DCollection([[V[i] for i in f] for f in F],facecolor=[c/255 for c in mats[m]],edgecolor='k',linewidth=0.1,alpha=0.9))
ax.set_xlim(-200,3400);ax.set_ylim(-200,4300);ax.set_zlim(0,3000);ax.view_init(35,-120);ax.set_box_aspect((3600,4500,3000))
plt.savefig('preview.png',dpi=90,bbox_inches='tight')
