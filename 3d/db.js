// ?v= у config.js: в рабочей версии до 12.11 был config.js со старым облаком supabase.co — браузеры держали его в кэше
// и просмотр на my.mgsmebel.com писал «Проект не найден» (Макс 12.11). Все страницы импортируют db.js и config.js с ОДНОЙ меткой.
const {createClient}=window.supabase;
import {SUPABASE_URL,SUPABASE_KEY,BUCKET} from './config.js?v=20261112c';
export const configured=!SUPABASE_URL.startsWith('PASTE');
export const sb=configured?createClient(SUPABASE_URL,SUPABASE_KEY):null;
export const publicUrl=path=>`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
export {BUCKET};
