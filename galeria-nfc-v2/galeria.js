(function () {
  const $ = id => document.getElementById(id);
  const token = new URLSearchParams(location.search).get('g');
  const STORY_MS = 5000;

  let photos = [];       // [{ id, full, thumb, fullUrl, thumbUrl }]
  let active = true;
  let lbIndex = -1;
  let storyIdx = 0;
  let storyTimer = null;
  let toastTimer = null;

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 4000);
  }

  function showMessage(html) {
    $('panel').innerHTML = html;
    $('fab').hidden = true;
  }

  function setTabs(mode) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  }

  async function load() {
    if (!token) return showMessage('<p class="empty">Galeria não encontrada.</p>');
    let g;
    try {
      g = await DB.getGallery(token);
    } catch (e) {
      return toast('Não foi possível carregar a galeria. Verifique sua conexão.');
    }
    if (!g.found) return showMessage('<p class="empty">Galeria não encontrada.</p>');
    if (!g.active) {
      active = false;
      return showMessage('<p class="notice">Esta galeria está desativada no momento e não aceita novos acessos, envios ou exclusões.</p>');
    }
    active = true;
    photos = g.photos.map(p => ({
      ...p,
      fullUrl: DB.publicUrl(p.full),
      thumbUrl: DB.publicUrl(p.thumb)
    }));
    render();
  }

  function render() {
    const full = photos.length >= DB.LIMIT;
    $('counter').textContent = `${photos.length} de ${DB.LIMIT} fotos`;
    $('notice').hidden = !full;
    $('notice').textContent = `Esta galeria atingiu o limite de ${DB.LIMIT} fotos.`;
    $('fab').disabled = full;
    $('empty').hidden = photos.length > 0;
    $('grid').innerHTML = photos
      .map((p, i) => `<button class="thumb" data-i="${i}" aria-label="Abrir foto ${i + 1}"><img loading="lazy" src="${p.thumbUrl}" alt=""></button>`)
      .join('');
  }

  // Abas
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      setTabs(btn.dataset.mode);
      if (btn.dataset.mode === 'stories') openStories(0);
    });
  });

  // Grade -> foto ampliada
  $('grid').addEventListener('click', e => {
    const b = e.target.closest('.thumb');
    if (b) openLightbox(Number(b.dataset.i));
  });

  function openLightbox(i) {
    lbIndex = i;
    $('lbImg').src = photos[i].fullUrl;
    $('lightbox').hidden = false;
  }

  function closeLightbox() {
    $('lightbox').hidden = true;
    $('lbImg').src = '';
    lbIndex = -1;
    setTabs('grid');
  }

  $('lbClose').onclick = closeLightbox;

  // Download: busca o arquivo para forçar o salvamento (o atributo download é ignorado entre domínios)
  $('lbDownload').onclick = async () => {
    const p = photos[lbIndex];
    if (!p) return;
    try {
      const blob = await (await fetch(p.fullUrl)).blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `guaramiranga-${lbIndex + 1}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) {
      window.open(p.fullUrl, '_blank');
    }
  };

  $('lbDelete').onclick = async () => {
    const p = photos[lbIndex];
    if (!p) return;
    if (!confirm('Excluir esta foto permanentemente? Essa ação não pode ser desfeita.')) return;
    try {
      await DB.deletePhoto(token, p);
      closeLightbox();
      await load();
      toast('Foto excluída.');
    } catch (e) {
      toast('Não foi possível excluir a foto. Tente novamente.');
    }
  };

  // Stories
  function openStories(start) {
    if (!photos.length) {
      toast('Ainda não há fotos para exibir.');
      setTabs('grid');
      return;
    }
    storyIdx = start;
    $('stories').hidden = false;
    showStory();
  }

  function showStory() {
    clearTimeout(storyTimer);
    $('bars').innerHTML = photos
      .map((_, j) => `<div class="bar ${j < storyIdx ? 'done' : j === storyIdx ? 'now' : ''}" style="--dur:${STORY_MS}ms"><span></span></div>`)
      .join('');
    $('storyImg').src = photos[storyIdx].fullUrl;
    storyTimer = setTimeout(nextStory, STORY_MS);
  }

  function nextStory() {
    if (storyIdx >= photos.length - 1) return closeStories();
    storyIdx++;
    showStory();
  }

  function prevStory() {
    if (storyIdx > 0) storyIdx--;
    showStory();
  }

  function closeStories() {
    clearTimeout(storyTimer);
    $('stories').hidden = true;
    $('storyImg').src = '';
    setTabs('grid');
  }

  $('next').onclick = nextStory;
  $('prev').onclick = prevStory;
  $('closeStories').onclick = closeStories;

  // Envio
  $('fab').onclick = () => $('file').click();

  $('file').onchange = async e => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length || !active) return;

    const room = DB.LIMIT - photos.length;
    if (room <= 0) return toast(`Limite de ${DB.LIMIT} fotos atingido.`);

    const batch = files.slice(0, room);
    const skipped = files.length - batch.length;
    $('fab').disabled = true;

    let sent = 0;
    let failed = 0;
    let stop = false;
    for (let i = 0; i < batch.length && !stop; i++) {
      toast(`Enviando ${i + 1} de ${batch.length}...`);
      try {
        await DB.uploadPhoto(token, batch[i]);
        sent++;
      } catch (err) {
        failed++;
        if (/limite/i.test(err.message || '')) stop = true;
      }
    }

    await load();
    const parts = [];
    if (sent) parts.push(`${sent} foto(s) enviada(s).`);
    if (skipped) parts.push(`Limite de ${DB.LIMIT} fotos: ${skipped} não enviada(s).`);
    if (failed) parts.push(`${failed} não enviada(s). Verifique o arquivo e a conexão.`);
    toast(parts.join(' ') || 'Nenhuma foto enviada.');
  };

  if (window.DB_CONFIG_ERROR) {
    showMessage('<p class="notice">Sistema ainda não configurado. Preencha o config.js com os dados do Supabase.</p>');
  } else {
    load();
  }
})();
