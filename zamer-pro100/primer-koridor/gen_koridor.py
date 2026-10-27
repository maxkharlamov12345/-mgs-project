import struct, math
H=2873; T=100
# ---- план: стены по порядку, интерьер слева по ходу ----
# поворот на углу: + влево (внутренний угол), - вправо (внешний)
walls=[('Stena_A',618),('Stena_B',1829),('Stena_V',2276),('Stena_G',585+800+300)]
turn_after=[180-90.03, -(180-88.1), 180-90.03]   # A/Б 90.0, Б/В внешний 88.1, В/Г 90.0
# старт: А идёт от свободного конца к углу А/Б (направление -y)
pts=[(0.0,618.0)]; ang=-90.0; dirs=[]
for i,(n,l) in enumerate(walls):
    d=(math.cos(math.radians(ang)),math.sin(math.radians(ang))); dirs.append(d)
    x,y=pts[-1]; pts.append((x+d[0]*l,y+d[1]*l))
    if i<len(turn_after): ang+=turn_after[i]
objects={}
def add(name,mat,verts,faces): objects.setdefault(name,(mat,[],[])); m=objects[name]; o=len(m[1]); m[1].extend(verts); m[2].extend([(a+o,b+o,c+o) for a,b,c in faces])
BF=[(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
def lbox(name,mat,S,d,u0,u1,t0,t1,z0,z1):
    # u вдоль стены, t: + внутрь помещения (влево), - наружу
    m=(-d[1],d[0]); v=[]
    for z in (z0,z1):
        for u,t in ((u0,t0),(u1,t0),(u1,t1),(u0,t1)):
            v.append((S[0]+d[0]*u+m[0]*t,S[1]+d[1]*u+m[1]*t,z))
    add(name,mat,v,BF)
def wall(i,openings,ext0,ext1):
    name,l=walls[i]; S=pts[i]; d=dirs[i]
    u0,u1=-ext0,l+ext1
    cuts=sorted({u0,u1,*[o[0] for o in openings],*[o[1] for o in openings]})
    for a,b in zip(cuts,cuts[1:]):
        zs=[(0,H)]
        for o in openings:
            if o[0]<=a and b<=o[1]:
                nz=[]
                for z0,z1 in zs:
                    if o[2]>z0: nz.append((z0,min(z1,o[2])))
                    if o[3]<z1: nz.append((max(z0,o[3]),z1))
                zs=nz
        for z0,z1 in zs: lbox(name,'wall',S,d,a,b,-T,0,z0,z1)
# А: от свободного конца к углу; угол А/Б внутренний -> удлинить на T
wall(0,[],0,T)
wall(1,[],T,0)        # Б: внешний угол на конце -> без удлинения
wall(2,[],0,T)        # В
wall(3,[(585,585+800,0,2125)],T,0)   # Г: проём 585 от угла, шир. 800 (допущение), выс. 2125
def on_wall(i,name,mat,u_from_corner_end,w,zb,h,dep,from_end=False):
    l=walls[i][1]; u=(l-u_from_corner_end) if from_end else u_from_corner_end
    u0,u1=(u-w,u) if from_end else (u,u+w)
    lbox(name,mat,pts[i],dirs[i],u0,u1,0,dep,zb,zb+h)
# А: щиток 267x267, 217 от угла А/Б, низ 1212 (угол в конце стены А)
on_wall(0,'Shitok_267x267','panel',217,267,1212,267,20,from_end=True)
# Б: электрощит 398x535, 158 от угла А/Б, низ 1415, глубина 40
on_wall(1,'Elektroshit_398x535','dark',158,398,1415,535,40)
# Б: розетка, центр 1461 от угла А/Б, центр по высоте 2155
on_wall(1,'Rozetka_B_h2155','socket',1461-40,80,2155-40,80,20)
# В: розетка, центр 258 от угла В/Г, высота центра 264
on_wall(2,'Rozetka_V_h264','socket',258-40,80,264-40,80,20,from_end=True)
# пол
P=pts; fl=[P[0],P[1],P[2],P[3],P[4],(P[4][0],P[0][1])]
cx=sum(p[0] for p in fl)/len(fl); cy=sum(p[1] for p in fl)/len(fl)
v=[(x,y,-20) for x,y in fl]+[(x,y,0) for x,y in fl]; n=len(fl); f=[]
def earclip(P):
    idx=list(range(len(P)));tri=[]
    area=sum(P[i][0]*P[(i+1)%len(P)][1]-P[(i+1)%len(P)][0]*P[i][1] for i in range(len(P)))
    sg=1 if area>0 else -1
    def cr(a,b,c): return ((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))*sg
    while len(idx)>3:
        for k in range(len(idx)):
            a,b,c=idx[k-1],idx[k],idx[(k+1)%len(idx)]
            if cr(P[a],P[b],P[c])<=0: continue
            if any(cr(P[a],P[b],P[q])>0 and cr(P[b],P[c],P[q])>0 and cr(P[c],P[a],P[q])>0 for q in idx if q not in(a,b,c)): continue
            tri.append((a,b,c) if sg>0 else (a,c,b)); idx.pop(k); break
    a,b,c=idx; tri.append((a,b,c) if sg>0 else (a,c,b)); return tri
for a,b,c in earclip(fl): f+=[(a,c,b),(n+a,n+b,n+c)]
for k in range(n): j=(k+1)%n; f+=[(k,j,n+j),(k,n+j,n+k)]
add('Pol','floor',v,f)
mats={'wall':(225,222,212),'floor':(170,140,100),'socket':(220,30,30),'panel':(250,250,250),'dark':(30,30,30)}
def write_obj(fn,s):
    open(fn+'.mtl','w').write(''.join(f'newmtl {k}\nKd {r/255:.3f} {g/255:.3f} {b/255:.3f}\n\n' for k,(r,g,b) in mats.items()))
    with open(fn+'.obj','w') as o:
        o.write(f'mtllib {fn}.mtl\n'); base=1
        for nm,(m,V,F) in objects.items():
            o.write(f'o {nm}\nusemtl {m}\n')
            for x,y,z in V: o.write(f'v {x*s:.3f} {z*s:.3f} {-y*s:.3f}\n')
            for a,b,c in F: o.write(f'f {a+base} {b+base} {c+base}\n')
            base+=len(V)
def chunk(c,d): return struct.pack('<HI',c,6+len(d))+d
def write_3ds(fn,s):
    mat=b''.join(chunk(0xAFFF,chunk(0xA000,k.encode()+b'\0')+chunk(0xA020,chunk(0x0011,bytes(c)))) for k,c in mats.items())
    objs=b''
    for nm,(m,V,F) in objects.items():
        vl=struct.pack('<H',len(V))+b''.join(struct.pack('<3f',x*s,y*s,z*s) for x,y,z in V)
        fm=chunk(0x4130,m.encode()+b'\0'+struct.pack('<H',len(F))+b''.join(struct.pack('<H',i) for i in range(len(F))))
        fl_=chunk(0x4120,struct.pack('<H',len(F))+b''.join(struct.pack('<4H',a,b,c,7) for a,b,c in F)+fm)
        objs+=chunk(0x4000,nm[:10].encode()+b'\0'+chunk(0x4100,chunk(0x4110,vl)+fl_))
    open(fn,'wb').write(chunk(0x4D4D,chunk(0x0002,struct.pack('<I',3))+chunk(0x3D3D,chunk(0x3D3E,struct.pack('<I',3))+mat+objs)))
write_3ds('koridor_primer_mm.3ds',1); write_3ds('koridor_primer_cm.3ds',0.1); write_obj('koridor_primer_mm',1)
for i,p in enumerate(pts): print(i,[round(c) for c in p])
# ---- превью: план + 3D ----
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection
fig=plt.figure(figsize=(15,7))
ax=fig.add_subplot(1,2,1); ax.set_aspect('equal'); ax.set_title('План (вид сверху), мм')
for i,(n,l) in enumerate(walls):
    a,b=pts[i],pts[i+1]; ax.plot([a[0],b[0]],[a[1],b[1]],'k',lw=3)
    mx,my=(a[0]+b[0])/2,(a[1]+b[1])/2; m=(-dirs[i][1],dirs[i][0])
    ax.text(mx+m[0]*180,my+m[1]*180,f"{['А','Б','В','Г'][i]}\n{l}",ha='center',va='center',fontsize=10,color='navy')
g0=pts[3]; d=dirs[3]
ax.plot([g0[0]+d[0]*585,g0[0]+d[0]*1385],[g0[1]+d[1]*585,g0[1]+d[1]*1385],color='white',lw=4)
ax.text(g0[0]+d[0]*985,g0[1]-200,'проём 800?\nh 2125',ha='center',fontsize=9,color='red')
ax.text(pts[2][0]-150,pts[2][1]+150,'внешний\n88.1°',ha='right',fontsize=9,color='red')
ax.grid(alpha=.3)
ax3=fig.add_subplot(1,2,2,projection='3d')
for nm,(m,V,F) in objects.items():
    ax3.add_collection3d(Poly3DCollection([[V[i] for i in f] for f in F],facecolor=[c/255 for c in mats[m]],edgecolor='k',linewidth=.1,alpha=.95))
xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
ax3.set_xlim(min(xs)-300,max(xs)+300); ax3.set_ylim(min(ys)-300,max(ys)+300); ax3.set_zlim(0,3000)
ax3.set_box_aspect((max(xs)-min(xs)+600,max(ys)-min(ys)+600,3000)); ax3.view_init(30,70)
plt.savefig('proverka.png',dpi=80,bbox_inches='tight')
