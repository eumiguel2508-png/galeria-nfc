// Acesso ao Supabase: banco (via RPC e RLS) e storage.
(function () {
  const cfg = window.APP_CONFIG || {};
  const LIMIT = 50;
  const BUCKET = 'fotos';
  const MAX_INPUT_BYTES = 15 * 1024 * 1024;
  const FULL_SIDE = 1280;
  const THUMB_SIDE = 400;

  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('COLE_AQUI') || !window.supabase) {
    window.DB_CONFIG_ERROR = true;
    window.DB = null;
    return;
  }

  const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const storage = client.storage.from(BUCKET);

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  function publicUrl(path) {
    return storage.getPublicUrl(path).data.publicUrl;
  }

  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }

  // Valida e gera duas versões em JPEG. Desenhar no canvas remove os metadados EXIF (GPS incluso).
  async function prepareImage(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('formato não permitido');
    if (file.size > MAX_INPUT_BYTES) throw new Error('arquivo maior que 15 MB');

    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('imagem ilegível'));
        i.src = url;
      });
      const big = Math.max(img.width, img.height);
      const make = (side, quality) => {
        const s = Math.min(1, side / big);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return new Promise((resolve, reject) =>
          c.toBlob(b => (b ? resolve(b) : reject(new Error('falha ao processar imagem'))), 'image/jpeg', quality)
        );
      };
      return { full: await make(FULL_SIDE, 0.8), thumb: await make(THUMB_SIDE, 0.7) };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  window.DB = {
    LIMIT,
    publicUrl,

    // ----- visitante -----
    getGallery: token => rpc('get_gallery', { p_token: token }),

    async uploadPhoto(token, file) {
      const { full, thumb } = await prepareImage(file);
      const id = uid();
      const pathFull = `${token}/f/${id}.jpg`;
      const pathThumb = `${token}/t/${id}.jpg`;
      const names = [pathFull, pathThumb];
      const opts = { contentType: 'image/jpeg', cacheControl: '31536000' };

      try {
        let r = await storage.upload(pathFull, full, opts);
        if (r.error) throw r.error;
        r = await storage.upload(pathThumb, thumb, opts);
        if (r.error) throw r.error;
        return await rpc('add_photo', {
          p_token: token,
          p_path_full: pathFull,
          p_path_thumb: pathThumb,
          p_mime: 'image/jpeg',
          p_size: full.size
        });
      } catch (err) {
        await rpc('discard_upload', { p_token: token, p_names: names }).catch(() => {});
        throw err;
      }
    },

    deletePhoto: (token, photo) => rpc('delete_photo', { p_token: token, p_photo_id: photo.id }),

    // ----- administrador -----
    async session() {
      return (await client.auth.getSession()).data.session;
    },
    signIn: (email, password) => client.auth.signInWithPassword({ email, password }),
    signOut: () => client.auth.signOut(),
    isAdmin: () => rpc('is_admin'),

    async adminKeychains() {
      const { data, error } = await client
        .from('keychains')
        .select('id, public_token, label, active, created_at, photos(count)')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },

    async adminCreateKeychain(label) {
      const { error } = await client.from('keychains').insert({ label });
      if (error) throw error;
    },

    async adminSetActive(id, active) {
      const { error } = await client.from('keychains').update({ active }).eq('id', id);
      if (error) throw error;
    },

    async adminPhotos(keychainId) {
      const { data, error } = await client
        .from('photos')
        .select('id, path_full, path_thumb, created_at')
        .eq('keychain_id', keychainId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(p => ({ id: p.id, full: p.path_full, thumb: p.path_thumb, created_at: p.created_at }));
    },

    adminDeletePhoto: photo => rpc('admin_delete_photo', { p_photo_id: photo.id })
  };
})();
