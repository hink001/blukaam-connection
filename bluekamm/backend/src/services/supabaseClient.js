const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tgzhjepxjpbxpypwaypz.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_vzjADvqW9Wu4g3nlXSC2DQ_8G-g03I5';

let supabase = null;
try {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('✅ Supabase Client initialized for URL:', SUPABASE_URL);
} catch (err) {
    console.warn('⚠️ Supabase Client initialization warning:', err.message);
}

module.exports = {
    supabase,
    SUPABASE_URL,
    SUPABASE_ANON_KEY
};
