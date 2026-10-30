/*
 * MGS — размеры в PRO100 7.08 (x64).
 *
 * Менеджер ставит размерные линии прямо в окне PRO100 (перспектива и любые виды):
 *   «Экспорт → Размеры MGS» включает режим; курсор сам прилипает к углам и серединам рёбер
 *   видимых деталей; щелчок — первая точка, щелчок — вторая, третий щелчок — куда вынести линию.
 * Размеры:
 *   - привязаны к деталям (GUID детали + номер угла) — двигаешь шкаф, размер едет за ним;
 *   - хранятся ВНУТРИ проекта (свойство проекта «MGS.Dims») — сохраняются в .sto вместе с проектом;
 *   - при «Отправить в MGS 3D» уходят на сайт (mgs3d.plg вызывает MgsDimsWriteJson).
 *
 * Как устроено: PRO100 рисует сцену через OpenGL (матрицы fixed pipeline). Подменяем в таблице импорта
 * PRO100.exe функцию SwapBuffers: перед показом кадра дорисовываем размеры поверх сцены.
 * Мышь — подклассом окна вида. Детали и их габариты — через интерфейсы плагинов PRO100
 * (восстановлены по PRO100.exe 7.08, сборка 11.07.2024; на другой сборке плагин не включается).
 */
#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#define _UNICODE
#include <windows.h>
#include <oleauto.h>
#include <shlobj.h>
#include <GL/gl.h>
#include <stdio.h>
#include <wchar.h>
#include <math.h>

/* ---------------- интерфейсы PRO100 ---------------- */
static const GUID IID_IUnknown_     = {0x00000000,0x0000,0x0000,{0xC0,0x00,0x00,0x00,0x00,0x00,0x00,0x46}};
static const GUID IID_IPlugin       = {0xe987c0b2,0x5651,0x4b1b,{0x98,0x37,0xb6,0x95,0xaf,0x8e,0x1d,0x22}};
static const GUID IID_IPluginInit   = {0x6f0f1740,0x5872,0x4ae9,{0x9c,0x33,0x9b,0xa6,0xa6,0x7e,0x4c,0x14}};
static const GUID IID_IPluginDone   = {0xb4dee719,0x24e8,0x4feb,{0x87,0xb9,0xa1,0x8b,0x9f,0xb5,0x38,0x5a}};
static const GUID IID_IExportPlugin = {0x9cad3fed,0x94fe,0x4ac6,{0xa9,0x90,0x6c,0x60,0x49,0x67,0x68,0xfd}};
static const GUID IID_IApplication  = {0x58ff9736,0x001f,0x427d,{0xbf,0xf1,0x36,0xd0,0x30,0x50,0x5b,0xcd}};
static const GUID IID_IEntity       = {0xdc7000af,0xb69b,0x4f49,{0x97,0xf5,0x82,0xa2,0x07,0x02,0x49,0xde}};

/* номера методов (0..2 — IUnknown) */
enum {
  APP_PROJECT = 11,                   /* IApplication: активный проект → IProject */
  PRJ_TOPLIST = 7,                    /* IProject: элементы верхнего уровня → IEntityList */
  PRJ_PROPS   = 15,                   /* IProject: свойства проекта → IPropertyList (сохраняются в .sto) */
  PRJ_BBOX    = 16,                   /* IProject: габариты проекта → IBoundingBox */
  PRJ_FILE    = 18,                   /* IProject: строка документа (имя файла) — только в журнал */
  LST_ITEM = 4, LST_COUNT = 5,        /* IEntityList */
  ENT_BBOX = 13, ENT_IDENT = 32,      /* IEntity */
  ENT_CHILDREN = 41,                  /* IEntity: вложенные элементы (у группы — её детали, у детали — пусто) */
  BB_MINX = 3,                        /* IBoundingBox: 3..5 — min XYZ, 6..8 — max XYZ, метры */
  IDN_GUID = 3,                       /* IIdentity: GUID элемента строкой */
  PL_GET = 4, PL_SET = 5              /* IPropertyList: Get(name, out value), Set(name, value) */
};
/* сборка PRO100.exe, под которую восстановлены номера методов */
#define P100_TIMESTAMP 0x668fe981u
#define P100_IMAGESIZE 0x1535000u

typedef HRESULT (__stdcall *QI_t)(void*, const GUID*, void**);
typedef ULONG   (__stdcall *AR_t)(void*);
typedef HRESULT (__stdcall *OutP_t)(void*, void**);
typedef HRESULT (__stdcall *OutI_t)(void*, int*);
typedef HRESULT (__stdcall *OutD_t)(void*, double*);
typedef HRESULT (__stdcall *OutS_t)(void*, BSTR*);
typedef HRESULT (__stdcall *Item_t)(void*, int, void**);
typedef HRESULT (__stdcall *GetS_t)(void*, BSTR, BSTR*);
typedef HRESULT (__stdcall *SetS_t)(void*, BSTR, BSTR);
typedef HRESULT (__stdcall *Exec_t)(void*, void*);

#define VT(p) (*(void***)(p))
static HRESULT xQI(void *p, const GUID *g, void **o){ *o=NULL; return p ? ((QI_t)VT(p)[0])(p,g,o) : E_POINTER; }
static void xRelease(void *p){ if(p) ((AR_t)VT(p)[2])(p); }
static void *outP(void *o, int slot){ void *r=NULL; if(!o) return NULL; if(FAILED(((OutP_t)VT(o)[slot])(o,&r))) return NULL; return r; }

/* ---------------- общее ---------------- */
static HINSTANCE g_inst;
static void *g_app;
static volatile LONG g_ref = 1;
static wchar_t g_dir[MAX_PATH];
static FILE *g_log;
static int g_ok;                      /* сборка PRO100 та, что нужно; можно работать */

static void logw(const wchar_t *fmt, ...){
  if(!g_log) return;
  SYSTEMTIME t; GetLocalTime(&t);
  fwprintf(g_log, L"%02u:%02u:%02u.%03u  ", t.wHour,t.wMinute,t.wSecond,t.wMilliseconds);
  va_list a; va_start(a,fmt); vfwprintf(g_log,fmt,a); va_end(a);
  fputwc(L'\n',g_log); fflush(g_log);
}
static void openLog(void){
  if(g_log) return;
  wchar_t p[MAX_PATH], la[MAX_PATH];
  if(FAILED(SHGetFolderPathW(NULL,CSIDL_LOCAL_APPDATA,NULL,0,la))) return;
  swprintf(p,MAX_PATH,L"%ls\\MGS3D",la); CreateDirectoryW(p,NULL);
  swprintf(p,MAX_PATH,L"%ls\\MGS3D\\logs",la); CreateDirectoryW(p,NULL);
  swprintf(p,MAX_PATH,L"%ls\\MGS3D\\logs\\dims.log",la);
  /* журнал не растёт бесконечно: больше 2 МБ — начинаем заново */
  WIN32_FILE_ATTRIBUTE_DATA fa;
  if(GetFileAttributesExW(p,GetFileExInfoStandard,&fa) && fa.nFileSizeLow>2*1024*1024) DeleteFileW(p);
  g_log=_wfopen(p,L"a, ccs=UTF-8");
}
static int iniInt(const wchar_t *sec, const wchar_t *key, int def){
  wchar_t p[MAX_PATH]; swprintf(p,MAX_PATH,L"%ls\\mgs3d.ini",g_dir);
  return GetPrivateProfileIntW(sec,key,def,p);
}

/* ---------------- детали проекта (кэш габаритов) ---------------- */
typedef struct { wchar_t id[40]; double mn[3], mx[3]; int group; } Box;
#define MAXBOX 12000
static Box *g_box; static int g_nbox;
static DWORD g_boxTick;

static int bboxOf(void *bb, double mn[3], double mx[3]){
  for(int i=0;i<3;i++){
    if(FAILED(((OutD_t)VT(bb)[BB_MINX+i])(bb,&mn[i]))) return 0;
    if(FAILED(((OutD_t)VT(bb)[BB_MINX+3+i])(bb,&mx[i]))) return 0;
  }
  for(int i=0;i<3;i++){ if(!isfinite(mn[i])||!isfinite(mx[i])||fabs(mn[i])>1e4||fabs(mx[i])>1e4) return 0;
    if(mn[i]>mx[i]){ double t=mn[i]; mn[i]=mx[i]; mx[i]=t; } }
  return 1;
}
static void walkList(void *list, int depth);
static void addEntity(void *unk, int depth){
  void *e=NULL;
  if(FAILED(xQI(unk,&IID_IEntity,&e)) || !e) return;
  if(g_nbox<MAXBOX){
    Box b; memset(&b,0,sizeof b);
    void *bb=outP(e,ENT_BBOX);
    int ok = bb && bboxOf(bb,b.mn,b.mx);
    xRelease(bb);
    void *idn=outP(e,ENT_IDENT); BSTR s=NULL;
    if(idn && SUCCEEDED(((OutS_t)VT(idn)[IDN_GUID])(idn,&s)) && s){ lstrcpynW(b.id,s,40); SysFreeString(s); }
    xRelease(idn);
    void *kids=outP(e,ENT_CHILDREN); int nk=0;
    if(kids) ((OutI_t)VT(kids)[LST_COUNT])(kids,&nk);
    b.group = nk>0;
    double sz=(b.mx[0]-b.mn[0])+(b.mx[1]-b.mn[1])+(b.mx[2]-b.mn[2]);
    if(ok && sz>1e-4) g_box[g_nbox++]=b;
    if(kids && nk>0 && depth<12) walkList(kids,depth+1);
    xRelease(kids);
  }
  xRelease(e);
}
static void walkList(void *list, int depth){
  int n=0;
  if(FAILED(((OutI_t)VT(list)[LST_COUNT])(list,&n)) || n<0 || n>100000) return;
  for(int i=0;i<n && g_nbox<MAXBOX;i++){
    void *it=NULL;
    if(SUCCEEDED(((Item_t)VT(list)[LST_ITEM])(list,i,&it)) && it){ addEntity(it,depth); xRelease(it); }
  }
}
static void *getProject(void){
  void *app=NULL,*prj=NULL;
  if(!g_app || FAILED(xQI(g_app,&IID_IApplication,&app)) || !app) return NULL;
  prj=outP(app,APP_PROJECT); xRelease(app);
  return prj;
}
static void refreshBoxes(int force){
  DWORD now=GetTickCount();
  if(!force && now-g_boxTick<1500) return;
  g_boxTick=now;
  if(!g_box) g_box=(Box*)calloc(MAXBOX,sizeof(Box));
  if(!g_box) return;
  void *prj=getProject(); if(!prj) return;
  void *top=outP(prj,PRJ_TOPLIST);
  int was=g_nbox; g_nbox=0;
  if(top){ walkList(top,0); xRelease(top); }
  xRelease(prj);
  if(force || was!=g_nbox) logw(L"детали: %d (было %d), %lu мс", g_nbox, was, GetTickCount()-now);
}
static Box *findBox(const wchar_t *id){
  if(!id[0]) return NULL;
  for(int i=0;i<g_nbox;i++) if(!wcscmp(g_box[i].id,id)) return &g_box[i];
  return NULL;
}
/* точки привязки детали: 0..7 — углы (бит0 x, бит1 y, бит2 z), 8..19 — середины рёбер, 20 — центр */
#define NPTS 21
static void boxPoint(const Box *b, int k, double p[3]){
  if(k<8){ for(int i=0;i<3;i++) p[i]=(k>>i)&1 ? b->mx[i] : b->mn[i]; return; }
  if(k==20){ for(int i=0;i<3;i++) p[i]=(b->mn[i]+b->mx[i])/2; return; }
  int e=k-8, ax=e/4, r=e%4;            /* ребро вдоль оси ax, r — какие концы у двух других осей */
  int o1=(ax+1)%3, o2=(ax+2)%3;
  p[ax]=(b->mn[ax]+b->mx[ax])/2;
  p[o1]=(r&1)?b->mx[o1]:b->mn[o1];
  p[o2]=(r&2)?b->mx[o2]:b->mn[o2];
}

/* ---------------- размеры ---------------- */
typedef struct { wchar_t id[40]; int k; double p[3]; } Anchor;   /* p — запасные координаты, если детали нет */
typedef struct { Anchor a, b; int axis, offAxis; double off; wchar_t text[24]; } Dim;
#define MAXDIM 400
static Dim g_dim[MAXDIM]; static int g_ndim;
static int g_show = 1;                /* показывать размеры */
static int g_mode;                    /* 1 — режим постановки */
static int g_stage;                   /* 0 — ждём первую точку, 1 — вторую, 2 — вынос */
static Dim g_cur;                     /* размер в работе */
static int g_sel = -1, g_hoverDim = -1;
static BSTR g_lastText;               /* что сейчас лежит в свойстве проекта */
static const wchar_t *PROP = L"MGS.Dims";

static void resolve(const Anchor *a, double p[3]){
  Box *b=findBox(a->id);
  if(b){ boxPoint(b,a->k,p); return; }
  p[0]=a->p[0]; p[1]=a->p[1]; p[2]=a->p[2];
}
/* геометрия размера: точки на деталях A,B; линия D1–D2; значение в мм */
static double dimGeom(const Dim *d, double A[3], double B[3], double D1[3], double D2[3]){
  resolve(&d->a,A); resolve(&d->b,B);
  for(int i=0;i<3;i++){ D1[i]=A[i]; D2[i]=A[i]; }
  D2[d->axis]=B[d->axis];
  D1[d->offAxis]+=d->off; D2[d->offAxis]+=d->off;
  return fabs(B[d->axis]-A[d->axis])*1000.0;
}
static void fmtValue(double mm, wchar_t *out, int cap){
  double r=floor(mm+0.5);
  if(fabs(mm-r)<0.05) swprintf(out,cap,L"%.0f",r); else swprintf(out,cap,L"%.1f",mm);
}

/* сериализация: строка на размер; поля через «|» */
static void serialize(wchar_t **out){
  size_t cap=256+g_ndim*400; wchar_t *s=(wchar_t*)calloc(cap,sizeof(wchar_t)); size_t n=0;
  n+=swprintf(s+n,cap-n,L"MGSDIMS 1\n");
  for(int i=0;i<g_ndim;i++){ Dim *d=&g_dim[i];
    n+=swprintf(s+n,cap-n,L"%ls|%d|%.6f|%.6f|%.6f|%ls|%d|%.6f|%.6f|%.6f|%d|%d|%.6f|%ls\n",
      d->a.id,d->a.k,d->a.p[0],d->a.p[1],d->a.p[2], d->b.id,d->b.k,d->b.p[0],d->b.p[1],d->b.p[2],
      d->axis,d->offAxis,d->off,d->text);
  }
  *out=s;
}
static void parse(const wchar_t *s){
  g_ndim=0; g_sel=-1;
  if(!s || wcsncmp(s,L"MGSDIMS 1",9)) return;
  const wchar_t *p=wcschr(s,L'\n');
  while(p && *++p && g_ndim<MAXDIM){
    Dim d; memset(&d,0,sizeof d);
    wchar_t line[1024]; const wchar_t *e=wcschr(p,L'\n'); size_t L=e?(size_t)(e-p):wcslen(p);
    if(L>=1023){ p=e; continue; }
    wmemcpy(line,p,L); line[L]=0;
    wchar_t *f[14]; int nf=0; wchar_t *c=line; f[nf++]=c;
    for(;*c && nf<14;c++) if(*c==L'|'){ *c=0; f[nf++]=c+1; }
    if(nf>=13){
      lstrcpynW(d.a.id,f[0],40); d.a.k=_wtoi(f[1]); d.a.p[0]=_wtof(f[2]); d.a.p[1]=_wtof(f[3]); d.a.p[2]=_wtof(f[4]);
      lstrcpynW(d.b.id,f[5],40); d.b.k=_wtoi(f[6]); d.b.p[0]=_wtof(f[7]); d.b.p[1]=_wtof(f[8]); d.b.p[2]=_wtof(f[9]);
      d.axis=_wtoi(f[10])%3; d.offAxis=_wtoi(f[11])%3; d.off=_wtof(f[12]);
      if(nf>13) lstrcpynW(d.text,f[13],24);
      if(d.a.k>=0 && d.a.k<NPTS && d.b.k>=0 && d.b.k<NPTS && d.axis!=d.offAxis) g_dim[g_ndim++]=d;
    }
    p=e;
  }
}
static void *getProps(void){ void *prj=getProject(); void *pl=outP(prj,PRJ_PROPS); xRelease(prj); return pl; }
static void saveDims(void){
  /* запасные координаты — на случай, если деталь потом удалят */
  for(int i=0;i<g_ndim;i++){ resolve(&g_dim[i].a,g_dim[i].a.p); resolve(&g_dim[i].b,g_dim[i].b.p); }
  wchar_t *s; serialize(&s);
  void *pl=getProps();
  if(pl){
    BSTR name=SysAllocString(PROP), val=SysAllocString(g_ndim?s:L"");
    HRESULT hr=((SetS_t)VT(pl)[PL_SET])(pl,name,val);
    logw(L"сохранено размеров: %d (hr=0x%08lx)", g_ndim, (unsigned long)hr);
    if(g_lastText) SysFreeString(g_lastText);
    g_lastText=val; SysFreeString(name); xRelease(pl);
  } else logw(L"не удалось сохранить размеры: нет свойств проекта");
  free(s);
}
/* раз в секунду: другой проект / отмена — подхватываем размеры из свойства проекта */
static void syncFromProject(void){
  void *pl=getProps(); if(!pl) return;
  BSTR name=SysAllocString(PROP), val=NULL;
  if(SUCCEEDED(((GetS_t)VT(pl)[PL_GET])(pl,name,&val))){
    const wchar_t *v=val?val:L"", *o=g_lastText?g_lastText:L"";
    if(wcscmp(v,o)){
      parse(v); logw(L"размеры из проекта: %d", g_ndim);
      if(g_lastText) SysFreeString(g_lastText);
      g_lastText=SysAllocString(v);
      g_stage=0;
    }
  }
  if(val) SysFreeString(val);
  SysFreeString(name); xRelease(pl);
}

/* ---------------- математика экрана ---------------- */
typedef struct { double M[16]; int vp[4]; HWND hwnd; int valid; } View;   /* M = P*MV, столбцы как в OpenGL */
static View g_view;                   /* последний кадр окна, где мышь */
static void mul44(const double *a, const double *b, double *o){
  for(int c=0;c<4;c++) for(int r=0;r<4;r++){ double s=0; for(int k=0;k<4;k++) s+=a[k*4+r]*b[c*4+k]; o[c*4+r]=s; }
}
/* мир → окно (x вправо, y вверх как в GL, z 0..1); 0 — точка за камерой */
static int project(const View *v, const double p[3], double s[3]){
  const double *M=v->M;
  double x=M[0]*p[0]+M[4]*p[1]+M[8]*p[2]+M[12];
  double y=M[1]*p[0]+M[5]*p[1]+M[9]*p[2]+M[13];
  double z=M[2]*p[0]+M[6]*p[1]+M[10]*p[2]+M[14];
  double w=M[3]*p[0]+M[7]*p[1]+M[11]*p[2]+M[15];
  if(w<=1e-9) return 0;
  x/=w; y/=w; z/=w;
  s[0]=v->vp[0]+(x*0.5+0.5)*v->vp[2];
  s[1]=v->vp[1]+(y*0.5+0.5)*v->vp[3];
  s[2]=z*0.5+0.5;
  return 1;
}

/* ---------------- привязка под курсором ---------------- */
static POINT g_mouse; static HWND g_mouseWnd; static int g_mouseIn;
typedef struct { int ok; Anchor a; double s[2]; } Snap;
static Snap g_snap;

static float depthAt(int x, int y){
  float d=1.0f; glReadPixels(x,y,1,1,GL_DEPTH_COMPONENT,GL_FLOAT,&d); return d;
}
static int visible(const double s[3]){
  int x=(int)floor(s[0]), y=(int)floor(s[1]); float mxd=0;
  for(int dy=-1;dy<=1;dy++) for(int dx=-1;dx<=1;dx++){ float d=depthAt(x+dx,y+dy); if(d>mxd) mxd=d; }
  return s[2] <= mxd + 2e-4;
}
static void findSnap(const View *v){
  g_snap.ok=0;
  if(!g_mouseIn || g_mouseWnd!=v->hwnd) return;
  double mx=g_mouse.x, my=v->vp[3]-1-g_mouse.y;      /* в координаты GL */
  /* кандидаты в радиусе 16 px; проверка видимости — только для ближайших */
  typedef struct { double d2; int bi,k; double s[3]; } C;
  C best[24]; int nb=0;
  for(int i=0;i<g_nbox;i++){
    Box *b=&g_box[i];
    for(int k=0;k<NPTS;k++){
      double p[3], s[3]; boxPoint(b,k,p);
      if(!project(v,p,s) || s[2]<0 || s[2]>1) continue;
      double dx=s[0]-mx, dy=s[1]-my, d2=dx*dx+dy*dy;
      if(d2>16*16) continue;
      d2+=100;                          /* >0: отрицательное значение ниже — «уже проверен» */
      if(k>=8) d2+=9;                   /* углы чуть приоритетнее середин рёбер */
      if(b->group && k<8) d2-=40;       /* наружный угол корпуса важнее угла его детали в 2–3 px рядом */
      if(nb<24){ best[nb].d2=d2; best[nb].bi=i; best[nb].k=k; memcpy(best[nb].s,s,sizeof s); nb++; }
      else { int w=0; for(int j=1;j<nb;j++) if(best[j].d2>best[w].d2) w=j;
        if(d2<best[w].d2){ best[w].d2=d2; best[w].bi=i; best[w].k=k; memcpy(best[w].s,s,sizeof s); } }
    }
  }
  /* по возрастанию расстояния, первая видимая */
  for(int pass=0;pass<nb;pass++){
    int m=-1; for(int j=0;j<nb;j++) if(best[j].d2>=0 && (m<0 || best[j].d2<best[m].d2)) m=j;
    if(m<0) break;
    if(visible(best[m].s)){
      Box *b=&g_box[best[m].bi];
      lstrcpynW(g_snap.a.id,b->id,40); g_snap.a.k=best[m].k; boxPoint(b,best[m].k,g_snap.a.p);
      g_snap.s[0]=best[m].s[0]; g_snap.s[1]=best[m].s[1]; g_snap.ok=1; return;
    }
    best[m].d2=-1;
  }
}
/* вынос: какая из двух других осей ближе к движению мыши и насколько */
static void chooseOffset(const View *v, Dim *d){
  double A[3],B[3],mid[3],sm[3]; resolve(&d->a,A); resolve(&d->b,B);
  for(int i=0;i<3;i++) mid[i]=A[i]; mid[d->axis]=(A[d->axis]+B[d->axis])/2;
  if(!project(v,mid,sm)) return;
  double mx=g_mouse.x-sm[0], my=(v->vp[3]-1-g_mouse.y)-sm[1];
  double bestScore=-1; int bestAx=(d->axis+1)%3; double bestOff=0;
  for(int j=1;j<=2;j++){
    int ax=(d->axis+j)%3; double q[3],sq[3]; memcpy(q,mid,sizeof q); q[ax]+=0.1;
    if(!project(v,q,sq)) continue;
    double vx=sq[0]-sm[0], vy=sq[1]-sm[1], L2=vx*vx+vy*vy; if(L2<1) continue;
    double along=(mx*vx+my*vy)/sqrt(L2);
    double score=fabs(along)/ (1+0.0*L2);
    if(score>bestScore){ bestScore=score; bestAx=ax; bestOff=(mx*vx+my*vy)/L2*0.1; }
  }
  d->offAxis=bestAx; d->off=bestOff;
}

/* ---------------- отрисовка ---------------- */
static HGLRC g_fontRC; static GLuint g_fontBase; static HFONT g_font; static int g_fontH=15;
static void ensureFont(HDC dc){
  HGLRC rc=wglGetCurrentContext();
  if(rc==g_fontRC && g_fontBase) return;
  if(!g_font) g_font=CreateFontW(-g_fontH,0,0,0,FW_BOLD,0,0,0,RUSSIAN_CHARSET,OUT_TT_PRECIS,CLIP_DEFAULT_PRECIS,ANTIALIASED_QUALITY,DEFAULT_PITCH,L"Arial");
  HGDIOBJ old=SelectObject(dc,g_font);
  GLuint base=glGenLists(256);
  if(base && wglUseFontBitmapsA(dc,0,256,base)){ g_fontBase=base; g_fontRC=rc; }
  else if(base) glDeleteLists(base,256);
  SelectObject(dc,old);
}
static int textWidth(const char *s){
  HDC dc=GetDC(NULL); HGDIOBJ o=SelectObject(dc,g_font); SIZE sz={0,0};
  GetTextExtentPoint32A(dc,s,(int)strlen(s),&sz); SelectObject(dc,o); ReleaseDC(NULL,dc); return sz.cx;
}
static void glText(double x, double y, const char *s){
  if(!g_fontBase) return;
  glRasterPos2d(x,y); glListBase(g_fontBase); glCallLists((GLsizei)strlen(s),GL_UNSIGNED_BYTE,s);
}
static void line2(double x1,double y1,double x2,double y2){ glBegin(GL_LINES); glVertex2d(x1,y1); glVertex2d(x2,y2); glEnd(); }
static void arrow(double x, double y, double dx, double dy){        /* остриём в (x,y), смотрит вдоль (dx,dy) */
  double L=sqrt(dx*dx+dy*dy); if(L<1e-6) return; dx/=L; dy/=L;
  double s=9, w=3.2;
  glBegin(GL_TRIANGLES);
  glVertex2d(x,y); glVertex2d(x-dx*s-dy*w, y-dy*s+dx*w); glVertex2d(x-dx*s+dy*w, y-dy*s-dx*w);
  glEnd();
}
static void disc(double x, double y, double r){
  glBegin(GL_TRIANGLE_FAN); glVertex2d(x,y);
  for(int i=0;i<=16;i++){ double a=i*6.2831853/16; glVertex2d(x+cos(a)*r,y+sin(a)*r); }
  glEnd();
}
/* цвета: линии — тёмно-синие, выбранный/наведённый — оранжевый */
static void setColor(int hot){ if(hot) glColor4d(0.95,0.45,0.05,1); else glColor4d(0.08,0.20,0.55,1); }

typedef struct { double x0,y0,x1,y1; } RectD;
static RectD g_label[MAXDIM];

static void drawDim(const View *v, const Dim *d, int idx, int hot){
  double A[3],B[3],D1[3],D2[3],sA[3],sB[3],s1[3],s2[3];
  double mm=dimGeom(d,A,B,D1,D2);
  if(!project(v,A,sA)||!project(v,B,sB)||!project(v,D1,s1)||!project(v,D2,s2)) return;
  double dx=s2[0]-s1[0], dy=s2[1]-s1[1], L=sqrt(dx*dx+dy*dy);
  setColor(hot);
  /* выносные линии: от детали к линии и на 6 px дальше */
  double e1x=s1[0]-sA[0], e1y=s1[1]-sA[1], e1=sqrt(e1x*e1x+e1y*e1y);
  double e2x=s2[0]-sB[0], e2y=s2[1]-sB[1], e2=sqrt(e2x*e2x+e2y*e2y);
  glLineWidth(1.0f);
  if(e1>0.5) line2(sA[0]+e1x/e1*3,sA[1]+e1y/e1*3, s1[0]+e1x/e1*6, s1[1]+e1y/e1*6);
  if(e2>0.5) line2(sB[0]+e2x/e2*3,sB[1]+e2y/e2*3, s2[0]+e2x/e2*6, s2[1]+e2y/e2*6);
  /* размерная линия со стрелками (короткая — стрелки снаружи) */
  glLineWidth(hot?2.2f:1.6f);
  if(L>24){ line2(s1[0],s1[1],s2[0],s2[1]); arrow(s1[0],s1[1],-dx,-dy); arrow(s2[0],s2[1],dx,dy); }
  else if(L>0.5){ double ux=dx/L,uy=dy/L;
    line2(s1[0]-ux*16,s1[1]-uy*16,s2[0]+ux*16,s2[1]+uy*16); arrow(s1[0],s1[1],dx,dy); arrow(s2[0],s2[1],-dx,-dy); }
  /* подпись: над серединой линии, со стороны выноса */
  wchar_t wv[24]; if(d->text[0]) lstrcpynW(wv,d->text,24); else fmtValue(mm,wv,24);
  char t[32]; WideCharToMultiByte(1251,0,wv,-1,t,32,NULL,NULL);
  int tw=textWidth(t), th=g_fontH;
  double mx=(s1[0]+s2[0])/2, my=(s1[1]+s2[1])/2;
  double nx=-dy, ny=dx, nL=sqrt(nx*nx+ny*ny); if(nL<1e-6){ nx=0; ny=1; nL=1; } nx/=nL; ny/=nL;
  double ox=(s1[0]+s2[0])/2-(sA[0]+sB[0])/2, oy=(s1[1]+s2[1])/2-(sA[1]+sB[1])/2;
  if(nx*ox+ny*oy<0){ nx=-nx; ny=-ny; }
  double gap = fabs(nx)*(tw/2.0+4) + fabs(ny)*(th/2.0+3);
  double cx=mx+nx*gap, cy=my+ny*gap;
  if(L<=24){ double ux=dx/(L>0.5?L:1), uy=dy/(L>0.5?L:1); cx=s2[0]+ux*(22+tw/2.0); cy=s2[1]+uy*(22+tw/2.0); }
  RectD r={cx-tw/2.0-4, cy-th/2.0-3, cx+tw/2.0+4, cy+th/2.0+3};
  if(idx>=0) g_label[idx]=r;
  glColor4d(1,1,1,0.88);
  glBegin(GL_QUADS); glVertex2d(r.x0,r.y0); glVertex2d(r.x1,r.y0); glVertex2d(r.x1,r.y1); glVertex2d(r.x0,r.y1); glEnd();
  setColor(hot);
  glText(cx-tw/2.0, cy-th/2.0+3, t);
}

static void drawOverlay(HDC dc){
  GLint vp[4]; glGetIntegerv(GL_VIEWPORT,vp);
  if(vp[2]<20 || vp[3]<20) return;
  double P[16],MV[16]; glGetDoublev(GL_PROJECTION_MATRIX,P); glGetDoublev(GL_MODELVIEW_MATRIX,MV);
  View v; mul44(P,MV,v.M); memcpy(v.vp,vp,sizeof vp); v.hwnd=WindowFromDC(dc); v.valid=1;
  if(g_mode){ findSnap(&v); if(g_stage==2 && g_mouseWnd==v.hwnd) chooseOffset(&v,&g_cur); }
  if(g_mouseWnd==v.hwnd) g_view=v;
  if(!g_show && !g_mode) return;
  if(!g_ndim && !g_mode) return;

  glPushAttrib(GL_ALL_ATTRIB_BITS);
  glMatrixMode(GL_PROJECTION); glPushMatrix(); glLoadIdentity(); glOrtho(vp[0],vp[0]+vp[2],vp[1],vp[1]+vp[3],-1,1);
  glMatrixMode(GL_MODELVIEW); glPushMatrix(); glLoadIdentity();
  glDisable(GL_DEPTH_TEST); glDisable(GL_LIGHTING); glDisable(GL_TEXTURE_2D); glDisable(GL_CULL_FACE);
  glDisable(GL_FOG); glDisable(GL_ALPHA_TEST); glDisable(GL_STENCIL_TEST); glDisable(GL_SCISSOR_TEST);
  glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);
  glEnable(GL_LINE_SMOOTH); glHint(GL_LINE_SMOOTH_HINT,GL_NICEST);
  glDisable(GL_POLYGON_SMOOTH);
  ensureFont(dc);

  if(g_show) for(int i=0;i<g_ndim;i++) drawDim(&v,&g_dim[i],i, i==g_sel || (g_mode && i==g_hoverDim));
  if(g_mode){
    if(g_stage==1 || g_stage==2){
      Dim t=g_cur;
      if(g_stage==1){
        if(g_snap.ok){ t.b=g_snap.a; double A[3],B[3]; resolve(&t.a,A); resolve(&t.b,B);
          int ax=0; for(int i=1;i<3;i++) if(fabs(B[i]-A[i])>fabs(B[ax]-A[ax])) ax=i;
          t.axis=ax; t.offAxis=(ax+1)%3; t.off=0; t.text[0]=0;
          if(fabs(B[ax]-A[ax])>1e-5) drawDim(&v,&t,-1,1);
        }
      } else drawDim(&v,&t,-1,1);
      double A[3],sA[3]; resolve(&g_cur.a,A);
      if(project(&v,A,sA)){ glColor4d(0.95,0.45,0.05,1); disc(sA[0],sA[1],4.5); }
    }
    if(g_snap.ok && g_stage<2){
      glColor4d(1,1,1,0.95); disc(g_snap.s[0],g_snap.s[1],7.5);
      glColor4d(0.95,0.45,0.05,1); disc(g_snap.s[0],g_snap.s[1],5.5);
    }
    /* подсказка в левом нижнем углу вида */
    const wchar_t *wh = g_stage==0 ? L"Размеры MGS: наведите на угол детали и щёлкните  ·  Esc — выход" :
                        g_stage==1 ? L"Щёлкните вторую точку  ·  Esc — отмена" :
                                     L"Отведите мышь и щёлкните, куда вынести размер  ·  Esc — отмена";
    char hint[200]; WideCharToMultiByte(1251,0,wh,-1,hint,200,NULL,NULL);
    int tw=textWidth(hint);
    glColor4d(0.08,0.10,0.12,0.78);
    glBegin(GL_QUADS); glVertex2d(vp[0]+8,vp[1]+8); glVertex2d(vp[0]+tw+24,vp[1]+8); glVertex2d(vp[0]+tw+24,vp[1]+34); glVertex2d(vp[0]+8,vp[1]+34); glEnd();
    glColor4d(1,1,1,1); glText(vp[0]+16,vp[1]+16,hint);
  }

  glMatrixMode(GL_MODELVIEW); glPopMatrix();
  glMatrixMode(GL_PROJECTION); glPopMatrix();
  glPopAttrib();
}

/* ---------------- перехват SwapBuffers ---------------- */
typedef BOOL (WINAPI *Swap_t)(HDC);
static Swap_t g_origSwap; static void **g_iatSlot;
static volatile LONG g_inDraw;
static void subclassView(HWND h);
static BOOL WINAPI hookSwap(HDC dc){
  if(g_ok && wglGetCurrentContext() && !InterlockedExchange(&g_inDraw,1)){
    HWND h=WindowFromDC(dc);
    if(h) subclassView(h);
    drawOverlay(dc);
    InterlockedExchange(&g_inDraw,0);
  }
  return g_origSwap(dc);
}
static void **findIat(HMODULE mod, const char *dll, const char *fn){
  BYTE *b=(BYTE*)mod; IMAGE_DOS_HEADER *dh=(IMAGE_DOS_HEADER*)b;
  IMAGE_NT_HEADERS64 *nt=(IMAGE_NT_HEADERS64*)(b+dh->e_lfanew);
  IMAGE_DATA_DIRECTORY dd=nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
  if(!dd.VirtualAddress) return NULL;
  for(IMAGE_IMPORT_DESCRIPTOR *d=(IMAGE_IMPORT_DESCRIPTOR*)(b+dd.VirtualAddress); d->Name; d++){
    if(lstrcmpiA((char*)(b+d->Name),dll)) continue;
    IMAGE_THUNK_DATA64 *nameT=(IMAGE_THUNK_DATA64*)(b+(d->OriginalFirstThunk?d->OriginalFirstThunk:d->FirstThunk));
    IMAGE_THUNK_DATA64 *addrT=(IMAGE_THUNK_DATA64*)(b+d->FirstThunk);
    for(;nameT->u1.AddressOfData;nameT++,addrT++){
      if(IMAGE_SNAP_BY_ORDINAL64(nameT->u1.Ordinal)) continue;
      IMAGE_IMPORT_BY_NAME *ibn=(IMAGE_IMPORT_BY_NAME*)(b+nameT->u1.AddressOfData);
      if(!strcmp((char*)ibn->Name,fn)) return (void**)&addrT->u1.Function;
    }
  }
  return NULL;
}
static void installHook(void){
  if(g_iatSlot) return;
  void **slot=findIat(GetModuleHandleW(NULL),"gdi32.dll","SwapBuffers");
  if(!slot){ logw(L"SwapBuffers в импорте PRO100 не найден — отрисовка размеров невозможна"); return; }
  DWORD old; if(!VirtualProtect(slot,sizeof(void*),PAGE_READWRITE,&old)){ logw(L"VirtualProtect: ошибка %lu",GetLastError()); return; }
  g_origSwap=(Swap_t)*slot; *slot=(void*)hookSwap; VirtualProtect(slot,sizeof(void*),old,&old);
  g_iatSlot=slot;
  /* модуль не выгружаем, пока в таблице наш адрес */
  HMODULE self; GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS|GET_MODULE_HANDLE_EX_FLAG_PIN,(LPCWSTR)hookSwap,&self);
  logw(L"перехват SwapBuffers установлен (%p → %p)", (void*)g_origSwap, (void*)hookSwap);
}
static void removeHook(void){
  if(!g_iatSlot) return;
  DWORD old; if(VirtualProtect(g_iatSlot,sizeof(void*),PAGE_READWRITE,&old)){ *g_iatSlot=(void*)g_origSwap; VirtualProtect(g_iatSlot,sizeof(void*),old,&old); }
  g_iatSlot=NULL;
}

/* ---------------- окно вида: мышь и клавиши ---------------- */
#define MAXVIEW 8
static struct { HWND h; WNDPROC old; } g_views[MAXVIEW]; static int g_nview;
static HWND g_panel;
static void updatePanel(void);
static void redrawAll(void){ for(int i=0;i<g_nview;i++) if(IsWindow(g_views[i].h)) InvalidateRect(g_views[i].h,NULL,FALSE); }
static WNDPROC oldProc(HWND h){ for(int i=0;i<g_nview;i++) if(g_views[i].h==h) return g_views[i].old; return DefWindowProcW; }
static int labelAt(double x, double y){
  for(int i=g_ndim-1;i>=0;i--){ RectD r=g_label[i]; if(x>=r.x0-3&&x<=r.x1+3&&y>=r.y0-3&&y<=r.y1+3) return i; }
  return -1;
}
static void setMode(int on){
  g_mode=on; g_stage=0; g_snap.ok=0; g_hoverDim=-1;
  if(on){ refreshBoxes(1); }
  logw(L"режим размеров: %ls", on?L"вкл":L"выкл");
  updatePanel(); redrawAll();
}
static void deleteSel(void){
  if(g_sel<0 || g_sel>=g_ndim) return;
  for(int i=g_sel;i<g_ndim-1;i++) g_dim[i]=g_dim[i+1];
  g_ndim--; g_sel=-1; saveDims(); updatePanel(); redrawAll();
}
static void clickAt(HWND h){
  if(g_stage==0){
    if(g_snap.ok){ memset(&g_cur,0,sizeof g_cur); g_cur.a=g_snap.a; g_stage=1; }
    else { /* щелчок по подписи — выбрать размер */
      double gy=(g_view.valid&&g_view.hwnd==h)? g_view.vp[3]-1-g_mouse.y : -1;
      g_sel=labelAt(g_mouse.x,gy); updatePanel();
    }
  } else if(g_stage==1){
    if(!g_snap.ok) return;
    double A[3],B[3]; resolve(&g_cur.a,A); resolve(&g_snap.a,B);
    int ax=0; for(int i=1;i<3;i++) if(fabs(B[i]-A[i])>fabs(B[ax]-A[ax])) ax=i;
    if(fabs(B[ax]-A[ax])<1e-5) return;                  /* та же точка */
    g_cur.b=g_snap.a; g_cur.axis=ax; g_cur.offAxis=(ax+1)%3; g_cur.off=0; g_stage=2;
  } else {
    if(g_ndim<MAXDIM){ g_dim[g_ndim++]=g_cur; g_sel=-1; saveDims(); }
    g_stage=0; updatePanel();
  }
  redrawAll();
}
static LRESULT CALLBACK viewProc(HWND h, UINT m, WPARAM w, LPARAM l){
  WNDPROC old=oldProc(h);
  switch(m){
  case WM_MOUSEMOVE:
    g_mouse.x=(short)LOWORD(l); g_mouse.y=(short)HIWORD(l); g_mouseWnd=h;
    if(!g_mouseIn){ TRACKMOUSEEVENT t={sizeof t,TME_LEAVE,h,0}; TrackMouseEvent(&t); g_mouseIn=1; }
    if(g_mode){
      if(g_view.valid && g_view.hwnd==h){ int d=labelAt(g_mouse.x,g_view.vp[3]-1-g_mouse.y); g_hoverDim = g_stage==0 ? d : -1; }
      InvalidateRect(h,NULL,FALSE);
    }
    break;
  case WM_MOUSELEAVE: g_mouseIn=0; if(g_mode) InvalidateRect(h,NULL,FALSE); break;
  case WM_LBUTTONDOWN: case WM_LBUTTONDBLCLK:
    if(g_mode){ SetFocus(h); g_mouse.x=(short)LOWORD(l); g_mouse.y=(short)HIWORD(l); g_mouseWnd=h; clickAt(h); return 0; }
    break;
  case WM_LBUTTONUP: if(g_mode) return 0; break;
  case WM_SETCURSOR: if(g_mode && LOWORD(l)==HTCLIENT){ SetCursor(LoadCursorW(NULL,IDC_CROSS)); return TRUE; } break;
  case WM_KEYDOWN:
    if(g_mode && w==VK_ESCAPE){ if(g_stage) { g_stage=0; redrawAll(); } else setMode(0); return 0; }
    if((g_mode || g_sel>=0) && w==VK_DELETE && g_sel>=0){ deleteSel(); return 0; }
    break;
  case WM_TIMER:
    if(w==0x4D47){ syncFromProject(); if(g_mode || g_ndim) refreshBoxes(0); return 0; }
    break;
  case WM_NCDESTROY: {
    LRESULT r=CallWindowProcW(old,h,m,w,l);
    for(int i=0;i<g_nview;i++) if(g_views[i].h==h){ g_views[i]=g_views[--g_nview]; break; }
    return r; }
  }
  return CallWindowProcW(old,h,m,w,l);
}
static void subclassView(HWND h){
  for(int i=0;i<g_nview;i++) if(g_views[i].h==h) return;
  if(g_nview>=MAXVIEW) return;
  WNDPROC old=(WNDPROC)SetWindowLongPtrW(h,GWLP_WNDPROC,(LONG_PTR)viewProc);
  if(!old) return;
  g_views[g_nview].h=h; g_views[g_nview].old=old; g_nview++;
  if(g_nview==1) SetTimer(h,0x4D47,1000,NULL);
  wchar_t cls[64]; GetClassNameW(h,cls,64);
  logw(L"окно вида: %p [%ls]", (void*)h, cls);
  if(g_nview==1){ syncFromProject(); refreshBoxes(1); }
}

/* ---------------- панель ---------------- */
enum { ID_MODE=101, ID_DEL, ID_SHOW, ID_CLEAR, ID_HINT };
static HFONT g_uiFont;
static void updatePanel(void){
  if(!g_panel) return;
  SetDlgItemTextW(g_panel,ID_MODE, g_mode?L"■ Закончить постановку (Esc)":L"✚ Поставить размер");
  EnableWindow(GetDlgItem(g_panel,ID_DEL), g_sel>=0);
  EnableWindow(GetDlgItem(g_panel,ID_CLEAR), g_ndim>0);
  CheckDlgButton(g_panel,ID_SHOW, g_show?BST_CHECKED:BST_UNCHECKED);
  wchar_t t[160]; swprintf(t,160,L"Размеров в проекте: %d. Они сохраняются вместе с проектом и уходят на сайт при «Отправить в MGS 3D».", g_ndim);
  SetDlgItemTextW(g_panel,ID_HINT,t);
}
static LRESULT CALLBACK panelProc(HWND h, UINT m, WPARAM w, LPARAM l){
  switch(m){
  case WM_COMMAND:
    switch(LOWORD(w)){
    case ID_MODE: setMode(!g_mode); if(g_nview) SetFocus(g_views[0].h); return 0;
    case ID_DEL: deleteSel(); return 0;
    case ID_SHOW: g_show=IsDlgButtonChecked(h,ID_SHOW)==BST_CHECKED; redrawAll(); return 0;
    case ID_CLEAR:
      if(MessageBoxW(h,L"Удалить все размеры MGS в этом проекте?",L"Размеры MGS",MB_YESNO|MB_ICONQUESTION)==IDYES){ g_ndim=0; g_sel=-1; saveDims(); updatePanel(); redrawAll(); }
      return 0;
    }
    break;
  case WM_CLOSE: setMode(0); ShowWindow(h,SW_HIDE); return 0;
  case WM_CTLCOLORSTATIC: SetBkMode((HDC)w,TRANSPARENT); return (LRESULT)GetSysColorBrush(COLOR_BTNFACE);
  }
  return DefWindowProcW(h,m,w,l);
}
static void showPanel(void){
  if(!g_panel){
    WNDCLASSW wc={0}; wc.lpfnWndProc=panelProc; wc.hInstance=g_inst; wc.lpszClassName=L"MGSDimsPanel";
    wc.hCursor=LoadCursorW(NULL,IDC_ARROW); wc.hbrBackground=GetSysColorBrush(COLOR_BTNFACE);
    RegisterClassW(&wc);
    HWND owner=g_nview?GetAncestor(g_views[0].h,GA_ROOT):GetActiveWindow();
    RECT rc; GetWindowRect(owner?owner:GetDesktopWindow(),&rc);
    int W=300,H=228;
    g_panel=CreateWindowExW(WS_EX_TOOLWINDOW,L"MGSDimsPanel",L"Размеры MGS",WS_CAPTION|WS_SYSMENU|WS_POPUP,
      rc.right-W-40, rc.top+140, W, H, owner, NULL, g_inst, NULL);
    if(!g_panel) return;
    g_uiFont=CreateFontW(-13,0,0,0,FW_NORMAL,0,0,0,DEFAULT_CHARSET,0,0,CLEARTYPE_QUALITY,0,L"Segoe UI");
    struct { const wchar_t *cls,*txt; DWORD st; int id,x,y,w,h; } c[]={
      {L"BUTTON",L"✚ Поставить размер",BS_PUSHBUTTON,ID_MODE,10,10,264,34},
      {L"BUTTON",L"Удалить выбранный (Del)",BS_PUSHBUTTON,ID_DEL,10,50,264,28},
      {L"BUTTON",L"Показывать размеры",BS_AUTOCHECKBOX,ID_SHOW,12,84,180,22},
      {L"BUTTON",L"Удалить все",BS_PUSHBUTTON,ID_CLEAR,194,82,80,26},
      {L"STATIC",L"",SS_LEFT,ID_HINT,12,114,262,70},
    };
    for(int i=0;i<5;i++){
      HWND k=CreateWindowExW(0,c[i].cls,c[i].txt,WS_CHILD|WS_VISIBLE|c[i].st,c[i].x,c[i].y,c[i].w,c[i].h,g_panel,(HMENU)(INT_PTR)c[i].id,g_inst,NULL);
      SendMessageW(k,WM_SETFONT,(WPARAM)g_uiFont,TRUE);
    }
  }
  updatePanel(); ShowWindow(g_panel,SW_SHOWNOACTIVATE);
}

/* ---------------- для mgs3d.plg: размеры в JSON для сайта ---------------- */
static void jsonPt(FILE *f, const char *k, const double p[3]){ fprintf(f,"\"%s\":[%.6f,%.6f,%.6f]",k,p[0],p[1],p[2]); }
__declspec(dllexport) int __stdcall MgsDimsWriteJson(const wchar_t *path){
  if(!g_ok) return 0;
  syncFromProject(); refreshBoxes(1);
  FILE *f=_wfopen(path,L"wb"); if(!f) return 0;
  double pmn[3]={0,0,0},pmx[3]={0,0,0}; int haveBox=0;
  void *prj=getProject(); void *bb=outP(prj,PRJ_BBOX); if(bb){ haveBox=bboxOf(bb,pmn,pmx); xRelease(bb); } xRelease(prj);
  fprintf(f,"{\"format\":\"mgs-dims\",\"version\":1,\"units\":\"m\",\"source\":\"PRO100\"");
  if(haveBox){ fprintf(f,",\"bbox\":{"); jsonPt(f,"min",pmn); fprintf(f,","); jsonPt(f,"max",pmx); fprintf(f,"}"); }
  fprintf(f,",\"dims\":[");
  int n=0;
  for(int i=0;i<g_ndim;i++){
    double A[3],B[3],D1[3],D2[3]; double mm=dimGeom(&g_dim[i],A,B,D1,D2);
    wchar_t wv[24]; if(g_dim[i].text[0]) lstrcpynW(wv,g_dim[i].text,24); else fmtValue(mm,wv,24);
    char tv[64]; WideCharToMultiByte(CP_UTF8,0,wv,-1,tv,64,NULL,NULL);
    for(char *c=tv;*c;c++) if(*c=='"'||*c=='\\') *c=' ';
    fprintf(f,"%s{",n++?",":""); jsonPt(f,"a",A); fprintf(f,","); jsonPt(f,"b",B); fprintf(f,",");
    jsonPt(f,"d1",D1); fprintf(f,","); jsonPt(f,"d2",D2);
    fprintf(f,",\"axis\":%d,\"offAxis\":%d,\"value\":%.1f,\"text\":\"%s\"}",g_dim[i].axis,g_dim[i].offAxis,mm,tv);
  }
  /* точки привязки (углы деталей) — сайт по ним совмещает систему координат PRO100 и OBJ */
  fprintf(f,"],\"anchors\":[");
  int na=0;
  for(int i=0;i<g_nbox && na<400;i+=1+g_nbox/400){
    if(g_box[i].group) continue;
    for(int k=0;k<8;k+=7){ double p[3]; boxPoint(&g_box[i],k,p); fprintf(f,"%s[%.6f,%.6f,%.6f]",na++?",":"",p[0],p[1],p[2]); }
  }
  fprintf(f,"]}");
  fclose(f);
  logw(L"размеры для сайта: %d → %ls", n, path);
  return n;
}

/* ---------------- плагин ---------------- */
typedef struct { void **vt; } Obj;
static HRESULT __stdcall pQI(void*,const GUID*,void**);
static ULONG   __stdcall pAddRef(void *s){ (void)s; return InterlockedIncrement(&g_ref); }
static ULONG   __stdcall pRelease(void *s){ (void)s; LONG r=InterlockedDecrement(&g_ref); return r>0?r:0; }
static HRESULT __stdcall pGetId(void *s, BSTR *o){ (void)s; if(!o) return E_POINTER; *o=SysAllocString(L"mgs3d.dims.v1"); return *o?S_OK:E_OUTOFMEMORY; }
static int checkBuild(void){
  BYTE *b=(BYTE*)GetModuleHandleW(NULL);
  IMAGE_NT_HEADERS64 *nt=(IMAGE_NT_HEADERS64*)(b+((IMAGE_DOS_HEADER*)b)->e_lfanew);
  int ok = nt->FileHeader.TimeDateStamp==P100_TIMESTAMP && nt->OptionalHeader.SizeOfImage==P100_IMAGESIZE;
  logw(L"сборка PRO100: метка %08lx размер %08lx — %ls", (unsigned long)nt->FileHeader.TimeDateStamp,
       (unsigned long)nt->OptionalHeader.SizeOfImage, ok?L"поддерживается":L"НЕ та, что проверена");
  return ok || iniInt(L"dims",L"skip_version_check",0);
}
static HRESULT __stdcall pInit(void *s, void *app){
  (void)s; openLog(); logw(L"=== Размеры MGS: Init app=%p ===", app);
  if(g_app) xRelease(g_app);
  g_app=app; if(app) ((AR_t)VT(app)[1])(app);
  g_ok=checkBuild();
  if(g_ok) installHook();
  return S_OK;
}
static HRESULT __stdcall pDone(void *s){
  (void)s; logw(L"Done");
  removeHook();
  for(int i=0;i<g_nview;i++) if(IsWindow(g_views[i].h)) SetWindowLongPtrW(g_views[i].h,GWLP_WNDPROC,(LONG_PTR)g_views[i].old);
  g_nview=0;
  if(g_panel){ DestroyWindow(g_panel); g_panel=NULL; }
  if(g_app){ xRelease(g_app); g_app=NULL; }
  return S_OK;
}
static HRESULT __stdcall pCaption(void *s, BSTR *o){ (void)s; if(!o) return E_POINTER; *o=SysAllocString(L"Размеры MGS…"); return *o?S_OK:E_OUTOFMEMORY; }
static HRESULT __stdcall pExecute(void *s, void *ctx){
  (void)s;(void)ctx; openLog();
  if(!g_ok){ MessageBoxW(GetActiveWindow(),L"Эта сборка PRO100 не поддерживается размерами MGS (нужна PRO100 7.08 x64 от 11.07.2024).\nЖурнал: %LOCALAPPDATA%\\MGS3D\\logs\\dims.log",L"Размеры MGS",MB_OK|MB_ICONWARNING); return S_OK; }
  if(!g_nview) logw(L"окно вида ещё не найдено — откройте вид «Перспектива»");
  syncFromProject();
  showPanel();
  if(!g_mode) setMode(1);
  return S_OK;
}
static void *vtBase[]  = { pQI, pAddRef, pRelease, pGetId };
static void *vtInit[]  = { pQI, pAddRef, pRelease, pGetId, pInit };
static void *vtDone[]  = { pQI, pAddRef, pRelease, pGetId, pDone };
static void *vtExport[]= { pQI, pAddRef, pRelease, pGetId, pCaption, pExecute };
static Obj oBase={vtBase}, oInit={vtInit}, oDone={vtDone}, oExport={vtExport};
static HRESULT __stdcall pQI(void *s, const GUID *iid, void **out){
  (void)s;
  if(!iid||!out) return E_POINTER;
  *out=NULL;
  if(IsEqualGUID(iid,&IID_IUnknown_)||IsEqualGUID(iid,&IID_IPlugin)) *out=&oBase;
  else if(IsEqualGUID(iid,&IID_IPluginInit)) *out=&oInit;
  else if(IsEqualGUID(iid,&IID_IPluginDone)) *out=&oDone;
  else if(IsEqualGUID(iid,&IID_IExportPlugin)) *out=&oExport;
  else return E_NOINTERFACE;
  InterlockedIncrement(&g_ref);
  return S_OK;
}
__declspec(dllexport) void **createObject(void **out){
  if(out){ *out=&oBase; InterlockedIncrement(&g_ref); }
  return out;
}
BOOL WINAPI DllMain(HINSTANCE h, DWORD why, LPVOID r){
  (void)r;
  if(why==DLL_PROCESS_ATTACH){
    g_inst=h; DisableThreadLibraryCalls(h);
    GetModuleFileNameW(h,g_dir,MAX_PATH);
    wchar_t *sl=wcsrchr(g_dir,L'\\'); if(sl) *sl=0;
  }
  return TRUE;
}
