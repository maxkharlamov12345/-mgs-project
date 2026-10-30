"""MGS: управление сотрудниками (только для администраторов).

Маленький сервис без зависимостей (Python stdlib). Снаружи доступен как https://api.mgsmebel.com/admin/v1/...
Проверяет вход сотрудника (JWT, подписанный JWT_SECRET) и его роль, затем вызывает
административное API GoTrue (auth:9999/admin/...) ключом service_role, который не покидает сервер.

Роль хранится в app_metadata.mgs_role пользователя: 'admin' | 'manager'.
Если администраторов ещё нет — самый первый созданный сотрудник становится администратором.
"""
import base64, hashlib, hmac, json, os, re, time, uuid, urllib.parse, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AUTH = os.environ.get('AUTH_URL', 'http://auth:9999')
REST = os.environ.get('REST_URL', 'http://rest:3000')
STORAGE = os.environ.get('STORAGE_URL', 'http://storage:5000')
MEDIA = 'media'
SECRET = os.environ['JWT_SECRET'].encode()
SERVICE = os.environ['SERVICE_ROLE_KEY']
ROLES = ('admin', 'manager')
BAN = '876000h'  # «навсегда» (100 лет)


def b64d(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def verify(token):
    try:
        h, p, s = token.split('.')
        sig = hmac.new(SECRET, f'{h}.{p}'.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(sig, b64d(s)):
            return None
        claims = json.loads(b64d(p))
        if claims.get('exp', 0) < time.time() or claims.get('role') != 'authenticated':
            return None
        return claims
    except Exception:
        return None


def call(base, method, path, body=None, raw=None, ctype='application/json', extra=None):
    data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    h = {'Authorization': f'Bearer {SERVICE}', 'apikey': SERVICE, 'Content-Type': ctype}
    h.update(extra or {})
    req = urllib.request.Request(base + path, method=method, data=data, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'null')
        except Exception:
            return e.code, None


def gotrue(method, path, body=None):
    return call(AUTH, method, path, body)


def rest(method, path, body=None):
    """PostgREST ключом service_role (обходит RLS). Возвращает (код, json)."""
    return call(REST, method, path, body, extra={'Prefer': 'return=representation'})


def must(res, what):
    st, d = res
    if st >= 300:
        msg = (d or {}).get('message') if isinstance(d, dict) else ''
        raise ApiError(400 if st < 500 else 502, f'{what}: ошибка {st} {msg or ""}'.strip())
    return d


class ApiError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg); self.code = code


def put_photo(kind, data, ctype):
    ext = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}.get(ctype)
    if not ext:
        raise ApiError(400, 'Фото — JPEG, PNG или WebP')
    path = f'{kind}/{uuid.uuid4().hex}.{ext}'
    st, d = call(STORAGE, 'POST', f'/object/{MEDIA}/{path}', raw=data, ctype=ctype, extra={'x-upsert': 'true'})
    if st >= 300:
        raise ApiError(502, f'Не удалось сохранить фото ({st})')
    return path


def drop_photo(path):
    if path:
        call(STORAGE, 'DELETE', f'/object/{MEDIA}/{path}')


def all_users():
    st, data = gotrue('GET', '/admin/users?page=1&per_page=1000')
    if st != 200:
        raise RuntimeError(f'auth {st}')
    return data.get('users', []) if isinstance(data, dict) else data


def role_of(u):
    r = (u.get('app_metadata') or {}).get('mgs_role')
    return r if r in ROLES else 'manager'


def is_disabled(u):
    b = u.get('banned_until')
    return bool(b) and b > time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime())


def bootstrap():
    """Нет ни одного администратора — делаем им самого первого сотрудника."""
    users = all_users()
    if any(role_of(u) == 'admin' and (u.get('app_metadata') or {}).get('mgs_role') for u in users):
        return
    if users:
        first = min(users, key=lambda u: u.get('created_at') or '')
        gotrue('PUT', f"/admin/users/{first['id']}", {'app_metadata': {'mgs_role': 'admin'}})


def profiles():
    d = must(rest('GET', '/staff_profiles?select=*'), 'Профили')
    return {p['user_id']: p for p in d}


def public(u, prof=None):
    prof = prof or {}
    return {'id': u['id'], 'email': u.get('email'),
            'name': prof.get('name') or (u.get('user_metadata') or {}).get('name') or '',
            'phone': prof.get('phone') or '', 'photo': prof.get('photo'), 'salon_id': prof.get('salon_id'),
            'role': role_of(u), 'disabled': is_disabled(u), 'created_at': u.get('created_at'),
            'last_sign_in_at': u.get('last_sign_in_at')}


EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
UUID = r'([0-9a-f-]{36})'
txt = lambda v, n=200: str(v or '').strip()[:n]


def save_profile(uid, d, old=None):
    """Сохраняет поля профиля из d (name, phone, salon_id, photo). Возвращает профиль."""
    row = {'user_id': uid}
    for k in ('name', 'phone'):
        if k in d:
            row[k] = txt(d[k], 120)
    if 'salon_id' in d:
        row['salon_id'] = d['salon_id'] or None
    if 'photo' in d:
        row['photo'] = d['photo'] or None
    if len(row) == 1:
        return old or {}
    row['updated_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    st, r = call(REST, 'POST', '/staff_profiles?on_conflict=user_id', [row],
                 extra={'Prefer': 'return=representation,resolution=merge-duplicates'})
    if st >= 300:
        raise ApiError(400, f'Не удалось сохранить профиль ({st}) {(r or {}).get("message", "") if isinstance(r, dict) else ""}'.strip())
    if old and 'photo' in d and old.get('photo') and old.get('photo') != row.get('photo'):
        drop_photo(old['photo'])
    return r[0] if r else row


class H(BaseHTTPRequestHandler):
    server_version = 'mgs-admin'

    def log_message(self, fmt, *a):
        print('%s %s %s' % (self.command, self.path, a[1] if len(a) > 1 else ''), flush=True)

    def reply(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def raw(self, limit):
        n = int(self.headers.get('Content-Length') or 0)
        if n > limit:
            raise ApiError(413, 'Файл слишком большой')
        return self.rfile.read(n) if n else b''

    def body(self):
        try:
            return json.loads(self.raw(200_000) or b'{}')
        except ApiError:
            raise
        except Exception:
            raise ApiError(400, 'Неверный запрос')

    def admin(self):
        """Пользователь-администратор, вызвавший запрос (иначе ApiError)."""
        auth = self.headers.get('Authorization', '')
        claims = verify(auth[7:]) if auth.startswith('Bearer ') else None
        if not claims:
            raise ApiError(401, 'Нужно войти заново')
        try:
            bootstrap()
        except Exception as e:
            raise ApiError(502, f'Сервис входа недоступен ({e})')
        st, me = gotrue('GET', f"/admin/users/{claims.get('sub')}")
        if st != 200 or is_disabled(me) or role_of(me) != 'admin':
            raise ApiError(403, 'Только для администратора')
        return me

    def handle_any(self):
        path = urllib.parse.urlsplit(self.path).path.rstrip('/')
        if self.command == 'GET' and path in ('', '/health'):
            return self.reply(200, {'ok': True})
        for pat, fn in ROUTES.get(self.command, []):
            m = re.fullmatch(pat, path)
            if m:
                try:
                    me = self.admin()
                    code, obj = fn(self, me, *m.groups())
                    return self.reply(code, obj)
                except ApiError as e:
                    return self.reply(e.code, {'error': str(e)})
                except Exception as e:
                    print('ERR', repr(e), flush=True)
                    return self.reply(500, {'error': 'Ошибка сервера'})
        self.reply(404, {'error': 'not found'})

    do_GET = do_POST = do_PATCH = do_DELETE = do_PUT = handle_any


# ---------- сотрудники ----------
def staff_list(h, me):
    profs = profiles()
    users = sorted(all_users(), key=lambda u: u.get('created_at') or '')
    return 200, [public(u, profs.get(u['id'])) for u in users]


def staff_create(h, me):
    d = h.body()
    email = txt(d.get('email')).lower()
    pw = str(d.get('password', ''))
    role = d.get('role') if d.get('role') in ROLES else 'manager'
    if not EMAIL.match(email):
        raise ApiError(400, 'Проверьте почту')
    if len(pw) < 8:
        raise ApiError(400, 'Пароль — не меньше 8 символов')
    if not txt(d.get('name')):
        raise ApiError(400, 'Укажите ФИО')
    st, u = gotrue('POST', '/admin/users', {'email': email, 'password': pw, 'email_confirm': True,
                                             'app_metadata': {'mgs_role': role},
                                             'user_metadata': {'name': txt(d.get('name'), 120)}})
    if st >= 300:
        msg = (u or {}).get('msg') or (u or {}).get('message') or ''
        if 'already' in msg or st == 422:
            raise ApiError(409, 'Сотрудник с такой почтой уже есть')
        raise ApiError(400, f'Не удалось создать ({st}) {msg}'.strip())
    prof = save_profile(u['id'], d)
    return 200, public(u, prof)


def staff_update(h, me, uid):
    d = h.body()
    upd = {}
    if 'role' in d:
        if d['role'] not in ROLES:
            raise ApiError(400, 'Неизвестная роль')
        if uid == me['id'] and d['role'] != 'admin':
            raise ApiError(400, 'Нельзя снять роль администратора с себя')
        upd['app_metadata'] = {'mgs_role': d['role']}
    if 'name' in d:
        if not txt(d['name']):
            raise ApiError(400, 'Укажите ФИО')
        upd['user_metadata'] = {'name': txt(d['name'], 120)}
    if 'password' in d:
        if len(str(d['password'])) < 8:
            raise ApiError(400, 'Пароль — не меньше 8 символов')
        upd['password'] = str(d['password'])
    if 'disabled' in d:
        if uid == me['id'] and d['disabled']:
            raise ApiError(400, 'Нельзя отключить себя')
        upd['ban_duration'] = BAN if d['disabled'] else 'none'
    if upd:
        st, u = gotrue('PUT', f'/admin/users/{uid}', upd)
        if st >= 300:
            raise ApiError(400, f'Не удалось сохранить ({st})')
    else:
        st, u = gotrue('GET', f'/admin/users/{uid}')
        if st != 200:
            raise ApiError(404, 'Сотрудник не найден')
    old = profiles().get(uid)
    prof = save_profile(uid, d, old)
    return 200, public(u, prof if prof else old)


# ---------- салоны ----------
def salon_fields(d, need):
    row = {}
    if 'name' in d or need:
        row['name'] = txt(d.get('name'), 120)
        if not row['name']:
            raise ApiError(400, 'Укажите название салона')
    if 'address' in d or need:
        row['address'] = txt(d.get('address'), 300)
    if 'photo' in d:
        row['photo'] = d['photo'] or None
    if 'sort' in d:
        row['sort'] = int(d['sort'] or 0)
    return row


def salons_list(h, me):
    return 200, must(rest('GET', '/salons?select=*&order=sort,created_at'), 'Салоны')


def salon_create(h, me):
    r = must(rest('POST', '/salons', [salon_fields(h.body(), True)]), 'Салон')
    return 200, r[0]


def salon_update(h, me, sid):
    d = h.body()
    old = must(rest('GET', f'/salons?id=eq.{sid}&select=*'), 'Салон')
    if not old:
        raise ApiError(404, 'Салон не найден')
    r = must(rest('PATCH', f'/salons?id=eq.{sid}', salon_fields(d, False)), 'Салон')
    if 'photo' in d and old[0].get('photo') and old[0]['photo'] != d['photo']:
        drop_photo(old[0]['photo'])
    return 200, r[0]


def salon_delete(h, me, sid):
    old = must(rest('DELETE', f'/salons?id=eq.{sid}'), 'Салон')
    for s in old or []:
        drop_photo(s.get('photo'))
    return 200, {'ok': True}


# ---------- фото ----------
def photo_upload(h, me, kind):
    ctype = (h.headers.get('Content-Type') or '').split(';')[0].strip().lower()
    data = h.raw(10 * 1024 * 1024)
    if not data:
        raise ApiError(400, 'Пустой файл')
    return 200, {'path': put_photo(kind, data, ctype)}


ROUTES = {
    'GET': [(r'/staff', staff_list), (r'/salons', salons_list)],
    'POST': [(r'/staff', staff_create), (r'/salons', salon_create), (r'/photo/(staff|salon)', photo_upload)],
    'PATCH': [(r'/staff/' + UUID, staff_update), (r'/salons/' + UUID, salon_update)],
    'DELETE': [(r'/salons/' + UUID, salon_delete)],
}


if __name__ == '__main__':
    print('mgs-admin on :8000', flush=True)
    ThreadingHTTPServer(('0.0.0.0', 8000), H).serve_forever()
