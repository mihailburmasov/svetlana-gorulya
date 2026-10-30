/* Клиентская часть статической копии gorulya.ru.
   Заменяет то, что раньше делал Nuxt: cookie-баннер, Яндекс Метрика после согласия,
   формы заявки и подписки, запуск ВК-видео, полный текст сказки по ссылке с ?pin=. */
(function () {
  'use strict';

  // Бэкенд заявок и подписок (Strapi). Если он переедет — поменять здесь.
  var API_URL = 'https://api.gorulya.ru';
  var METRIKA_ID = 109132071;
  var CONSENT_KEY = 'cookie-consent-accepted';
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* приватный режим */ }
  }
  function hasConsent() {
    return storageGet(CONSENT_KEY) === 'true';
  }

  /* ---------- Яндекс Метрика (только после согласия на cookie) ---------- */

  var metrikaStarted = false;
  function startMetrika() {
    if (!METRIKA_ID || metrikaStarted || !hasConsent()) return;
    metrikaStarted = true;
    window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
    window.ym.l = Date.now();
    window.ym(METRIKA_ID, 'init', { defer: true, clickmap: true, trackLinks: true, accurateTrackBounce: true });
    window.ym(METRIKA_ID, 'hit', location.pathname + location.search);
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://mc.yandex.ru/metrika/tag.js';
    document.head.appendChild(s);
  }

  /* ---------- Cookie-баннер ---------- */

  function initCookieBanner() {
    if (hasConsent()) return;
    var banner = document.createElement('aside');
    banner.className = 'cookie-banner';
    banner.setAttribute('aria-label', 'Уведомление о cookie');
    banner.innerHTML =
      '<p> Сайт использует cookie-файлы, данные о действиях посетителей и метрические сервисы. ' +
      'Это помогает обеспечивать работу сайта, анализировать посещаемость и улучшать материалы. ' +
      'Вы можете принять использование cookie или ограничить их в настройках браузера. Подробнее - ' +
      '<a href="/privacy">в Политике обработки персональных данных</a></p>' +
      '<button class="button button--primary" type="button">Понятно</button>';
    banner.querySelector('button').addEventListener('click', function () {
      storageSet(CONSENT_KEY, 'true');
      banner.remove();
      startMetrika();
    });
    (document.querySelector('.site-shell') || document.body).appendChild(banner);
  }

  /* ---------- Формы ---------- */

  function sessionPayload() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* старый браузер */ }
    return {
      sourcePage: location.pathname + location.search,
      sourceUrl: location.href,
      referrer: document.referrer || '',
      sessionInfo: {
        userLanguage: navigator.language || '',
        timezone: tz,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        cookieConsentAccepted: hasConsent()
      }
    };
  }

  function post(path, body) {
    return fetch(API_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error('HTTP ' + res.status);
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function errorMessage(err, fallback) {
    var d = (err && err.data) || {};
    var msg = (d.error && d.error.message) || d.message || '';
    return msg === 'Too many requests' ? 'Слишком много попыток. Попробуйте немного позже.' : fallback;
  }

  // Ошибка под полем: <p class="field__error"> + aria-invalid, как в исходных компонентах
  function setFieldError(input, text) {
    if (!input) return;
    var holder = input.closest('.field') || input.closest('.checkbox-row');
    var next = holder && holder.nextElementSibling;
    var existing = input.closest('.field')
      ? holder.querySelector('.field__error')
      : (next && next.classList.contains('field__error') ? next : null);
    if (!text) {
      input.removeAttribute('aria-invalid');
      if (existing) existing.remove();
      return;
    }
    input.setAttribute('aria-invalid', 'true');
    if (!existing) {
      existing = document.createElement('p');
      existing.className = 'field__error';
      if (input.closest('.field')) holder.appendChild(existing);
      else holder.insertAdjacentElement('afterend', existing);
    }
    existing.textContent = text;
  }

  function setNote(form, state, text) {
    var actions = form.querySelector('.form-actions') || form;
    var note = actions.querySelector('.form-note');
    if (!text) {
      if (note) note.remove();
      return;
    }
    if (!note) {
      note = document.createElement('p');
      note.setAttribute('aria-live', 'polite');
      actions.appendChild(note);
    }
    note.className = 'form-note' + (state ? ' form-note--' + state : '');
    note.textContent = text;
  }

  function setBusy(form, busy, idleLabel) {
    var btn = form.querySelector('button[type="submit"]');
    form.querySelectorAll('input, textarea, button').forEach(function (el) { el.disabled = busy; });
    if (btn) btn.textContent = busy ? 'Отправляем...' : idleLabel;
  }

  function initLeadForm(form) {
    var btn = form.querySelector('button[type="submit"]');
    var idleLabel = btn ? btn.textContent.trim() : 'Отправить';
    var f = {
      company: form.querySelector('[name="company"]'),
      name: form.querySelector('[name="name"]'),
      phone: form.querySelector('[name="phone"]'),
      email: form.querySelector('[name="email"]'),
      message: form.querySelector('[name="message"]'),
      consent: form.querySelector('.checkbox-row input[type="checkbox"]')
    };
    var fieldset = form.querySelector('.radio-group');

    // Поле «Ссылка ВК» появляется только при способе связи «ВК»
    var vkField = document.createElement('div');
    vkField.className = 'field';
    vkField.innerHTML =
      '<label for="lead-vk">Ссылка ВК</label>' +
      '<input id="lead-vk" class="input" type="text" name="vkUrl" placeholder="https://vk.com/..." required>';
    var vkInput = vkField.querySelector('input');

    function method() {
      var checked = form.querySelector('[name="contact-method"]:checked');
      return checked ? checked.value : 'phone';
    }
    function syncVk() {
      if (method() === 'vk') {
        if (!vkField.isConnected && fieldset) fieldset.insertAdjacentElement('afterend', vkField);
      } else if (vkField.isConnected) {
        vkInput.value = '';
        setFieldError(vkInput, '');
        vkField.remove();
      }
    }
    form.querySelectorAll('[name="contact-method"]').forEach(function (r) {
      r.addEventListener('change', syncVk);
    });

    function validate() {
      var ok = true;
      function check(input, text) {
        setFieldError(input, text);
        if (text) ok = false;
      }
      check(f.name, f.name.value.trim().length < 2 ? 'Укажите имя.' : '');
      check(f.phone, f.phone.value.trim() ? '' : 'Укажите телефон.');
      if (method() === 'vk') check(vkInput, vkInput.value.trim() ? '' : 'Добавьте ссылку ВК.');
      var email = f.email ? f.email.value.trim() : '';
      if (f.email) check(f.email, email && !EMAIL_RE.test(email) ? 'Проверьте email.' : '');
      check(f.consent, f.consent.checked ? '' : 'Нужно согласие на обработку данных.');
      return ok;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setNote(form, '', '');
      if (!validate()) {
        setNote(form, 'error', 'Проверьте поля формы и попробуйте ещё раз.');
        return;
      }
      var body = Object.assign({
        name: f.name.value,
        phone: f.phone.value,
        contactMethod: method(),
        vkUrl: vkInput.value,
        email: f.email ? f.email.value : '',
        message: f.message ? f.message.value : '',
        consentAccepted: f.consent.checked,
        company: f.company ? f.company.value : ''
      }, sessionPayload());
      setBusy(form, true, idleLabel);
      post('/api/lead-submit', body).then(function (res) {
        setBusy(form, false, idleLabel);
        form.reset();
        syncVk();
        setNote(form, 'success', res && res.notified
          ? 'Заявка отправлена. Я свяжусь с вами.'
          : 'Заявка сохранена. Я свяжусь с вами.');
      }).catch(function (err) {
        setBusy(form, false, idleLabel);
        setNote(form, 'error', errorMessage(err, 'Не удалось отправить заявку. Попробуйте ещё раз чуть позже.'));
      });
    });
  }

  function initSubscribeForm(form) {
    var btn = form.querySelector('button[type="submit"]');
    var idleLabel = btn ? btn.textContent.trim() : 'Подписаться';
    var company = form.querySelector('[name="company"]');
    var name = form.querySelector('[name="name"]');
    var email = form.querySelector('[name="email"]');
    var consent = form.querySelector('.checkbox-row input[type="checkbox"]');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      setNote(form, '', '');
      var emailError = EMAIL_RE.test(email.value.trim()) ? '' : 'Укажите корректный email.';
      var consentError = consent.checked ? '' : 'Нужно согласие на обработку данных.';
      setFieldError(email, emailError);
      setFieldError(consent, consentError);
      if (emailError || consentError) {
        setNote(form, 'error', 'Проверьте форму и попробуйте ещё раз.');
        return;
      }
      var body = Object.assign({
        email: email.value,
        name: name ? name.value : '',
        consentAccepted: consent.checked,
        company: company ? company.value : ''
      }, sessionPayload());
      setBusy(form, true, idleLabel);
      post('/api/subscribe-submit', body).then(function (res) {
        setBusy(form, false, idleLabel);
        form.reset();
        setNote(form, 'success', res && res.notified ? 'Подписка оформлена. Спасибо.' : 'Подписка сохранена. Спасибо.');
      }).catch(function (err) {
        setBusy(form, false, idleLabel);
        setNote(form, 'error', errorMessage(err, 'Не удалось оформить подписку. Попробуйте ещё раз чуть позже.'));
      });
    });
  }

  /* ---------- ВК-видео: iframe вместо заглушки по клику ---------- */

  function vkEmbedUrl(href) {
    try {
      var u = new URL(href);
      var m = u.pathname.match(/^\/(video|clip)(-?\d+)_(\d+)/);
      return m ? 'https://vkvideo.ru/video_ext.php?oid=' + m[2] + '&id=' + m[3] + '&hd=1' : null;
    } catch (e) {
      return null;
    }
  }

  function initVkVideo(block) {
    var btn = block.querySelector('.vk-video__placeholder');
    var link = block.querySelector('a[href*="vk.com/"], a[href*="vk.ru/"], a[href*="vkvideo.ru/"]');
    var src = link && vkEmbedUrl(link.href);
    if (!btn || !src) return;
    btn.addEventListener('click', function () {
      var iframe = document.createElement('iframe');
      iframe.className = 'vk-video__iframe';
      iframe.src = src + '&autoplay=1';
      iframe.title = 'ВК Видео';
      iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('allowfullscreen', '');
      btn.replaceWith(iframe);
    });
  }

  /* ---------- Полный текст сказки по ссылке из письма (?pin=...) ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function textOf(n) {
    return typeof (n && n.text) === 'string' ? n.text : ((n && n.children) || []).map(textOf).join('');
  }
  function inlines(n) {
    return ((n && n.children) || []).reduce(function (acc, c) {
      return acc.concat(typeof (c && c.text) === 'string' || (c && c.type === 'link') ? [c] : (c && c.children) || []);
    }, []);
  }
  function inline(c) {
    var t = esc(textOf(c));
    if (c.type === 'link') {
      var href = c.url || c.href || '#';
      var ext = /^https?:\/\//.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return '<a href="' + esc(href) + '"' + ext + '>' + t + '</a>';
    }
    var tag = c.code ? 'code' : c.bold ? 'strong' : c.italic ? 'em' : c.underline ? 'u' : c.strikethrough ? 's' : 'span';
    return '<' + tag + '>' + t + '</' + tag + '>';
  }
  function line(n) {
    return inlines(n).map(inline).join('');
  }
  function mediaUrl(m) {
    if (!m) return '';
    var url = (m.formats && m.formats.large && m.formats.large.url) || m.url || '';
    return url && url.charAt(0) === '/' ? API_URL + url : url;
  }
  function renderBlocks(blocks) {
    return blocks.map(function (b) {
      if (b.type === 'heading') return b.level === 2 ? '<h2>' + line(b) + '</h2>' : '<h3>' + line(b) + '</h3>';
      if (b.type === 'quote') return '<blockquote>' + line(b) + '</blockquote>';
      if (b.type === 'list') {
        var tag = b.format === 'ordered' ? 'ol' : 'ul';
        return '<' + tag + '>' + (b.children || []).map(function (li) { return '<li>' + line(li) + '</li>'; }).join('') + '</' + tag + '>';
      }
      if (b.type === 'image') {
        var media = b.image || b.asset || b.media;
        var src = mediaUrl(media);
        if (!src) return '';
        var alt = (media && media.alternativeText) || '';
        return '<figure class="rich-text__figure"><img src="' + esc(src) + '" alt="' + esc(alt) + '">' +
          (alt ? '<figcaption>' + esc(alt) + '</figcaption>' : '') + '</figure>';
      }
      return textOf(b) ? '<p>' + line(b) + '</p>' : '';
    }).join('');
  }

  function initStoryFullContent() {
    var m = location.pathname.match(/\/stories\/([^/]+)\/?$/);
    var pin = (new URLSearchParams(location.search).get('pin') || '').trim();
    var inner = document.querySelector('.content-detail--stories .content-detail__inner');
    if (!m || !pin || !inner) return;
    fetch(API_URL + '/api/stories/' + encodeURIComponent(m[1]) + '/full-content?pin=' + encodeURIComponent(pin))
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) {
        var blocks = json && json.data && json.data.fullContent;
        if (!blocks || !blocks.length) return;
        var full = document.createElement('div');
        full.className = 'content-detail__full';
        full.innerHTML = '<p class="eyebrow">Полная версия</p><div class="rich-text article-body">' + renderBlocks(blocks) + '</div>';
        inner.appendChild(full);
      })
      .catch(function () { /* без полного текста страница остаётся как есть */ });
  }

  /* ---------- Запуск ---------- */

  startMetrika();
  initCookieBanner();
  document.querySelectorAll('form.lead-form-block__form').forEach(initLeadForm);
  document.querySelectorAll('form.subscribe-block__form').forEach(initSubscribeForm);
  document.querySelectorAll('.vk-video').forEach(initVkVideo);
  initStoryFullContent();
})();
