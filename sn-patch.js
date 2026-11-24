/* Scientific Network: облачная синхронизация Supabase + надстройка.
   Подключен в index.html перед </body> ПОСЛЕ основного скрипта */
(function () {
 var SB_URL = 'https://yjjwkbrhskzjmikwwyed.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqandrYnJoc2t6am1pa3d3eWVkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU1NDE4MjgsImV4cCI6MjExMTExNzgyOH0.J6wsqnqfzehuRqN9bmrDzuyfJ8pgHd8WtJnJQjo6iFk';
  var SYNC_KEYS = ['sn_users_v4', 'sn_posts_v4', 'sn_notifs_v4', 'sn_msgs_v4'];
  var ADMIN_LOGIN = 'Joseph Levitsky-DEV-';

   
  function $(id) { return document.getElementById(id); }

  /* ---------- 1. Облачное хранилище Supabase + кэш ---------- */
  var _set = Storage.prototype.setItem;
  var _get = Storage.prototype.getItem;
  var cloudCache = {};
  var isSyncing = false;

  for (var i = 0; i < SYNC_KEYS.length; i++) {
    var k = SYNC_KEYS[i];
    cloudCache[k] = _get.call(localStorage, k) || '[]';
  }

  function sbHeaders(extra) {
    var h = {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY
    };
    if (extra) {
      for (var k in extra) h[k] = extra[k];
    }
    return h;
  }

  function pushToSupabase(key, jsonStr) {
    var parsed;
    try { parsed = JSON.parse(jsonStr); } catch (e) { return; }
    fetch(SB_URL + '/rest/v1/sn_cloud_store?on_conflict=key', {
      method: 'POST',
      headers: sbHeaders({
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      }),
      body: JSON.stringify([{ key: key, data: parsed, updated_at: new Date().toISOString() }])
    })
    .then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          alert('Ошибка записи в базу (' + r.status + '): ' + t);
        });
      }
    })
    .catch(function (err) { alert('Ошибка соединения с базой: ' + err.message); });
  }

  function pullFromSupabase(isInitial) {
    if (isSyncing) return Promise.resolve();
    isSyncing = true;
    return fetch(SB_URL + '/rest/v1/sn_cloud_store?select=key,data', {
      method: 'GET',
      headers: sbHeaders()
    })
    .then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function (rows) {
      isSyncing = false;
      if (!Array.isArray(rows)) return;
      var changed = false;
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (SYNC_KEYS.indexOf(row.key) >= 0) {
          var str = JSON.stringify(row.data || []);
          if (cloudCache[row.key] !== str) {
            cloudCache[row.key] = str;
            try { _set.call(localStorage, row.key, str); } catch (e) {}
            changed = true;
          }
        }
      }
      if (isInitial || changed) {
        if (typeof updateNav === 'function') updateNav();
        if (typeof CURRENT_PAGE !== 'undefined' && typeof showPage === 'function') {
          var activeEl = document.activeElement;
          var isTyping = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.id === 'wall-editor');
          if (!isTyping) {
            var y = window.scrollY;
            showPage(CURRENT_PAGE, typeof CURRENT_ARG !== 'undefined' ? CURRENT_ARG : undefined);
            window.scrollTo(0, y);
          }
        }
      }
    })
    .catch(function (err) {
      isSyncing = false;
      console.error('Ошибка загрузки из облака:', err);
    });
  }

  Storage.prototype.getItem = function (k) {
    if (this === localStorage && SYNC_KEYS.indexOf(k) >= 0) {
      return cloudCache[k];
    }
    return _get.call(this, k);
  };

  Storage.prototype.setItem = function (k, v) {
    if (this === localStorage && SYNC_KEYS.indexOf(k) >= 0) {
      cloudCache[k] = v;
      try { _set.call(localStorage, k, v); } catch (e) {}
      pushToSupabase(k, v);
      return;
    }
    try { _set.call(this, k, v); }
    catch (e) { alert('Не хватило места в хранилище браузера. Уберите тяжёлые фото и видео.'); }
  };

  /* ---------- 2. Пароли: соль + PBKDF2 ---------- */
  function hex(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }
  function newSalt() {
    var a = new Uint8Array(12);
    crypto.getRandomValues(a);
    return hex(a);
  }
  function hashPass(salt, pass) {
    if (!(window.crypto && crypto.subtle)) {
      var s = salt + ':' + pass, h = 5381;
      for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return Promise.resolve('weak' + (h >>> 0).toString(16));
    }
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) {
        return crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, k, 256);
      }).then(hex);
  }

  onRegister = function (ev) {
    ev.preventDefault();
    var login = ($('reg-login').value || '').trim();
    var p1 = $('reg-pass').value || '';
    var p2 = $('reg-pass2').value || '';
    var msg = $('reg-msg');

    if (!login || !p1) { msg.innerHTML = '<b>Ошибка.</b> Заполните поля.'; return; }
    if (login.length < 3) { msg.innerHTML = '<b>Ошибка.</b> Минимум 3 знака в имени.'; return; }
    if (!/^[A-Za-zА-Яа-яЁё0-9 _\-\.]+$/.test(login)) { msg.innerHTML = '<b>Ошибка.</b> Недопустимые символы в имени.'; return; }
    if (p1.length < 6) { msg.innerHTML = '<b>Ошибка.</b> Пароль минимум 6 знаков.'; return; }
    if (p1 !== p2) { msg.innerHTML = '<b>Ошибка.</b> Пароли не совпадают.'; return; }

    msg.innerHTML = '<i>Проверка имени в базе...</i>';
    pullFromSupabase(false).then(function () {
      var salt = newSalt();
      hashPass(salt, p1).then(function (h) {
        var users = getUsers();
        for (var i = 0; i < users.length; i++) {
          if (users[i].login.toLowerCase() === login.toLowerCase()) {
            msg.innerHTML = '<b>Ошибка.</b> Такое имя уже занято.';
            return;
          }
        }
        users.push({
          login: login, salt: salt, hash: h, registered: Date.now(),
          bio: '', avatar: '', gender: '', age: '', city: '', occupation: '',
          music: '', books: '', films: '', hobbies: '',
          friendsVisible: true,
          friends: [], friendRequests: [], sentRequests: [],
          following: [], subscribers: []
        });
        saveUsers(users);
        setSession(login);
        updateNav();
        showPage('profile');
      });
    });
  };

  onLogin = function (ev) {
    ev.preventDefault();
    var login = ($('log-login').value || '').trim();
    var pass = $('log-pass').value || '';
    var msg = $('login-msg');
    if (!login || !pass) { msg.innerHTML = '<b>Ошибка.</b> Заполните поля.'; return; }

    msg.innerHTML = '<i>Вход...</i>';
    pullFromSupabase(false).then(function () {
      var u = null, users = getUsers();
      for (var i = 0; i < users.length; i++) {
        if (users[i].login.toLowerCase() === login.toLowerCase()) { u = users[i]; break; }
      }
      if (!u) { msg.innerHTML = '<b>Ошибка.</b> Участник не найден.'; return; }

      function finish() { setSession(u.login); updateNav(); showPage('feed'); }

      var check = u.hash
        ? hashPass(u.salt, pass).then(function (h) { return h === u.hash; })
        : Promise.resolve(u.password === pass);

      check.then(function (ok) {
        if (!ok) { msg.innerHTML = '<b>Ошибка.</b> Пароль неверен.'; return; }
        if (u.hash) { finish(); return; }
        var salt = newSalt();
        hashPass(salt, pass).then(function (h) {
          var us = getUsers();
          for (var j = 0; j < us.length; j++) {
            if (us[j].login === u.login) { us[j].salt = salt; us[j].hash = h; delete us[j].password; }
          }
          saveUsers(us);
          finish();
        });
      });
    });
  };

  /* ---------- 3. Баги навигации ---------- */
  var searchDiv = document.createElement('div');
  searchDiv.id = 'page-search';
  searchDiv.hidden = true;
  if ($('main')) $('main').appendChild(searchDiv);

  showPage = function (name, arg) {
    var u = currentUser();
    var pub = ['home', 'sections', 'section', 'profiles', 'profile', 'search'];
    if (!u && pub.indexOf(name) < 0) name = 'home';

    var all = document.querySelectorAll('#main > div');
    for (var i = 0; i < all.length; i++) all[i].hidden = true;
    var el = $('page-' + name);
    if (!el) { el = $('page-home'); name = 'home'; }
    if (el) el.hidden = false;

    var R = {
      home: renderHome, feed: renderFeed, 'feed-sub': renderFeedSub,
      sections: renderSections, section: renderSection, profiles: renderProfiles,
      gallery: renderGallery, publish: renderPublish, profile: renderProfile,
      settings: renderSettings, notifications: renderNotifications,
      messages: renderMessages, conversation: renderConversation, search: renderSearch
    };
    if (R[name]) R[name](arg);
    CURRENT_PAGE = name;
    CURRENT_ARG = arg;
    window.scrollTo(0, 0);
  };

  refreshCurrent = function () {
    var y = window.scrollY;
    showPage(CURRENT_PAGE, CURRENT_ARG);
    window.scrollTo(0, y);
  };

  var _updateNav = updateNav;
  updateNav = function () {
    _updateNav();
    var nav = $('top-nav');
    if (nav && nav.innerHTML.indexOf('data-page="search"') < 0) {
      nav.innerHTML = nav.innerHTML.replace('Главная</a>',
        'Главная</a> <a href="#" data-action="goto" data-page="search">Поиск</a>');
    }
  };

  var _renderNotifications = renderNotifications;
  renderNotifications = function () {
    _renderNotifications();
    var b = $('notif-clear');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  };

  /* ---------- 4. Лайки и комментарии ---------- */
  var openPosts = {};

  function socialHtml(p) {
    var me = currentUser(), likes = p.likes || [], cm = p.comments || [];
    var s = '<p>';
    if (me) {
      s += '<button type="button" class="post-like" data-id="' + esc(p.id) + '">' +
           (likes.indexOf(me) >= 0 ? '♥ Убрать лайк' : '♡ Нравится') + '</button> ';
    } else {
      s += '♡ ';
    }
    s += '<b>' + likes.length + '</b></p>';

    s += '<details data-id="' + esc(p.id) + '"' + (openPosts[p.id] ? ' open' : '') + '>';
    s += '<summary>Комментарии (' + cm.length + ')</summary>';
    for (var i = 0; i < cm.length; i++) {
      var c = cm[i];
      s += '<p><small><a href="#" data-action="profile" data-arg="' + esc(c.author) + '">' +
           esc(c.author) + '</a> · ' + fmtAgo(c.date) + '</small><br>' +
           esc(c.text).replace(/\n/g, '<br>');
      if (me && (c.author === me || p.author === me)) {
        s += ' <button type="button" class="comment-del" data-id="' + esc(p.id) +
             '" data-cid="' + esc(c.id) + '">×</button>';
      }
      s += '</p>';
    }
    if (me) {
      s += '<form class="comment-form" data-id="' + esc(p.id) + '">' +
           '<textarea rows="2" placeholder="Написать комментарий..."></textarea><br>' +
           '<button type="submit">Отправить комментарий</button></form>';
    } else {
      s += '<p><small>Войдите, чтобы комментировать.</small></p>';
    }
    return s + '</details>';
  }

  var _postHtml = postHtml;
  postHtml = function (p, opts) {
    var h = _postHtml(p, opts);
    var tail = '</article>';
    var i = h.lastIndexOf(tail);
    return i < 0 ? h + socialHtml(p) : h.slice(0, i) + socialHtml(p) + h.slice(i);
  };

  function mutatePost(id, fn) {
    var ps = getPosts();
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].id === id) { fn(ps[i]); savePosts(ps); return ps[i]; }
    }
    return null;
  }

  function postLabel(p) { return p.title ? ' «' + p.title + '»' : ''; }

  var _bindPostActions = bindPostActions;
  bindPostActions = function (root) {
    _bindPostActions(root);
    var me = currentUser(), i;
    var det = root.querySelectorAll('details[data-id]');
    for (i = 0; i < det.length; i++) {
      det[i].addEventListener('toggle', function () {
        openPosts[this.getAttribute('data-id')] = this.open;
      });
    }
    if (!me) return;
    var likes = root.querySelectorAll('.post-like');
    for (i = 0; i < likes.length; i++) {
      likes[i].addEventListener('click', function () {
        var added = false;
        var p = mutatePost(this.getAttribute('data-id'), function (p) {
          p.likes = p.likes || [];
          var k = p.likes.indexOf(me);
          if (k >= 0) p.likes.splice(k, 1); else { p.likes.push(me); added = true; }
        });
        if (p && added && p.author !== me) {
          addNotif(p.author, me, 'like', me + ' оценил(а) вашу запись' + postLabel(p), { postId: p.id });
        }
        refreshCurrent();
      });
    }
    var forms = root.querySelectorAll('.comment-form');
    for (i = 0; i < forms.length; i++) {
      forms[i].addEventListener('submit', function (ev) {
        ev.preventDefault();
        var text = this.querySelector('textarea').value.trim();
        if (!text) return;
        var id = this.getAttribute('data-id');
        var p = mutatePost(id, function (p) {
          p.comments = p.comments || [];
          p.comments.push({ id: uid(), author: me, text: text, date: Date.now() });
        });
        openPosts[id] = true;
        if (p && p.author !== me) {
          addNotif(p.author, me, 'comment', me + ' прокомментировал(а) вашу запись' + postLabel(p), { postId: p.id });
        }
        refreshCurrent();
      });
    }
    var dels = root.querySelectorAll('.comment-del');
    for (i = 0; i < dels.length; i++) {
      dels[i].addEventListener('click', function () {
        if (!confirm('Удалить комментарий?')) return;
        var cid = this.getAttribute('data-cid');
        var pid = this.getAttribute('data-id');
        openPosts[pid] = true;
        mutatePost(pid, function (p) {
          p.comments = (p.comments || []).filter(function (c) { return c.id !== cid; });
        });
        refreshCurrent();
      });
    }
  };

  /* ---------- 5. Поиск ---------- */
  var lastQ = '', lastSec = '';
  renderSearch = function () {
    var el = $('page-search');
    if (!el) return;
    var h = '<h2>Поиск</h2>' +
      '<input type="search" id="q" placeholder="Слово, заглавие, имя, город..." ' +
      'style="width:70%;max-width:400px" value="' + esc(lastQ) + '"> ' +
      '<select id="qs"><option value="">Все разделы</option>';
    for (var k in SECTIONS) {
      h += '<option value="' + esc(k) + '"' + (k === lastSec ? ' selected' : '') + '>' +
           esc(SECTIONS[k].name) + '</option>';
    }
    h += '</select><div id="q-res"></div>';
    el.innerHTML = h;

    var q = $('q'), qs = $('qs');
    function run() {
      lastQ = q ? q.value : '';
      lastSec = qs ? qs.value : '';
      searchResults();
    }
    if (q) q.addEventListener('input', run);
    if (qs) qs.addEventListener('change', run);
    searchResults();
    if (!lastQ && q) q.focus();
  };

  function searchResults() {
    var box = $('q-res');
    if (!box) return;
    var t = lastQ.trim().toLowerCase();
    if (!t && !lastSec) {
      box.innerHTML = '<p>Введите запрос или выберите раздел.</p>';
      return;
    }
    var posts = getPosts().filter(function (p) {
      if (p.type !== 'article') return false;
      if (lastSec && p.section !== lastSec) return false;
      if (!t) return true;
      return ((p.title || '') + ' ' + (p.text || '') + ' ' + (p.author || '')).toLowerCase().indexOf(t) >= 0;
    });
    posts.sort(function (a, b) { return b.date - a.date; });

    var h = '';
    if (t && !lastSec) {
      var people = getUsers().filter(function (u) {
        return ((u.login || '') + ' ' + (u.city || '') + ' ' + (u.occupation || '') + ' ' +
          (u.bio || '') + ' ' + (u.books || '') + ' ' + (u.hobbies || '')).toLowerCase().indexOf(t) >= 0;
      });
      h += '<h3>Люди (' + people.length + ')</h3>';
      if (people.length) {
        h += '<ul>';
        for (var i = 0; i < people.length; i++) {
          var u = people[i];
          h += '<li><a href="#" data-action="profile" data-arg="' + esc(u.login) + '">' + esc(u.login) + '</a>' +
               (u.city ? ', ' + esc(u.city) : '') +
               (u.occupation ? ', ' + esc(u.occupation) : '') + '</li>';
        }
        h += '</ul>';
      }
    }

    h += '<h3>Статьи (' + posts.length + ')</h3>';
    var shown = posts.slice(0, 50);
    for (var j = 0; j < shown.length; j++) {
      h += postHtml(shown[j], { showAuthor: true, showSection: true });
    }
    if (posts.length > 50) {
      h += '<p><small>Показаны первые 50. Уточните запрос.</small></p>';
    }
    box.innerHTML = h;
    bindPostActions(box);
  }

  /* Запуск начальной загрузки из облака и автообновление каждые 4 сек */
  pullFromSupabase(true);
  setInterval(function () { pullFromSupabase(false); }, 4000);
     /* ---------- 6. Звуковое уведомление при новом СМС ---------- */
  function playSmsSound() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.09);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch (e) {}
  }

  var knownMaxMsgTime = 0;
  function checkNewSms(isFirstRun) {
    var me = currentUser();
    if (!me || typeof getMsgs !== 'function') return;
    var msgs = getMsgs();
    var latestIncoming = 0;
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var isForMe = (m.to === me) || (m.participants && m.participants.indexOf(me) >= 0 && m.from !== me && m.author !== me);
      var ts = m.date || m.ts || m.time || 0;
      if (isForMe && ts > latestIncoming) latestIncoming = ts;
    }
    if (isFirstRun) {
      knownMaxMsgTime = latestIncoming;
      return;
    }
    if (latestIncoming > knownMaxMsgTime) {
      knownMaxMsgTime = latestIncoming;
      playSmsSound();
    }
  }

  setTimeout(function () { checkNewSms(true); }, 1500);
  setInterval(function () { checkNewSms(false); }, 4000);
  /* ---------- 7. Панель администратора (только для ADMIN_LOGIN) ---------- */
  function isAdmin() {
    var me = currentUser();
    return !!(me && ADMIN_LOGIN && me.toLowerCase() === ADMIN_LOGIN.toLowerCase());
  }

  var _postHtmlAdmin = postHtml;
  postHtml = function (p, opts) {
    var h = _postHtmlAdmin(p, opts);
    if (!isAdmin() || p.author === currentUser()) return h;
    var btn = '<p><button type="button" class="post-del admin-del-post" data-id="' + p.id + '">[Админ] Удалить запись</button></p>';
    var tail = '</article><hr>';
    var i = h.lastIndexOf(tail);
    return i < 0 ? h : h.slice(0, i) + btn + h.slice(i);
  };

  var _bindAdmin = bindPostActions;
  bindPostActions = function (root) {
    _bindAdmin(root);
    if (!isAdmin()) return;

    var adminDels = root.querySelectorAll('.admin-del-post');
    for (var i = 0; i < adminDels.length; i++) {
      adminDels[i].addEventListener('click', function () {
        if (!confirm('Удалить эту запись как администратор?')) return;
        var id = this.getAttribute('data-id');
        var ps = getPosts().filter(function (x) { return x.id !== id; });
        savePosts(ps);
        refreshCurrent();
      });
    }
  };

  var _renderProfilesAdmin = renderProfiles;
  renderProfiles = function () {
    _renderProfilesAdmin();
    if (!isAdmin()) return;
    var el = $('page-profiles');
    var items = el.querySelectorAll('li');
    for (var i = 0; i < items.length; i++) {
      var link = items[i].querySelector('a[data-action="profile"]');
      if (!link) continue;
      var target = link.getAttribute('data-arg');
      if (target && target.toLowerCase() !== ADMIN_LOGIN.toLowerCase()) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'post-del';
        b.style.marginLeft = '10px';
        b.style.padding = '1px 6px';
        b.textContent = 'Удалить и забанить';
        b.setAttribute('data-ban', target);
        b.addEventListener('click', function () {
          var who = this.getAttribute('data-ban');
          if (!confirm('Точно удалить аккаунт «' + who + '» и все его посты?')) return;
          saveUsers(getUsers().filter(function (u) { return u.login !== who; }));
          savePosts(getPosts().filter(function (p) { return p.author !== who; }));
          refreshCurrent();
        });
        items[i].appendChild(b);
      }
    }
  };
  /* ---------- 8. Ранги и бейджи (DEV / DEV.TEAM) ---------- */
  function getUserBadgeHtml(login) {
    if (!login) return '';
    var role = '';
    if (typeof ADMIN_LOGIN !== 'undefined' && login.toLowerCase() === ADMIN_LOGIN.toLowerCase()) {
      role = 'DEV';
    } else {
      var u = typeof getUser === 'function' ? getUser(login) : null;
      if (u && u.rank) role = u.rank;
    }
    if (!role) return '';
    var bg = (role === 'DEV') ? '#480303' : '#2a5885';
    return ' <span style="display:inline-block;padding:1px 5px;margin-left:4px;background:' + bg +
           ';color:#fff;font:bold 10px/1.2 Tahoma,Arial,sans-serif;border-radius:2px;vertical-align:middle;letter-spacing:0.5px;">' +
           esc(role) + '</span>';
  }

  function injectBadges(root) {
    if (!root) return;
    var links = root.querySelectorAll('a[data-action="profile"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (a.getAttribute('data-badged')) continue;
      a.setAttribute('data-badged', '1');
      var login = a.getAttribute('data-arg') || a.textContent.trim();
      var badge = getUserBadgeHtml(login);
      if (badge) a.insertAdjacentHTML('afterend', badge);
    }
  }

  var _showPageRank = showPage;
  showPage = function (name, arg) {
    _showPageRank(name, arg);
    injectBadges($('main'));

    /* Бейдж в заголовке самого профиля */
    if (name === 'profile') {
      var targetLogin = arg || currentUser();
      var h2 = $('page-profile') ? $('page-profile').querySelector('h2') : null;
      if (h2 && targetLogin && !h2.getAttribute('data-badged')) {
        h2.setAttribute('data-badged', '1');
        var badge = getUserBadgeHtml(targetLogin);
        if (badge) h2.insertAdjacentHTML('beforeend', badge);
      }
    }

    /* Кнопка выдачи ранга DEV.TEAM в списке «Люди» (видна только тебе) */
    if (name === 'profiles' && typeof isAdmin === 'function' && isAdmin()) {
      var items = $('page-profiles').querySelectorAll('li');
      for (var i = 0; i < items.length; i++) {
        var link = items[i].querySelector('a[data-action="profile"]');
        if (!link) continue;
        var target = link.getAttribute('data-arg');
        if (!target || target.toLowerCase() === ADMIN_LOGIN.toLowerCase()) continue;

        var u = getUser(target);
        var hasTeam = !!(u && u.rank === 'DEV.TEAM');
        var rBtn = document.createElement('button');
        rBtn.type = 'button';
        rBtn.style.marginLeft = '8px';
        rBtn.style.padding = '1px 6px';
        rBtn.style.fontSize = '11px';
        rBtn.textContent = hasTeam ? 'Снять DEV.TEAM' : 'Выдать DEV.TEAM';
        rBtn.setAttribute('data-rank-user', target);
        rBtn.addEventListener('click', function () {
          var who = this.getAttribute('data-rank-user');
          var users = getUsers();
          for (var j = 0; j < users.length; j++) {
            if (users[j].login === who) {
              users[j].rank = (users[j].rank === 'DEV.TEAM') ? '' : 'DEV.TEAM';
              break;
            }
          }
          saveUsers(users);
          refreshCurrent();
        });
        items[i].appendChild(rBtn);
      }
    }
  };

})();
