/* Имитация PRO100 для проверки mgs3d.plg под Wine: интерфейсы + окно «Экспорт в obj» + диалог сохранения */
#define UNICODE
#include <windows.h>
#include <commdlg.h>
#include <oleauto.h>
#include <stdio.h>

static const GUID IID_IPlugin       = {0xe987c0b2,0x5651,0x4b1b,{0x98,0x37,0xb6,0x95,0xaf,0x8e,0x1d,0x22}};
static const GUID IID_IPluginInit   = {0x6f0f1740,0x5872,0x4ae9,{0x9c,0x33,0x9b,0xa6,0xa6,0x7e,0x4c,0x14}};
static const GUID IID_IPluginDone   = {0xb4dee719,0x24e8,0x4feb,{0x87,0xb9,0xa1,0x8b,0x9f,0xb5,0x38,0x5a}};
static const GUID IID_IExportPlugin = {0x9cad3fed,0x94fe,0x4ac6,{0xa9,0x90,0x6c,0x60,0x49,0x67,0x68,0xfd}};
static const GUID IID_IApplication  = {0x58ff9736,0x001f,0x427d,{0xbf,0xf1,0x36,0xd0,0x30,0x50,0x5b,0xcd}};
static const GUID IID_IPluginInfo   = {0x8fa9494c,0x0ee8,0x4505,{0xb8,0xd2,0xfc,0x0c,0x7c,0x10,0xdf,0x3f}};
#define VT(p) (*(void***)(p))
typedef struct { void **vt; } Obj;

static HRESULT __stdcall dummy(void){ return E_NOTIMPL; }
static ULONG __stdcall ar(void *s){ (void)s; return 1; }
/* экспортёр OBJ */
static int g_cb[3]; static HWND g_form; static int g_done;
static LRESULT CALLBACK formProc(HWND h, UINT m, WPARAM w, LPARAM l){
  if(m==WM_COMMAND && LOWORD(w)==100){ g_done=1; return 0; }
  if(m==WM_CLOSE){ g_done=2; return 0; }
  return DefWindowProcW(h,m,w,l);
}
static HRESULT __stdcall exGetId(void *s, BSTR *o){ (void)s; *o=SysAllocString(L"export.obj"); return S_OK; }
static HRESULT __stdcall exExec(void *s, void *ctx){
  (void)s;(void)ctx;
  HINSTANCE hi=GetModuleHandleW(NULL);
  g_form=CreateWindowExW(0,L"TOBJForm",L"Экспорт в obj",WS_OVERLAPPEDWINDOW|WS_VISIBLE,100,100,300,220,NULL,NULL,hi,NULL);
  const wchar_t *n[3]={L"копировать текстуры",L"только выбранное",L"добавить стены"};
  HWND cb[3];
  for(int i=0;i<3;i++){ cb[i]=CreateWindowExW(0,L"TCheckBox",n[i],WS_CHILD|WS_VISIBLE|BS_AUTOCHECKBOX,10,10+30*i,200,24,g_form,(HMENU)(INT_PTR)(10+i),hi,NULL);
    SendMessageW(cb[i],BM_SETCHECK,i==1?BST_CHECKED:BST_UNCHECKED,0); }
  CreateWindowExW(0,L"TButton",L"OK",WS_CHILD|WS_VISIBLE,10,110,80,26,g_form,(HMENU)100,hi,NULL);
  g_done=0; MSG msg;
  while(!g_done && GetMessageW(&msg,NULL,0,0)){ TranslateMessage(&msg); DispatchMessageW(&msg); }
  for(int i=0;i<3;i++) g_cb[i]=SendMessageW(cb[i],BM_GETCHECK,0,0)==BST_CHECKED;
  DestroyWindow(g_form);
  printf("HOST options: copy=%d sel=%d walls=%d done=%d\n",g_cb[0],g_cb[1],g_cb[2],g_done); fflush(stdout);
  if(g_done!=1) return S_OK;
  wchar_t file[MAX_PATH]=L"";
  OPENFILENAMEW of={sizeof of}; of.lpstrFile=file; of.nMaxFile=MAX_PATH; of.lpstrFilter=L"OBJ\0*.obj\0"; of.Flags=OFN_EXPLORER|OFN_OVERWRITEPROMPT;
  if(!GetSaveFileNameW(&of)){ printf("HOST save cancelled err=%lu\n",CommDlgExtendedError()); return S_OK; }
  printf("HOST save to %ls\n",file); fflush(stdout);
  FILE *f=_wfopen(file,L"wb"); fputs("o 1_Деталь\nv 0 0 0\n",f); fclose(f);
  return S_OK;
}
static HRESULT __stdcall exQI(void*,const GUID*,void**);
static void *vtEx[]={exQI,ar,ar,exGetId,dummy,exExec}; static Obj oEx={vtEx};
static HRESULT __stdcall exQI(void *s,const GUID *g,void **o){ (void)s; if(IsEqualGUID(g,&IID_IExportPlugin)){*o=&oEx;return S_OK;} *o=NULL; return E_NOINTERFACE; }
/* info */
static HRESULT __stdcall infoGetObj(void *s, void **o){ (void)s; *o=&oEx; return S_OK; }
static HRESULT __stdcall infoQI(void*,const GUID*,void**);
static void *vtInfo[]={infoQI,ar,ar,dummy,dummy,infoGetObj}; static Obj oInfo={vtInfo};
static HRESULT __stdcall infoQI(void *s,const GUID *g,void **o){ (void)s; if(IsEqualGUID(g,&IID_IPluginInfo)){*o=&oInfo;return S_OK;} *o=NULL; return E_NOINTERFACE; }
/* list */
static HRESULT __stdcall lItem(void *s,int i,void **o){ (void)s;(void)i; *o=&oInfo; return S_OK; }
static HRESULT __stdcall lCount(void *s,int *n){ (void)s; *n=1; return S_OK; }
static void *vtList[]={dummy,ar,ar,dummy,lItem,lCount}; static Obj oList={vtList};
/* app */
static HRESULT __stdcall aGet(void *s,void **o){ (void)s; *o=&oList; return S_OK; }
static HRESULT __stdcall aQI(void*,const GUID*,void**);
static void *vtApp[19]; static Obj oApp={vtApp};
static HRESULT __stdcall aQI(void *s,const GUID *g,void **o){ (void)s; if(IsEqualGUID(g,&IID_IApplication)){*o=&oApp;return S_OK;} *o=NULL; return E_NOINTERFACE; }

static WNDPROC btnProc;
static LRESULT CALLBACK superBtn(HWND h,UINT m,WPARAM w,LPARAM l){ return CallWindowProcW(btnProc,h,m,w,l); }
static void regSuper(const wchar_t *name){
  WNDCLASSEXW wc={sizeof wc}; GetClassInfoExW(NULL,L"BUTTON",&wc); btnProc=wc.lpfnWndProc;
  wc.lpfnWndProc=superBtn; wc.lpszClassName=name; wc.hInstance=GetModuleHandleW(NULL); RegisterClassExW(&wc);
}

int wmain(int argc, wchar_t **argv){
  (void)argc;
  for(int i=0;i<19;i++) vtApp[i]=dummy; vtApp[0]=aQI; vtApp[1]=ar; vtApp[2]=ar; vtApp[18]=aGet;
  regSuper(L"TCheckBox"); regSuper(L"TButton");
  WNDCLASSW fc={0}; fc.lpfnWndProc=formProc; fc.hInstance=GetModuleHandleW(NULL); fc.lpszClassName=L"TOBJForm"; fc.hbrBackground=(HBRUSH)(COLOR_BTNFACE+1); RegisterClassW(&fc);
  HMODULE dll=LoadLibraryW(argv[1]); if(!dll){ printf("load fail %lu\n",GetLastError()); return 1; }
  typedef void**(*CO)(void**); CO co=(CO)GetProcAddress(dll,"createObject");
  void *unk=NULL; co(&unk); printf("createObject -> %p\n",unk);
  void *p=NULL,*init=NULL,*done=NULL,*ex=NULL; BSTR s=NULL;
  ((HRESULT(__stdcall*)(void*,const GUID*,void**))VT(unk)[0])(unk,&IID_IPlugin,&p);
  ((HRESULT(__stdcall*)(void*,BSTR*))VT(p)[3])(p,&s); printf("GetId: %ls\n",s);
  ((HRESULT(__stdcall*)(void*,const GUID*,void**))VT(unk)[0])(unk,&IID_IPluginInit,&init);
  ((HRESULT(__stdcall*)(void*,void*))VT(init)[4])(init,&oApp);
  ((HRESULT(__stdcall*)(void*,const GUID*,void**))VT(unk)[0])(unk,&IID_IExportPlugin,&ex);
  ((HRESULT(__stdcall*)(void*,BSTR*))VT(ex)[4])(ex,&s); printf("Caption: %ls\n",s);
  HRESULT hr=((HRESULT(__stdcall*)(void*,void*))VT(ex)[5])(ex,(void*)0x1234);
  printf("Execute hr=0x%08lx\n",(unsigned long)hr);
  ((HRESULT(__stdcall*)(void*,const GUID*,void**))VT(unk)[0])(unk,&IID_IPluginDone,&done);
  ((HRESULT(__stdcall*)(void*))VT(done)[4])(done);
  printf("ok\n"); return 0;
}
