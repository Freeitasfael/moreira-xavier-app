/**
 * Moreira & Xavier — Dashboard Frontend
 * SPA Client-Side Application
 */

// ─── State ──────────────────────────────────────────────────

const state = {
  token: localStorage.getItem('mx_token') || null,
  user: JSON.parse(localStorage.getItem('mx_user') || 'null'),
  currentSection: 'dashboard',
};

// ─── API Client ─────────────────────────────────────────────

const API_BASE = '/api';

async function api(endpoint, options = {}) {
  const headers = {
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...options.headers,
  };

  // Only set Content-Type for requests that have a body
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || data.message || 'Erro na requisição');
  }

  return data;
}

// ─── Auth ───────────────────────────────────────────────────

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('mx_token', token);
  localStorage.setItem('mx_user', JSON.stringify(user));
}

function clearAuth() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('mx_token');
  localStorage.removeItem('mx_user');
}

function isAuthenticated() {
  return !!state.token;
}

// ─── Navigation ─────────────────────────────────────────────

function showPage(pageId) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');
}

function showSection(sectionId) {
  state.currentSection = sectionId;

  document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
  const section = document.getElementById(`section-${sectionId}`);
  if (section) section.classList.add('active');

  document.querySelectorAll('.nav-item[data-section]').forEach((n) => n.classList.remove('active'));
  const navItem = document.querySelector(`.nav-item[data-section="${sectionId}"]`);
  if (navItem) navItem.classList.add('active');

  // Carregar dados da seção
  loadSectionData(sectionId);
}

async function loadSectionData(section) {
  switch (section) {
    case 'dashboard':
      await loadDashboard();
      break;
    case 'processos':
      await loadProcessos();
      break;
    case 'prazos':
      await loadPrazos();
      break;
    case 'notificacoes':
      await loadNotificacoes();
      break;
    case 'credenciais':
      await loadCredenciais();
      break;
  }
}

// ─── Toast Notifications ────────────────────────────────────

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = {
    success: 'check-circle',
    error: 'alert-circle',
    info: 'info',
    warning: 'alert-triangle',
  };
  const titles = {
    success: 'Sucesso',
    error: 'Erro',
    info: 'Info',
    warning: 'Atenção',
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i data-lucide="${icons[type] || 'info'}" class="toast-icon"></i>
    <div class="toast-content">
      <div class="toast-title">${titles[type] || 'Info'}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close"><i data-lucide="x"></i></button>
  `;

  container.appendChild(toast);
  lucide.createIcons({ nodes: [toast] });

  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 4500);
}

// ─── Smart Greeting ─────────────────────────────────────────

function updateGreeting() {
  const el = document.getElementById('dashboard-greeting');
  if (!el) return;
  const hour = new Date().getHours();
  const nome = state.user?.nome?.split(' ')[0] || '';
  let saudacao;
  if (hour < 12) saudacao = 'Bom dia';
  else if (hour < 18) saudacao = 'Boa tarde';
  else saudacao = 'Boa noite';
  el.textContent = nome ? `${saudacao}, ${nome}` : saudacao;
}

// ─── Animated Counter ───────────────────────────────────────

function animateCounter(elementId, target) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  const duration = 400;
  const start = performance.now();
  function step(timestamp) {
    const progress = Math.min((timestamp - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
    el.textContent = Math.round(current + (target - current) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ─── Modal ──────────────────────────────────────────────────

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
}

// ─── Data Loaders ───────────────────────────────────────────

async function loadDashboard() {
  updateGreeting();
  try {
    const [statsRes, prazosRes] = await Promise.all([
      api('/processos/estatisticas'),
      api('/prazos?limite=5'),
    ]);

    const stats = statsRes.data;
    animateCounter('stat-total', stats.totalProcessos);
    animateCounter('stat-ativos', stats.processosAtivos);
    animateCounter('stat-urgentes', stats.prazosUrgentes);
    animateCounter('stat-proximos', stats.prazosProximos);

    // Prazos urgentes
    const prazosContainer = document.getElementById('prazos-urgentes-list');
    const prazos = prazosRes.data;

    if (prazos.length === 0) {
      prazosContainer.innerHTML = `
        <div class="empty-state">
          <i data-lucide="check-circle"></i>
          <p>Tudo em dia!</p>
          <span>Nenhum prazo urgente no momento</span>
        </div>`;
    } else {
      prazosContainer.innerHTML = prazos
        .map((p) => renderPrazoItem(p))
        .join('');
    }

    // Carregar últimas movimentações
    const processosRes = await api('/processos?porPagina=5');
    const processosData = processosRes.data.processos;
    const timelineContainer = document.getElementById('ultimas-movimentacoes');

    const movimentacoes = processosData
      .filter((p) => p.movimentacoes && p.movimentacoes.length > 0)
      .map((p) => ({
        ...p.movimentacoes[0],
        numeroCnj: p.numeroCnj,
      }))
      .slice(0, 5);

    if (movimentacoes.length === 0) {
      timelineContainer.innerHTML = `
        <div class="empty-state">
          <i data-lucide="inbox"></i>
          <p>Nenhuma movimentação recente</p>
        </div>`;
    } else {
      timelineContainer.innerHTML = movimentacoes
        .map((m) => `
          <div class="timeline-item">
            <div class="timeline-dot"><i data-lucide="file-text"></i></div>
            <div class="timeline-content">
              <div class="timeline-title">${m.descricao}</div>
              <div class="timeline-processo">${m.numeroCnj}</div>
              <div class="timeline-data">${formatDate(m.data)}</div>
            </div>
          </div>`)
        .join('');
    }

    lucide.createIcons();
  } catch (error) {
    console.error('Erro ao carregar dashboard:', error);
  }
}

async function loadProcessos() {
  const container = document.getElementById('processos-list');
  
  // Show skeleton loading
  container.innerHTML = `
    <div class="skeleton skeleton-card"></div>
    <div class="skeleton skeleton-card"></div>
    <div class="skeleton skeleton-card"></div>
  `;
  
  try {
    const busca = document.getElementById('processos-busca')?.value || '';
    const status = document.getElementById('processos-status')?.value || '';

    const params = new URLSearchParams();
    if (busca) params.set('busca', busca);
    if (status) params.set('status', status);

    const res = await api(`/processos?${params.toString()}`);
    const { processos } = res.data;

    if (processos.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="folder-plus"></i>
          <p>Nenhum processo encontrado</p>
          <span>Clique em "Novo Processo" para começar</span>
        </div>`;
    } else {
      container.innerHTML = processos.map((p) => renderProcessoCard(p)).join('');
    }

    lucide.createIcons();
  } catch (error) {
    console.error('Erro ao carregar processos:', error);
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="alert-circle"></i>
        <p>Erro ao carregar processos</p>
        <span>${error.message}</span>
      </div>`;
    lucide.createIcons();
  }
}

async function loadPrazos() {
  try {
    const res = await api('/prazos');
    const prazos = res.data;
    const container = document.getElementById('prazos-completos-list');

    if (prazos.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="calendar-check"></i>
          <p>Nenhum prazo pendente</p>
        </div>`;
    } else {
      container.innerHTML = prazos.map((p) => renderPrazoItem(p)).join('');
    }

    lucide.createIcons();
  } catch (error) {
    console.error('Erro ao carregar prazos:', error);
  }
}

async function loadNotificacoes() {
  try {
    const res = await api('/notificacoes');
    const notificacoes = res.data;
    const container = document.getElementById('notificacoes-list');

    if (notificacoes.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="bell-off"></i>
          <p>Nenhuma notificação</p>
        </div>`;
    } else {
      container.innerHTML = notificacoes.map((n) => renderNotificacao(n)).join('');
    }

    lucide.createIcons();
  } catch (error) {
    console.error('Erro ao carregar notificações:', error);
  }
}

async function loadCredenciais() {
  try {
    const res = await api('/auth/credenciais');
    const credenciais = res.data;
    const container = document.getElementById('credenciais-list');

    if (credenciais.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="key-round"></i>
          <p>Nenhuma credencial cadastrada</p>
          <span>Adicione credenciais para habilitar o scraping automático</span>
        </div>`;
    } else {
      container.innerHTML = credenciais
        .map((c) => `
          <div class="credencial-card">
            <div class="credencial-icon"><i data-lucide="shield-check"></i></div>
            <div class="credencial-info">
              <div class="credencial-nome">${c.tribunal}</div>
              <div class="credencial-meta">${c.ativo ? '🟢 Ativo' : '🔴 Inativo'} · Adicionado em ${formatDate(c.criadoEm)}</div>
            </div>
            <button class="btn btn-sm btn-outline" onclick="removerCredencial('${c.tribunal}')">
              <i data-lucide="trash-2"></i>
            </button>
          </div>`)
        .join('');
    }

    lucide.createIcons();
  } catch (error) {
    console.error('Erro ao carregar credenciais:', error);
  }
}

// ─── Renderers ──────────────────────────────────────────────

function renderProcessoCard(p) {
  const statusClass = `status-${(p.status || 'ativo').toLowerCase()}`;
  const ultimaMovData = p.movimentacoes?.[0] ? formatDate(p.movimentacoes[0].data) : 'N/A';
  const prazosCount = p._count?.prazos || 0;

  return `
    <div class="processo-card" onclick="verProcesso('${p.id}')">
      <div class="processo-card-header">
        <span class="processo-numero">${p.numeroCnj}</span>
        <span class="processo-status ${statusClass}">${p.status || 'ATIVO'}</span>
      </div>
      <div class="processo-classe">${p.classe || 'Classe não informada'}</div>
      <div class="processo-partes">
        ${p.parteAutora ? `<strong>Autor:</strong> ${p.parteAutora}` : ''}
        ${p.parteRe ? `<br><strong>Réu:</strong> ${p.parteRe}` : ''}
        ${!p.parteAutora && !p.parteRe ? 'Partes não informadas' : ''}
      </div>
      <div class="processo-meta">
        <span class="processo-meta-item"><i data-lucide="building-2"></i> ${p.tribunal || 'N/A'}</span>
        <span class="processo-meta-item"><i data-lucide="map-pin"></i> ${p.vara || 'N/A'}</span>
        <span class="processo-meta-item"><i data-lucide="clock"></i> ${ultimaMovData}</span>
      </div>
      <div class="processo-actions">
        <button class="btn btn-sm btn-primary" onclick="event.stopPropagation(); sincronizarProcesso('${p.id}')">
          <i data-lucide="refresh-cw"></i> Sincronizar
        </button>
        <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); removerProcesso('${p.id}')">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>`;
}

function renderPrazoItem(p) {
  const urgClass = `urgencia-${p.urgencia || 'normal'}`;
  const diasClass = `dias-${p.urgencia || 'normal'}`;
  const dias = p.diasRestantes ?? 0;
  const processo = p.processo || {};

  return `
    <div class="prazo-item">
      <div class="prazo-urgencia ${urgClass}"></div>
      <div class="prazo-info">
        <div class="prazo-descricao">${p.descricao}</div>
        <div class="prazo-processo">${processo.numeroCnj || ''} · ${processo.classe || ''}</div>
      </div>
      <div class="prazo-countdown">
        <div class="prazo-dias ${diasClass}">${dias}</div>
        <div class="prazo-label">dias úteis</div>
      </div>
    </div>`;
}

function renderNotificacao(n) {
  const isUnread = !n.lidaEm;
  const iconClass = n.tipo.includes('CRITICO')
    ? 'icon-critico'
    : n.tipo.includes('PRAZO')
    ? 'icon-prazo'
    : 'icon-movimentacao';
  const iconName = n.tipo.includes('CRITICO')
    ? 'alert-triangle'
    : n.tipo.includes('PRAZO')
    ? 'clock'
    : 'file-text';

  return `
    <div class="notificacao-item ${isUnread ? 'unread' : ''}" onclick="marcarNotificacaoLida('${n.id}')">
      <div class="notificacao-icon ${iconClass}"><i data-lucide="${iconName}"></i></div>
      <div class="notificacao-content">
        <div class="notificacao-titulo">${n.titulo}</div>
        <div class="notificacao-mensagem">${n.mensagem.substring(0, 120)}${n.mensagem.length > 120 ? '...' : ''}</div>
        <div class="notificacao-tempo">${formatTimeAgo(n.criadoEm)}</div>
      </div>
    </div>`;
}

// ─── Actions ────────────────────────────────────────────────

async function sincronizarProcesso(id) {
  try {
    showToast('Sincronizando com DataJud...', 'info');
    const res = await api(`/processos/${id}/sincronizar`, { method: 'POST' });
    showToast(res.message, 'success');
    await loadSectionData(state.currentSection);
  } catch (error) {
    showToast(`Erro: ${error.message}`, 'error');
  }
}

async function removerProcesso(id) {
  if (!confirm('Tem certeza que deseja remover este processo do acompanhamento?')) return;
  try {
    await api(`/processos/${id}`, { method: 'DELETE' });
    showToast('Processo removido', 'success');
    await loadProcessos();
  } catch (error) {
    showToast(`Erro: ${error.message}`, 'error');
  }
}

async function marcarNotificacaoLida(id) {
  try {
    await api(`/notificacoes/${id}/lida`, { method: 'PATCH' });
    await loadNotificacoes();
    await updateBadges();
  } catch (error) {
    console.error('Erro ao marcar notificação:', error);
  }
}

async function removerCredencial(tribunal) {
  if (!confirm(`Remover credencial do ${tribunal}?`)) return;
  try {
    await api(`/auth/credenciais/${tribunal}`, { method: 'DELETE' });
    showToast('Credencial removida', 'success');
    await loadCredenciais();
  } catch (error) {
    showToast(`Erro: ${error.message}`, 'error');
  }
}

let _currentProcessoId = null;

async function verProcesso(id) {
  _currentProcessoId = id;
  showSection('processo-detalhe');

  // Show skeleton loading
  document.getElementById('detalhe-cnj').textContent = 'Carregando...';
  document.getElementById('detalhe-classe').textContent = '';
  document.getElementById('detalhe-timeline').innerHTML = `
    <div class="skeleton skeleton-text" style="width:90%"></div>
    <div class="skeleton skeleton-text" style="width:70%"></div>
    <div class="skeleton skeleton-text" style="width:80%"></div>
  `;

  try {
    const res = await api(`/processos/${id}`);
    const p = res.data;

    // Header
    document.getElementById('detalhe-cnj').textContent = p.numeroCnj;
    document.getElementById('detalhe-classe').textContent = p.classe || 'Classe não informada';
    
    const statusBadge = document.getElementById('detalhe-status-badge');
    statusBadge.textContent = p.status || 'ATIVO';
    statusBadge.className = `processo-status status-${(p.status || 'ativo').toLowerCase()}`;

    // Capa fields
    document.getElementById('detalhe-tribunal').textContent = p.tribunal || '—';
    document.getElementById('detalhe-vara').textContent = p.vara || '—';
    document.getElementById('detalhe-assunto').textContent = p.assunto || '—';
    document.getElementById('detalhe-comarca').textContent = p.comarca || '—';
    document.getElementById('detalhe-autor').textContent = p.parteAutora || '—';
    document.getElementById('detalhe-reu').textContent = p.parteRe || '—';
    document.getElementById('detalhe-valor').textContent = p.valorCausa
      ? `R$ ${parseFloat(p.valorCausa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      : '—';
    document.getElementById('detalhe-ultima-verif').textContent = p.ultimaVerif
      ? formatDate(p.ultimaVerif) + ' ' + new Date(p.ultimaVerif).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : 'Nunca verificado';

    // Prazos
    const prazosContainer = document.getElementById('detalhe-prazos-list');
    if (p.prazos && p.prazos.length > 0) {
      prazosContainer.innerHTML = p.prazos.map(pr => renderPrazoItem(pr)).join('');
    } else {
      prazosContainer.innerHTML = `
        <div class="empty-state small">
          <i data-lucide="calendar-check"></i>
          <p>Nenhum prazo vinculado</p>
        </div>`;
    }

    // Movimentações
    const timelineContainer = document.getElementById('detalhe-timeline');
    const movs = p.movimentacoes || [];
    document.getElementById('detalhe-mov-count').textContent = movs.length;

    if (movs.length === 0) {
      timelineContainer.innerHTML = `
        <div class="empty-state">
          <i data-lucide="inbox"></i>
          <p>Nenhuma movimentação registrada</p>
          <span>Clique em "Sincronizar" para buscar movimentações</span>
        </div>`;
    } else {
      timelineContainer.innerHTML = movs.map((m, idx) => {
        const tipo = (m.tipo || 'OUTROS').toUpperCase();
        const tipoLabel = formatTipoMovimentacao(tipo);
        let dotClass = '';
        let iconName = 'file-text';
        let badgeClass = 'badge-outros';
        if (tipo.includes('SENTENCA')) { dotClass = 'dot-sentenca'; iconName = 'gavel'; badgeClass = 'badge-sentenca'; }
        else if (tipo.includes('DECISAO')) { dotClass = 'dot-decisao'; iconName = 'scale'; badgeClass = 'badge-decisao'; }
        else if (tipo.includes('INTIMACAO')) { dotClass = 'dot-intimacao'; iconName = 'bell'; badgeClass = 'badge-intimacao'; }
        else if (tipo.includes('CITACAO')) { dotClass = 'dot-intimacao'; iconName = 'mail'; badgeClass = 'badge-citacao'; }
        else if (tipo.includes('DESPACHO')) { iconName = 'pen-tool'; badgeClass = 'badge-despacho'; }
        else if (tipo.includes('PETICAO')) { iconName = 'file-plus'; badgeClass = 'badge-peticao'; }
        else if (tipo.includes('JUNTADA')) { iconName = 'file-plus'; badgeClass = 'badge-juntada'; }
        else if (tipo.includes('AUDIENCIA')) { iconName = 'users'; badgeClass = 'badge-audiencia'; }
        else if (tipo.includes('DISTRIBUICAO')) { iconName = 'shuffle'; badgeClass = 'badge-distribuicao'; }
        else if (tipo.includes('RECURSO') || tipo.includes('ACORDAO')) { iconName = 'book-open'; badgeClass = 'badge-recurso'; }
        else if (tipo.includes('BAIXA')) { iconName = 'archive'; badgeClass = 'badge-baixa'; }
        else if (tipo.includes('REMESSA')) { iconName = 'send'; badgeClass = 'badge-remessa'; }

        const dataFormatada = formatDate(m.data);
        const horaFormatada = formatTime(m.data);
        const temComplemento = m.complemento && m.complemento.trim().length > 0;
        const temCodigo = m.codigo != null;

        // Parse complemento para exibição estruturada
        let complementoHtml = '';
        if (temComplemento) {
          const complementos = m.complemento.split(';').map(c => c.trim()).filter(c => c.length > 0);
          complementoHtml = complementos.map(c => {
            const parts = c.split(':');
            if (parts.length >= 2) {
              const label = parts[0].trim().replace(/_/g, ' ');
              const valor = parts.slice(1).join(':').trim().replace(/_/g, ' ');
              return `
                <div class="mov-detalhe-row">
                  <span class="mov-detalhe-label">${capitalizeFirst(label)}</span>
                  <span class="mov-detalhe-valor">${capitalizeFirst(valor)}</span>
                </div>`;
            }
            return `<div class="mov-detalhe-row"><span class="mov-detalhe-valor">${capitalizeFirst(c.replace(/_/g, ' '))}</span></div>`;
          }).join('');
        }

        return `
          <div class="mov-card ${idx === 0 ? 'mov-card-latest' : ''}" data-mov-id="${m.id}" onclick="toggleMovDetalhe(this)">
            <div class="mov-card-header">
              <div class="mov-card-icon ${dotClass}">
                <i data-lucide="${iconName}"></i>
              </div>
              <div class="mov-card-info">
                <div class="mov-card-title">${m.descricao}</div>
                <div class="mov-card-meta">
                  <span class="mov-badge ${badgeClass}">${tipoLabel}</span>
                  <span class="mov-date"><i data-lucide="calendar" style="width:12px;height:12px"></i> ${dataFormatada}</span>
                  ${horaFormatada ? `<span class="mov-time"><i data-lucide="clock" style="width:12px;height:12px"></i> ${horaFormatada}</span>` : ''}
                </div>
              </div>
              <div class="mov-card-chevron">
                <i data-lucide="chevron-down"></i>
              </div>
            </div>
            <div class="mov-card-details">
              <div class="mov-details-inner">
                ${temCodigo ? `
                <div class="mov-detalhe-row">
                  <span class="mov-detalhe-label">Código CNJ</span>
                  <span class="mov-detalhe-valor mov-detalhe-code">${m.codigo}</span>
                </div>` : ''}
                <div class="mov-detalhe-row">
                  <span class="mov-detalhe-label">Data/Hora</span>
                  <span class="mov-detalhe-valor">${dataFormatada}${horaFormatada ? ' às ' + horaFormatada : ''}</span>
                </div>
                <div class="mov-detalhe-row">
                  <span class="mov-detalhe-label">Tipo</span>
                  <span class="mov-detalhe-valor">${tipoLabel}</span>
                </div>
                <div class="mov-detalhe-row">
                  <span class="mov-detalhe-label">Fonte</span>
                  <span class="mov-detalhe-valor">${formatFonte(m.fonte)}</span>
                </div>
                ${complementoHtml ? `
                <div class="mov-detalhe-divider"></div>
                <div class="mov-detalhe-section-title">Complementos</div>
                ${complementoHtml}` : ''}
              </div>
            </div>
          </div>`;
      }).join('');
    }

    // Sync button
    const syncBtn = document.getElementById('btn-sync-detalhe');
    syncBtn.onclick = async () => {
      syncBtn.disabled = true;
      syncBtn.innerHTML = '<div class="spinner"></div> Sincronizando...';
      try {
        const syncRes = await api(`/processos/${id}/sincronizar`, { method: 'POST' });
        showToast(syncRes.message || 'Sincronizado!', 'success');
        await verProcesso(id); // Reload
      } catch (err) {
        showToast(`Erro: ${err.message}`, 'error');
      } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = '<i data-lucide="refresh-cw"></i> Sincronizar';
        lucide.createIcons({ nodes: [syncBtn] });
      }
    };

    lucide.createIcons();
  } catch (error) {
    showToast(`Erro ao carregar processo: ${error.message}`, 'error');
    showSection('processos');
  }
}

async function updateBadges() {
  try {
    const res = await api('/notificacoes/count');
    const count = res.data.naoLidas;
    const badge = document.getElementById('badge-notificacoes');
    if (count > 0) {
      badge.textContent = count;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch {
    // Silenciar erro
  }
}

// ─── Utilities ──────────────────────────────────────────────

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return date.toLocaleDateString('pt-BR');
}

function formatTimeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  if (diffMin < 1) return 'agora';
  if (diffMin < 60) return `${diffMin}min atrás`;
  if (diffH < 24) return `${diffH}h atrás`;
  if (diffD < 7) return `${diffD}d atrás`;
  return formatDate(dateStr);
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const h = date.getHours();
  const m = date.getMinutes();
  if (h === 0 && m === 0) return ''; // Midnight means no time info
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatTipoMovimentacao(tipo) {
  const map = {
    SENTENCA: 'Sentença',
    DECISAO: 'Decisão',
    DESPACHO: 'Despacho',
    INTIMACAO: 'Intimação',
    CITACAO: 'Citação',
    PETICAO: 'Petição',
    JUNTADA: 'Juntada',
    AUDIENCIA: 'Audiência',
    DISTRIBUICAO: 'Distribuição',
    RECURSO: 'Recurso',
    BAIXA: 'Baixa/Arquivamento',
    REMESSA: 'Remessa',
    ACORDAO: 'Acórdão',
    OUTROS: 'Outros',
  };
  return map[tipo] || tipo;
}

function formatFonte(fonte) {
  const map = {
    DATAJUD: 'DataJud (CNJ)',
    EPROC_TJMG: 'TJMG - PJe/Eproc',
    MANUAL: 'Cadastro Manual',
    DJEN: 'Diário da Justiça',
  };
  return map[fonte] || fonte || 'N/A';
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function toggleMovDetalhe(el) {
  const isOpen = el.classList.contains('mov-card-open');
  // Close all others
  document.querySelectorAll('.mov-card-open').forEach(card => {
    if (card !== el) card.classList.remove('mov-card-open');
  });
  // Toggle this one
  el.classList.toggle('mov-card-open', !isOpen);
}

// ─── Event Listeners ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // Check auth
  if (isAuthenticated()) {
    showPage('dashboard-page');
    updateUserInfo();
    showSection('dashboard');
    updateBadges();
  } else {
    showPage('login-page');
  }

  // ─── Login Form ─────────────────────────────────────────
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Entrando...';

    try {
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('login-email').value,
          senha: document.getElementById('login-senha').value,
        }),
      });

      setAuth(res.data.token, res.data.advogado);
      showToast(`Bem-vindo, ${res.data.advogado.nome}!`, 'success');
      showPage('dashboard-page');
      updateUserInfo();
      showSection('dashboard');
      updateBadges();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="log-in"></i> Entrar';
      lucide.createIcons({ nodes: [btn] });
    }
  });

  // ─── Registro Form ─────────────────────────────────────
  document.getElementById('registro-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('registro-btn');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Criando...';

    try {
      const res = await api('/auth/registro', {
        method: 'POST',
        body: JSON.stringify({
          nome: document.getElementById('reg-nome').value,
          email: document.getElementById('reg-email').value,
          oabNumero: document.getElementById('reg-oab').value,
          oabUf: document.getElementById('reg-uf').value,
          senha: document.getElementById('reg-senha').value,
        }),
      });

      setAuth(res.data.token, res.data.advogado);
      showToast('Conta criada com sucesso!', 'success');
      showPage('dashboard-page');
      updateUserInfo();
      showSection('dashboard');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="user-plus"></i> Criar Conta';
      lucide.createIcons({ nodes: [btn] });
    }
  });

  // Toggle login/registro
  document.getElementById('show-registro-btn').addEventListener('click', () => {
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('registro-form').classList.remove('hidden');
  });

  document.getElementById('show-login-btn').addEventListener('click', () => {
    document.getElementById('registro-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
  });

  // ─── Navigation ─────────────────────────────────────────
  document.querySelectorAll('.nav-item[data-section]').forEach((item) => {
    item.addEventListener('click', () => {
      showSection(item.dataset.section);
      // Close mobile sidebar
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebar-overlay');
      if (sidebar) sidebar.classList.remove('open');
      if (overlay) overlay.classList.remove('visible');
    });
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', () => {
    clearAuth();
    showPage('login-page');
    showToast('Até logo!', 'info');
  });

  // ─── Mobile Sidebar Menu ─────────────────────────────────
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const sidebar = document.getElementById('sidebar');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      sidebarOverlay.classList.toggle('visible');
    });
  }

  if (sidebarOverlay) {
    sidebarOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('visible');
    });
  }

  // ─── Modals ─────────────────────────────────────────────
  // Novo Processo
  const openProcessoModal = () => openModal('modal-processo');
  document.getElementById('btn-novo-processo').addEventListener('click', openProcessoModal);
  document.getElementById('btn-novo-processo-2').addEventListener('click', openProcessoModal);
  document.getElementById('modal-processo-close').addEventListener('click', () => closeModal('modal-processo'));
  document.getElementById('modal-processo-cancel').addEventListener('click', () => closeModal('modal-processo'));

  document.getElementById('form-novo-processo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-cadastrar-processo');
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> Consultando...';

    try {
      const numeroCnj = document.getElementById('input-cnj').value;
      const res = await api('/processos', {
        method: 'POST',
        body: JSON.stringify({ numeroCnj }),
      });

      showToast(res.message, 'success');
      closeModal('modal-processo');
      document.getElementById('input-cnj').value = '';
      await loadSectionData(state.currentSection);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="search"></i> Consultar e Cadastrar';
      lucide.createIcons({ nodes: [btn] });
    }
  });

  // Importar por OAB
  const btnImportarOab = document.getElementById('btn-importar-oab');
  if (btnImportarOab) {
    btnImportarOab.addEventListener('click', async () => {
      try {
        btnImportarOab.disabled = true;
        btnImportarOab.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Solicitando...';
        lucide.createIcons({ nodes: [btnImportarOab] });

        const res = await api('/processos/importar-oab', { method: 'POST' });
        showToast(res.message || 'Sincronização agendada', 'success');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        btnImportarOab.disabled = false;
        btnImportarOab.innerHTML = '<i data-lucide="refresh-cw"></i> Atualizar via OAB';
        lucide.createIcons({ nodes: [btnImportarOab] });
      }
    });
  }

  // Nova Credencial
  document.getElementById('btn-nova-credencial').addEventListener('click', () => openModal('modal-credencial'));
  document.getElementById('modal-credencial-close').addEventListener('click', () => closeModal('modal-credencial'));
  document.getElementById('modal-credencial-cancel').addEventListener('click', () => closeModal('modal-credencial'));

  document.getElementById('form-nova-credencial').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const tribunal = document.getElementById('cred-tribunal').value;
      await api('/auth/credenciais', {
        method: 'POST',
        body: JSON.stringify({
          tribunal,
          sistema: tribunal,
          login: document.getElementById('cred-login').value,
          senha: document.getElementById('cred-senha').value,
        }),
      });

      showToast('Credencial salva com sucesso!', 'success');
      closeModal('modal-credencial');
      e.target.reset();
      await loadCredenciais();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  // Ler todas notificações
  document.getElementById('btn-ler-todas').addEventListener('click', async () => {
    try {
      await api('/notificacoes/ler-todas', { method: 'POST' });
      showToast('Todas as notificações foram marcadas como lidas', 'success');
      await loadNotificacoes();
      await updateBadges();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  // ─── Search / Filters ──────────────────────────────────
  let searchTimeout;
  document.getElementById('processos-busca')?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadProcessos(), 400);
  });

  document.getElementById('processos-status')?.addEventListener('change', () => loadProcessos());

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', () => {
      document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
    });
  });
});

function updateUserInfo() {
  if (state.user) {
    document.getElementById('user-name').textContent = state.user.nome;
    document.getElementById('user-oab').textContent = `OAB/${state.user.oabUf} ${state.user.oabNumero}`;
    document.getElementById('user-avatar').textContent = state.user.nome
      .split(' ')
      .map((n) => n[0])
      .join('')
      .substring(0, 2)
      .toUpperCase();
  }
}
