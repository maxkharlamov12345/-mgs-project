#!/bin/sh
# Сборка кнопки MGS 3D для PRO100 и обновления для менеджеров.
#   sh 3d/pro100/build.sh      (нужен x86_64-w64-mingw32-gcc: apt-get install gcc-mingw-w64-x86-64-win32)
# Делает: MGS3D_PRO100.zip (установщик) и update/ (автообновление: manifest.json + mgs3d_core.dll + mgs3d_send.ps1).
# Менеджеры получают обновление, когда update/ попадает на рабочий сайт (git push origin main:prod),
# тестовый сайт: https://test.mgsmebel.com/3d/pro100/update (в mgs3d.ini: [update] url=...).
set -e
cd "$(dirname "$0")"
B=$(date -u +%y%j%H%M)          # номер сборки: год, день года, часы, минуты (UTC) — всегда растёт
T=$(mktemp -d); P="$T/MGS3D_PRO100"; mkdir -p "$P" update
x86_64-w64-mingw32-gcc -O2 -s -shared -municode -DMGS_BUILD=$B -o "$P/mgs3d.plg" src/mgs3d.c -lole32 -loleaut32 -lshell32 -luser32
cp src/mgs3d_send.ps1 src/install.ps1 src/uninstall.ps1 src/mgs3d.ini pkg/* "$P/"
cp "$P/mgs3d.plg" update/mgs3d_core.dll
cp src/mgs3d_send.ps1 update/mgs3d_send.ps1
python3 - "$B" "$P" <<'PY'
import sys,os,json,hashlib,zipfile
b,P=sys.argv[1],sys.argv[2]
files=[{'name':n,'sha256':hashlib.sha256(open('update/'+n,'rb').read()).hexdigest(),'size':os.path.getsize('update/'+n)} for n in ('mgs3d_core.dll','mgs3d_send.ps1')]
json.dump({'version':int(b),'files':files},open('update/manifest.json','w'),indent=1)
with zipfile.ZipFile('MGS3D_PRO100.zip','w',zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(P)): z.write(os.path.join(P,f),'MGS3D_PRO100/'+f)
print('сборка',b,'— архив и update/ готовы')
PY
rm -rf "$T"
