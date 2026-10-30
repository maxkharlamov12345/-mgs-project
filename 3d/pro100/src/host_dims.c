/* Имитация PRO100 для проверки mgsdims.plg под Wine:
 * сцена OpenGL (fixed pipeline, метры, Z вверх, камера в матрице проекции — как у PRO100),
 * интерфейсы проекта/деталей/габаритов/свойств, сценарий мыши, снимок экрана в BMP.
 * Запуск: wine host_dims.exe <папка с mgsdims.plg> <куда писать результаты> */
#define UNICODE
#include <windows.h>
#include <oleauto.h>
#include <GL/gl.h>
#include <stdio.h>
#include <math.h>
#include <stdlib.h>

static const GUID IID_IPluginInit   = {0x6f0f1740,0x5872,0x4ae9,{0x9c,0x33,0x9b,0xa6,0xa6,0x7e,0x4c,0x14}};
static const GUID IID_IExportPlugin = {0x9cad3fed,0x94fe,0x4ac6,{0xa9,0x90,0x6c,0x60,0x49,0x67,0x68,0xfd}};
static const GUID IID_IPluginDone   = {0xb4dee719,0x24e8,0x4feb,{0x87,0xb9,0xa1,0x8b,0x9f,0xb5,0x38,0x5a}};
#define VT(p) (*(void***)(p))
typedef struct { void **vt; } Obj;
static HRESULT __stdcall notimpl(void){ return E_NOTIMPL; }
static ULONG __stdcall ar(void *s){ (void)s; return 1; }
static HRESULT __stdcall qiSelf(void *s,const GUID *g,void **o){ (void)g; *o=s; return S_OK; }
static void fillVt(void **vt,int n){ for(int i=0;i<n;i++) vt[i]=(void*)notimpl; vt[0]=(void*)qiSelf; vt[1]=(void*)ar; vt[2]=(void*)ar; }

/* ---- сцена: детали (метры, Z вверх) ---- */
typedef struct { Obj o; double mn[3],mx[3]; const wchar_t *guid; int parent; float col[3]; } Ent;
static Ent E[16]; static int NE;
static void addE(int parent,const wchar_t *g,double x0,double y0,double z0,double x1,double y1,double z1,float r,float gg,float b){
  Ent *e=&E[NE++]; e->parent=parent; e->guid=g; e->mn[0]=x0;e->mn[1]=y0;e->mn[2]=z0; e->mx[0]=x1;e->mx[1]=y1;e->mx[2]=z1; e->col[0]=r;e->col[1]=gg;e->col[2]=b;
}
/* bbox */
typedef struct { Obj o; Ent *e; int prj; } BB;
static BB bbs[64]; static int nbb;
static void bbExtent(BB *b,double mn[3],double mx[3]){
  if(!b->prj){ for(int i=0;i<3;i++){ mn[i]=b->e->mn[i]; mx[i]=b->e->mx[i]; } return; }
  for(int i=0;i<3;i++){ mn[i]=1e9; mx[i]=-1e9; }
  for(int k=0;k<NE;k++) for(int i=0;i<3;i++){ if(E[k].mn[i]<mn[i]) mn[i]=E[k].mn[i]; if(E[k].mx[i]>mx[i]) mx[i]=E[k].mx[i]; }
}
#define BBG(n,isMax) static HRESULT __stdcall bb##n(void *s,double *o){ double a[3],b[3]; bbExtent((BB*)s,a,b); *o=(isMax?b:a)[n%3]; return S_OK; }
BBG(0,0) BBG(1,0) BBG(2,0)
static HRESULT __stdcall bb3(void *s,double *o){ double a[3],b[3]; bbExtent((BB*)s,a,b); *o=b[0]; return S_OK; }
static HRESULT __stdcall bb4(void *s,double *o){ double a[3],b[3]; bbExtent((BB*)s,a,b); *o=b[1]; return S_OK; }
static HRESULT __stdcall bb5(void *s,double *o){ double a[3],b[3]; bbExtent((BB*)s,a,b); *o=b[2]; return S_OK; }
static void *vtBB[24];
static BB *newBB(Ent *e,int prj){ BB *b=&bbs[(nbb++)%64]; b->o.vt=vtBB; b->e=e; b->prj=prj; return b; }
/* identity */
typedef struct { Obj o; Ent *e; } Idn;
static Idn idns[64]; static int nidn; static void *vtIdn[8];
static HRESULT __stdcall idnGuid(void *s,BSTR *o){ *o=SysAllocString(((Idn*)s)->e->guid); return S_OK; }
/* list */
typedef struct { Obj o; int parent; } Lst;
static Lst lsts[64]; static int nlst; static void *vtLst[8];
static int kids(int parent,int *out){ int n=0; for(int i=0;i<NE;i++) if(E[i].parent==parent) out[n++]=i; return n; }
static HRESULT __stdcall lstCount(void *s,int *n){ int t[16]; *n=kids(((Lst*)s)->parent,t); return S_OK; }
static HRESULT __stdcall lstItem(void *s,int i,void **o){ int t[16]; int n=kids(((Lst*)s)->parent,t); if(i<0||i>=n) return E_INVALIDARG; *o=&E[t[i]]; return S_OK; }
static Lst *newLst(int parent){ Lst *l=&lsts[(nlst++)%64]; l->o.vt=vtLst; l->parent=parent; return l; }
/* entity */
static void *vtEnt[48];
static HRESULT __stdcall entBB(void *s,void **o){ *o=newBB((Ent*)s,0); return S_OK; }
static HRESULT __stdcall entIdn(void *s,void **o){ Idn *d=&idns[(nidn++)%64]; d->o.vt=vtIdn; d->e=(Ent*)s; *o=d; return S_OK; }
static HRESULT __stdcall entKids(void *s,void **o){ *o=newLst((int)((Ent*)s-E)); return S_OK; }
/* свойства проекта */
static wchar_t g_prop[65536]; static int g_setCount;
static void *vtPL[12]; static Obj oPL={vtPL};
static HRESULT __stdcall plGet(void *s,BSTR n,BSTR *o){ (void)s; *o=SysAllocString(!lstrcmpW(n,L"MGS.Dims")?g_prop:L""); return S_OK; }
static HRESULT __stdcall plSet(void *s,BSTR n,BSTR v){ (void)s; if(!lstrcmpW(n,L"MGS.Dims")){ lstrcpynW(g_prop,v?v:L"",65536); g_setCount++; } return S_OK; }
/* проект и приложение */
static void *vtPrj[40]; static Obj oPrj={vtPrj};
static HRESULT __stdcall prjTop(void *s,void **o){ (void)s; *o=newLst(-1); return S_OK; }
static HRESULT __stdcall prjProps(void *s,void **o){ (void)s; *o=&oPL; return S_OK; }
static HRESULT __stdcall prjBox(void *s,void **o){ (void)s; *o=newBB(NULL,1); return S_OK; }
static void *vtApp[24]; static Obj oApp={vtApp};
static HRESULT __stdcall appPrj(void *s,void **o){ (void)s; *o=&oPrj; return S_OK; }

/* ---- OpenGL ---- */
static HWND g_view; static HDC g_dc; static HGLRC g_rc; static int W=900,H=600;
static double PM[16];                  /* перспектива*вид, столбцы */
static void lookPersp(void){
  double eye[3]={-1.6,-3.6,2.6}, at[3]={0.8,0.3,0.9}, up[3]={0,0,1};
  double f[3]={at[0]-eye[0],at[1]-eye[1],at[2]-eye[2]}; double L=sqrt(f[0]*f[0]+f[1]*f[1]+f[2]*f[2]); for(int i=0;i<3;i++) f[i]/=L;
  double s[3]={f[1]*up[2]-f[2]*up[1], f[2]*up[0]-f[0]*up[2], f[0]*up[1]-f[1]*up[0]}; L=sqrt(s[0]*s[0]+s[1]*s[1]+s[2]*s[2]); for(int i=0;i<3;i++) s[i]/=L;
  double u[3]={s[1]*f[2]-s[2]*f[1], s[2]*f[0]-s[0]*f[2], s[0]*f[1]-s[1]*f[0]};
  double V[16]={s[0],u[0],-f[0],0, s[1],u[1],-f[1],0, s[2],u[2],-f[2],0, 0,0,0,1};
  V[12]=-(s[0]*eye[0]+s[1]*eye[1]+s[2]*eye[2]); V[13]=-(u[0]*eye[0]+u[1]*eye[1]+u[2]*eye[2]); V[14]=(f[0]*eye[0]+f[1]*eye[1]+f[2]*eye[2]);
  double fov=45*3.14159265/180, a=(double)W/H, n=0.05, fa=50, t=1/tan(fov/2);
  double P[16]={t/a,0,0,0, 0,t,0,0, 0,0,(fa+n)/(n-fa),-1, 0,0,2*fa*n/(n-fa),0};
  for(int c=0;c<4;c++) for(int r=0;r<4;r++){ double x=0; for(int k=0;k<4;k++) x+=P[k*4+r]*V[c*4+k]; PM[c*4+r]=x; }
}
static int toScreen(const double p[3],int *x,int *y){
  double v[4]; for(int r=0;r<4;r++) v[r]=PM[r]*p[0]+PM[4+r]*p[1]+PM[8+r]*p[2]+PM[12+r];
  if(v[3]<=0) return 0; *x=(int)lround((v[0]/v[3]*0.5+0.5)*W); *y=(int)lround(H-1-(v[1]/v[3]*0.5+0.5)*H); return 1;
}
static void box(const Ent *e){
  double a[3]={e->mn[0],e->mn[1],e->mn[2]}, b[3]={e->mx[0],e->mx[1],e->mx[2]};
  static const int F[6][4]={{0,1,3,2},{4,6,7,5},{0,4,5,1},{2,3,7,6},{0,2,6,4},{1,5,7,3}};
  static const float shade[6]={0.7f,1.0f,0.8f,0.85f,0.75f,0.9f};
  glBegin(GL_QUADS);
  for(int f=0;f<6;f++){ glColor3f(e->col[0]*shade[f],e->col[1]*shade[f],e->col[2]*shade[f]);
    for(int k=0;k<4;k++){ int c=F[f][k]; glVertex3d(c&1?b[0]:a[0], c&2?b[1]:a[1], c&4?b[2]:a[2]); } }
  glEnd();
}
static void render(void){
  wglMakeCurrent(g_dc,g_rc);
  glViewport(0,0,W,H); glClearColor(0.93f,0.91f,0.88f,1); glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
  glEnable(GL_DEPTH_TEST); glDepthFunc(GL_LEQUAL);
  glMatrixMode(GL_PROJECTION); glLoadMatrixd(PM); glMatrixMode(GL_MODELVIEW); glLoadIdentity();
  for(int i=0;i<NE;i++) if(!(E[i].parent==-1 && kids(i,(int[16]){0}))) box(&E[i]);   /* группы не рисуем — только детали */
  SwapBuffers(g_dc);                    /* через таблицу импорта — её перехватывает плагин */
}
static LRESULT CALLBACK viewProc(HWND h,UINT m,WPARAM w,LPARAM l){
  if(m==WM_PAINT){ PAINTSTRUCT ps; BeginPaint(h,&ps); render(); EndPaint(h,&ps); return 0; }
  if(m==WM_ERASEBKGND) return 1;
  return DefWindowProcW(h,m,w,l);
}
static void pump(int ms){ DWORD t=GetTickCount(); MSG msg; while(GetTickCount()-t<(DWORD)ms){ while(PeekMessageW(&msg,NULL,0,0,PM_REMOVE)){ TranslateMessage(&msg); DispatchMessageW(&msg);} Sleep(10);} }
static void shot(const wchar_t *path){
  /* перерисовка — плагин дорисует размеры перед SwapBuffers; читаем передний буфер */
  InvalidateRect(g_view,NULL,FALSE); UpdateWindow(g_view); pump(80);
  wglMakeCurrent(g_dc,g_rc);
  unsigned char *px=malloc(W*H*3); glReadBuffer(getenv("SHOT_BUF")&&getenv("SHOT_BUF")[0]=='f'?GL_FRONT:GL_BACK); glPixelStorei(GL_PACK_ALIGNMENT,1); glReadPixels(0,0,W,H,GL_BGR_EXT,GL_UNSIGNED_BYTE,px);
  FILE *f=_wfopen(path,L"wb"); BITMAPFILEHEADER fh={0x4D42}; BITMAPINFOHEADER ih={sizeof ih,W,H,1,24,BI_RGB};
  int row=(W*3+3)&~3; fh.bfOffBits=sizeof fh+sizeof ih; fh.bfSize=fh.bfOffBits+row*H;
  fwrite(&fh,sizeof fh,1,f); fwrite(&ih,sizeof ih,1,f);
  unsigned char pad[4]={0}; for(int y=0;y<H;y++){ fwrite(px+y*W*3,1,W*3,f); fwrite(pad,1,row-W*3,f); }
  fclose(f); free(px);
}
static void mouseTo(int x,int y){ PostMessageW(g_view,WM_MOUSEMOVE,0,MAKELPARAM(x,y)); pump(60); InvalidateRect(g_view,NULL,FALSE); UpdateWindow(g_view); pump(60); }
static void clickAt(int x,int y){ mouseTo(x,y); PostMessageW(g_view,WM_LBUTTONDOWN,MK_LBUTTON,MAKELPARAM(x,y)); PostMessageW(g_view,WM_LBUTTONUP,0,MAKELPARAM(x,y)); pump(80); }
static void corner(int e,int k,int *x,int *y){ double p[3]; for(int i=0;i<3;i++) p[i]=(k>>i)&1?E[e].mx[i]:E[e].mn[i]; toScreen(p,x,y); }

int wmain(int argc,wchar_t **argv){
  if(argc<3){ printf("usage: host_dims <plugdir> <outdir>\n"); return 2; }
  const wchar_t *out=argv[2]; wchar_t p[MAX_PATH];
  /* шкаф: группа (0) из боковин, дна, крыши; рядом тумба (5); двери не нужны */
  addE(-1,L"{G-CAB}",0,0,0, 0.8,0.56,2.0, .6f,.6f,.6f);
  addE(0,L"{P-LEFT}", 0,0,0,      0.016,0.56,2.0, .85f,.75f,.6f);
  addE(0,L"{P-RIGHT}",0.784,0,0,  0.8,0.56,2.0,   .85f,.75f,.6f);
  addE(0,L"{P-BOT}",  0.016,0,0.1,0.784,0.56,0.116,.80f,.70f,.55f);
  addE(0,L"{P-TOP}",  0.016,0,1.984,0.784,0.56,2.0,.80f,.70f,.55f);
  addE(-1,L"{P-TUMBA}",1.0,0,0, 1.6,0.45,0.72, .45f,.6f,.8f);
  fillVt(vtBB,24); for(int i=0;i<3;i++) vtBB[3+i]=(void*[]){(void*)bb0,(void*)bb1,(void*)bb2}[i];
  vtBB[6]=(void*)bb3; vtBB[7]=(void*)bb4; vtBB[8]=(void*)bb5;
  fillVt(vtIdn,8); vtIdn[3]=(void*)idnGuid;
  fillVt(vtLst,8); vtLst[4]=(void*)lstItem; vtLst[5]=(void*)lstCount;
  fillVt(vtEnt,48); vtEnt[13]=(void*)entBB; vtEnt[32]=(void*)entIdn; vtEnt[41]=(void*)entKids;
  for(int i=0;i<NE;i++) E[i].o.vt=vtEnt;
  fillVt(vtPL,12); vtPL[4]=(void*)plGet; vtPL[5]=(void*)plSet;
  fillVt(vtPrj,40); vtPrj[7]=(void*)prjTop; vtPrj[15]=(void*)prjProps; vtPrj[16]=(void*)prjBox;
  fillVt(vtApp,24); vtApp[11]=(void*)appPrj;

  HINSTANCE hi=GetModuleHandleW(NULL);
  WNDCLASSW wc={0}; wc.lpfnWndProc=DefWindowProcW; wc.hInstance=hi; wc.lpszClassName=L"TMainForm"; wc.hbrBackground=(HBRUSH)(COLOR_BTNFACE+1); RegisterClassW(&wc);
  WNDCLASSW vc={0}; vc.style=CS_OWNDC; vc.lpfnWndProc=viewProc; vc.hInstance=hi; vc.lpszClassName=L"TGLSurface"; vc.hCursor=LoadCursorW(NULL,IDC_ARROW); RegisterClassW(&vc);
  HWND main=CreateWindowExW(0,L"TMainForm",L"PRO100 (имитация)",WS_OVERLAPPEDWINDOW|WS_VISIBLE,0,0,W+40,H+80,NULL,NULL,hi,NULL);
  g_view=CreateWindowExW(0,L"TGLSurface",L"",WS_CHILD|WS_VISIBLE,10,10,W,H,main,NULL,hi,NULL);
  g_dc=GetDC(g_view);
  PIXELFORMATDESCRIPTOR pfd={sizeof pfd,1,PFD_DRAW_TO_WINDOW|PFD_SUPPORT_OPENGL|PFD_DOUBLEBUFFER,PFD_TYPE_RGBA,24,0,0,0,0,0,0,8,0,0,0,0,0,0,24,8,0,PFD_MAIN_PLANE,0,0,0,0};
  SetPixelFormat(g_dc,ChoosePixelFormat(g_dc,&pfd),&pfd); g_rc=wglCreateContext(g_dc); wglMakeCurrent(g_dc,g_rc);
  printf("GL: %s / %s\n",glGetString(GL_VENDOR),glGetString(GL_RENDERER));
  lookPersp();

  swprintf(p,MAX_PATH,L"%ls\\mgsdims.plg",argv[1]);
  HMODULE m=LoadLibraryW(p); if(!m){ printf("FAIL load %lu\n",GetLastError()); return 1; }
  void **(*co)(void**)=(void**(*)(void**))GetProcAddress(m,"createObject");
  int (__stdcall *wj)(const wchar_t*)=(int(__stdcall*)(const wchar_t*))GetProcAddress(m,"MgsDimsWriteJson");
  void *pl=NULL; co(&pl);
  void *ini=NULL,*ex=NULL,*dn=NULL;
  ((HRESULT(__stdcall*)(void*,const GUID*,void**))VT(pl)[0])(pl,&IID_IPluginInit,&ini);
  ((HRESULT(__stdcall*)(void*,const GUID*,void**))VT(pl)[0])(pl,&IID_IExportPlugin,&ex);
  ((HRESULT(__stdcall*)(void*,const GUID*,void**))VT(pl)[0])(pl,&IID_IPluginDone,&dn);
  ((HRESULT(__stdcall*)(void*,void*))VT(ini)[4])(ini,&oApp);
  BSTR cap=NULL; ((HRESULT(__stdcall*)(void*,BSTR*))VT(ex)[4])(ex,&cap); printf("caption: %ls\n",cap);
  pump(300);
  swprintf(p,MAX_PATH,L"%ls\\0-scene.bmp",out); shot(p);
  ((HRESULT(__stdcall*)(void*,void*))VT(ex)[5])(ex,NULL);       /* «Экспорт → Размеры MGS…» */
  pump(200);

  int x,y,ok=1;
  /* 1) ширина шкафа по верху спереди: угол слева-сверху-спереди (k=4: x=min,y=min,z=max) → справа (k=5) */
  corner(1,4,&x,&y); mouseTo(x+5,y+4); swprintf(p,MAX_PATH,L"%ls\\1-hover.bmp",out); shot(p);
  clickAt(x+5,y+4);
  corner(2,5,&x,&y); clickAt(x-4,y+3);
  { int ax,ay,bx,by; corner(1,4,&ax,&ay); corner(2,5,&bx,&by); mouseTo((ax+bx)/2,(ay+by)/2-60); }
  swprintf(p,MAX_PATH,L"%ls\\2-offset.bmp",out); shot(p);
  { int ax,ay,bx,by; corner(1,4,&ax,&ay); corner(2,5,&bx,&by); clickAt((ax+bx)/2,(ay+by)/2-60); }
  /* 2) высота тумбы: передний правый низ (k=1) → верх (k=5) */
  corner(5,1,&x,&y); clickAt(x,y);
  corner(5,5,&x,&y); clickAt(x,y);
  clickAt(x+70,y+40);
  swprintf(p,MAX_PATH,L"%ls\\3-two-dims.bmp",out); shot(p);
  printf("prop after 2 dims (set %d times):\n%ls\n",g_setCount,g_prop);
  int lines=0; for(wchar_t *c=g_prop;*c;c++) if(*c==L'\n') lines++;
  if(lines!=3){ printf("FAIL: ожидалось 2 размера\n"); ok=0; }
  if(!(wcsstr(g_prop,L"{G-CAB}")||wcsstr(g_prop,L"{P-LEFT}"))||!wcsstr(g_prop,L"{P-TUMBA}")){ printf("FAIL: привязка к деталям\n"); ok=0; }

  /* 3) деталь сдвинулась → размер следует (тумба выше на 10 см) */
  E[5].mx[2]=0.82; pump(1700); swprintf(p,MAX_PATH,L"%ls\\4-moved.bmp",out); shot(p);
  swprintf(p,MAX_PATH,L"%ls\\dims.json",out); int n=wj(p); printf("json dims: %d\n",n);
  FILE *f=_wfopen(p,L"rb"); char buf[8192]={0}; fread(buf,1,8191,f); fclose(f); printf("%s\n",buf);
  if(n!=2 || !strstr(buf,"\"value\":820.0") || !strstr(buf,"\"value\":800.0")){ printf("FAIL: значения в json (ждём 800 и 820)\n"); ok=0; }

  /* 4) другой проект: свойство пустое → размеры исчезают; вернули → появились */
  wchar_t keep[65536]; lstrcpyW(keep,g_prop); g_prop[0]=0; pump(1300);
  n=wj(p); if(n!=0){ printf("FAIL: после смены проекта размеры остались (%d)\n",n); ok=0; }
  lstrcpyW(g_prop,keep); pump(1300); n=wj(p); if(n!=2){ printf("FAIL: размеры не вернулись (%d)\n",n); ok=0; }

  /* 5) Esc выключает режим, выбор подписи + Delete удаляет */
  PostMessageW(g_view,WM_KEYDOWN,VK_ESCAPE,0); pump(100);
  swprintf(p,MAX_PATH,L"%ls\\5-final.bmp",out); shot(p);

  ((HRESULT(__stdcall*)(void*))VT(dn)[4])(dn);
  printf(ok?"ALL OK\n":"SOME FAILED\n");
  return ok?0:1;
}
