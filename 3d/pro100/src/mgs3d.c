/*
 * MGS 3D — плагин экспорта для PRO100 7.08 (x64).
 * Добавляет в меню «Экспорт» пункт «Отправить в MGS 3D…»:
 *   1) вызывает встроенный экспорт PRO100 в OBJ (плагин с id "export.obj");
 *   2) пока открыты его окна, сам ставит галочки и путь сохранения;
 *   3) после экспорта запускает mgs3d_send.ps1 (окно выбора проекта и отправка в MGS 3D).
 * Интерфейсы PRO100 — COM-подобные (IUnknown + методы, HRESULT, соглашение Win64).
 */
#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#define _UNICODE
#include <windows.h>
#include <oleauto.h>
#include <shlobj.h>
#include <stdio.h>
#include <wchar.h>

/* ---------- GUID интерфейсов PRO100 ---------- */
static const GUID IID_IUnknown_     = {0x00000000,0x0000,0x0000,{0xC0,0x00,0x00,0x00,0x00,0x00,0x00,0x46}};
static const GUID IID_IPlugin       = {0xe987c0b2,0x5651,0x4b1b,{0x98,0x37,0xb6,0x95,0xaf,0x8e,0x1d,0x22}};
static const GUID IID_IPluginInit   = {0x6f0f1740,0x5872,0x4ae9,{0x9c,0x33,0x9b,0xa6,0xa6,0x7e,0x4c,0x14}};
static const GUID IID_IPluginDone   = {0xb4dee719,0x24e8,0x4feb,{0x87,0xb9,0xa1,0x8b,0x9f,0xb5,0x38,0x5a}};
static const GUID IID_IExportPlugin = {0x9cad3fed,0x94fe,0x4ac6,{0xa9,0x90,0x6c,0x60,0x49,0x67,0x68,0xfd}};
static const GUID IID_IApplication  = {0x58ff9736,0x001f,0x427d,{0xbf,0xf1,0x36,0xd0,0x30,0x50,0x5b,0xcd}};
static const GUID IID_IApplication2 = {0x9692391b,0xccb6,0x4eff,{0xa0,0x90,0x59,0x37,0x88,0x07,0xd4,0x98}};
static const GUID IID_IPluginInfo   = {0x8fa9494c,0x0ee8,0x4505,{0xb8,0xd2,0xfc,0x0c,0x7c,0x10,0xdf,0x3f}};

/* Адреса методов в PRO100.exe 7.08 (сборка 11.07.2024) — проверка, что версия та же, до любых вызовов */
#define RVA_APP_GETPLUGINS 0xd6c771
#define RVA_LIST_ITEM      0xd6c147
#define RVA_LIST_COUNT     0xd6c150
#define RVA_OBJ_EXECUTE    0xc2144a

typedef HRESULT (__stdcall *QI_t)(void*, const GUID*, void**);
typedef ULONG   (__stdcall *AR_t)(void*);
typedef HRESULT (__stdcall *GetPlugins_t)(void*, void**);
typedef HRESULT (__stdcall *Item_t)(void*, int, void**);
typedef HRESULT (__stdcall *Count_t)(void*, int*);
typedef HRESULT (__stdcall *GetObj_t)(void*, void**);
typedef HRESULT (__stdcall *GetStr_t)(void*, BSTR*);
typedef HRESULT (__stdcall *Exec_t)(void*, void*);

#define VT(p) (*(void***)(p))
static HRESULT xQI(void *p, const GUID *g, void **o){ *o=NULL; return ((QI_t)VT(p)[0])(p,g,o); }
static void xRelease(void *p){ if(p) ((AR_t)VT(p)[2])(p); }

/* ---------- состояние ---------- */
static HINSTANCE g_inst;
static void *g_app;               /* приложение PRO100 из Init */
static volatile LONG g_ref = 1, g_busy = 0;
static wchar_t g_dir[MAX_PATH];   /* папка плагина */
static wchar_t g_out[MAX_PATH];   /* папка экспорта */
static wchar_t g_obj[MAX_PATH];   /* путь model.obj */
static FILE *g_log;

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
  swprintf(p,MAX_PATH,L"%ls\\MGS3D\\logs\\plugin.log",la);
  g_log=_wfopen(p,L"a, ccs=UTF-8");
}
static void say(const wchar_t *msg){ MessageBoxW(GetActiveWindow(), msg, L"MGS 3D", MB_OK|MB_ICONWARNING); }
static int ini(const wchar_t *key, int def){
  wchar_t p[MAX_PATH]; swprintf(p,MAX_PATH,L"%ls\\mgs3d.ini",g_dir);
  return GetPrivateProfileIntW(L"export",key,def,p);
}
static int slotOk(void *obj, int slot, ULONG_PTR rva, const wchar_t *name){
  ULONG_PTR base=(ULONG_PTR)GetModuleHandleW(NULL);
  ULONG_PTR fn=(ULONG_PTR)VT(obj)[slot];
  int ok = fn==base+rva;
  logw(L"ABI %ls slot=%d fn=%p expected=%p %ls", name, slot, (void*)fn, (void*)(base+rva), ok?L"OK":L"MISMATCH");
  return ok || ini(L"skip_version_check",0);
}

/* ---------- автозаполнение окон экспорта ---------- */
static int g_stageOpts, g_stageSave, g_ticks;
typedef struct { const wchar_t *cls; HWND found[16]; int n; } FindCtx;
static BOOL CALLBACK findKids(HWND h, LPARAM lp){
  FindCtx *c=(FindCtx*)lp; wchar_t cls[64];
  GetClassNameW(h,cls,64);
  if(!lstrcmpiW(cls,c->cls) && c->n<16) c->found[c->n++]=h;
  return TRUE;
}
static void dumpWindow(HWND w){
  wchar_t cls[64], txt[128]; GetClassNameW(w,cls,64); GetWindowTextW(w,txt,128);
  logw(L"  окно [%ls] «%ls» id=%d", cls, txt, GetDlgCtrlID(w));
}
static BOOL CALLBACK dumpKid(HWND h, LPARAM lp){ (void)lp; if(IsWindowVisible(h)) dumpWindow(h); return TRUE; }

static void fillOptions(HWND form){
  const wchar_t *names[3]={L"копировать текстуры",L"только выбранное",L"добавить стены"};
  int want[3]={ini(L"copy_textures",1), ini(L"selection_only",0), ini(L"add_walls",1)};
  FindCtx c={L"TCheckBox"}; EnumChildWindows(form,findKids,(LPARAM)&c);
  int pending=0;
  for(int i=0;i<c.n;i++){
    wchar_t t[128]; GetWindowTextW(c.found[i],t,128);
    for(int k=0;k<3;k++) if(!lstrcmpiW(t,names[k])){
      int st=(int)SendMessageW(c.found[i],BM_GETCHECK,0,0)==BST_CHECKED;
      if(st!=want[k]){ logw(L"галочка «%ls»: %d → %d", t, st, want[k]); SendMessageW(c.found[i],BM_CLICK,0,0); pending=1; }
    }
  }
  if(pending) return;                 /* проверим ещё раз на следующем такте */
  FindCtx b={L"TButton"}; EnumChildWindows(form,findKids,(LPARAM)&b);
  for(int i=0;i<b.n;i++){
    wchar_t t[64]; GetWindowTextW(b.found[i],t,64);
    if(!lstrcmpiW(t,L"OK") && IsWindowEnabled(b.found[i])){
      logw(L"окно настроек: нажимаю OK"); PostMessageW(b.found[i],BM_CLICK,0,0); g_stageOpts=1; return;
    }
  }
}
static void fillSave(HWND dlg){
  /* поле имени файла — Edit внутри ComboBoxEx32 (новый диалог) или любой Edit (старый) */
  HWND edit=NULL;
  FindCtx e={L"Edit"}; EnumChildWindows(dlg,findKids,(LPARAM)&e);
  for(int i=0;i<e.n;i++){
    HWND p=GetParent(e.found[i]); wchar_t pc[64]; GetClassNameW(p,pc,64);
    if(!lstrcmpiW(pc,L"ComboBox")){ edit=e.found[i]; break; }
  }
  if(!edit && e.n) edit=e.found[0];
  if(!edit){ logw(L"окно сохранения без поля имени — жду"); return; }
  SendMessageW(edit,WM_SETTEXT,0,(LPARAM)g_obj);
  wchar_t back[MAX_PATH]; SendMessageW(edit,WM_GETTEXT,MAX_PATH,(LPARAM)back);
  if(lstrcmpiW(back,g_obj)){ logw(L"путь не встал в поле: «%ls»", back); return; }
  HWND ok=GetDlgItem(dlg,IDOK);
  if(!ok){
    FindCtx b={L"Button"}; EnumChildWindows(dlg,findKids,(LPARAM)&b);
    for(int i=0;i<b.n;i++){ wchar_t t[64]; GetWindowTextW(b.found[i],t,64);
      if(wcsstr(t,L"Сохранить")||wcsstr(t,L"Save")){ ok=b.found[i]; break; } }
  }
  logw(L"окно сохранения: путь %ls, нажимаю Сохранить", g_obj);
  if(ok) PostMessageW(ok,BM_CLICK,0,0); else PostMessageW(dlg,WM_COMMAND,IDOK,0);
  g_stageSave=1;
}
static BOOL CALLBACK onThreadWnd(HWND w, LPARAM lp){
  (void)lp;
  if(!IsWindowVisible(w)) return TRUE;
  wchar_t cls[64]; GetClassNameW(w,cls,64);
  if(!lstrcmpiW(cls,L"TOBJForm") && !g_stageOpts){ fillOptions(w); return FALSE; }
  if(!lstrcmpiW(cls,L"#32770") && !g_stageSave){
    FindCtx e={L"Edit"}; EnumChildWindows(w,findKids,(LPARAM)&e);
    if(e.n){ fillSave(w); return FALSE; }
    logw(L"сообщение PRO100:"); dumpWindow(w); EnumChildWindows(w,dumpKid,0);
  }
  return TRUE;
}
static VOID CALLBACK onTimer(HWND h, UINT m, UINT_PTR id, DWORD t){
  (void)h;(void)m;(void)t;
  if(++g_ticks==1 || g_ticks%20==0) logw(L"такт %d: настройки=%d сохранение=%d", g_ticks, g_stageOpts, g_stageSave);
  if(g_ticks>200){ KillTimer(NULL,id); logw(L"автозаполнение: время вышло (30 с)"); return; }
  if(g_stageOpts && g_stageSave) { KillTimer(NULL,id); return; }
  EnumThreadWindows(GetCurrentThreadId(),onThreadWnd,0);
}

/* ---------- поиск встроенного экспорта OBJ ---------- */
static void *findObjExporter(void){
  void *app=NULL, *list=NULL, *res=NULL; int n=0;
  if(!g_app){ logw(L"нет связи с PRO100 (Init не вызывался)"); return NULL; }
  if(FAILED(xQI(g_app,&IID_IApplication,&app)) || !app)
    if(FAILED(xQI(g_app,&IID_IApplication2,&app)) || !app){ logw(L"QI IApplication: нет"); return NULL; }
  if(!slotOk(app,18,RVA_APP_GETPLUGINS,L"app.GetPlugins")) goto out;
  if(FAILED(((GetPlugins_t)VT(app)[18])(app,&list)) || !list){ logw(L"GetPlugins: ошибка"); goto out; }
  if(!slotOk(list,4,RVA_LIST_ITEM,L"list.Item") || !slotOk(list,5,RVA_LIST_COUNT,L"list.Count")) goto out;
  if(FAILED(((Count_t)VT(list)[5])(list,&n)) || n<=0 || n>4096){ logw(L"Count: %d", n); goto out; }
  logw(L"плагинов в PRO100: %d", n);
  for(int i=0;i<n && !res;i++){
    void *it=NULL,*info=NULL,*obj=NULL,*ex=NULL; BSTR id=NULL;
    if(SUCCEEDED(((Item_t)VT(list)[4])(list,i,&it)) && it &&
       SUCCEEDED(xQI(it,&IID_IPluginInfo,&info)) && info &&
       SUCCEEDED(((GetObj_t)VT(info)[5])(info,&obj)) && obj &&
       SUCCEEDED(xQI(obj,&IID_IExportPlugin,&ex)) && ex &&
       SUCCEEDED(((GetStr_t)VT(ex)[3])(ex,&id)) && id){
      logw(L"  экспорт [%d]: %ls", i, id);
      if(!lstrcmpiW(id,L"export.obj")){ res=ex; ex=NULL; }
    }
    if(id) SysFreeString(id);
    xRelease(ex); xRelease(obj); xRelease(info); xRelease(it);
  }
  if(res && !slotOk(res,5,RVA_OBJ_EXECUTE,L"export.obj.Execute")){ xRelease(res); res=NULL; }
out:
  xRelease(list); xRelease(app);
  return res;
}

static void projectTitle(wchar_t *out, int cap){
  HWND w=GetAncestor(GetActiveWindow(),GA_ROOTOWNER); out[0]=0;
  if(w) GetWindowTextW(w,out,cap);
  for(wchar_t *p=out;*p;p++) if(*p==L'"') *p=L'\'';
}

static int fileSize(const wchar_t *p, LONGLONG *sz){
  WIN32_FILE_ATTRIBUTE_DATA a;
  if(!GetFileAttributesExW(p,GetFileExInfoStandard,&a)) return 0;
  *sz=((LONGLONG)a.nFileSizeHigh<<32)|a.nFileSizeLow; return 1;
}

static HRESULT runExport(void *ctx){
  openLog(); logw(L"=== Отправить в MGS 3D ===");
  void *ex=findObjExporter();
  if(!ex){ say(L"Не удалось найти экспорт OBJ в PRO100.\nЭта версия PRO100 пока не поддерживается плагином MGS 3D (нужна 7.08).\n\nЖурнал: %LOCALAPPDATA%\\MGS3D\\logs"); return E_FAIL; }
  wchar_t la[MAX_PATH]; SYSTEMTIME t; GetLocalTime(&t);
  SHGetFolderPathW(NULL,CSIDL_LOCAL_APPDATA,NULL,0,la);
  swprintf(g_out,MAX_PATH,L"%ls\\MGS3D\\export",la); CreateDirectoryW(g_out,NULL);
  swprintf(g_out,MAX_PATH,L"%ls\\MGS3D\\export\\%04u%02u%02u-%02u%02u%02u",la,t.wYear,t.wMonth,t.wDay,t.wHour,t.wMinute,t.wSecond);
  CreateDirectoryW(g_out,NULL);
  swprintf(g_obj,MAX_PATH,L"%ls\\model.obj",g_out);
  logw(L"папка экспорта: %ls", g_out);

  wchar_t title[300]; projectTitle(title,300);
  g_stageOpts=g_stageSave=g_ticks=0;
  UINT_PTR tm = ini(L"auto_fill",1) ? SetTimer(NULL,0,150,onTimer) : 0;
  HRESULT hr=((Exec_t)VT(ex)[5])(ex,ctx);
  if(tm) KillTimer(NULL,tm);
  xRelease(ex);
  LONGLONG sz=0;
  logw(L"экспорт OBJ завершён hr=0x%08lx", (unsigned long)hr);
  if(!fileSize(g_obj,&sz) || sz<=0){
    logw(L"model.obj не появился");
    if(g_stageSave || !tm) say(L"PRO100 не сохранил модель. Повторите «Отправить в MGS 3D…».");
    return S_OK;               /* пользователь мог просто закрыть окно экспорта */
  }
  logw(L"model.obj: %lld байт", sz);

  /* размеры, поставленные менеджером (плагин «Размеры MGS», mgsdims.plg), — рядом с моделью для сайта */
  {
    HMODULE dm=GetModuleHandleW(L"mgsdims.plg");
    typedef int (__stdcall *WJ_t)(const wchar_t*);
    WJ_t wj = dm ? (WJ_t)GetProcAddress(dm,"MgsDimsWriteJson") : NULL;
    if(wj){ wchar_t jp[MAX_PATH]; swprintf(jp,MAX_PATH,L"%ls\\mgs-dims.json",g_out); logw(L"размеров для сайта: %d", wj(jp)); }
    else logw(L"плагин размеров не загружен — размеры не передаются");
  }

  wchar_t cmd[2048], ps1[MAX_PATH];
  swprintf(ps1,MAX_PATH,L"%ls\\mgs3d_send.ps1",g_dir);
  if(GetFileAttributesW(ps1)==INVALID_FILE_ATTRIBUTES){ say(L"Рядом с плагином нет mgs3d_send.ps1. Переустановите MGS 3D."); return E_FAIL; }
  swprintf(cmd,2048,L"powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File \"%ls\" -Dir \"%ls\" -Title \"%ls\"",ps1,g_out,title);
  STARTUPINFOW si={sizeof si}; PROCESS_INFORMATION pi;
  if(CreateProcessW(NULL,cmd,NULL,NULL,FALSE,CREATE_NO_WINDOW,NULL,g_dir,&si,&pi)){
    AllowSetForegroundWindow(pi.dwProcessId);
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    logw(L"запущено окно отправки");
  } else { logw(L"не запустилось окно отправки, ошибка %lu", GetLastError()); say(L"Не удалось открыть окно отправки MGS 3D."); }
  return S_OK;
}

/* ---------- объект плагина ---------- */
typedef struct { void **vt; } Obj;
static HRESULT __stdcall pQI(void*,const GUID*,void**);
static ULONG   __stdcall pAddRef(void *s){ (void)s; return InterlockedIncrement(&g_ref); }
static ULONG   __stdcall pRelease(void *s){ (void)s; LONG r=InterlockedDecrement(&g_ref); return r>0?r:0; }
static HRESULT __stdcall pGetId(void *s, BSTR *o){ (void)s; if(!o) return E_POINTER; *o=SysAllocString(L"mgs3d.send.v1"); return *o?S_OK:E_OUTOFMEMORY; }
static HRESULT __stdcall pInit(void *s, void *app){
  (void)s; openLog(); logw(L"Init app=%p", app);
  if(g_app) xRelease(g_app);
  g_app=app; if(app) ((AR_t)VT(app)[1])(app);
  return S_OK;
}
static HRESULT __stdcall pDone(void *s){ (void)s; logw(L"Done"); if(g_app){ xRelease(g_app); g_app=NULL; } return S_OK; }
static HRESULT __stdcall pCaption(void *s, BSTR *o){ (void)s; if(!o) return E_POINTER; *o=SysAllocString(L"Отправить в MGS 3D…"); return *o?S_OK:E_OUTOFMEMORY; }
static HRESULT __stdcall pExecute(void *s, void *ctx){
  (void)s;
  if(InterlockedCompareExchange(&g_busy,1,0)) return E_PENDING;
  HRESULT hr=runExport(ctx);
  InterlockedExchange(&g_busy,0);
  return hr;
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

/* PRO100 вызывает createObject и получает интерфейс через скрытый выходной параметр */
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
