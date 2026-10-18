/* Sourcingo OS shim: stands in for the claude.ai capabilities inside the OS (page /markers).
   Archive -> /api/markers/styles (shared by the company's orders team); Claude reading -> /api/markers/jobs, read on
   Supabase with the company's AI key; downloads -> normal file download. */
(function () {
  if (window.claude && window.claude.use) return;
  if (!Object.fromEntries) Object.fromEntries = function (it) { var o = {}; Array.from(it).forEach(function (p) { o[p[0]] = p[1]; }); return o; };
  var BATCH = 3.8 * 1024 * 1024; // base64 characters the server accepts in one request (hosting limit 4.5 MB)
  var BUDGET = 24 * 1024 * 1024; // base64 characters sent to Claude in one reading (its limit is 32 MB per request)
  function err(code, message) { var e = new Error(message || code); e.code = code; return e; }
  function api(url, opts) {
    return fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts)).then(function (r) {
      return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) {} if (!r.ok && r.status !== 202) throw err(r.status === 429 ? 'rate_limited' : 'http_' + r.status, (j && j.message) || ('Server error ' + r.status)); return j; });
    });
  }

  // ---------------------------------------------------------------- archive
  var listeners = [], last = null;
  function snap(docs) { return { docs: docs.map(function (d) { return { id: d.id, exists: true, data: function () { return d.data; } }; }) }; }
  function refresh() {
    return api('/api/markers/styles').then(function (j) { last = (j && j.docs) || []; listeners.forEach(function (l) { l.cb(snap(last)); }); })
      .catch(function (e) { listeners.forEach(function (l) { if (l.onErr) l.onErr(e); }); });
  }
  setInterval(function () { if (listeners.length && document.visibilityState !== 'hidden') refresh(); }, 60000);
  document.addEventListener('visibilitychange', function () { if (listeners.length && document.visibilityState === 'visible') refresh(); });
  var db = {
    collection: function () {
      return {
        onSnapshot: function (cb, onErr) { var l = { cb: cb, onErr: onErr }; listeners.push(l); if (last) setTimeout(function () { cb(snap(last)); }, 0); refresh(); return function () { listeners.splice(listeners.indexOf(l), 1); }; },
        doc: function (id) {
          return { set: function (data) { return api('/api/markers/styles?id=' + encodeURIComponent(id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }).then(refresh); } };
        },
      };
    },
  };

  // ---------------------------------------------------------------- downloads
  var downloads = {
    save: function (req) {
      var blob = req.data instanceof Blob ? req.data : new Blob([req.data], { type: 'text/plain' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = req.filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      return Promise.resolve({ status: 'saved' });
    },
  };

  // ---------------------------------------------------------------- Claude reading
  function dataURL(blob) { return new Promise(function (ok, no) { var r = new FileReader(); r.onload = function () { ok(String(r.result)); }; r.onerror = function () { no(err('image_rejected', 'A file could not be read.')); }; r.readAsDataURL(blob); }); }
  function shrink(blob, edge, quality) {
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        var s = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(err('image_rejected', 'One photo could not be opened. Remove it and try again.')); };
      img.src = url;
    });
  }
  function pack(images, edge, quality) {
    // One at a time: decoding many full-size photos at once can run a phone out of memory.
    var urls = [];
    return images.reduce(function (p, b) { return p.then(function () { return (b.type === 'application/pdf' ? dataURL(b) : shrink(b, edge, quality)).then(function (u) { urls.push(u); }); }); }, Promise.resolve()).then(function () {
      return urls.map(function (u, i) { return { type: images[i].type === 'application/pdf' ? 'application/pdf' : 'image/jpeg', data: u.slice(u.indexOf(',') + 1) }; });
    });
  }
  function size(files) { return files.reduce(function (n, f) { return n + f.data.length; }, 0); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // A long reading goes to Claude's queue: then it is checked less often and may take up to an hour.
  function poll(id, t0, queued) {
    var limit = (queued ? 60 : 12) * 60000;
    return wait(queued ? 20000 : 3000).then(function () { return api('/api/markers/jobs?id=' + id); }).then(function (j) {
      if (j && j.status === 'done') return j.result;
      if (j && j.status === 'error') throw err(j.code === 'rate_limited' || j.code === 'invalid_json' ? j.code : 'failed', j.message);
      if (Date.now() - t0 > limit) throw err('failed', 'Reading took too long. Try again with fewer files.');
      return poll(id, t0, !!(j && j.queued));
    }, function (e) { if (Date.now() - t0 > limit) throw e; return poll(id, t0, queued); });
  }
  var sample = {
    limits: function () { return Promise.resolve({ images: { maxCount: 100, maxInputBytes: 40 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] } }); },
    json: function (prompt, opts) {
      var images = (opts && opts.images) || [];
      if (images.length > 100) return Promise.reject(err('prompt_too_large', 'Claude can read up to 100 photos and pages at once. Remove some photos.'));
      var tries = [[1568, 0.85], [1200, 0.75], [1000, 0.7], [800, 0.65]];
      function attempt(i) {
        return pack(images, tries[i][0], tries[i][1]).then(function (files) {
          var fits = size(files) + prompt.length <= BUDGET && files.every(function (f) { return f.data.length <= BATCH - prompt.length; });
          if (fits) return files;
          if (i + 1 < tries.length) return attempt(i + 1);
          throw err('prompt_too_large', 'The files are too large together. Send fewer photos or a smaller tech pack PDF.');
        });
      }
      return attempt(0).then(function (files) {
        // Split into batches under the server's request limit, keeping the order.
        var batches = [[]], n = prompt.length;
        files.forEach(function (f) { if (n + f.data.length > BATCH && batches[batches.length - 1].length) { batches.push([]); n = 0; } batches[batches.length - 1].push(f); n += f.data.length; });
        return api('/api/markers/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: prompt, files: batches[0] }) }).then(function (j) {
          var chain = Promise.resolve();
          batches.slice(1).forEach(function (b, i) { chain = chain.then(function () { return api('/api/markers/jobs?id=' + j.id + '&part=' + (i + 1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: b }) }); }); });
          return chain.then(function () { return j; });
        });
      }).then(function (j) {
        return api('/api/markers/jobs?id=' + j.id + '&start=1', { method: 'POST' }).then(function () { return poll(j.id, Date.now(), false); });
      });
    },
  };

  window.MARKERPILOT_WEB = true;
  window.claude = { use: function (n) { return Promise.resolve(n === 'db' ? db : n === 'downloads' ? downloads : n === 'sample' ? sample : null); } };
})();
