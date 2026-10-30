"""MGS: управление сотрудниками (только для администраторов).

Маленький сервис без зависимостей (Python stdlib). Снаружи доступен как https://api.mgsmebel.com/admin/v1/...
Проверяет вход сотрудника (JWT, подписанный JWT_SECRET) и его роль, затем вызывает
административное API GoTrue (auth:9999/admin/...) ключом service_role, который не покидает сервер.

Роль хранится в app_metadata.mgs_role пользователя: 'admin' | 'manager'.
Если администраторов ещё нет — самый первый созданный сотрудник становится администратором.
"""
import base64, hashlib, hmac, json, os, re, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AUTH = os.environ.get('AUTH_URL', 'http://auth:9999')
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


def gotrue(method, path, body=None):
    req = urllib.request.Request(AUTH + path, method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {SERVICE}', 'apikey': SERVICE,
                                          'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'null')
        except Exception:
            return e.code, None


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


def public(u):
    return {'id': u['id'], 'email': u.get('email'), 'name': (u.get('user_metadata') or {}).get('name') or '',
            'role': role_of(u), 'disabled': is_disabled(u), 'created_at': u.get('created_at'),
            'last_sign_in_at': u.get('last_sign_in_at')}


EMAIL = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


class H(BaseHTTPRequestHandler):
    server_version = 'mgs-admin'

    def log_message(self, fmt, *a):
        print('%s %s' % (self.command, self.path), flush=True)

    def reply(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n > 100_000:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            return {}

    def caller(self):
        """Возвращает (claims, user) администратора или отвечает ошибкой и возвращает None."""
        auth = self.headers.get('Authorization', '')
        claims = verify(auth[7:]) if auth.startswith('Bearer ') else None
        if not claims:
            self.reply(401, {'error': 'Нужно войти заново'})
            return None
        try:
            bootstrap()
        except Exception as e:
            self.reply(502, {'error': f'Сервис входа недоступен ({e})'})
            return None
        st, me = gotrue('GET', f"/admin/users/{claims.get('sub')}")
        if st != 200 or is_disabled(me) or role_of(me) != 'admin':
            self.reply(403, {'error': 'Только для администратора'})
            return None
        return me

    def route(self):
        p = self.path.split('?')[0].rstrip('/')
        m = re.fullmatch(r'/staff(?:/([0-9a-f-]{36}))?', p)
        return m

    def do_GET(self):
        if self.path.rstrip('/') in ('', '/health'):
            return self.reply(200, {'ok': True})
        m = self.route()
        if not m or m.group(1):
            return self.reply(404, {'error': 'not found'})
        if not self.caller():
            return
        users = sorted(all_users(), key=lambda u: u.get('created_at') or '')
        self.reply(200, [public(u) for u in users])

    def do_POST(self):
        m = self.route()
        if not m or m.group(1):
            return self.reply(404, {'error': 'not found'})
        if not self.caller():
            return
        d = self.body()
        email = str(d.get('email', '')).strip().lower()
        pw = str(d.get('password', ''))
        role = d.get('role') if d.get('role') in ROLES else 'manager'
        name = str(d.get('name', '')).strip()[:100]
        if not EMAIL.match(email):
            return self.reply(400, {'error': 'Проверьте почту'})
        if len(pw) < 8:
            return self.reply(400, {'error': 'Пароль — не меньше 8 символов'})
        st, u = gotrue('POST', '/admin/users', {'email': email, 'password': pw, 'email_confirm': True,
                                                 'app_metadata': {'mgs_role': role},
                                                 'user_metadata': {'name': name}})
        if st >= 300:
            msg = (u or {}).get('msg') or (u or {}).get('message') or ''
            if 'already' in msg or st == 422:
                return self.reply(409, {'error': 'Сотрудник с такой почтой уже есть'})
            return self.reply(400, {'error': f'Не удалось создать ({st}) {msg}'.strip()})
        self.reply(200, public(u))

    def do_PATCH(self):
        m = self.route()
        if not m or not m.group(1):
            return self.reply(404, {'error': 'not found'})
        me = self.caller()
        if not me:
            return
        uid = m.group(1)
        d = self.body()
        upd = {}
        if 'role' in d:
            if d['role'] not in ROLES:
                return self.reply(400, {'error': 'Неизвестная роль'})
            if uid == me['id'] and d['role'] != 'admin':
                return self.reply(400, {'error': 'Нельзя снять роль администратора с себя'})
            upd['app_metadata'] = {'mgs_role': d['role']}
        if 'name' in d:
            upd['user_metadata'] = {'name': str(d['name']).strip()[:100]}
        if 'password' in d:
            if len(str(d['password'])) < 8:
                return self.reply(400, {'error': 'Пароль — не меньше 8 символов'})
            upd['password'] = str(d['password'])
        if 'disabled' in d:
            if uid == me['id'] and d['disabled']:
                return self.reply(400, {'error': 'Нельзя отключить себя'})
            upd['ban_duration'] = BAN if d['disabled'] else 'none'
        if not upd:
            return self.reply(400, {'error': 'Нечего менять'})
        st, u = gotrue('PUT', f'/admin/users/{uid}', upd)
        if st >= 300:
            return self.reply(400, {'error': f'Не удалось сохранить ({st})'})
        self.reply(200, public(u))


if __name__ == '__main__':
    print('mgs-admin on :8000', flush=True)
    ThreadingHTTPServer(('0.0.0.0', 8000), H).serve_forever()
