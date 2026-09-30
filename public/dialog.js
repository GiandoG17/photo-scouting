// Popup applicativi: sostituiscono confirm() e alert() del browser.
(() => {
  function open({ title, message, confirmText = 'OK', cancelText = null, danger = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal" role="dialog" aria-modal="true">
          <h3></h3>
          <p></p>
          <div class="modal-actions">
            ${cancelText ? '<button class="cancel"></button>' : ''}
            <button class="primary ok${danger ? ' danger-fill' : ''}"></button>
          </div>
        </div>`;
      overlay.querySelector('h3').textContent = title || '';
      overlay.querySelector('h3').hidden = !title;
      overlay.querySelector('p').textContent = message || '';
      overlay.querySelector('.ok').textContent = confirmText;
      if (cancelText) overlay.querySelector('.cancel').textContent = cancelText;

      const prevFocus = document.activeElement;
      const close = (result) => {
        document.removeEventListener('keydown', onKey);
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 150);
        prevFocus?.focus?.();
        resolve(result);
      };
      // Invio attiva il pulsante con il focus (di default "Annulla"), Esc chiude.
      const onKey = (e) => { if (e.key === 'Escape') close(false); };
      overlay.querySelector('.ok').onclick = () => close(true);
      overlay.querySelector('.cancel')?.addEventListener('click', () => close(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add('show'));
      overlay.querySelector(cancelText ? '.cancel' : '.ok').focus();
    });
  }

  // fetch JSON che, se la sessione è scaduta, porta alla pagina di accesso invece di mostrare errori.
  window.apiFetch = async (url, opts) => {
    const res = await fetch(url, opts);
    if (res.status === 401 && !location.pathname.startsWith('/login')) {
      location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
      return new Promise(() => {});
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };

  window.appConfirm = (opts) => open({ cancelText: 'Annulla', confirmText: 'Conferma', ...opts });
  window.appAlert = (opts) => open({ confirmText: 'OK', ...(typeof opts === 'string' ? { message: opts } : opts) }).then(() => {});

  // Qualsiasi errore non gestito viene mostrato in un popup invece di sparire in console.
  window.addEventListener('unhandledrejection', (e) => {
    appAlert({ title: 'Qualcosa è andato storto', message: e.reason?.message || String(e.reason) });
  });
})();
