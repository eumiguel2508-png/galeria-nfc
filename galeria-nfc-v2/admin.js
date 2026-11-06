(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const galleryUrl = token => new URL('galeria.html?g=' + encodeURIComponent(token), location.href).href;

  function showLogin() {
    $('loginCard').hidden = false;
    $('panel').hidden = true;
    $('logout').hidden = true;
  }

  function showPanel() {
    $('loginCard').hidden = true;
    $('panel').hidden = false;
    $('logout').hidden = false;
  }

  async function start() {
    if (window.DB_CONFIG_ERROR) {
      $('fatal').textContent = 'Sistema não configurado: preencha o config.js com a URL e a chave do Supabase.';
      $('loginCard').hidden = true;
      return;
    }
    const session = await DB.session();
    if (!session) return showLogin();
    try {
      if (!(await DB.isAdmin())) {
        await DB.signOut();
        $('loginErr').textContent = 'Esta conta não tem permissão de administrador.';
        return showLogin();
      }
    } catch (e) {
      $('fatal').textContent = 'Não foi possível verificar a permissão. Tente novamente.';
      return;
    }
    showPanel();
    renderList();
  }

  $('loginForm').onsubmit = async e => {
    e.preventDefault();
    $('loginErr').textContent = '';
    const { error } = await DB.signIn($('email').value.trim(), $('password').value);
    if (error) {
      $('loginErr').textContent = 'E-mail ou senha incorretos.';
      return;
    }
    $('password').value = '';
    start();
  };

  $('logout').onclick = async () => {
    await DB.signOut();
    location.reload();
  };

  async function renderList() {
    let rows;
    try {
      rows = await DB.adminKeychains();
    } catch (e) {
      $('list').innerHTML = '<p class="muted">Não foi possível carregar os chaveiros.</p>';
      return;
    }
    $('summary').textContent = `${rows.length} chaveiro(s)`;
    if (!rows.length) {
      $('list').innerHTML = '<p class="muted">Nenhum chaveiro cadastrado ainda.</p>';
      return;
    }
    $('list').innerHTML = rows.map(k => {
      const count = k.photos && k.photos[0] ? k.photos[0].count : 0;
      return `
        <div class="card" style="box-shadow:none;border:1px solid #e3e8e2">
          <div class="row" style="justify-content:space-between">
            <strong>${esc(k.label)}</strong>
            <span class="badge ${k.active ? 'on' : 'off'}">${k.active ? 'Ativo' : 'Inativo'}</span>
          </div>
          <p class="muted">${count} de ${DB.LIMIT} fotos • criado em ${new Date(k.created_at).toLocaleDateString('pt-BR')}</p>
          <div class="link">${esc(galleryUrl(k.public_token))}</div>
          <div class="row" style="margin-top:10px">
            <button class="btn-light" data-act="copy" data-token="${esc(k.public_token)}">Copiar link</button>
            <a class="btn-light" href="galeria.html?g=${encodeURIComponent(k.public_token)}" target="_blank" style="text-decoration:none">Abrir galeria</a>
            <button class="btn-light" data-act="toggle" data-id="${k.id}" data-active="${k.active}">${k.active ? 'Desativar' : 'Ativar'}</button>
            <button class="btn-light" data-act="photos" data-id="${k.id}">Ver fotos</button>
          </div>
          <div id="photos-${k.id}" hidden></div>
        </div>`;
    }).join('');
  }

  async function togglePhotos(id) {
    const box = $('photos-' + id);
    if (!box.hidden) { box.hidden = true; return; }
    box.innerHTML = '<p class="muted">Carregando...</p>';
    box.hidden = false;
    try {
      const photos = await DB.adminPhotos(id);
      box.innerHTML = photos.length
        ? `<div class="admin-grid">${photos.map(p => `
            <div class="thumb">
              <img src="${DB.publicUrl(p.thumb)}" alt="" loading="lazy">
              <button class="del" data-act="delphoto" data-id="${id}" data-photo="${esc(JSON.stringify(p))}">Excluir</button>
            </div>`).join('')}</div>`
        : '<p class="muted">Esta galeria ainda não tem fotos.</p>';
    } catch (e) {
      box.innerHTML = '<p class="muted">Não foi possível carregar as fotos.</p>';
    }
  }

  $('create').onclick = async () => {
    const label = $('label').value.trim();
    if (!label) { $('createMsg').textContent = 'Informe um nome ou código.'; return; }
    try {
      await DB.adminCreateKeychain(label);
      $('label').value = '';
      $('createMsg').textContent = 'Galeria criada. Copie o link para gravar na tag NFC.';
      renderList();
    } catch (e) {
      $('createMsg').textContent = 'Não foi possível criar a galeria.';
    }
  };

  $('list').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const act = b.dataset.act;

    if (act === 'copy') {
      await navigator.clipboard.writeText(galleryUrl(b.dataset.token));
      b.textContent = 'Copiado!';
      setTimeout(() => (b.textContent = 'Copiar link'), 1500);
    }

    if (act === 'toggle') {
      try {
        await DB.adminSetActive(b.dataset.id, b.dataset.active !== 'true');
        renderList();
      } catch (err) {
        alert('Não foi possível alterar o status do chaveiro.');
      }
    }

    if (act === 'photos') togglePhotos(b.dataset.id);

    if (act === 'delphoto') {
      if (!confirm('Excluir esta foto permanentemente?')) return;
      try {
        await DB.adminDeletePhoto(JSON.parse(b.dataset.photo));
      } catch (err) {
        alert('Não foi possível excluir a foto.');
        return;
      }
      const id = b.dataset.id;
      await renderList();   // reconstrói a lista (fechada)
      await togglePhotos(id); // reabre com as fotos atualizadas
    }
  });

  start();
})();
