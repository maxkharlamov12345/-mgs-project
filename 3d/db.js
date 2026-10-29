const {createClient}=window.supabase;
import {SUPABASE_URL,SUPABASE_KEY,BUCKET} from './config.js';
export const configured=!SUPABASE_URL.startsWith('PASTE');
export const sb=configured?createClient(SUPABASE_URL,SUPABASE_KEY):null;
export const publicUrl=path=>`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
export {BUCKET};
